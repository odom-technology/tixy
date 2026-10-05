import {
  leaderboardServerError,
  noStoreJson,
  requireLeaderboardAccess,
} from '../../_shared/leaderboard-helpers';
import { requireIdentity } from '@/server/auth';
import { getBotRecordLeaderboard, getPlayerBotRecords } from '@/server/arcade/pool-elo';

export const dynamic = 'force-dynamic';

/** GET — Bot speed run leaderboard. ?difficulty=easy|medium|hard or ?userId=... for personal bests. */
export async function GET(request: Request) {
  const unauthorized = await requireLeaderboardAccess();
  if (unauthorized) return unauthorized;

  try {
    const { searchParams } = new URL(request.url);
    const difficulty = searchParams.get('difficulty');
    const userId = searchParams.get('userId');

    // Personal bests for a user across all difficulties
    if (userId) {
      const records = await getPlayerBotRecords(userId);
      return noStoreJson({
        records: records.map((r) => ({
          botDifficulty: r.botDifficulty,
          fewestTurns: r.fewestTurns,
          totalTurnDurationMs: r.totalTurnDurationMs ?? null,
          achievedAt: r.achievedAt,
        })),
      });
    }

    // Leaderboard for a specific difficulty
    if (!difficulty || !['easy', 'medium', 'hard'].includes(difficulty)) {
      return noStoreJson({ error: 'Specify ?difficulty=easy|medium|hard or ?userId=...' }, 400);
    }

    const rows = await getBotRecordLeaderboard(difficulty, 50);
    const leaderboard = rows.map((row) => ({
      userId: row.userId,
      userName: row.userName,
      fewestTurns: row.fewestTurns,
      totalTurnDurationMs: row.totalTurnDurationMs ?? null,
      achievedAt: row.achievedAt,
    }));

    // Include the current user's entry if they're not in the top 50
    let currentUserEntry = null;
    try {
      const identity = await requireIdentity({ allowExternal: true, allowGuest: true });
      if (identity?.userId && !leaderboard.find((e) => e.userId === identity.userId)) {
        const records = await getPlayerBotRecords(identity.userId);
        const match = records.find((r) => r.botDifficulty === difficulty);
        if (match) {
          // Compute rank: count how many records are better (fewer turns, or same turns but earlier)
          const allRows = await getBotRecordLeaderboard(difficulty, 9999);
          const rank = allRows.findIndex((r) => r.userId === identity.userId) + 1;
          currentUserEntry = {
            userId: identity.userId,
            userName: match.userName,
            fewestTurns: match.fewestTurns,
            totalTurnDurationMs: match.totalTurnDurationMs ?? null,
            achievedAt: match.achievedAt,
            rank: rank > 0 ? rank : null,
          };
        }
      }
    } catch { /* not signed in */ }

    return noStoreJson({ leaderboard, currentUserEntry });
  } catch (error) {
    return leaderboardServerError(error);
  }
}
