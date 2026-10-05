import { asc, desc, eq } from 'drizzle-orm';

import { db } from '@/server/db/client';
import { stackScores } from '@/server/db/schema';
import { STACK_RULES_VERSION } from '@/server/arcade/stack-replay';
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
    // upserts on both), so this is a plain ordered select. The board is the
    // current rules, 2. `?season=last` reads last season's bests: each
    // player's rules 1 row, never rewritten.
    const lastSeason = searchParams.get('season') === 'last';
    const scores = await db
      .select({
        id: stackScores.id,
        odUserId: stackScores.odUserId,
        userName: stackScores.userName,
        score: stackScores.score,
      })
      .from(stackScores)
      .where(eq(stackScores.rules, lastSeason ? 1 : STACK_RULES_VERSION))
      .orderBy(desc(stackScores.score), asc(stackScores.createdAt))
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
