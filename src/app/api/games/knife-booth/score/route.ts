import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { desc, eq, count, sql } from 'drizzle-orm';
import { db } from '@/server/db/client';
import { knifeBoothScores } from '@/server/db/schema';
import { requireIdentity } from '@/server/auth';
import { broadcast } from '@/server/events';
import {
  consumeGameSessionOrReject,
  validateGameSession,
} from '@/server/arcade/game-session';
import {
  validateKnifeRun,
  KNIFE_MAX_SCORE,
  KNIFE_MAX_TAPS,
  type KnifeThrow,
} from '@/server/arcade/knife-booth-replay';
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

type RawThrow = { t?: unknown };

type ScorePayload = {
  score?: number;
  sessionToken?: string;
  throws?: RawThrow[];
  clientDurationMs?: number;
  env?: EnvFingerprint;
};

// The longest a single Knife Booth run can plausibly last on the server clock.
// Even a marathon endless run (deep stage counts at a few seconds each) is well
// inside this ceiling; a session posting far past it (a stalled tab, or a
// clock-stretch attempt) is rejected outright.
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
      .select({ score: knifeBoothScores.score })
      .from(knifeBoothScores)
      .where(eq(knifeBoothScores.odUserId, identity.userId))
      .orderBy(desc(knifeBoothScores.score))
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
  const authResult = await authenticateGamePlayer('knife-booth');
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
    claimedScore > KNIFE_MAX_SCORE
  ) {
    return NextResponse.json({ error: 'Invalid score value.' }, { status: 400 });
  }

  // Reject obviously oversized payloads before doing any work.
  if (payload.throws.length > KNIFE_MAX_TAPS) {
    return rejectScore('knife-booth', {
      userId: identity.userId,
      userName: identityName,
      score: claimedScore,
      stage: 'payload',
      reason: `Throw payload too large (${payload.throws.length})`,
      publicMessage: 'Invalid score data.',
    });
  }

  // Normalize the submitted throws to the validator's shape. We trust ONLY the
  // timestamp; validateKnifeRun re-derives every landing angle from the seed.
  const throws: KnifeThrow[] = payload.throws.map((entry) => ({
    t: Number((entry as RawThrow)?.t),
  }));

  // Validate the game session token + server clock.
  const sessionValidation = await validateGameSession(
    sessionToken,
    identity.userId,
    'knife-booth',
    claimedScore,
    undefined,
    { consumeSession: false },
  );

  if (!sessionValidation.valid) {
    return rejectScore('knife-booth', {
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
  const knifeBoothSeed = sessionValidation.session?.knifeBoothSeed;

  if (!sessionId) {
    return rejectScore('knife-booth', {
      userId: identity.userId,
      userName: identityName,
      score: claimedScore,
      stage: 'session',
      reason: 'Missing session id',
      publicMessage: 'Invalid game session.',
    });
  }

  if (typeof knifeBoothSeed !== 'number') {
    return rejectScore('knife-booth', {
      userId: identity.userId,
      userName: identityName,
      score: claimedScore,
      stage: 'session',
      reason: 'Missing knife-booth seed for session',
      publicMessage: 'Invalid game session.',
    });
  }

  // Server-clock ceiling: reject a run that posts implausibly long after it
  // began (stalled tab / clock-stretch). The client timeline is cosmetic — only
  // this server-measured elapsed gates the session.
  if (sessionDurationMs > MAX_SESSION_DURATION_MS) {
    return rejectScore('knife-booth', {
      userId: identity.userId,
      userName: identityName,
      score: claimedScore,
      stage: 'session',
      reason: `Session duration exceeds window (${sessionDurationMs}ms)`,
      publicMessage: 'Invalid game session.',
    });
  }

  // === SERVER-AUTHORITATIVE SCORE ===
  // Re-derive every stage's rotation schedule + board from the seed and replay
  // the recorded throws. The client-claimed number is never trusted; it must
  // equal this authoritative count.
  const runResult = validateKnifeRun(knifeBoothSeed, throws);
  const authoritativeScore = runResult.score;

  if (claimedScore !== authoritativeScore) {
    return rejectScore('knife-booth', {
      userId: identity.userId,
      userName: identityName,
      score: claimedScore,
      stage: 'server-replay',
      reason: `Authoritative score mismatch (server=${authoritativeScore}, client=${claimedScore}, stages=${runResult.stagesCleared}, reached=${runResult.stageReached}, inspected=${runResult.inspected}, stop=${runResult.stop}, throws=${throws.length}, session=${sessionDurationMs}ms)`,
    });
  }

  // Build a per-throw ActionEntry timeline for the generic anti-cheat pass
  // (env/webdriver/time-ratio + score-jump anomaly). The validator already
  // reconstructed the absolute wall time of every counted throw.
  const throwActions: ActionEntry[] = runResult.throwTimesAbs.map((abs, i) => ({
    t: Math.max(0, Math.floor(abs)),
    d: { i },
  }));

  const [previousBest, gameCount] = await Promise.all([
    db
      .select({ score: knifeBoothScores.score })
      .from(knifeBoothScores)
      .where(eq(knifeBoothScores.odUserId, identity.userId))
      .orderBy(desc(knifeBoothScores.score))
      .limit(1)
      .then((rows) => rows[0]?.score ?? null),
    db
      .select({ count: count() })
      .from(knifeBoothScores)
      .where(eq(knifeBoothScores.odUserId, identity.userId))
      .then((rows) => rows[0]?.count ?? 0),
  ]);

  const antiCheat = await runAntiCheat({
    gameType: 'knife-booth',
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
          .select({ score: knifeBoothScores.score })
          .from(knifeBoothScores)
          .where(eq(knifeBoothScores.odUserId, identity.userId))
          .limit(1)
      )[0];

      await db
        .insert(knifeBoothScores)
        .values({
          id: crypto.randomUUID(),
          odUserId: identity.userId,
          userName,
          score: authoritativeScore,
          createdAt: now,
        })
        .onConflictDoUpdate({
          target: knifeBoothScores.odUserId,
          set: {
            userName,
            score: authoritativeScore,
            createdAt: now,
          },
          where: sql`excluded.score > ${knifeBoothScores.score}`,
        });

      await recordScoreEvent({
        gameSlug: 'knife-booth',
        userId: identity.userId,
        userName,
        score: authoritativeScore,
      }).catch(() => {});

      const reward = await awardGameRunCredits({
        userId: identity.userId,
        context: { gameType: 'knife-booth', score: authoritativeScore },
        sourceId: `knife-booth:${sessionId}`,
        meta: {
          score: authoritativeScore,
          antiCheat: antiCheat.severity ?? 'pass',
        },
      });
      const achievements = await recordRunAchievements(
        identity.userId,
        { gameType: 'knife-booth', score: authoritativeScore },
        reward,
        { durationMs: sessionDurationMs },
      );

      await recordGameTimeMetric({
        userId: identity.userId,
        gameType: 'knife-booth',
        durationMs: Math.min(sessionDurationMs, MAX_SESSION_DURATION_MS),
        playedAtMs: now,
      });

      const leaderboard = await db
        .select()
        .from(knifeBoothScores)
        .orderBy(desc(knifeBoothScores.score))
        .limit(SCORE_RESPONSE_LEADERBOARD_LIMIT);

      broadcast('gameLeaderboards', {
        gameType: 'knife-booth',
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
