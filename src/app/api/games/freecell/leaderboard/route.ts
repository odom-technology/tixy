import { and, asc, eq } from 'drizzle-orm';

import { db } from '@/server/db/client';
import { freecellScores } from '@/server/db/schema';
import { dayNumberFromMs } from '@/server/arcade/freecell-replay';
import { LEADERBOARD_QUERY_LIMIT } from '../../_shared/constants';
import {
  leaderboardServerError,
  noStoreJson,
  resolveLeaderboardLimit,
  requireLeaderboardAccess,
} from '../../_shared/leaderboard-helpers';

export const dynamic = 'force-dynamic';

type FreecellMode = 'daily' | 'free';
const isMode = (v: unknown): v is FreecellMode => v === 'daily' || v === 'free';

/**
 * GET /api/games/freecell/leaderboard?mode=<daily|free>&limit=<n|all>
 *
 * Ascending by clear time (fastest first), move count as tiebreak. The free
 * board is a single fastest-clear-ever ranking; the daily board is scoped to
 * TODAY's shared deal (deal_key = current UTC day number). One best row per
 * (user, mode, deal) — the score route upserts keeping the MIN — so this is a
 * plain ordered select.
 */
export async function GET(request: Request) {
  const unauthorized = await requireLeaderboardAccess();
  if (unauthorized) return unauthorized;

  const { searchParams } = new URL(request.url);
  // The shared leaderboard hook forwards the mode as `mode`.
  const mode = searchParams.get('mode') || 'free';
  const limit = resolveLeaderboardLimit(searchParams);

  if (!isMode(mode)) {
    return noStoreJson(
      { error: 'Invalid mode. Must be daily or free.' },
      400,
    );
  }

  const dealKey =
    mode === 'daily' ? String(dayNumberFromMs(Date.now())) : 'free';

  try {
    const scores = await db
      .select({
        id: freecellScores.id,
        odUserId: freecellScores.odUserId,
        userName: freecellScores.userName,
        solveTimeMs: freecellScores.solveTimeMs,
        moveCount: freecellScores.moveCount,
        mode: freecellScores.mode,
      })
      .from(freecellScores)
      .where(and(eq(freecellScores.mode, mode), eq(freecellScores.dealKey, dealKey)))
      .orderBy(
        asc(freecellScores.solveTimeMs),
        asc(freecellScores.moveCount),
        asc(freecellScores.createdAt),
      )
      .limit(limit || LEADERBOARD_QUERY_LIMIT);

    const leaderboard = scores.map((score) => ({
      id: score.id,
      userId: score.odUserId,
      userName: score.userName,
      score: score.solveTimeMs,
      solveTimeMs: score.solveTimeMs,
      moveCount: score.moveCount,
      mode: score.mode,
    }));

    return noStoreJson({ leaderboard, mode });
  } catch (error) {
    return leaderboardServerError(error);
  }
}
