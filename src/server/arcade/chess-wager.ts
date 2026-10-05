// ---------------------------------------------------------------------------
// Chess — private match wager helpers (hold / settle / refund).
// Mirrors pool-wager so chess can reuse the same Tickets ledger flows.
// ---------------------------------------------------------------------------

import { withTransaction } from '@/server/db/client';
import { mutateWalletAndLedgerForTransaction } from '@/server/arcade/rewards/wallet';

const UPDATE_WAGER_STATUS_SQL =
  'UPDATE chess_matches SET wager_status = $1 WHERE id = $2';

export async function holdPlayer1Wager(
  matchId: string,
  player1Id: string,
  amount: number,
): Promise<void> {
  await withTransaction(async (client) => {
    await mutateWalletAndLedgerForTransaction(client, {
      userId: player1Id,
      currencyType: 'credits',
      amount: -amount,
      sourceType: 'wager_hold',
      sourceId: `chess-wager-hold:${matchId}:${player1Id}`,
      meta: { matchId, role: 'player1', gameType: 'chess' },
    });

    await client.query(UPDATE_WAGER_STATUS_SQL, ['p1_held', matchId]);
  });
}

export async function holdMatchWager(
  matchId: string,
  _player1Id: string,
  player2Id: string,
  amount: number,
): Promise<void> {
  await withTransaction((client) =>
    mutateWalletAndLedgerForTransaction(client, {
      userId: player2Id,
      currencyType: 'credits',
      amount: -amount,
      sourceType: 'wager_hold',
      sourceId: `chess-wager-hold:${matchId}:${player2Id}`,
      meta: { matchId, role: 'player2', gameType: 'chess' },
    }),
  );
}

/** Award the full pot (2x amount) to the winner and mark the match paid. */
export async function settleMatchWager(
  matchId: string,
  winnerId: string,
  amount: number,
): Promise<void> {
  await withTransaction(async (client) => {
    await mutateWalletAndLedgerForTransaction(client, {
      userId: winnerId,
      currencyType: 'credits',
      amount: amount * 2,
      sourceType: 'wager_payout',
      sourceId: `chess-wager-payout:${matchId}:${winnerId}`,
      meta: { matchId, gameType: 'chess' },
    });

    await client.query(UPDATE_WAGER_STATUS_SQL, ['paid', matchId]);
  });
}

/** Split the pot (on a draw) or refund both players (on early forfeit). */
export async function refundMatchWager(
  matchId: string,
  player1Id: string,
  player2Id: string,
  amount: number,
): Promise<void> {
  await withTransaction(async (client) => {
    await mutateWalletAndLedgerForTransaction(client, {
      userId: player1Id,
      currencyType: 'credits',
      amount,
      sourceType: 'wager_refund',
      sourceId: `chess-wager-refund:${matchId}:${player1Id}`,
      meta: { matchId, gameType: 'chess' },
    });
    await mutateWalletAndLedgerForTransaction(client, {
      userId: player2Id,
      currencyType: 'credits',
      amount,
      sourceType: 'wager_refund',
      sourceId: `chess-wager-refund:${matchId}:${player2Id}`,
      meta: { matchId, gameType: 'chess' },
    });

    await client.query(UPDATE_WAGER_STATUS_SQL, ['refunded', matchId]);
  });
}
