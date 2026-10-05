import { asc, desc, eq } from 'drizzle-orm';

import { db } from '@/server/db/client';
import { highStrikerScores } from '@/server/db/schema';
import { STRIKER_RULES_VERSION } from '@/server/arcade/high-striker-replay';
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
    // One personal-best row per user per rules version (the score route
    // upserts on both). The board is the current rules, 3 (endless). `?season=last`
    // reads last season's bests: each player's rules 2 (five swings) row.
    const lastSeason = searchParams.get('season') === 'last';
    const scores = await db
      .select({
        id: highStrikerScores.id,
        odUserId: highStrikerScores.odUserId,
        userName: highStrikerScores.userName,
        score: highStrikerScores.score,
      })
      .from(highStrikerScores)
      .where(eq(highStrikerScores.rules, lastSeason ? STRIKER_RULES_VERSION - 1 : STRIKER_RULES_VERSION))
      .orderBy(desc(highStrikerScores.score), asc(highStrikerScores.createdAt))
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
