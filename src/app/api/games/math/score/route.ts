import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { desc, eq, count, sql } from 'drizzle-orm';
import { db } from '@/server/db/client';
import { mathScores } from '@/server/db/schema';
import { requireIdentity } from '@/server/auth';
import { broadcast } from '@/server/events';
import {
  consumeGameSessionOrReject,
  validateGameSession,
} from '@/server/arcade/game-session';
import {
  validateMathRun,
  MATH_SPRINT_DURATION_SEC,
  MATH_MAX_ANSWERS,
  type MathAnswer,
} from '@/server/arcade/math-sprint';
import { awardGameRunCredits } from '@/server/arcade/rewards';
import { recordRunAchievements } from '../../_shared/run-achievements';
import { recordGameTimeMetric } from '@/server/arcade/game-time-metrics';
import { recordScoreEvent } from '@/server/arcade/score-events';
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
import {
  SCORE_RESPONSE_LEADERBOARD_LIMIT,
  MATH_MAX_CLIENT_SCORE,
} from '../../_shared/constants';

type RawAnswer = { index?: unknown; value?: unknown; t?: unknown };

type ScorePayload = {
  score?: number;
  sessionToken?: string;
  answers?: RawAnswer[];
  clientDurationMs?: number;
  env?: EnvFingerprint;
};

// The whole sprint runs on the server clock. Reject any session whose
// server-measured elapsed exceeds the sprint + grace (a stalled tab that posts
// late, or a clock-stretch attempt). 62s window + 3s network/persist grace.
const MAX_SESSION_DURATION_MS = MATH_SPRINT_DURATION_SEC * 1000 + 5_000;

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
      .select({ score: mathScores.score })
      .from(mathScores)
      .where(eq(mathScores.odUserId, identity.userId))
      .orderBy(desc(mathScores.score))
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
  const authResult = await authenticateGamePlayer('math');
  if (isErrorResponse(authResult)) return authResult;
  const { identity, identityName } = authResult;

  const payload = await parsePayload<ScorePayload>(request);
  if (payload instanceof NextResponse) return payload;

  if (
    typeof payload?.score !== 'number' ||
    typeof payload?.sessionToken !== 'string' ||
    !Array.isArray(payload?.answers)
  ) {
    return NextResponse.json(
      { error: 'Invalid score data. Session token and answers required.' },
      { status: 400 },
    );
  }

  const { sessionToken, env } = payload;
  const claimedScore = Math.floor(payload.score);

  if (
    !Number.isFinite(claimedScore) ||
    claimedScore < 0 ||
    claimedScore > MATH_MAX_CLIENT_SCORE
  ) {
    return NextResponse.json({ error: 'Invalid score value.' }, { status: 400 });
  }

  // Reject obviously oversized payloads before doing any work.
  if (payload.answers.length > MATH_MAX_ANSWERS * 3) {
    return rejectScore('math', {
      userId: identity.userId,
      userName: identityName,
      score: claimedScore,
      stage: 'payload',
      reason: `Answer payload too large (${payload.answers.length})`,
      publicMessage: 'Invalid score data.',
    });
  }

  // Normalize the submitted answers to the validator's shape. Malformed entries
  // are passed through as-is; validateMathRun drops anything non-conforming.
  const answers: MathAnswer[] = payload.answers.map((entry) => ({
    index: Number((entry as RawAnswer)?.index),
    value: Number((entry as RawAnswer)?.value),
    t: Number((entry as RawAnswer)?.t),
  }));

  // Validate the game session token + server clock.
  const sessionValidation = await validateGameSession(
    sessionToken,
    identity.userId,
    'math',
    claimedScore,
    undefined,
    { consumeSession: false },
  );

  if (!sessionValidation.valid) {
    return rejectScore('math', {
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
  const mathSeed = sessionValidation.session?.mathSeed;

  if (!sessionId) {
    return rejectScore('math', {
      userId: identity.userId,
      userName: identityName,
      score: claimedScore,
      stage: 'session',
      reason: 'Missing session id',
      publicMessage: 'Invalid game session.',
    });
  }

  if (typeof mathSeed !== 'number') {
    return rejectScore('math', {
      userId: identity.userId,
      userName: identityName,
      score: claimedScore,
      stage: 'session',
      reason: 'Missing math seed for session',
      publicMessage: 'Invalid game session.',
    });
  }

  // Server-clock ceiling: the sprint cannot have lasted materially longer than
  // 60s. A run that posts far past the window is rejected outright (the client
  // countdown is cosmetic — only this server-measured elapsed is trusted).
  if (sessionDurationMs > MAX_SESSION_DURATION_MS) {
    return rejectScore('math', {
      userId: identity.userId,
      userName: identityName,
      score: claimedScore,
      stage: 'session',
      reason: `Session duration exceeds sprint window (${sessionDurationMs}ms)`,
      publicMessage: 'Invalid game session.',
    });
  }

  // === SERVER-AUTHORITATIVE SCORE ===
  // Re-derive every problem from the seed and count validated-correct answers
  // inside the 60s window + cadence floor. The client-claimed number is never
  // trusted; it must equal this authoritative count.
  const runResult = validateMathRun(mathSeed, answers, sessionDurationMs);
  const authoritativeScore = runResult.correct;

  if (claimedScore !== authoritativeScore) {
    return rejectScore('math', {
      userId: identity.userId,
      userName: identityName,
      score: claimedScore,
      stage: 'server-replay',
      reason: `Authoritative score mismatch (server=${authoritativeScore}, client=${claimedScore}, counted=${runResult.counted}, dropped=${runResult.dropped}, session=${sessionDurationMs}ms)`,
    });
  }

  // Build per-answer ActionEntry timeline for the generic anti-cheat pass
  // (env/webdriver/time-ratio + score-jump anomaly). One action per submitted
  // answer, `t` = ms since first problem.
  const answerActions: ActionEntry[] = answers
    .filter(
      (entry) =>
        Number.isInteger(entry.index) &&
        entry.index >= 0 &&
        Number.isFinite(entry.t) &&
        entry.t >= 0,
    )
    .map((entry) => ({
      t: Math.max(0, Math.floor(entry.t)),
      d: { index: entry.index },
    }))
    .sort((a, b) => a.t - b.t);

  const [previousBest, gameCount] = await Promise.all([
    db
      .select({ score: mathScores.score })
      .from(mathScores)
      .where(eq(mathScores.odUserId, identity.userId))
      .orderBy(desc(mathScores.score))
      .limit(1)
      .then((rows) => rows[0]?.score ?? null),
    db
      .select({ count: count() })
      .from(mathScores)
      .where(eq(mathScores.odUserId, identity.userId))
      .then((rows) => rows[0]?.count ?? 0),
  ]);

  const antiCheat = await runAntiCheat({
    gameType: 'math',
    userId: identity.userId,
    userName: identityName,
    score: authoritativeScore,
    actions: answerActions,
    env: env ?? null,
    previousBest,
    sessionDurationMs,
    serverActionCount: sessionValidation.session?.actionCount,
    serverActionCounts: sessionValidation.session?.actionCounts,
    modeDurationSec: MATH_SPRINT_DURATION_SEC,
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
          .select({ score: mathScores.score })
          .from(mathScores)
          .where(eq(mathScores.odUserId, identity.userId))
          .limit(1)
      )[0];

      await db
        .insert(mathScores)
        .values({
          id: crypto.randomUUID(),
          odUserId: identity.userId,
          userName,
          score: authoritativeScore,
          createdAt: now,
        })
        .onConflictDoUpdate({
          target: mathScores.odUserId,
          set: {
            userName,
            score: authoritativeScore,
            createdAt: now,
          },
          where: sql`excluded.score > ${mathScores.score}`,
        });

      await recordScoreEvent({
        gameSlug: 'math',
        userId: identity.userId,
        userName,
        score: authoritativeScore,
      }).catch(() => {});

      const reward = await awardGameRunCredits({
        userId: identity.userId,
        context: { gameType: 'math', score: authoritativeScore },
        sourceId: `math:${sessionId}`,
        meta: {
          score: authoritativeScore,
          antiCheat: antiCheat.severity ?? 'pass',
        },
      });
      const achievements = await recordRunAchievements(
        identity.userId,
        { gameType: 'math', score: authoritativeScore },
        reward,
        { durationMs: sessionDurationMs },
      );

      await recordGameTimeMetric({
        userId: identity.userId,
        gameType: 'math',
        durationMs: Math.min(sessionDurationMs, MAX_SESSION_DURATION_MS),
        playedAtMs: now,
      });

      const leaderboard = await db
        .select()
        .from(mathScores)
        .orderBy(desc(mathScores.score))
        .limit(SCORE_RESPONSE_LEADERBOARD_LIMIT);

      broadcast('gameLeaderboards', {
        gameType: 'math',
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
