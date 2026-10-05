/* What the scores page reads on the server: where a player stands on each
   floor board, and the ticket machines' biggest wins this week. The boards
   that pay are the weekly boards (rewards/weekly-boards.ts). */

import { isWindowedBoardGame } from '@/features/arcade/components/leaderboard-games';
import { getPickerGroups } from '@/features/arcade/components/leaderboards/page-boards';
import { getEloRank as getBattleshipRank } from '@/server/arcade/battleship-elo';
import { getEloRank as getChessRank } from '@/server/arcade/chess-elo';
import { getEloRank as getConnectFourRank } from '@/server/arcade/connect-four-elo';
import { getEloRank as getPoolRank } from '@/server/arcade/pool-elo';
import { getEloRank as getReversiRank } from '@/server/arcade/reversi-elo';
import { getUserRankInWindow } from '@/server/arcade/score-events';
import { getUtcDateKey } from '@/server/arcade/word-grid';
import { query } from '@/server/db/client';

// ── Ticket machines: the biggest win each player landed this week ───────────

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const NOT_REFUND = `(outcome_json IS NULL OR outcome_json NOT LIKE '%"refunded":true%')`;

export type MachineWinRow = {
  userId: string;
  userName: string;
  rank: number;
  payout: number;
  wager: number;
  multiplier: number;
};

export type MachineWins = {
  rows: MachineWinRow[];
  viewer: { userId: string; rank: number; payout: number } | null;
  around: MachineWinRow[];
};

/**
 * One row per player: their biggest payout on this machine in the last seven
 * days, ranked. Reads the week's slice of arcade_round_history through its
 * (game_type, created_at) index, so the cost is the week's rounds on one
 * machine. With a viewer, also their rank and the two rows either side.
 */
export async function getMachineWins(
  historyType: string,
  viewerId: string | null,
  limit = 50,
): Promise<MachineWins> {
  const since = Date.now() - WEEK_MS;
  const rows = (
    await query<{
      user_id: string;
      user_name: string;
      payout_amount: number | string;
      wager_amount: number | string;
      multiplier: number | string;
      rnk: number | string;
      rn: number | string;
    }>(
      `WITH best AS (
         SELECT DISTINCT ON (user_id) user_id, user_name, payout_amount, wager_amount, multiplier, created_at
         FROM arcade_round_history
         WHERE game_type = $1 AND created_at >= $2 AND payout_amount > 0 AND ${NOT_REFUND}
         ORDER BY user_id, payout_amount DESC, created_at ASC
       ), ranked AS (
         SELECT *, RANK() OVER (ORDER BY payout_amount DESC) AS rnk,
                ROW_NUMBER() OVER (ORDER BY payout_amount DESC, created_at ASC, user_id) AS rn
         FROM best
       ), me AS (
         SELECT rn FROM ranked WHERE user_id = $4
       )
       SELECT r.user_id, r.user_name, r.payout_amount, r.wager_amount, r.multiplier, r.rnk, r.rn
       FROM ranked r LEFT JOIN me ON TRUE
       WHERE r.rn <= $3 OR (me.rn IS NOT NULL AND r.rn BETWEEN me.rn - 2 AND me.rn + 2)
       ORDER BY r.rn`,
      [historyType, since, Math.min(Math.max(limit, 1), 100), viewerId ?? ''],
    )
  ).rows;

  const toRow = (row: (typeof rows)[number]): MachineWinRow & { rn: number } => ({
    userId: row.user_id,
    userName: row.user_name || 'player',
    rank: Number(row.rnk),
    rn: Number(row.rn),
    payout: Number(row.payout_amount),
    wager: Number(row.wager_amount),
    multiplier: Number(row.multiplier),
  });
  const all = rows.map(toRow);
  const mine = viewerId ? all.find((row) => row.userId === viewerId) : undefined;
  const strip = ({ rn: _rn, ...row }: MachineWinRow & { rn: number }): MachineWinRow => row;
  return {
    rows: all.filter((row) => row.rn <= limit).map(strip),
    viewer: mine ? { userId: mine.userId, rank: mine.rank, payout: mine.payout } : null,
    around: mine ? all.filter((row) => Math.abs(row.rn - mine.rn) <= 2).map(strip) : [],
  };
}

// ── Where you stand: one rank per floor board ────────────────────────────────

const RATING_RANK: Record<string, (userId: string) => Promise<number | null>> = {
  '8-ball': getPoolRank,
  chess: getChessRank,
  'connect-four': getConnectFourRank,
  reversi: getReversiRank,
  battleship: getBattleshipRank,
};

/** Today's word grid: solved first, then fewest guesses, then fastest. */
async function getWordGridRankToday(userId: string): Promise<number | null> {
  const result = await query<{ ahead: number | string | null; mine: number | string | null }>(
    `WITH mine AS (
       SELECT solved, guesses, time_seconds FROM word_grid_scores
       WHERE puzzle_date = $1 AND od_user_id = $2
       ORDER BY solved DESC, guesses ASC, time_seconds ASC LIMIT 1
     )
     SELECT (SELECT COUNT(*) FROM mine) AS mine,
            (SELECT COUNT(DISTINCT s.od_user_id) FROM word_grid_scores s, mine m
             WHERE s.puzzle_date = $1 AND s.od_user_id <> $2
               AND (s.solved::int > m.solved::int
                 OR (s.solved = m.solved AND (s.guesses < m.guesses
                   OR (s.guesses = m.guesses AND s.time_seconds < m.time_seconds))))) AS ahead`,
    [getUtcDateKey(), userId],
  );
  const row = result.rows[0];
  if (!row || Number(row.mine) === 0) return null;
  return Number(row.ahead ?? 0) + 1;
}

export type Standing = {
  slug: string;
  rank: number;
  /** What the rank is on: the board it reads when no tab is picked. */
  on: 'all time' | 'rating' | 'today' | 'this week';
};

/** The player's rank on each floor board they are on, in floor order. */
export async function getFloorStandings(userId: string): Promise<Standing[]> {
  const games = getPickerGroups().flatMap(({ games }) => games);
  const ranks = await Promise.all(
    games.map(async (game): Promise<Standing | null> => {
      try {
        const { board } = game;
        if (board.kind === 'rating') {
          const rank = await RATING_RANK[game.slug]?.(userId);
          return rank ? { slug: game.slug, rank, on: 'rating' } : null;
        }
        if (board.kind === 'wins') {
          const wins = await getMachineWins(board.historyType, userId, 1);
          return wins.viewer ? { slug: game.slug, rank: wins.viewer.rank, on: 'this week' } : null;
        }
        if (game.slug === 'word-grid') {
          const rank = await getWordGridRankToday(userId);
          return rank ? { slug: game.slug, rank, on: 'today' } : null;
        }
        if (isWindowedBoardGame(game.slug)) {
          const mine = await getUserRankInWindow(game.slug, 'all', userId);
          return mine ? { slug: game.slug, rank: mine.rank, on: 'all time' } : null;
        }
        return null;
      } catch (error) {
        console.error(`standing for ${game.slug} failed:`, error);
        return null;
      }
    }),
  );
  return ranks.filter((rank): rank is Standing => rank != null);
}
