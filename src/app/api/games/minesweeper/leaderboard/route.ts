import { asc, eq } from 'drizzle-orm';

import { db } from '@/server/db/client';
import { minesweeperScores } from '@/server/db/schema';
import { isMinesweeperDifficulty } from '@/server/arcade/minesweeper-generator';
import { LEADERBOARD_QUERY_LIMIT } from '../../_shared/constants';
import {
  leaderboardServerError,
  noStoreJson,
  resolveLeaderboardLimit,
  requireLeaderboardAccess,
} from '../../_shared/leaderboard-helpers';

export const dynamic = 'force-dynamic';

/**
 * GET /api/games/minesweeper/leaderboard?mode=<difficulty>&limit=<n|all>
 *
 * Per-difficulty board, ascending by solve time (fastest first). One PB row per
 * (user, difficulty) — the score route upserts keeping the MIN time — so this
 * is a plain ordered select.
 */
export async function GET(request: Request) {
  const unauthorized = await requireLeaderboardAccess();
  if (unauthorized) return unauthorized;

  const { searchParams } = new URL(request.url);
  // The shared leaderboard hook forwards the difficulty as `mode`.
  const difficulty = searchParams.get('mode') || 'beginner';
  const limit = resolveLeaderboardLimit(searchParams);

  if (!isMinesweeperDifficulty(difficulty)) {
    return noStoreJson(
      {
        error:
          'Invalid difficulty. Must be beginner, intermediate, or expert.',
      },
      400,
    );
  }

  try {
    const scores = await db
      .select({
        id: minesweeperScores.id,
        odUserId: minesweeperScores.odUserId,
        userName: minesweeperScores.userName,
        solveTimeMs: minesweeperScores.solveTimeMs,
        difficulty: minesweeperScores.difficulty,
      })
      .from(minesweeperScores)
      .where(eq(minesweeperScores.difficulty, difficulty))
      .orderBy(
        asc(minesweeperScores.solveTimeMs),
        asc(minesweeperScores.createdAt),
      )
      .limit(limit || LEADERBOARD_QUERY_LIMIT);

    const leaderboard = scores.map((score) => ({
      id: score.id,
      userId: score.odUserId,
      userName: score.userName,
      score: score.solveTimeMs,
      solveTimeMs: score.solveTimeMs,
      difficulty: score.difficulty,
    }));

    return noStoreJson({ leaderboard, mode: difficulty });
  } catch (error) {
    return leaderboardServerError(error);
  }
}
