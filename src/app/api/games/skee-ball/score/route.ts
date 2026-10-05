import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { desc, eq, count, sql } from 'drizzle-orm';
import { db } from '@/server/db/client';
import { skeeBallScores } from '@/server/db/schema';
import { requireIdentity } from '@/server/auth';
import { broadcast } from '@/server/events';
import {
  consumeGameSessionOrReject,
  validateGameSession,
} from '@/server/arcade/game-session';
import {
  validateSkeeRun,
  SKEE_MAX_SCORE,
  SKEE_MAX_THROWS,
  skeeDailyTarget,
  skeeDateKey,
  type SkeeThrow,
} from '@/server/arcade/skee-ball-replay';
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

type RawThrow = { t?: unknown; aim?: unknown; power?: unknown };

type ScorePayload = {
  score?: number;
  sessionToken?: string;
  throws?: RawThrow[];
  clientDurationMs?: number;
  env?: EnvFingerprint;
};

// The longest a single Skee-Ball frame can plausibly last on the server clock.
// Nine balls, even at a leisurely pace, are well inside this ceiling. A
// session that posts far past it (a stalled tab, or a clock-stretch attempt)
// is rejected outright.
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
      .select({ score: skeeBallScores.score })
      .from(skeeBallScores)
      .where(eq(skeeBallScores.odUserId, identity.userId))
      .orderBy(desc(skeeBallScores.score))
      .limit(1);

    return NextResponse.json({
      bestScore: bestScore[0]?.score ?? 0,
      // Today's target (UTC). Shown on the cabinet; it pays nothing extra.
      dailyTarget: skeeDailyTarget(skeeDateKey(Date.now())),
    });
  } catch (error) {
    console.error('Failed to fetch user best score:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const authResult = await authenticateGamePlayer('skee-ball');
  if (isErrorResponse(authResult)) return authResult;
  const { identity, identityName } = authResult;

  const payload = await parsePayload<ScorePayload>(request);
  if (payload instanceof NextResponse) return payload;

  if (
    typeof payload?.score !== 'number' ||
    typeof payload?.sessionToken !== 'string' ||
    !Array.isArray(payload?.throws)
  ) {
    return NextResponse.json(
      { error: 'Invalid score data. Session token and throws required.' },
      { status: 400 },
    );
  }

  const { sessionToken, env } = payload;
  const claimedScore = Math.floor(payload.score);

  if (
    !Number.isFinite(claimedScore) ||
    claimedScore < 0 ||
    claimedScore > SKEE_MAX_SCORE
  ) {
    return NextResponse.json({ error: 'Invalid score value.' }, { status: 400 });
  }

  // Reject obviously oversized payloads before doing any work. A frame submits
  // nine throws; generous headroom for ignored (under-cadence) releases.
  if (payload.throws.length > SKEE_MAX_THROWS) {
    return rejectScore('skee-ball', {
      userId: identity.userId,
      userName: identityName,
      score: claimedScore,
      stage: 'payload',
      reason: `Throw payload too large (${payload.throws.length})`,
      publicMessage: 'Invalid score data.',
    });
  }

  // Normalize the submitted throws to the validator's shape. We trust ONLY the
  // release params + timestamp; validateSkeeRun re-derives every trajectory,
  // ring, and lit-ring multiplier from the seed.
  const throws: SkeeThrow[] = payload.throws.map((entry) => ({
    t: Number((entry as RawThrow)?.t),
    aim: Number((entry as RawThrow)?.aim),
    power: Number((entry as RawThrow)?.power),
  }));

  // Validate the game session token + server clock.
  const sessionValidation = await validateGameSession(
    sessionToken,
    identity.userId,
    'skee-ball',
    claimedScore,
    undefined,
    { consumeSession: false },
  );

  if (!sessionValidation.valid) {
    return rejectScore('skee-ball', {
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
  const skeeBallSeed = sessionValidation.session?.skeeBallSeed;

  if (!sessionId) {
    return rejectScore('skee-ball', {
      userId: identity.userId,
      userName: identityName,
      score: claimedScore,
      stage: 'session',
      reason: 'Missing session id',
      publicMessage: 'Invalid game session.',
    });
  }

  if (typeof skeeBallSeed !== 'number') {
    return rejectScore('skee-ball', {
      userId: identity.userId,
      userName: identityName,
      score: claimedScore,
      stage: 'session',
      reason: 'Missing skee-ball seed for session',
      publicMessage: 'Invalid game session.',
    });
  }

  // Server-clock ceiling: reject a run that posts implausibly long after it
  // began (stalled tab / clock-stretch). The client timeline is cosmetic — only
  // this server-measured elapsed gates the session.
  if (sessionDurationMs > MAX_SESSION_DURATION_MS) {
    return rejectScore('skee-ball', {
      userId: identity.userId,
      userName: identityName,
      score: claimedScore,
      stage: 'session',
      reason: `Session duration exceeds window (${sessionDurationMs}ms)`,
      publicMessage: 'Invalid game session.',
    });
  }

  // === SERVER-AUTHORITATIVE SCORE ===
  // Replay every throw's release params through the deterministic lane sim and
  // apply the seed-derived lit-ring schedule. The client-claimed number is
  // never trusted; it must equal this authoritative count.
  const runResult = validateSkeeRun(skeeBallSeed, throws);
  const authoritativeScore = runResult.score;

  if (claimedScore !== authoritativeScore) {
    return rejectScore('skee-ball', {
      userId: identity.userId,
      userName: identityName,
      score: claimedScore,
      stage: 'server-replay',
      reason: `Authoritative score mismatch (server=${authoritativeScore}, client=${claimedScore}, balls=${runResult.balls}, inspected=${runResult.inspected}, stop=${runResult.stop}, throws=${throws.length}, session=${sessionDurationMs}ms)`,
    });
  }

  // Build a per-throw ActionEntry timeline for the generic anti-cheat pass
  // (env/webdriver/time-ratio + score-jump anomaly).
  const throwActions: ActionEntry[] = runResult.throwTimesAbs.map((abs, i) => ({
    t: Math.max(0, Math.floor(abs)),
    d: { ball: i },
  }));

  const [previousBest, gameCount] = await Promise.all([
    db
      .select({ score: skeeBallScores.score })
      .from(skeeBallScores)
      .where(eq(skeeBallScores.odUserId, identity.userId))
      .orderBy(desc(skeeBallScores.score))
      .limit(1)
      .then((rows) => rows[0]?.score ?? null),
    db
      .select({ count: count() })
      .from(skeeBallScores)
      .where(eq(skeeBallScores.odUserId, identity.userId))
      .then((rows) => rows[0]?.count ?? 0),
  ]);

  const antiCheat = await runAntiCheat({
    gameType: 'skee-ball',
    userId: identity.userId,
    userName: identityName,
    score: authoritativeScore,
    actions: throwActions,
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
          .select({ score: skeeBallScores.score })
          .from(skeeBallScores)
          .where(eq(skeeBallScores.odUserId, identity.userId))
          .limit(1)
      )[0];

      await db
        .insert(skeeBallScores)
        .values({
          id: crypto.randomUUID(),
          odUserId: identity.userId,
          userName,
          score: authoritativeScore,
          createdAt: now,
        })
        .onConflictDoUpdate({
          target: skeeBallScores.odUserId,
          set: {
            userName,
            score: authoritativeScore,
            createdAt: now,
          },
          where: sql`excluded.score > ${skeeBallScores.score}`,
        });

      await recordScoreEvent({
        gameSlug: 'skee-ball',
        userId: identity.userId,
        userName,
        score: authoritativeScore,
      }).catch(() => {});

      const reward = await awardGameRunCredits({
        userId: identity.userId,
        context: { gameType: 'skee-ball', score: authoritativeScore },
        sourceId: `skee-ball:${sessionId}`,
        meta: {
          score: authoritativeScore,
          antiCheat: antiCheat.severity ?? 'pass',
        },
      });
      const achievements = await recordRunAchievements(
        identity.userId,
        { gameType: 'skee-ball', score: authoritativeScore },
        reward,
        { durationMs: sessionDurationMs },
      );

      await recordGameTimeMetric({
        userId: identity.userId,
        gameType: 'skee-ball',
        durationMs: Math.min(sessionDurationMs, MAX_SESSION_DURATION_MS),
        playedAtMs: now,
      });

      const leaderboard = await db
        .select()
        .from(skeeBallScores)
        .orderBy(desc(skeeBallScores.score))
        .limit(SCORE_RESPONSE_LEADERBOARD_LIMIT);

      broadcast('gameLeaderboards', {
        gameType: 'skee-ball',
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
