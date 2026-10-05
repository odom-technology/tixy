import {
  leaderboardServerError,
  noStoreJson,
  requireLeaderboardAccess,
} from '../../_shared/leaderboard-helpers';
import { requireIdentity } from '@/server/auth';
import {
  getEloLeaderboard,
  getElo,
  getEloRank,
  getEloHistory,
  getTierName,
  getTierColor,
} from '@/server/arcade/pool-elo';

export const dynamic = 'force-dynamic';

/** GET — Elo-ranked leaderboard for 8-ball (human vs human only). */
export async function GET(request: Request) {
  const unauthorized = await requireLeaderboardAccess();
  if (unauthorized) return unauthorized;

  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');

    // If userId requested, return that player's detail + recent history
    if (userId) {
      const elo = await getElo(userId);
      if (!elo || elo.totalGames === 0) {
        return noStoreJson({ player: null, history: [] });
      }
      const history = await getEloHistory(userId, 10);
      const rank = await getEloRank(userId);
      return noStoreJson({
        player: {
          userId: elo.userId,
          userName: elo.userName,
          eloRating: elo.eloRating,
          rank,
          tier: getTierName(elo.eloRating),
          tierColor: getTierColor(elo.eloRating),
          totalWins: elo.totalWins,
          totalLosses: elo.totalLosses,
          totalGames: elo.totalGames,
          winRate: elo.totalGames > 0
            ? Math.round((elo.totalWins / elo.totalGames) * 1000) / 10
            : 0,
          peakElo: elo.peakElo,
          lastPlayed: elo.lastPlayed,
        },
        history: history.map((h) => ({
          matchId: h.matchId,
          opponentId: h.playerAId === userId ? h.playerBId : h.playerAId,
          won: h.winnerId === userId,
          eloBefore: h.playerAId === userId ? h.playerAEloBefore : h.playerBEloBefore,
          eloAfter: h.playerAId === userId ? h.playerAEloAfter : h.playerBEloAfter,
          eloChange: h.playerAId === userId ? h.playerAEloChange : h.playerBEloChange,
          timestamp: h.createdAt,
        })),
      });
    }

    // Default: full leaderboard
    const rows = await getEloLeaderboard(50);
    const leaderboard = rows.map((row) => ({
      userId: row.userId,
      userName: row.userName,
      eloRating: row.eloRating,
      tier: getTierName(row.eloRating),
      tierColor: getTierColor(row.eloRating),
      totalWins: row.totalWins,
      totalLosses: row.totalLosses,
      totalGames: row.totalGames,
      winRate: row.totalGames > 0
        ? Math.round((row.totalWins / row.totalGames) * 1000) / 10
        : 0,
      peakElo: row.peakElo,
    }));

    // Include the current user's rank + entry if they're not in the top 50
    let currentUserEntry = null;
    try {
      const identity = await requireIdentity({ allowExternal: true, allowGuest: true });
      const currentUserId = identity?.userId;
      if (currentUserId && !leaderboard.find((e) => e.userId === currentUserId)) {
        const elo = await getElo(currentUserId);
        if (elo && elo.totalGames > 0) {
          const rank = await getEloRank(currentUserId);
          currentUserEntry = {
            userId: elo.userId,
            userName: elo.userName,
            eloRating: elo.eloRating,
            tier: getTierName(elo.eloRating),
            tierColor: getTierColor(elo.eloRating),
            totalWins: elo.totalWins,
            totalLosses: elo.totalLosses,
            totalGames: elo.totalGames,
            winRate: Math.round((elo.totalWins / elo.totalGames) * 1000) / 10,
            peakElo: elo.peakElo,
            rank,
          };
        }
      }
    } catch { /* not signed in — no pinned row */ }

    return noStoreJson({ leaderboard, currentUserEntry });
  } catch (error) {
    return leaderboardServerError(error);
  }
}
