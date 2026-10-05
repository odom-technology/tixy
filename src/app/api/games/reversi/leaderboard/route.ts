import {
  leaderboardServerError,
  noStoreJson,
  resolveLeaderboardLimit,
  requireLeaderboardAccess,
} from '../../_shared/leaderboard-helpers';
import { requireIdentity } from '@/server/auth';
import {
  getEloLeaderboard,
  getElo,
  getEloRank,
  getTierName,
  getTierColor,
  getBotRecordLeaderboard,
  getPlayerBotRecords,
} from '@/server/arcade/reversi-elo';

export const dynamic = 'force-dynamic';

/**
 * GET — Unified Reversi leaderboard.
 *
 * ?mode=ranked → Elo leaderboard (default)
 * ?mode=easy|medium|hard → Speed run vs bot
 */
export async function GET(request: Request) {
  const unauthorized = await requireLeaderboardAccess();
  if (unauthorized) return unauthorized;

  try {
    const { searchParams } = new URL(request.url);
    const mode = searchParams.get('mode') ?? 'ranked';
    const limit = resolveLeaderboardLimit(searchParams);

    let currentUserId: string | null = null;
    try {
      const identity = await requireIdentity({ allowExternal: true, allowGuest: true });
      currentUserId = identity?.userId ?? null;
    } catch { /* not signed in */ }

    if (mode === 'ranked') {
      const rows = await getEloLeaderboard(limit);
      const leaderboard = rows.map((row) => ({
        id: row.userId,
        userId: row.userId,
        userName: row.userName,
        score: row.eloRating,
        eloRating: row.eloRating,
        tier: getTierName(row.eloRating),
        tierColor: getTierColor(row.eloRating),
        totalWins: row.totalWins,
        totalLosses: row.totalLosses,
        totalDraws: row.totalDraws,
        totalGames: row.totalGames,
        winRate: row.totalGames > 0
          ? Math.round((row.totalWins / row.totalGames) * 100)
          : 0,
      }));

      let currentUserEntry = null;
      if (currentUserId && !leaderboard.find((e) => e.userId === currentUserId)) {
        const elo = await getElo(currentUserId);
        if (elo && elo.totalGames > 0) {
          const rank = await getEloRank(currentUserId);
          currentUserEntry = {
            id: elo.userId,
            userId: elo.userId,
            userName: elo.userName,
            score: elo.eloRating,
            eloRating: elo.eloRating,
            tier: getTierName(elo.eloRating),
            tierColor: getTierColor(elo.eloRating),
            totalWins: elo.totalWins,
            totalLosses: elo.totalLosses,
            totalDraws: elo.totalDraws,
            totalGames: elo.totalGames,
            winRate: Math.round((elo.totalWins / elo.totalGames) * 1000) / 10,
            rank,
          };
        }
      }

      return noStoreJson({ leaderboard, currentUserEntry });
    }

    if (['easy', 'medium', 'hard'].includes(mode)) {
      const rows = await getBotRecordLeaderboard(mode, limit);
      const leaderboard = rows.map((row) => ({
        id: row.userId,
        userId: row.userId,
        userName: row.userName,
        score: row.fewestPly,
        fewestPly: row.fewestPly,
        totalThinkingMs: row.totalThinkingMs ?? null,
        achievedAt: row.achievedAt,
      }));

      let currentUserEntry = null;
      if (currentUserId && !leaderboard.find((e) => e.userId === currentUserId)) {
        const records = await getPlayerBotRecords(currentUserId);
        const match = records.find((r) => r.botDifficulty === mode);
        if (match) {
          const allRows = await getBotRecordLeaderboard(mode, 9999);
          const rank = allRows.findIndex((r) => r.userId === currentUserId) + 1;
          currentUserEntry = {
            id: currentUserId,
            userId: currentUserId,
            userName: match.userName,
            score: match.fewestPly,
            fewestPly: match.fewestPly,
            totalThinkingMs: match.totalThinkingMs ?? null,
            achievedAt: match.achievedAt,
            rank: rank > 0 ? rank : null,
          };
        }
      }

      return noStoreJson({ leaderboard, currentUserEntry });
    }

    return noStoreJson({ leaderboard: [] });
  } catch (error) {
    return leaderboardServerError(error);
  }
}
