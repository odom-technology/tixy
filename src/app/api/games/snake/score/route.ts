import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { desc, eq, sql } from 'drizzle-orm';
import { db } from '@/server/db/client';
import { snakeScores } from '@/server/db/schema';
import { requireIdentity } from '@/server/auth';
import { broadcast } from '@/server/events';
import { consumeGameSessionOrReject, validateGameSession } from '@/server/arcade/game-session';
import { parseSnakeInputs, verifySnakeRun } from '@/server/arcade/snake-replay';
import { awardGameRunCredits } from '@/server/arcade/rewards';
import { recordGameTimeMetric } from '@/server/arcade/game-time-metrics';
import { recordScoreEvent } from '@/server/arcade/score-events';
import { consumeContinueForGameRun } from '@/server/monetization/continued-runs';
import {
  runAntiCheat,
  type ActionEntry,
} from '@/server/arcade/anti-cheat';
import {
  authenticateGamePlayer,
  isErrorResponse,
  parsePayload,
  rejectScore,
  type BaseScorePayload,
} from '../../_shared/score-helpers';
import { runScoreRoutePipeline } from '../../_shared/score-route-pipeline';
import { recordRunAchievements } from '../../_shared/run-achievements';
import {
  SCORE_RESPONSE_LEADERBOARD_LIMIT,
  SNAKE_MAX_CLIENT_SCORE,
} from '../../_shared/constants';

type ScorePayload = BaseScorePayload & {
  /** The turns the run was played with: [[tick queued on, 'U' | 'D' | 'L' | 'R'], ...]. */
  inputs?: unknown;
};

const OLD_CLIENT_MESSAGE = 'This page is out of date. Reload it and play again.';

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
      .select({ score: snakeScores.score })
      .from(snakeScores)
      .where(eq(snakeScores.odUserId, identity.userId))
      .orderBy(desc(snakeScores.score))
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
  const authResult = await authenticateGamePlayer('snake');
  if (isErrorResponse(authResult)) return authResult;
  const { identity, identityName } = authResult;

  const payload = await parsePayload<ScorePayload>(request);
  if (payload instanceof NextResponse) return payload;

  if (
    typeof payload?.score !== 'number' ||
    typeof payload?.sessionToken !== 'string'
  ) {
    return NextResponse.json(
      { error: 'Invalid score data. Session token required.' },
      { status: 400 },
    );
  }

  const { sessionToken, env } = payload;
  const continuedRun = payload.continued === true;
  const clientScore = Math.floor(payload.score);
  const clientDurationMs =
    typeof payload.clientDurationMs === 'number' &&
    Number.isFinite(payload.clientDurationMs) &&
    payload.clientDurationMs >= 0
      ? payload.clientDurationMs
      : null;

  if (!Number.isFinite(clientScore) || clientScore < 0 || clientScore > SNAKE_MAX_CLIENT_SCORE) {
    return NextResponse.json(
      { error: 'Invalid score value.' },
      { status: 400 },
    );
  }

  // Validate game session token
  const sessionValidation = await validateGameSession(
    sessionToken,
    identity.userId,
    'snake',
    clientScore,
    undefined,
    { consumeSession: false },
  );

  if (!sessionValidation.valid) {
    return rejectScore('snake',{
      userId: identity.userId,
      userName: identityName,
      score: clientScore,
      stage: 'session',
      reason: sessionValidation.error ?? 'Invalid game session.',
      publicMessage: 'Invalid game session.',
    });
  }

  const sessionId = sessionValidation.session?.sessionId;
  const sessionDurationMs = sessionValidation.session?.durationMs ?? 0;
  const snakeSeed = sessionValidation.session?.snakeSeed;
  if (!sessionId || snakeSeed === undefined) {
    return rejectScore('snake',{
      userId: identity.userId,
      userName: identityName,
      score: clientScore,
      stage: 'session',
      reason: 'Missing session id or snake seed',
      publicMessage: 'Invalid game session.',
    });
  }
  // The run is the turns it was played with. The score is what the server's
  // replay of those turns eats from the session's seed; the client's score is
  // never trusted and has to match. A client from before this check posts no
  // turns, so it fails here once (see OLD_CLIENT_MESSAGE).
  const inputs = parseSnakeInputs(payload.inputs);
  if (inputs === null) {
    return rejectScore('snake', {
      userId: identity.userId,
      userName: identityName,
      score: clientScore,
      stage: 'payload',
      reason: Array.isArray(payload.inputs)
        ? 'Malformed turn list'
        : 'No turn list (client from before the replay check)',
      publicMessage: OLD_CLIENT_MESSAGE,
      status: 409,
    });
  }

  const run = verifySnakeRun(snakeSeed, inputs, clientScore, { elapsedMs: sessionDurationMs });
  if (run.ok === false) {
    const { reason } = run as Extract<typeof run, { ok: false }>;
    return rejectScore('snake', {
      userId: identity.userId,
      userName: identityName,
      score: clientScore,
      stage: 'server-replay',
      reason: `Rejected run (${reason}, turns=${inputs.length}, session=${sessionDurationMs}ms)`,
      publicMessage: 'Score could not be verified.',
    });
  }
  const score = run.score;
  // How long the run lasted: the client's own figure, held between the least
  // the tick rate allows and the session's age.
  const replayDurationMs = Math.round(
    Math.min(
      sessionDurationMs,
      Math.max(
        run.minDurationMs,
        clientDurationMs ?? 0,
      ),
    ),
  );
  const serverActions: ActionEntry[] = [
    ...run.inputTimesMs.map((t) => ({ t, d: { type: 'direction' } })),
    ...run.foodTimesMs.map((t) => ({ t, d: { type: 'food' } })),
  ].sort((a, b) => a.t - b.t);

  // Anti-cheat validation
  const previousBest = await db
    .select({ score: snakeScores.score })
    .from(snakeScores)
    .where(eq(snakeScores.odUserId, identity.userId))
    .orderBy(desc(snakeScores.score))
    .limit(1)
    .then((rows) => rows[0]?.score ?? null);

  const antiCheat = await runAntiCheat({
    gameType: 'snake',
    userId: identity.userId,
    userName: identityName,
    score,
    actions: serverActions,
    env: env ?? null,
    previousBest,
    sessionDurationMs: replayDurationMs,
    serverActionCount: run.apples,
    serverActionCounts: {
      food: run.apples,
      direction: inputs.length,
    },
  });

  return runScoreRoutePipeline({
    antiCheat,
    identity,
    persist: async ({ now, userName }) => {
      // Atomically claim the session first (both branches): a losing duplicate
      // submit throws a 409 here and performs zero writes.
      await consumeGameSessionOrReject(sessionId, identity.userId);

      if (continuedRun) {
        const entitlement = await consumeContinueForGameRun({
          userId: identity.userId,
          gameType: 'snake',
          score,
          sessionId,
          meta: {
            antiCheat: antiCheat.severity ?? 'pass',
            durationMs: replayDurationMs,
          },
        });
        await recordGameTimeMetric({
          userId: identity.userId,
          gameType: 'snake',
          durationMs: replayDurationMs,
          playedAtMs: now,
        });

        const leaderboard = await db
          .select()
          .from(snakeScores)
          .orderBy(desc(snakeScores.score))
          .limit(SCORE_RESPONSE_LEADERBOARD_LIMIT);

        return {
          success: true,
          continued: true,
          reward: null,
          entitlement: {
            type: 'continue',
            balanceAfter: entitlement.balanceAfter,
          },
          leaderboard: leaderboard.map((entry) => ({
            id: entry.id,
            userName: entry.userName,
            score: entry.score,
          })),
        };
      }

      await db
        .insert(snakeScores)
        .values({
          id: crypto.randomUUID(),
          odUserId: identity.userId,
          userName,
          score,
          createdAt: now,
        })
        .onConflictDoUpdate({
          target: snakeScores.odUserId,
          set: {
            userName,
            score,
            createdAt: now,
          },
          where: sql`excluded.score > ${snakeScores.score}`,
        });
      await recordScoreEvent({
        gameSlug: 'snake',
        userId: identity.userId,
        userName,
        score,
      }).catch(() => {});
      const reward = await awardGameRunCredits({
        userId: identity.userId,
        context: { gameType: 'snake', score },
        sourceId: `snake:${sessionId}`,
        meta: {
          score,
          antiCheat: antiCheat.severity ?? 'pass',
        },
      });
      await recordGameTimeMetric({
        userId: identity.userId,
        gameType: 'snake',
        durationMs: replayDurationMs,
        playedAtMs: now,
      });
      // Each apple is 10 points, so apples == score / 10.
      const achievements = await recordRunAchievements(
        identity.userId,
        { gameType: 'snake', score },
        reward,
        { durationMs: replayDurationMs, snakeApples: Math.round(score / 10) },
      );

      const leaderboard = await db
        .select()
        .from(snakeScores)
        .orderBy(desc(snakeScores.score))
        .limit(SCORE_RESPONSE_LEADERBOARD_LIMIT);

      broadcast('gameLeaderboards', {
        gameType: 'snake',
        updatedAt: now,
      });

      return {
        success: true,
        reward,
        achievements,
        leaderboard: leaderboard.map((entry) => ({
          id: entry.id,
          userName: entry.userName,
          score: entry.score,
        })),
      };
    },
  });
}
