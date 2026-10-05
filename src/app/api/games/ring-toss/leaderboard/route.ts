import { asc, desc } from 'drizzle-orm';

import { db } from '@/server/db/client';
import { ringTossScores } from '@/server/db/schema';
import { LEADERBOARD_QUERY_LIMIT } from '../../_shared/constants';
import {
  leaderboardServerError,
  noStoreJson,
  resolveLeaderboardLimit,
  requireLeaderboardAccess,
} from '../../_shared/leaderboard-helpers';

export const dynamic = 'force-dynamic';

/* Ring toss's board: one best round per player in ring_toss_scores. */

export async function GET(request: Request) {
  const unauthorized = await requireLeaderboardAccess();
  if (unauthorized) return unauthorized;

  try {
    const { searchParams } = new URL(request.url);
    const limit = resolveLeaderboardLimit(searchParams);
    // One personal-best row per user (od_user_id is unique; the score route
    // upserts keeping MAX), so this is a plain ordered select.
    const scores = await db
      .select({
        id: ringTossScores.id,
        odUserId: ringTossScores.odUserId,
        userName: ringTossScores.userName,
        score: ringTossScores.score,
      })
      .from(ringTossScores)
      .orderBy(desc(ringTossScores.score), asc(ringTossScores.createdAt))
      .limit(limit || LEADERBOARD_QUERY_LIMIT);

    return noStoreJson({
      leaderboard: scores.map((s: { id: string; odUserId: string; userName: string; score: number }) => ({
        id: s.id,
        userId: s.odUserId,
        userName: s.userName,
        score: s.score,
      })),
    });
  } catch (error) {
    return leaderboardServerError(error);
  }
}
