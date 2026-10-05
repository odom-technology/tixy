import { asc, desc } from 'drizzle-orm';

import { db } from '@/server/db/client';
import { skeeBallScores } from '@/server/db/schema';
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
    // upserts), so this is a plain ordered select.
    const scores = await db
      .select({
        id: skeeBallScores.id,
        odUserId: skeeBallScores.odUserId,
        userName: skeeBallScores.userName,
        score: skeeBallScores.score,
      })
      .from(skeeBallScores)
      .orderBy(desc(skeeBallScores.score), asc(skeeBallScores.createdAt))
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
