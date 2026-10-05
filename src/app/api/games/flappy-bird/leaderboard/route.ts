import { asc, desc } from 'drizzle-orm';

import { db } from '@/server/db/client';
import { flappyBirdScores } from '@/server/db/schema';
import { LEADERBOARD_QUERY_LIMIT } from '../../_shared/constants';
import {
  leaderboardServerError,
  noStoreJson,
  resolveLeaderboardLimit,
  requireLeaderboardAccess,
} from '../../_shared/leaderboard-helpers';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const unauthorized = await requireLeaderboardAccess();
  if (unauthorized) return unauthorized;

  try {
    const { searchParams } = new URL(request.url);
    const limit = resolveLeaderboardLimit(searchParams);
    // One personal-best row per user (od_user_id is unique; the score route
    // upserts), so this is a plain ordered select — GROUP BY would make
    // Postgres reject the ungrouped id/user_name columns.
    const scores = await db
      .select({
        id: flappyBirdScores.id,
        odUserId: flappyBirdScores.odUserId,
        userName: flappyBirdScores.userName,
        score: flappyBirdScores.score,
      })
      .from(flappyBirdScores)
      .orderBy(desc(flappyBirdScores.score), asc(flappyBirdScores.createdAt))
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
