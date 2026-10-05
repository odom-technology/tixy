import { asc, desc } from 'drizzle-orm';

import { db } from '@/server/db/client';
import { ticketStopLockScores, ticketStopScores } from '@/server/db/schema';
import { LEADERBOARD_QUERY_LIMIT } from '../../_shared/constants';
import {
  leaderboardServerError,
  noStoreJson,
  resolveLeaderboardLimit,
  requireLeaderboardAccess,
} from '../../_shared/leaderboard-helpers';

export const dynamic = 'force-dynamic';

/* Ticket stop's board is rules 2 (the lock), in ticket_stop_lock_scores.
   `?mode=last-season` reads rules 1 (the bulb ring), the old table, which
   nothing writes any more. The two scores are different things (hits and
   points) and are never merged or rescaled. */

export async function GET(request: Request) {
  const unauthorized = await requireLeaderboardAccess();
  if (unauthorized) return unauthorized;

  try {
    const { searchParams } = new URL(request.url);
    const limit = resolveLeaderboardLimit(searchParams);
    const table = searchParams.get('mode') === 'last-season' ? ticketStopScores : ticketStopLockScores;
    // One personal-best row per user (od_user_id is unique; the score route
    // upserts keeping MAX), so this is a plain ordered select.
    const scores = await db
      .select({
        id: table.id,
        odUserId: table.odUserId,
        userName: table.userName,
        score: table.score,
      })
      .from(table)
      .orderBy(desc(table.score), asc(table.createdAt))
      .limit(limit || LEADERBOARD_QUERY_LIMIT);

    const leaderboard = scores.map((score) => ({
      id: score.id,
      userId: score.odUserId,
      userName: score.userName,
      score: score.score,
    }));

    return noStoreJson({ leaderboard });
  } catch (error) {
    return leaderboardServerError(error);
  }
}
