import { asc, desc, eq } from 'drizzle-orm';

import { db } from '@/server/db/client';
import { tinDuckScores } from '@/server/db/schema';
import { GALLERY_RULES_VERSION } from '@/server/arcade/tin-duck-gallery';
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
    // upserts on both). The board is the current rules, 2. `?season=last` reads
    // last season's bests: each player's rules 1 row, never rewritten.
    const lastSeason = searchParams.get('season') === 'last';
    const scores = await db
      .select({
        id: tinDuckScores.id,
        odUserId: tinDuckScores.odUserId,
        userName: tinDuckScores.userName,
        score: tinDuckScores.score,
      })
      .from(tinDuckScores)
      .where(eq(tinDuckScores.rules, lastSeason ? 1 : GALLERY_RULES_VERSION))
      .orderBy(desc(tinDuckScores.score), asc(tinDuckScores.createdAt))
      .limit(limit || LEADERBOARD_QUERY_LIMIT);

    const leaderboard = scores.map((score: { id: string; odUserId: string; userName: string; score: number }) => ({
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
