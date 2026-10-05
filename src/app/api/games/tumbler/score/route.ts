import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { desc, eq, count, sql } from 'drizzle-orm';
import { db } from '@/server/db/client';
import { tumblerScores } from '@/server/db/schema';
import { requireIdentity } from '@/server/auth';
import { broadcast } from '@/server/events';
import {
  consumeGameSessionOrReject,
  validateGameSession,
} from '@/server/arcade/game-session';
import {
  validateTumblerRun,
  TUMBLER_MAX_SCORE,
  TUMBLER_MAX_TAPS,
  type TumblerTap,
} from '@/server/arcade/tumbler-replay';
import { awardGameRunCredits } from '@/server/arcade/rewards';
import { recordRunAchievements } from '../../_shared/run-achievements';
import { recordGameTimeMetric } from '@/server/arcade/game-time-metrics';
import {
  runAntiCheat,
  type ActionEntry,
  type EnvFingerprint,
} from '@/server/arcade/anti-cheat';
import {
  authenticateGamePlayer,
  isErrorResponse,
  parsePayload,
  rejectScore,
} from '../../_shared/score-helpers';
import { runScoreRoutePipeline } from '../../_shared/score-route-pipeline';
import { recordScoreEvent } from '@/server/arcade/score-events';
import { SCORE_RESPONSE_LEADERBOARD_LIMIT } from '../../_shared/constants';

type RawTap = { t?: unknown };

type ScorePayload = {
  score?: number;
  sessionToken?: string;
  taps?: RawTap[];
  clientDurationMs?: number;
  env?: EnvFingerprint;
};

// The longest a single Tumbler run can plausibly last on the server clock. The
// deepest scoreable pin is TUMBLER_MAX_PINS; even at a leisurely few seconds per
// pin that is well inside this ceiling. A session that posts far past it (a
// stalled tab, or a clock-stretch attempt) is rejected outright.
const MAX_SESSION_DURATION_MS = 60 * 60 * 1000; // 1 hour

export async function GET() {
  let identity;
  try {
    identity = await requireIdentity({ allowExternal: true, allowGuest: true });
  } catch {
    return NextResponse.json(
      { error: 'Authentication required.' },
      { status: 401 },
    );
  }

  try {
    const bestScore = await db
      .select({ score: tumblerScores.score })
      .from(tumblerScores)
      .where(eq(tumblerScores.odUserId, identity.userId))
      .orderBy(desc(tumblerScores.score))
      .limit(1);

    return NextResponse.json({ bestScore: bestScore[0]?.score ?? 0 });
  } catch (error) {
    console.error('Failed to fetch user best score:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const authResult = await authenticateGamePlayer('tumbler');
  if (isErrorResponse(authResult)) return authResult;
  const { identity, identityName } = authResult;

  const payload = await parsePayload<ScorePayload>(request);
  if (payload instanceof NextResponse) return payload;

  if (
    typeof payload?.score !== 'number' ||
    typeof payload?.sessionToken !== 'string' ||
    !Array.isArray(payload?.taps)
  ) {
    return NextResponse.json(
      { error: 'Invalid score data. Session token and taps required.' },
      { status: 400 },
    );
  }

  const { sessionToken, env } = payload;
  const claimedScore = Math.floor(payload.score);

  if (
    !Number.isFinite(claimedScore) ||
    claimedScore < 0 ||
    claimedScore > TUMBLER_MAX_SCORE
  ) {
    return NextResponse.json({ error: 'Invalid score value.' }, { status: 400 });
  }

  // Reject obviously oversized payloads before doing any work. A run can submit
  // at most two taps per pin (sticky pins) plus the fatal miss; generous headroom.
  if (payload.taps.length > TUMBLER_MAX_TAPS) {
    return rejectScore('tumbler', {
      userId: identity.userId,
      userName: identityName,
      score: claimedScore,
      stage: 'payload',
      reason: `Tap payload too large (${payload.taps.length})`,
      publicMessage: 'Invalid score data.',
    });
  }

  // Normalize the submitted taps to the validator's shape. We trust ONLY the
  // timestamp; validateTumblerRun re-derives every notch angle from the seed.
  const taps: TumblerTap[] = payload.taps.map((entry) => ({
    t: Number((entry as RawTap)?.t),
  }));

  // Validate the game session token + server clock.
  const sessionValidation = await validateGameSession(
    sessionToken,
    identity.userId,
    'tumbler',
    claimedScore,
    undefined,
    { consumeSession: false },
  );

  if (!sessionValidation.valid) {
    return rejectScore('tumbler', {
      userId: identity.userId,
      userName: identityName,
      score: claimedScore,
      stage: 'session',
      reason: sessionValidation.error ?? 'Invalid game session.',
      publicMessage: 'Invalid game session.',
    });
  }

  const sessionId = sessionValidation.session?.sessionId;
  const sessionDurationMs = sessionValidation.session?.durationMs ?? 0;
  const tumblerSeed = sessionValidation.session?.tumblerSeed;

  if (!sessionId) {
    return rejectScore('tumbler', {
      userId: identity.userId,
      userName: identityName,
      score: claimedScore,
      stage: 'session',
      reason: 'Missing session id',
      publicMessage: 'Invalid game session.',
    });
  }

  if (typeof tumblerSeed !== 'number') {
    return rejectScore('tumbler', {
      userId: identity.userId,
      userName: identityName,
      score: claimedScore,
      stage: 'session',
      reason: 'Missing tumbler seed for session',
      publicMessage: 'Invalid game session.',
    });
  }

  // Server-clock ceiling: reject a run that posts implausibly long after it
  // began (stalled tab / clock-stretch). The client timeline is cosmetic — only
  // this server-measured elapsed gates the session.
  if (sessionDurationMs > MAX_SESSION_DURATION_MS) {
    return rejectScore('tumbler', {
      userId: identity.userId,
      userName: identityName,
      score: claimedScore,
      stage: 'session',
      reason: `Session duration exceeds window (${sessionDurationMs}ms)`,
      publicMessage: 'Invalid game session.',
    });
  }

  // === SERVER-AUTHORITATIVE SCORE ===
  // Re-derive every pin's notch + speed from the seed and count the leading run
  // of valid consecutive clicks. The client-claimed number is never trusted; it
  // must equal this authoritative count.
  const runResult = validateTumblerRun(tumblerSeed, taps);
  const authoritativeScore = runResult.score;

  if (claimedScore !== authoritativeScore) {
    return rejectScore('tumbler', {
      userId: identity.userId,
      userName: identityName,
      score: claimedScore,
      stage: 'server-replay',
      reason: `Authoritative score mismatch (server=${authoritativeScore}, client=${claimedScore}, pins=${runResult.pins}, inspected=${runResult.inspected}, stop=${runResult.stop}, taps=${taps.length}, session=${sessionDurationMs}ms)`,
    });
  }

  // Build a per-click ActionEntry timeline for the generic anti-cheat pass
  // (env/webdriver/time-ratio + score-jump anomaly). The validator already
  // reconstructed the absolute wall time of every counted tap.
  const clickActions: ActionEntry[] = runResult.clickTimesAbs.map((abs, i) => ({
    t: Math.max(0, Math.floor(abs)),
    d: { pin: i },
  }));

  const [previousBest, gameCount] = await Promise.all([
    db
      .select({ score: tumblerScores.score })
      .from(tumblerScores)
      .where(eq(tumblerScores.odUserId, identity.userId))
      .orderBy(desc(tumblerScores.score))
      .limit(1)
      .then((rows) => rows[0]?.score ?? null),
    db
      .select({ count: count() })
      .from(tumblerScores)
      .where(eq(tumblerScores.odUserId, identity.userId))
      .then((rows) => rows[0]?.count ?? 0),
  ]);

  const antiCheat = await runAntiCheat({
    gameType: 'tumbler',
    userId: identity.userId,
    userName: identityName,
    score: authoritativeScore,
    actions: clickActions,
    env: env ?? null,
    previousBest,
    sessionDurationMs,
    serverActionCount: sessionValidation.session?.actionCount,
    serverActionCounts: sessionValidation.session?.actionCounts,
    gameCount,
  });

  return runScoreRoutePipeline({
    antiCheat,
    identity,
    persist: async ({ now, userName }) => {
      // Atomically claim the session first: a losing duplicate submit throws a
      // 409 here and performs zero writes.
      await consumeGameSessionOrReject(sessionId, identity.userId);

      const existing = (
        await db
          .select({ score: tumblerScores.score })
          .from(tumblerScores)
          .where(eq(tumblerScores.odUserId, identity.userId))
          .limit(1)
      )[0];

      await db
        .insert(tumblerScores)
        .values({
          id: crypto.randomUUID(),
          odUserId: identity.userId,
          userName,
          score: authoritativeScore,
          createdAt: now,
        })
        .onConflictDoUpdate({
          target: tumblerScores.odUserId,
          set: {
            userName,
            score: authoritativeScore,
            createdAt: now,
          },
          where: sql`excluded.score > ${tumblerScores.score}`,
        });

      await recordScoreEvent({
        gameSlug: 'tumbler',
        userId: identity.userId,
        userName,
        score: authoritativeScore,
      }).catch(() => {});

      const reward = await awardGameRunCredits({
        userId: identity.userId,
        context: { gameType: 'tumbler', score: authoritativeScore },
        sourceId: `tumbler:${sessionId}`,
        meta: {
          score: authoritativeScore,
          antiCheat: antiCheat.severity ?? 'pass',
        },
      });
      const achievements = await recordRunAchievements(
        identity.userId,
        { gameType: 'tumbler', score: authoritativeScore },
        reward,
        { durationMs: sessionDurationMs },
      );

      await recordGameTimeMetric({
        userId: identity.userId,
        gameType: 'tumbler',
        durationMs: Math.min(sessionDurationMs, MAX_SESSION_DURATION_MS),
        playedAtMs: now,
      });

      const leaderboard = await db
        .select()
        .from(tumblerScores)
        .orderBy(desc(tumblerScores.score))
        .limit(SCORE_RESPONSE_LEADERBOARD_LIMIT);

      broadcast('gameLeaderboards', {
        gameType: 'tumbler',
        updatedAt: now,
      });

      return {
        success: true,
        isNewPB: !existing || authoritativeScore > existing.score,
        reward,
        achievements,
        leaderboard: leaderboard.map((entry) => ({
          id: entry.id,
          userId: entry.odUserId,
          userName: entry.userName,
          score: entry.score,
        })),
      };
    },
  });
}
