// ---------------------------------------------------------------------------
// 8-Ball Pool — Tournament parimutuel wager system.
//
// Spectators can bet Tickets on who they think will win each tournament match.
// Payout follows parimutuel formula: winner share = floor(bet * totalPool / winnerPool).
// ---------------------------------------------------------------------------

import crypto from 'node:crypto';
import { query, queryOne } from '@/server/db/client';
import { mutateWalletAndLedgerTx } from '@/server/arcade/rewards/helpers';
import {
  POOL_TOURNAMENT_DEFAULT_MAX_BET,
  POOL_TOURNAMENT_DEFAULT_MIN_BET,
} from '@/server/arcade/pool-wager-constants';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TournamentWager = {
  id: string;
  tournamentId: string;
  tournamentMatchId: string;
  userId: string;
  userName: string;
  backedPlayerId: string;
  amount: number;
  payout: number | null;
  status: string;
  createdAt: number;
  settledAt: number | null;
};

export type WagerPoolSummary = {
  player1Total: number;
  player2Total: number;
  totalPool: number;
};

const toNum = (value: unknown): number => (value == null ? 0 : Number(value));
const toNumOrNull = (value: unknown): number | null =>
  value == null ? null : Number(value);

const WAGER_SELECT = `
  id,
  tournament_id AS "tournamentId",
  tournament_match_id AS "tournamentMatchId",
  user_id AS "userId",
  user_name AS "userName",
  backed_player_id AS "backedPlayerId",
  amount,
  payout,
  status,
  created_at AS "createdAt",
  settled_at AS "settledAt"
`;

type WagerRow = {
  id: string;
  tournamentId: string;
  tournamentMatchId: string;
  userId: string;
  userName: string;
  backedPlayerId: string;
  amount: string | number;
  payout: string | number | null;
  status: string;
  createdAt: string | number;
  settledAt: string | number | null;
};

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export async function getWagerPoolSummary(tournamentMatchId: string): Promise<WagerPoolSummary> {
  const tMatch = await queryOne<{ player1Id: string | null }>(
    `SELECT player1_id AS "player1Id" FROM pool_tournament_matches WHERE id = $1`,
    [tournamentMatchId],
  );

  const rows = await query<WagerRow>(
    `SELECT ${WAGER_SELECT} FROM pool_tournament_wagers
     WHERE tournament_match_id = $1 AND status = 'active'`,
    [tournamentMatchId],
  );

  let player1Total = 0;
  let player2Total = 0;
  for (const row of rows.rows) {
    if (row.backedPlayerId === tMatch?.player1Id) {
      player1Total += toNum(row.amount);
    } else {
      player2Total += toNum(row.amount);
    }
  }

  return { player1Total, player2Total, totalPool: player1Total + player2Total };
}

export async function getWagersForTournament(
  tournamentId: string,
  userId?: string,
): Promise<{
  matchPools: Record<string, WagerPoolSummary>;
  userWagers: TournamentWager[];
}> {
  // Get all match IDs for this tournament
  const matches = await query<{ id: string; player1Id: string | null }>(
    `SELECT id, player1_id AS "player1Id" FROM pool_tournament_matches
     WHERE tournament_id = $1`,
    [tournamentId],
  );

  const allWagers = await query<WagerRow>(
    `SELECT ${WAGER_SELECT} FROM pool_tournament_wagers
     WHERE tournament_id = $1`,
    [tournamentId],
  );

  const matchPools: Record<string, WagerPoolSummary> = {};
  const p1Map = new Map(matches.rows.map((m) => [m.id, m.player1Id]));

  for (const m of matches.rows) {
    matchPools[m.id] = { player1Total: 0, player2Total: 0, totalPool: 0 };
  }

  for (const wager of allWagers.rows) {
    if (wager.status !== 'active') continue;
    const pool = matchPools[wager.tournamentMatchId];
    if (!pool) continue;
    const amount = toNum(wager.amount);
    if (wager.backedPlayerId === p1Map.get(wager.tournamentMatchId)) {
      pool.player1Total += amount;
    } else {
      pool.player2Total += amount;
    }
    pool.totalPool += amount;
  }

  const userWagers: TournamentWager[] = userId
    ? allWagers.rows
        .filter((w) => w.userId === userId)
        .map((w) => ({
          id: w.id,
          tournamentId: w.tournamentId,
          tournamentMatchId: w.tournamentMatchId,
          userId: w.userId,
          userName: w.userName,
          backedPlayerId: w.backedPlayerId,
          amount: toNum(w.amount),
          payout: toNumOrNull(w.payout),
          status: w.status,
          createdAt: toNum(w.createdAt),
          settledAt: toNumOrNull(w.settledAt),
        }))
    : [];

  return { matchPools, userWagers };
}

// ---------------------------------------------------------------------------
// Place a wager
// ---------------------------------------------------------------------------

export async function placeTournamentWager({
  userId,
  userName,
  tournamentMatchId,
  backedPlayerId,
  amount,
}: {
  userId: string;
  userName: string;
  tournamentMatchId: string;
  backedPlayerId: string;
  amount: number;
}): Promise<TournamentWager> {
  // Validate amount
  if (!Number.isInteger(amount) || amount < 5) {
    throw new Error('Minimum bet is 5 Tickets.');
  }
  if (amount % 5 !== 0) {
    throw new Error('Bet must be a multiple of 5 Tickets.');
  }

  // Load tournament match
  const tMatch = await queryOne<{
    id: string;
    tournamentId: string;
    player1Id: string | null;
    player2Id: string | null;
    status: string;
  }>(
    `SELECT id, tournament_id AS "tournamentId", player1_id AS "player1Id",
            player2_id AS "player2Id", status
     FROM pool_tournament_matches
     WHERE id = $1`,
    [tournamentMatchId],
  );
  if (!tMatch) throw new Error('Tournament match not found.');
  if (tMatch.status !== 'pending') {
    throw new Error('Betting is closed for this match.');
  }
  if (!tMatch.player1Id || !tMatch.player2Id) {
    throw new Error('Both players must be assigned before betting opens.');
  }

  // Validate backed player
  if (backedPlayerId !== tMatch.player1Id && backedPlayerId !== tMatch.player2Id) {
    throw new Error('Invalid player selection.');
  }

  // Self-bet prevention
  if (userId === tMatch.player1Id || userId === tMatch.player2Id) {
    throw new Error('Players cannot bet on their own match.');
  }

  // Load tournament for betting config
  const tournament = await queryOne<{
    bettingEnabled: boolean | number | null;
    minBet: string | number | null;
    maxBet: string | number | null;
  }>(
    `SELECT betting_enabled AS "bettingEnabled", min_bet AS "minBet", max_bet AS "maxBet"
     FROM pool_tournaments
     WHERE id = $1`,
    [tMatch.tournamentId],
  );
  if (!tournament) throw new Error('Tournament not found.');
  if (!(tournament.bettingEnabled === true || tournament.bettingEnabled === 1)) {
    throw new Error('Betting is not enabled for this tournament.');
  }
  const maxBet = toNumOrNull(tournament.maxBet) ?? POOL_TOURNAMENT_DEFAULT_MAX_BET;
  const minBet = toNumOrNull(tournament.minBet) ?? POOL_TOURNAMENT_DEFAULT_MIN_BET;
  if (amount > maxBet) {
    throw new Error(`Maximum bet is ${maxBet} Tickets.`);
  }
  if (amount < minBet) {
    throw new Error(`Minimum bet is ${minBet} Tickets.`);
  }

  const wagerId = crypto.randomUUID();
  const holdSourceId = `tourn-wager-hold:${wagerId}`;
  const now = Date.now();

  // Deduct Tickets
  await mutateWalletAndLedgerTx({
    userId,
    currencyType: 'credits',
    amount: -amount,
    sourceType: 'wager_hold',
    sourceId: holdSourceId,
    meta: { tournamentId: tMatch.tournamentId, tournamentMatchId, backedPlayerId },
  });

  // Insert wager row
  await query(
    `INSERT INTO pool_tournament_wagers
       (id, tournament_id, tournament_match_id, user_id, user_name,
        backed_player_id, amount, payout, status, ledger_source_id_hold,
        ledger_source_id_payout, created_at, settled_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [
      wagerId, tMatch.tournamentId, tournamentMatchId, userId, userName,
      backedPlayerId, amount, null, 'active', holdSourceId, null, now, null,
    ],
  );

  return {
    id: wagerId,
    tournamentId: tMatch.tournamentId,
    tournamentMatchId,
    userId,
    userName,
    backedPlayerId,
    amount,
    payout: null,
    status: 'active',
    createdAt: now,
    settledAt: null,
  };
}

// ---------------------------------------------------------------------------
// Settle wagers (parimutuel payout)
// ---------------------------------------------------------------------------

export async function settleTournamentMatchWagers(
  tournamentMatchId: string,
  winnerId: string,
): Promise<{ settled: number; refunded: number }> {
  const activeWagers = await query<WagerRow>(
    `SELECT ${WAGER_SELECT} FROM pool_tournament_wagers
     WHERE tournament_match_id = $1 AND status = 'active'`,
    [tournamentMatchId],
  );

  if (activeWagers.rows.length === 0) return { settled: 0, refunded: 0 };

  const totalPool = activeWagers.rows.reduce((sum, w) => sum + toNum(w.amount), 0);
  const winnerPool = activeWagers.rows
    .filter((w) => w.backedPlayerId === winnerId)
    .reduce((sum, w) => sum + toNum(w.amount), 0);

  const now = Date.now();

  // If nobody bet on the winner, refund everyone
  if (winnerPool === 0) {
    return cancelTournamentMatchWagers(tournamentMatchId);
  }

  let settled = 0;
  for (const wager of activeWagers.rows) {
    const isWinner = wager.backedPlayerId === winnerId;
    const payout = isWinner ? Math.floor(toNum(wager.amount) * totalPool / winnerPool) : 0;
    const newStatus = isWinner ? 'won' : 'lost';
    const payoutSourceId = `tourn-wager-payout:${wager.id}`;

    if (isWinner && payout > 0) {
      await mutateWalletAndLedgerTx({
        userId: wager.userId,
        currencyType: 'credits',
        amount: payout,
        sourceType: 'wager_payout',
        sourceId: payoutSourceId,
        meta: { tournamentMatchId, wagerId: wager.id, totalPool, winnerPool },
      });
    }

    await query(
      `UPDATE pool_tournament_wagers
       SET status = $1, payout = $2, ledger_source_id_payout = $3, settled_at = $4
       WHERE id = $5`,
      [newStatus, payout, isWinner ? payoutSourceId : null, now, wager.id],
    );

    settled++;
  }

  return { settled, refunded: 0 };
}

// ---------------------------------------------------------------------------
// Cancel / refund all wagers for a match
// ---------------------------------------------------------------------------

export async function cancelTournamentMatchWagers(
  tournamentMatchId: string,
): Promise<{ settled: number; refunded: number }> {
  const activeWagers = await query<WagerRow>(
    `SELECT ${WAGER_SELECT} FROM pool_tournament_wagers
     WHERE tournament_match_id = $1 AND status = 'active'`,
    [tournamentMatchId],
  );

  const now = Date.now();
  let refunded = 0;

  for (const wager of activeWagers.rows) {
    const refundSourceId = `tourn-wager-refund:${wager.id}`;
    await mutateWalletAndLedgerTx({
      userId: wager.userId,
      currencyType: 'credits',
      amount: toNum(wager.amount),
      sourceType: 'wager_refund',
      sourceId: refundSourceId,
      meta: { tournamentMatchId, wagerId: wager.id },
    });

    await query(
      `UPDATE pool_tournament_wagers
       SET status = 'refunded', payout = 0, ledger_source_id_payout = $1, settled_at = $2
       WHERE id = $3`,
      [refundSourceId, now, wager.id],
    );

    refunded++;
  }

  return { settled: 0, refunded };
}
