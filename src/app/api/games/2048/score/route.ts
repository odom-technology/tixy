import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { desc, eq } from 'drizzle-orm';
import { db, query, queryOne } from '@/server/db/client';
import { game2048Scores } from '@/server/db/schema';
import { requireIdentity } from '@/server/auth';
import { broadcast } from '@/server/events';
import { consumeGameSessionOrReject, validateGameSession } from '@/server/arcade/game-session';
import { parseGame2048Moves, verifyGame2048Run } from '@/server/arcade/game-2048-replay';
import { awardGameRunCredits } from '@/server/arcade/rewards';
import { recordRunAchievements } from '../../_shared/run-achievements';
import { recordGameTimeMetric } from '@/server/arcade/game-time-metrics';
import { recordScoreEvent } from '@/server/arcade/score-events';
import { recordHighScoreIfBeaten } from '@/server/services/activity-events';
import { addAntiCheatLog } from '@/server/arcade/anti-cheat-logs';
import { consumeContinueForGameRun } from '@/server/monetization/continued-runs';
import {
  authenticateGamePlayer,
  isErrorResponse,
  parsePayload,
  rejectScore,
  type BaseScorePayload,
} from '../../_shared/score-helpers';
import {
  GAME_2048_MAX_CLIENT_SCORE,
  GAME_2048_MAX_TILE,
  SCORE_RESPONSE_LEADERBOARD_LIMIT,
} from '../../_shared/constants';

type Game2048ScorePayload = BaseScorePayload & {
  highestTile?: number;
  moves?: number;
  /** The run's moves, [[ms since the run began, 'U' | 'D' | 'L' | 'R' | 'Z'], ...]. */
  moveLog?: unknown;
};

const OLD_CLIENT_MESSAGE = 'This page is out of date. Reload it and play again.';

/** The client allows one undo a day on a device, by the player's local day.
 *  Two local days fit inside any 24 hours, and a second device adds one, so
 *  the server allows three runs with an undo in 24 hours and no more. */
const MAX_UNDO_RUNS_PER_DAY = 3;
const UNDO_WINDOW_MS = 24 * 60 * 60 * 1000;

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
      .select({ score: game2048Scores.score })
      .from(game2048Scores)
      .where(eq(game2048Scores.odUserId, identity.userId))
      .orderBy(desc(game2048Scores.score))
      .limit(1);

    return NextResponse.json({ bestScore: bestScore[0]?.score ?? 0 });
  } catch (error) {
    console.error('Failed to fetch user best 2048 score:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const authResult = await authenticateGamePlayer('2048');
  if (isErrorResponse(authResult)) return authResult;
  const { identity, identityName } = authResult;

  const payload = await parsePayload<Game2048ScorePayload>(request);
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

  const clientScore = Math.floor(payload.score);
  const continuedRun = payload.continued === true;
  const clientHighestTile =
    typeof payload.highestTile === 'number' && Number.isFinite(payload.highestTile)
      ? Math.max(0, Math.floor(payload.highestTile))
      : 0;
  const clientMoves =
    typeof payload.moves === 'number' && Number.isFinite(payload.moves)
      ? Math.max(0, Math.floor(payload.moves))
      : 0;

  if (
    !Number.isFinite(clientScore) ||
    clientScore < 0 ||
    clientScore > GAME_2048_MAX_CLIENT_SCORE
  ) {
    return NextResponse.json({ error: 'Invalid score value.' }, { status: 400 });
  }

  // Highest tile must be a power of two within the reachable range.
  if (
    clientHighestTile !== 0 &&
    (clientHighestTile > GAME_2048_MAX_TILE ||
      (clientHighestTile & (clientHighestTile - 1)) !== 0 ||
      clientHighestTile < 2)
  ) {
    return NextResponse.json({ error: 'Invalid tile value.' }, { status: 400 });
  }

  const reject = (stage: string, reason: string, publicMessage?: string, status?: number) =>
    rejectScore('2048', {
      userId: identity.userId,
      userName: identityName,
      score: clientScore,
      stage,
      reason,
      publicMessage,
      status,
    });

  const sessionValidation = await validateGameSession(
    payload.sessionToken,
    identity.userId,
    '2048',
    clientScore,
    undefined,
    { consumeSession: false },
  );
  if (!sessionValidation.valid) {
    return reject('session', sessionValidation.error ?? 'Invalid session', 'Invalid game session.');
  }

  const sessionId = sessionValidation.session?.sessionId;
  const seed = sessionValidation.session?.game2048Seed;
  const sessionDurationMs = sessionValidation.session?.durationMs ?? 0;
  if (!sessionId || typeof seed !== 'number') {
    return reject('session', 'Missing session id or seed', 'Invalid game session.');
  }

  // The run is the moves it was played with. The score and the highest tile
  // are what the server's replay of them reaches from the session's seed, and
  // the client's figures have to match. A client from before this check posts
  // no move list, so it fails here once (see OLD_CLIENT_MESSAGE).
  const moveLog = parseGame2048Moves(payload.moveLog);
  if (moveLog === null) {
    return reject(
      'payload',
      Array.isArray(payload.moveLog)
        ? 'Malformed move list'
        : 'No move list (client from before the replay check)',
      OLD_CLIENT_MESSAGE,
      409,
    );
  }

  const run = verifyGame2048Run(
    seed,
    moveLog,
    { score: clientScore, highestTile: clientHighestTile },
    { elapsedMs: sessionDurationMs },
  );
  if (run.ok === false) {
    const { reason, at } = run as Extract<typeof run, { ok: false }>;
    return reject(
      'server-replay',
      `Rejected run (${reason}${at === undefined ? '' : `, entry ${at}`}, entries=${moveLog.length}, claimedMoves=${clientMoves}, session=${sessionDurationMs}ms)`,
      'Score could not be verified.',
    );
  }

  const score = run.score;
  const highestTile = run.highestTile;
  // How long the run lasted: the client's own figure (it leaves out time the
  // tab was hidden), held between the last move and the session's age.
  const durationMs = Math.round(
    Math.min(
      sessionDurationMs,
      Math.max(
        run.lastMoveMs,
        typeof payload.clientDurationMs === 'number' &&
          Number.isFinite(payload.clientDurationMs) &&
          payload.clientDurationMs >= 0
          ? payload.clientDurationMs
          : 0,
      ),
    ),
  );

  if (run.undos > 0) {
    const used = await queryOne<{ n: string }>(
      `SELECT COUNT(*) AS n FROM game_2048_undo_runs
       WHERE od_user_id = $1 AND created_at > $2`,
      [identity.userId, Date.now() - UNDO_WINDOW_MS],
    );
    if (Number(used?.n ?? 0) >= MAX_UNDO_RUNS_PER_DAY) {
      return reject(
        'undo',
        `Undo used in ${used?.n} runs in 24 hours`,
        'Undo is used up for today.',
      );
    }
  }

  try {
    const now = Date.now();
    const userName = identityName || 'Anonymous';

    // Atomically claim the session first (both branches): a losing duplicate
    // submit throws a 409 here — caught below — and performs zero writes.
    if (sessionId) {
      await consumeGameSessionOrReject(sessionId, identity.userId);
    }
    if (run.undos > 0) {
      await query(
        `INSERT INTO game_2048_undo_runs (session_id, od_user_id, created_at)
         VALUES ($1, $2, $3) ON CONFLICT (session_id) DO NOTHING`,
        [sessionId, identity.userId, now],
      );
    }
    await addAntiCheatLog({
      ts: Date.now(),
      gameType: '2048',
      userId: identity.userId,
      userName: identityName,
      score,
      result: 'pass',
      reason: `OK | ${JSON.stringify({ score, highestTile, moves: run.moves, undos: run.undos, durationMs })}`,
      stage: 'complete',
      checks: [],
    }).catch(() => {});

    if (continuedRun) {
      const entitlement = await consumeContinueForGameRun({
        userId: identity.userId,
        gameType: '2048',
        score,
        sessionId,
        meta: {
          highestTile,
          moves: run.moves,
          durationMs,
        },
      });

      await recordGameTimeMetric({
        userId: identity.userId,
        gameType: '2048',
        durationMs,
        playedAtMs: now,
      });

      const leaderboard = await db
        .select()
        .from(game2048Scores)
        .orderBy(desc(game2048Scores.score))
        .limit(SCORE_RESPONSE_LEADERBOARD_LIMIT);

      return NextResponse.json({
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
          highestTile: entry.highestTile,
        })),
      });
    }

    await recordHighScoreIfBeaten({
      userId: identity.userId,
      gameSlug: '2048',
      table: 'game_2048_scores',
      userColumn: 'od_user_id',
      scoreColumn: 'score',
      newScore: score,
    });

    await query(
      `
        INSERT INTO game_2048_scores (
          id,
          od_user_id,
          user_name,
          score,
          highest_tile,
          created_at
        ) VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT(od_user_id) DO UPDATE SET
          user_name = excluded.user_name,
          score = CASE
            WHEN excluded.score > game_2048_scores.score
            THEN excluded.score
            ELSE game_2048_scores.score
          END,
          highest_tile = CASE
            WHEN excluded.highest_tile > game_2048_scores.highest_tile
            THEN excluded.highest_tile
            ELSE game_2048_scores.highest_tile
          END,
          created_at = CASE
            WHEN excluded.score > game_2048_scores.score
            THEN excluded.created_at
            ELSE game_2048_scores.created_at
          END
      `,
      [
        crypto.randomUUID(),
        identity.userId,
        userName,
        score,
        highestTile,
        now,
      ],
    );

    await recordScoreEvent({
      gameSlug: '2048',
      userId: identity.userId,
      userName,
      score,
    }).catch(() => {});

    const reward = await awardGameRunCredits({
      userId: identity.userId,
      context: { gameType: '2048', score },
      sourceId: `2048:${sessionId ?? 'nosession'}`,
      meta: {
        score,
        highestTile,
      },
    });
    const achievements = await recordRunAchievements(
      identity.userId,
      { gameType: '2048', score },
      reward,
      { durationMs, highestTile },
    );

    await recordGameTimeMetric({
      userId: identity.userId,
      gameType: '2048',
      durationMs,
      playedAtMs: now,
    });

    const leaderboard = await db
      .select()
      .from(game2048Scores)
      .orderBy(desc(game2048Scores.score))
      .limit(SCORE_RESPONSE_LEADERBOARD_LIMIT);

    broadcast('gameLeaderboards', { gameType: '2048', updatedAt: now });

    return NextResponse.json({
      success: true,
      reward,
      achievements,
      leaderboard: leaderboard.map((entry) => ({
        id: entry.id,
        userName: entry.userName,
        score: entry.score,
        highestTile: entry.highestTile,
      })),
    });
  } catch (error) {
    const routeError = error as Error & { status?: number };
    if (
      typeof routeError.status === 'number' &&
      routeError.status >= 400 &&
      routeError.status < 500
    ) {
      return NextResponse.json(
        { error: routeError.message || 'Failed to save score.' },
        { status: routeError.status },
      );
    }
    console.error('Failed to save 2048 score:', error);
    return NextResponse.json({ error: 'Failed to save score.' }, { status: 500 });
  }
}
