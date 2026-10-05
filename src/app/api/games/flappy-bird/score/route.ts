import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { desc, eq, count, sql } from 'drizzle-orm';
import { db } from '@/server/db/client';
import { flappyBirdScores } from '@/server/db/schema';
import { requireIdentity } from '@/server/auth';
import { broadcast } from '@/server/events';
import { consumeGameSessionOrReject, validateGameSession } from '@/server/arcade/game-session';
import { parseFlappyFlaps, verifyFlappyRun } from '@/server/arcade/flappy-replay';
import { awardGameRunCredits } from '@/server/arcade/rewards';
import { recordRunAchievements } from '../../_shared/run-achievements';
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
import { SCORE_RESPONSE_LEADERBOARD_LIMIT, FLAPPY_MAX_CLIENT_SCORE } from '../../_shared/constants';

type ScorePayload = BaseScorePayload & {
  /** The sim tick of each flap the run was played with, the first at 0. */
  flaps?: unknown;
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
      .select({ score: flappyBirdScores.score })
      .from(flappyBirdScores)
      .where(eq(flappyBirdScores.odUserId, identity.userId))
      .orderBy(desc(flappyBirdScores.score))
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
  const authResult = await authenticateGamePlayer('flappy-bird');
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

  if (!Number.isFinite(clientScore) || clientScore < 0 || clientScore > FLAPPY_MAX_CLIENT_SCORE) {
    return NextResponse.json(
      { error: 'Invalid score value.' },
      { status: 400 },
    );
  }

  // Validate game session token
  const sessionValidation = await validateGameSession(
    sessionToken,
    identity.userId,
    'flappy-bird',
    clientScore,
    undefined,
    { consumeSession: false },
  );

  if (!sessionValidation.valid) {
    return rejectScore('flappy-bird', {
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
  const flappySeed = sessionValidation.session?.flappySeed;
  if (!sessionId || flappySeed === undefined) {
    return rejectScore('flappy-bird', {
      userId: identity.userId,
      userName: identityName,
      score: clientScore,
      stage: 'session',
      reason: 'Missing session id or flappy seed',
      publicMessage: 'Invalid game session.',
    });
  }

  // The run is the flaps it was played with. The score is what the server's
  // replay of those flaps passes from the session's seed; the client's score
  // is never trusted and has to match. A page from before this check posts
  // no flaps, so it fails here once (see OLD_CLIENT_MESSAGE).
  const flaps = parseFlappyFlaps(payload.flaps);
  if (flaps === null) {
    return rejectScore('flappy-bird', {
      userId: identity.userId,
      userName: identityName,
      score: clientScore,
      stage: 'payload',
      reason: Array.isArray(payload.flaps)
        ? 'Malformed flap list'
        : 'No flap list (client from before the replay check)',
      publicMessage: OLD_CLIENT_MESSAGE,
      status: 409,
    });
  }

  const run = verifyFlappyRun(flappySeed, flaps, clientScore, { elapsedMs: sessionDurationMs });
  if (run.ok === false) {
    const { reason } = run as Extract<typeof run, { ok: false }>;
    return rejectScore('flappy-bird', {
      userId: identity.userId,
      userName: identityName,
      score: clientScore,
      stage: 'server-replay',
      reason: `Rejected run (${reason}, flaps=${flaps.length}, session=${sessionDurationMs}ms)`,
      publicMessage: 'Score could not be verified.',
    });
  }
  const authoritativeScore = run.score;
  // How long the run lasted: the client's own figure, held between the sim
  // clock's length of the run and the session's age.
  const replayDurationMs = Math.round(
    Math.min(sessionDurationMs, Math.max(run.durationMs, clientDurationMs ?? 0)),
  );
  const serverActions: ActionEntry[] = [
    ...run.flapTimesMs.map((t) => ({ t, d: { type: 'flap' } })),
    ...run.pipeTimesMs.map((t) => ({ t, d: { type: 'pipe' } })),
  ].sort((a, b) => a.t - b.t);

  // Anti-cheat validation
  const [previousBest, gameCount] = await Promise.all([
    db
      .select({ score: flappyBirdScores.score })
      .from(flappyBirdScores)
      .where(eq(flappyBirdScores.odUserId, identity.userId))
      .orderBy(desc(flappyBirdScores.score))
      .limit(1)
      .then((rows) => rows[0]?.score ?? null),
    db
      .select({ count: count() })
      .from(flappyBirdScores)
      .where(eq(flappyBirdScores.odUserId, identity.userId))
      .then((rows) => rows[0]?.count ?? 0),
  ]);

  const antiCheat = await runAntiCheat({
    gameType: 'flappy-bird',
    userId: identity.userId,
    userName: identityName,
    score: authoritativeScore,
    actions: serverActions,
    env: env ?? null,
    previousBest,
    sessionDurationMs: replayDurationMs,
    serverActionCount: run.flaps,
    serverActionCounts: {
      flap: run.flaps,
      pipe: run.pipeTimesMs.length,
    },
    gameCount,
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
          gameType: 'flappy-bird',
          score: authoritativeScore,
          sessionId,
          meta: {
            antiCheat: antiCheat.severity ?? 'pass',
            durationMs: replayDurationMs,
          },
        });
        await recordGameTimeMetric({
          userId: identity.userId,
          gameType: 'flappy-bird',
          durationMs: replayDurationMs,
          playedAtMs: now,
        });

        const leaderboard = await db
          .select()
          .from(flappyBirdScores)
          .orderBy(desc(flappyBirdScores.score))
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
        .insert(flappyBirdScores)
        .values({
          id: crypto.randomUUID(),
          odUserId: identity.userId,
          userName,
          score: authoritativeScore,
          createdAt: now,
        })
        .onConflictDoUpdate({
          target: flappyBirdScores.odUserId,
          set: {
            userName,
            score: authoritativeScore,
            createdAt: now,
          },
          where: sql`excluded.score > ${flappyBirdScores.score}`,
        });
      await recordScoreEvent({
        gameSlug: 'flappy-bird',
        userId: identity.userId,
        userName,
        score: authoritativeScore,
      }).catch(() => {});
      const reward = await awardGameRunCredits({
        userId: identity.userId,
        context: { gameType: 'flappy-bird', score: authoritativeScore },
        sourceId: `flappy:${sessionId}`,
        meta: {
          score: authoritativeScore,
          antiCheat: antiCheat.severity ?? 'pass',
        },
      });
      const achievements = await recordRunAchievements(
        identity.userId,
        { gameType: 'flappy-bird', score: authoritativeScore },
        reward,
        { durationMs: replayDurationMs, flappyPipes: authoritativeScore },
      );
      await recordGameTimeMetric({
        userId: identity.userId,
        gameType: 'flappy-bird',
        durationMs: replayDurationMs,
        playedAtMs: now,
      });

      const leaderboard = await db
        .select()
        .from(flappyBirdScores)
        .orderBy(desc(flappyBirdScores.score))
        .limit(SCORE_RESPONSE_LEADERBOARD_LIMIT);

      broadcast('gameLeaderboards', {
        gameType: 'flappy-bird',
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
