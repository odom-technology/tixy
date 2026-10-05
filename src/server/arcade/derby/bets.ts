import { assertGameAvailable } from '@/server/arcade/game-availability';
// ---------------------------------------------------------------------------
// Derby Royale — bet placement + round settlement.
//
// Money movement mirrors the arcade session pattern (see arcade-session.ts):
//   - bet:    debit `wager_hold`  sourceId `derby-bet:{betId}`
//   - settle: credit `wager_payout` sourceId `derby-payout:{betId}` (winners only)
// All movement flows through mutateWalletAndLedgerForTransaction inside a
// withTransaction, currency `credits`. Losers keep no payout — their wager was
// already held at bet time, so the house keeps it (no explicit debit at settle).
//
// Settlement is idempotent: the round claim is guarded by `settled_at IS NULL`
// and each bet by its own `settled_at IS NULL`; the ledger's UNIQUE(source_type,
// source_id) is a second safety net. This makes boot-recovery re-settle safe —
// nothing is ever paid twice, and the outcome is recomputed from the committed
// seed, never re-rolled.
// ---------------------------------------------------------------------------

import crypto from 'node:crypto';

import { query, withTransaction } from '@/server/db/client';
import { mutateWalletAndLedgerForTransaction } from '@/server/arcade/rewards/wallet';
import { roundArcadePayout } from '@/server/arcade/arcade-payout';
import { broadcast } from '@/server/events';
import { recordWagerSettlementStats } from '@/server/arcade/stats/pipeline';
import type { UnlockResult } from '@/server/arcade/achievements/types';
import {
  DERBY_BET_GRACE_MS,
  DERBY_BET_INCREMENT,
  DERBY_HORSE_COUNT,
  DERBY_MAX_BET,
  DERBY_MIN_BET,
  type DerbyEvent,
} from './derby-shared';
import { derbyPayoutSeed, getDerbyEngine } from './engine';

const INSERT_HISTORY_SQL = `
  INSERT INTO arcade_round_history
    (id, user_id, user_name, game_type, wager_amount, payout_amount, multiplier, seed, choices_json, outcome_json, created_at)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
`;

/** Thrown by placeDerbyBet with the HTTP status the route should surface. */
export class DerbyBetError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'DerbyBetError';
  }
}

export type PlaceDerbyBetResult = {
  betId: string;
  horseIdx: number;
  amount: number;
  multiplier: number;
  balanceAfter: number;
  betTotals: number[];
  betCounts: number[];
};

// ---------------------------------------------------------------------------
// Bet placement
// ---------------------------------------------------------------------------

export async function placeDerbyBet(params: {
  userId: string;
  userName: string | null;
  roundId: string;
  horseIdx: number;
  amount: number;
}): Promise<PlaceDerbyBetResult> {
  await assertGameAvailable('derby');
  const { userId, userName, roundId, horseIdx, amount } = params;

  const engine = getDerbyEngine();
  await engine.whenReady();
  const round = engine.getCurrentRoundMeta();

  if (!round || round.id !== roundId) {
    throw new DerbyBetError(409, 'This round is no longer accepting bets.');
  }
  if (round.phase !== 'betting') {
    throw new DerbyBetError(409, 'Betting is closed for this round.');
  }
  if (Date.now() > round.bettingEndsAt + DERBY_BET_GRACE_MS) {
    throw new DerbyBetError(409, 'Betting has just closed for this round.');
  }
  if (
    !Number.isInteger(horseIdx) ||
    horseIdx < 0 ||
    horseIdx >= DERBY_HORSE_COUNT
  ) {
    throw new DerbyBetError(400, 'Invalid horse.');
  }
  if (
    !Number.isInteger(amount) ||
    amount < DERBY_MIN_BET ||
    amount > DERBY_MAX_BET ||
    amount % DERBY_BET_INCREMENT !== 0
  ) {
    throw new DerbyBetError(
      400,
      `Bets are ${DERBY_MIN_BET} to ${DERBY_MAX_BET} tickets, in steps of ${DERBY_BET_INCREMENT}.`,
    );
  }

  const multiplier = round.oddsM[horseIdx];
  const betId = crypto.randomUUID();
  const now = Date.now();

  let balanceAfter = 0;
  try {
    await withTransaction(async (client) => {
      // Hold the wager (debit). Throws 'Insufficient balance.' if too poor.
      const ledger = await mutateWalletAndLedgerForTransaction(client, {
        userId,
        currencyType: 'credits',
        amount: -amount,
        sourceType: 'wager_hold',
        sourceId: `derby-bet:${betId}`,
        meta: { arcadeGameType: 'arcade-derby', roundId, horseIdx },
      });
      balanceAfter = ledger.balanceAfter;

      // One bet per (round, user, horse) — UNIQUE constraint enforces it.
      await client.query(
        `
          INSERT INTO derby_bets
            (id, round_id, user_id, user_name, horse_idx, amount, multiplier, created_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, to_timestamp($8 / 1000.0))
        `,
        [betId, roundId, userId, userName, horseIdx, amount, multiplier, now],
      );

      // Bump round totals — guarded by phase AND the persisted deadline (plus
      // grace) so a bet can't slip in on a delayed transition timer; a bet
      // that races past the close rolls the whole tx back (including the hold).
      const bump = await client.query(
        `
          UPDATE derby_rounds
          SET bet_count = bet_count + 1, total_wagered = total_wagered + $2
          WHERE id = $1 AND phase = 'betting'
            AND betting_ends_at + make_interval(secs => $3 / 1000.0) >= now()
        `,
        [roundId, amount, DERBY_BET_GRACE_MS],
      );
      if ((bump.rowCount ?? 0) === 0) {
        throw new DerbyBetError(409, 'Betting has just closed for this round.');
      }
    });
  } catch (error) {
    if (error instanceof DerbyBetError) throw error;
    const message = error instanceof Error ? error.message : 'Bet failed.';
    if (message.toLowerCase().includes('insufficient')) {
      throw new DerbyBetError(402, 'Not enough Tickets for this bet.');
    }
    // Unique violation → duplicate horse bet this round.
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: string }).code === '23505'
    ) {
      throw new DerbyBetError(409, 'You already have a bet on this horse.');
    }
    throw new DerbyBetError(400, message);
  }

  // In-memory totals for snapshots/broadcasts (DB is source of truth; boot
  // reloads these from derby_bets).
  const totals = engine.recordLocalBet(roundId, horseIdx, amount) ?? {
    betTotals: [],
    betCounts: [],
  };

  const event: DerbyEvent = {
    type: 'bet',
    roundId,
    horseIdx,
    amount,
    name: userName ?? 'Someone',
    betTotals: totals.betTotals,
    betCounts: totals.betCounts,
  };
  broadcast('derby', event);

  return {
    betId,
    horseIdx,
    amount,
    multiplier,
    balanceAfter,
    betTotals: totals.betTotals,
    betCounts: totals.betCounts,
  };
}

// ---------------------------------------------------------------------------
// Settlement
// ---------------------------------------------------------------------------

export type DerbyTopWin = { name: string; amount: number; payout: number };

export type SettleDerbyRoundResult = {
  totalPaid: number;
  topWins: DerbyTopWin[];
};

/**
 * Pay out every unsettled bet on a round. Winners (horse_idx === winnerIdx) are
 * credited amount x multiplier through roundArcadePayout using a per-bet seed
 * label (the bet id) so the fractional-Ticket rounding is reproducible from the
 * revealed seed. Idempotent — safe to call again on boot recovery.
 *
 * `oddsM` is the published multiplier table (source of truth, captured per bet
 * as `multiplier` — passed here only for reference/consistency).
 */
export async function settleDerbyRound(params: {
  roundId: string;
  roundNumber: number;
  seedHex: string;
  winnerIdx: number;
}): Promise<SettleDerbyRoundResult> {
  const { roundId, roundNumber, seedHex, winnerIdx } = params;
  const payoutSeed = derbyPayoutSeed(seedHex);
  const now = Date.now();

  const settlements: { userId: string; wager: number; payout: number }[] = [];
  let totalPaid = 0;

  await withTransaction(async (client) => {
    // Claim settlement for this round (idempotent). Even if the claim was
    // already taken (a prior crash mid-settle), we still process any bets left
    // unsettled below — the per-bet guard makes that safe.
    await client.query(
      `
        UPDATE derby_rounds
        SET phase = 'results', settled_at = COALESCE(settled_at, to_timestamp($2 / 1000.0))
        WHERE id = $1
      `,
      [roundId, now],
    );

    const bets = await client.query<{
      id: string;
      user_id: string;
      user_name: string | null;
      horse_idx: number;
      amount: string | number;
      multiplier: string | number;
    }>(
      `
        SELECT id, user_id, user_name, horse_idx, amount, multiplier
        FROM derby_bets
        WHERE round_id = $1 AND settled_at IS NULL
        FOR UPDATE
      `,
      [roundId],
    );

    for (const bet of bets.rows) {
      const amount = Number(bet.amount);
      const multiplier = Number(bet.multiplier);
      const isWin = bet.horse_idx === winnerIdx;
      const payout = isWin
        ? roundArcadePayout(amount * multiplier, payoutSeed, bet.id)
        : 0;

      if (payout > 0) {
        await mutateWalletAndLedgerForTransaction(client, {
          userId: bet.user_id,
          currencyType: 'credits',
          amount: payout,
          sourceType: 'wager_payout',
          sourceId: `derby-payout:${bet.id}`,
          meta: {
            arcadeGameType: 'arcade-derby',
            roundId,
            roundNumber,
            horseIdx: bet.horse_idx,
            multiplier,
          },
        });
        totalPaid += payout;
      }
      settlements.push({ userId: bet.user_id, wager: amount, payout });

      await client.query(
        `UPDATE derby_bets SET payout = $2, settled_at = to_timestamp($3 / 1000.0) WHERE id = $1`,
        [bet.id, payout, now],
      );

      // Economy stats read arcade_round_history — insert one row per bet so
      // Derby shows up in getArcadeEconomyStats (gameType 'arcade-derby').
      await client.query(INSERT_HISTORY_SQL, [
        crypto.randomUUID(),
        bet.user_id,
        bet.user_name ?? 'Anonymous',
        'arcade-derby',
        amount,
        payout,
        isWin ? multiplier : 0,
        payoutSeed,
        JSON.stringify({ horseIdx: bet.horse_idx }),
        JSON.stringify({ winnerIdx, roundNumber, won: isWin }),
        now,
      ]);
    }

    if (totalPaid > 0) {
      await client.query(
        `UPDATE derby_rounds SET total_paid = total_paid + $2 WHERE id = $1`,
        [roundId, totalPaid],
      );
    }
  });

  // Cross-cutting wager stats and achievement evaluation are intentionally
  // outside the money transaction: a stats outage must never roll back a
  // committed payout. Aggregate each viewer's tickets into one result notice.
  const resultByUser = new Map<
    string,
    { stake: number; payout: number; achievements: UnlockResult[] }
  >();
  for (const settlement of settlements) {
    const achievements = await recordWagerSettlementStats(settlement.userId, {
      gameType: 'arcade-derby',
      durationMs: 0,
      netProfit: settlement.payout - settlement.wager,
    });
    const aggregate = resultByUser.get(settlement.userId) ?? {
      stake: 0,
      payout: 0,
      achievements: [],
    };
    aggregate.stake += settlement.wager;
    aggregate.payout += settlement.payout;
    for (const achievement of achievements) {
      if (!aggregate.achievements.some((item) => item.id === achievement.id)) {
        aggregate.achievements.push(achievement);
      }
    }
    resultByUser.set(settlement.userId, aggregate);
  }

  for (const [userId, result] of resultByUser) {
    broadcast(`user:${userId}`, {
      type: 'derby_payout',
      payout: result.payout,
      stake: result.stake,
      achievements: result.achievements,
      roundNumber,
    });
  }

  // Top wins for the results overlay — rebuilt from the settled winning bets so
  // it is correct on both the live path and a boot re-settle.
  const winRows = await query<{
    user_name: string | null;
    amount: string | number;
    payout: string | number;
  }>(
    `
      SELECT user_name, amount, payout
      FROM derby_bets
      WHERE round_id = $1 AND horse_idx = $2 AND payout > 0
      ORDER BY payout DESC
      LIMIT 10
    `,
    [roundId, winnerIdx],
  );

  const topWins: DerbyTopWin[] = winRows.rows.map((r) => ({
    name: r.user_name ?? 'Anonymous',
    amount: Number(r.amount),
    payout: Number(r.payout),
  }));

  return { totalPaid, topWins };
}
