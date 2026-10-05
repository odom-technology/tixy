import { asc, desc, eq } from 'drizzle-orm';

import { db } from '@/server/db/client';
import { typingTestScores } from '@/server/db/schema';
import { LEADERBOARD_QUERY_LIMIT, TYPING_TEST_MODES } from '../../_shared/constants';
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

  const { searchParams } = new URL(request.url);
  const mode = parseInt(searchParams.get('mode') || '60', 10);
  const limit = resolveLeaderboardLimit(searchParams);

  if (!(TYPING_TEST_MODES as readonly number[]).includes(mode)) {
    return noStoreJson({ error: 'Invalid mode. Must be 15, 30, or 60.' }, 400);
  }

  try {
    // One personal-best row per user and mode (od_user_id+mode is unique;
    // the score route upserts), so this is a plain ordered select —
    // GROUP BY would make Postgres reject the ungrouped id/user_name columns.
    const scores = await db
      .select({
        id: typingTestScores.id,
        odUserId: typingTestScores.odUserId,
        userName: typingTestScores.userName,
        wpm: typingTestScores.wpm,
        rawWpm: typingTestScores.rawWpm,
        accuracy: typingTestScores.accuracy,
        wordsCompleted: typingTestScores.wordsCompleted,
      })
      .from(typingTestScores)
      .where(eq(typingTestScores.mode, mode))
      .orderBy(desc(typingTestScores.wpm), asc(typingTestScores.createdAt))
      .limit(limit || LEADERBOARD_QUERY_LIMIT);

    const leaderboard = scores.map((score) => ({
      id: score.id,
      userId: score.odUserId,
      userName: score.userName,
      wpm: score.wpm,
      rawWpm: score.rawWpm,
      accuracy: score.accuracy,
      wordsCompleted: score.wordsCompleted,
    }));

    return noStoreJson({ leaderboard, mode });
  } catch (error) {
    return leaderboardServerError(error);
  }
}
