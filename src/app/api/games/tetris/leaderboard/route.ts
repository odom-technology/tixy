import { asc, desc, gt } from 'drizzle-orm';

import { db } from '@/server/db/client';
import { tetrisScores } from '@/server/db/schema';
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
    const mode = searchParams.get('mode');

    if (mode === 'lines') {
      // Lines cleared leaderboard — uses best_lines (separate PB from score)
      // Ties broken by earliest achievement of that lines PB
      const scores = await db
        .select({
          id: tetrisScores.id,
          odUserId: tetrisScores.odUserId,
          userName: tetrisScores.userName,
          score: tetrisScores.bestLinesScore,
          level: tetrisScores.bestLinesLevel,
          lines: tetrisScores.bestLines,
        })
        .from(tetrisScores)
        .where(gt(tetrisScores.bestLines, 0))
        .orderBy(
          desc(tetrisScores.bestLines),
          asc(tetrisScores.bestLinesCreatedAt),
        )
        .limit(limit || LEADERBOARD_QUERY_LIMIT);

      return noStoreJson({
        leaderboard: scores.map((s) => ({
          id: s.id,
          userId: s.odUserId,
          userName: s.userName,
          score: s.score,
          level: s.level,
          lines: s.lines,
        })),
        mode: 'lines',
      });
    }

    // Default: high score leaderboard
    // Ties broken by fewer lines (more efficient), then earlier date
    const scores = await db
      .select({
        id: tetrisScores.id,
        odUserId: tetrisScores.odUserId,
        userName: tetrisScores.userName,
        score: tetrisScores.score,
        level: tetrisScores.level,
        lines: tetrisScores.lines,
      })
      .from(tetrisScores)
      .orderBy(
        desc(tetrisScores.score),
        asc(tetrisScores.lines),
        asc(tetrisScores.createdAt),
      )
      .limit(limit || LEADERBOARD_QUERY_LIMIT);

    return noStoreJson({
      leaderboard: scores.map((s) => ({
        id: s.id,
        userId: s.odUserId,
        userName: s.userName,
        score: s.score,
        level: s.level,
        lines: s.lines,
      })),
    });
  } catch (error) {
    return leaderboardServerError(error);
  }
}
