import { asc, eq } from 'drizzle-orm';

import { db } from '@/server/db/client';
import { punchCardScores } from '@/server/db/schema';
import { isPunchCardSize } from '@/server/arcade/punch-card-generator';
import { LEADERBOARD_QUERY_LIMIT } from '../../_shared/constants';
import {
  leaderboardServerError,
  noStoreJson,
  resolveLeaderboardLimit,
  requireLeaderboardAccess,
} from '../../_shared/leaderboard-helpers';

export const dynamic = 'force-dynamic';

/**
 * GET /api/games/punch-card/leaderboard?mode=<size>&limit=<n|all>
 *
 * Per-size board, ascending by recorded solve time (fastest first) — 5x5
 * blitz times are not comparable to 15x15 marathons, so sizes never mix
 * (sudoku's per-difficulty model). One PB row per (user, size) — the score
 * route upserts keeping the MIN time — so this is a plain ordered select.
 */
export async function GET(request: Request) {
  const unauthorized = await requireLeaderboardAccess();
  if (unauthorized) return unauthorized;

  const { searchParams } = new URL(request.url);
  // The shared leaderboard hook forwards the board size as `mode`.
  const size = searchParams.get('mode') || '5x5';
  const limit = resolveLeaderboardLimit(searchParams);

  if (!isPunchCardSize(size)) {
    return noStoreJson(
      { error: 'Invalid size. Must be 5x5, 10x10, or 15x15.' },
      400,
    );
  }

  try {
    const scores = await db
      .select({
        id: punchCardScores.id,
        odUserId: punchCardScores.odUserId,
        userName: punchCardScores.userName,
        solveTimeMs: punchCardScores.solveTimeMs,
        size: punchCardScores.size,
      })
      .from(punchCardScores)
      .where(eq(punchCardScores.size, size))
      .orderBy(asc(punchCardScores.solveTimeMs), asc(punchCardScores.createdAt))
      .limit(limit || LEADERBOARD_QUERY_LIMIT);

    const leaderboard = scores.map((score) => ({
      id: score.id,
      userId: score.odUserId,
      userName: score.userName,
      score: score.solveTimeMs,
      solveTimeMs: score.solveTimeMs,
      size: score.size,
    }));

    return noStoreJson({ leaderboard, mode: size });
  } catch (error) {
    return leaderboardServerError(error);
  }
}
