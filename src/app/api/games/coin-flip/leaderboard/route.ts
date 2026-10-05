import { asc, desc, sql } from 'drizzle-orm';
import { db } from '@/server/db/client';
import { coinFlipScores } from '@/server/db/schema';
import { LEADERBOARD_QUERY_LIMIT } from '../../_shared/constants';
import {
  leaderboardServerError,
  noStoreJson,
  requireLeaderboardAccess,
  resolveLeaderboardLimit,
} from '../../_shared/leaderboard-helpers';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const unauthorized = await requireLeaderboardAccess();
  if (unauthorized) return unauthorized;

  try {
    const { searchParams } = new URL(request.url);
    const limit = resolveLeaderboardLimit(searchParams);
    const effectiveGamesPlayed = sql<number>`
      CASE
        WHEN ${coinFlipScores.totalGamesPlayed} > 0 THEN ${coinFlipScores.totalGamesPlayed}
        ELSE 1
      END
    `;
    const effectiveCorrectFlips = sql<number>`
      MAX(${coinFlipScores.totalCorrectFlips}, ${coinFlipScores.streak})
    `;
    const effectiveTotalFlips = sql<number>`
      MAX(${coinFlipScores.totalFlips}, ${coinFlipScores.streak} + 1)
    `;
    const scores = await db
      .select({
        id: coinFlipScores.id,
        odUserId: coinFlipScores.odUserId,
        userName: coinFlipScores.userName,
        streak: coinFlipScores.streak,
        gamesPlayed: effectiveGamesPlayed.as('games_played'),
        accuracyPct: sql<number>`
          ROUND(
            (CAST(${effectiveCorrectFlips} AS REAL) * 100.0) /
            NULLIF(${effectiveTotalFlips}, 0),
            1
          )
        `.as('accuracy_pct'),
      })
      .from(coinFlipScores)
      .orderBy(desc(coinFlipScores.streak), asc(coinFlipScores.createdAt))
      .limit(limit || LEADERBOARD_QUERY_LIMIT);

    const leaderboard = scores.map((score) => ({
      id: score.id,
      userId: score.odUserId,
      userName: score.userName,
      score: score.streak,
      streak: score.streak,
      totalGamesPlayed: Number(score.gamesPlayed) || 0,
      accuracyPercentage: Number(score.accuracyPct) || 0,
    }));

    return noStoreJson({ leaderboard });
  } catch (error) {
    return leaderboardServerError(error);
  }
}
