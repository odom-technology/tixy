import {
  leaderboardServerError,
  noStoreJson,
  resolveLeaderboardLimit,
  requireLeaderboardAccess,
} from '../../_shared/leaderboard-helpers';
import { requireIdentity } from '@/server/auth';
import { getEloLeaderboard, getElo, getEloRank, getTierName, getTierColor } from '@/server/arcade/pool-elo';
import { getBotRecordLeaderboard, getPlayerBotRecords } from '@/server/arcade/pool-elo';

export const dynamic = 'force-dynamic';

/**
 * GET — Unified 8-ball leaderboard.
 *
 * ?mode=ranked   → Elo leaderboard (default)
 * ?mode=easy     → Speed run: easy bot
 * ?mode=medium   → Speed run: medium bot
 * ?mode=hard     → Speed run: hard bot
 *
 * Always returns `currentUserEntry` if the signed-in user has data but
 * is outside the returned top rows.
 */
export async function GET(request: Request) {
  const unauthorized = await requireLeaderboardAccess();
  if (unauthorized) return unauthorized;

  try {
    const { searchParams } = new URL(request.url);
    const mode = searchParams.get('mode') ?? 'ranked';
    const limit = resolveLeaderboardLimit(searchParams);

    // Resolve current user (best-effort, no hard failure)
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
        totalGames: row.totalGames,
        winRate: row.totalGames > 0
          ? Math.round((row.totalWins / row.totalGames) * 100)
          : 0,
      }));

      // Pinned entry for current user if outside the visible list
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
            totalGames: elo.totalGames,
            winRate: Math.round((elo.totalWins / elo.totalGames) * 1000) / 10,
            rank,
          };
        }
      }

      return noStoreJson({ leaderboard, currentUserEntry });
    }

    // Speed run modes
    if (['easy', 'medium', 'hard'].includes(mode)) {
      const rows = await getBotRecordLeaderboard(mode, limit);
      const leaderboard = rows.map((row) => ({
        id: row.userId,
        userId: row.userId,
        userName: row.userName,
        score: row.fewestTurns,
        fewestTurns: row.fewestTurns,
        totalTurnDurationMs: row.totalTurnDurationMs ?? null,
        achievedAt: row.achievedAt,
      }));

      // Pinned entry for current user
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
            score: match.fewestTurns,
            fewestTurns: match.fewestTurns,
            totalTurnDurationMs: match.totalTurnDurationMs ?? null,
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
