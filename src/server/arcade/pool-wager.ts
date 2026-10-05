// ---------------------------------------------------------------------------
// 8-Ball Pool — Private match wager helpers (hold / settle / refund).
// ---------------------------------------------------------------------------

import type { PoolClient } from 'pg';

import { withTransaction } from '@/server/db/client';
import { mutateWalletAndLedgerForTransaction } from '@/server/arcade/rewards/wallet';

const UPDATE_WAGER_STATUS_SQL =
  'UPDATE pool_matches SET wager_status = $1 WHERE id = $2';

/** The caller's transaction when there is one, else a new one. */
const inTransaction = <T>(outer: PoolClient | undefined, fn: (client: PoolClient) => Promise<T>) =>
  outer ? fn(outer) : withTransaction(fn);

/**
 * Hold Player 1's Tickets at challenge creation time.
 * This prevents them from spending Tickets between challenge creation
 * and the opponent joining.
 */
export async function holdPlayer1Wager(
  matchId: string,
  player1Id: string,
  amount: number,
  /** Run inside this transaction instead of a new one. */
  outer?: PoolClient,
): Promise<void> {
  await inTransaction(outer, async (client) => {
    await mutateWalletAndLedgerForTransaction(client, {
      userId: player1Id,
      currencyType: 'credits',
      amount: -amount,
      sourceType: 'wager_hold',
      sourceId: `match-wager-hold:${matchId}:${player1Id}`,
      meta: { matchId, role: 'player1' },
    });

    await client.query(UPDATE_WAGER_STATUS_SQL, ['p1_held', matchId]);
  });
}

/**
 * Hold Player 2's Tickets when they join a wager match.
 * Player 1's Tickets are already held from challenge creation.
 * Throws if Player 2 has insufficient balance.
 */
export async function holdMatchWager(
  matchId: string,
  player1Id: string,
  player2Id: string,
  amount: number,
  /** Run inside this transaction instead of a new one. */
  outer?: PoolClient,
): Promise<void> {
  await inTransaction(outer, (client) =>
    mutateWalletAndLedgerForTransaction(client, {
      userId: player2Id,
      currencyType: 'credits',
      amount: -amount,
      sourceType: 'wager_hold',
      sourceId: `match-wager-hold:${matchId}:${player2Id}`,
      meta: { matchId, role: 'player2' },
    }),
  );
}

/**
 * Settle a wager by awarding the full pot (2x amount) to the winner.
 * Updates the match wager_status to 'paid'.
 */
export async function settleMatchWager(
  matchId: string,
  winnerId: string,
  amount: number,
  /** Run inside this transaction instead of a new one. */
  outer?: PoolClient,
): Promise<void> {
  await inTransaction(outer, async (client) => {
    await mutateWalletAndLedgerForTransaction(client, {
      userId: winnerId,
      currencyType: 'credits',
      amount: amount * 2,
      sourceType: 'wager_payout',
      sourceId: `match-wager-payout:${matchId}:${winnerId}`,
      meta: { matchId },
    });

    await client.query(UPDATE_WAGER_STATUS_SQL, ['paid', matchId]);
  });
}

/**
 * Refund both players (e.g., early forfeit before 4 moves).
 * Updates the match wager_status to 'refunded'.
 */
export async function refundMatchWager(
  matchId: string,
  player1Id: string,
  player2Id: string,
  amount: number,
  /** Run inside this transaction instead of a new one. */
  outer?: PoolClient,
): Promise<void> {
  await inTransaction(outer, async (client) => {
    await mutateWalletAndLedgerForTransaction(client, {
      userId: player1Id,
      currencyType: 'credits',
      amount: amount,
      sourceType: 'wager_refund',
      sourceId: `match-wager-refund:${matchId}:${player1Id}`,
      meta: { matchId },
    });

    await mutateWalletAndLedgerForTransaction(client, {
      userId: player2Id,
      currencyType: 'credits',
      amount: amount,
      sourceType: 'wager_refund',
      sourceId: `match-wager-refund:${matchId}:${player2Id}`,
      meta: { matchId },
    });

    await client.query(UPDATE_WAGER_STATUS_SQL, ['refunded', matchId]);
  });
}
