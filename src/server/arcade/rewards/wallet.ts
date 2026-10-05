import crypto from 'node:crypto';

import {
  GAME_DAILY_CREDIT_CAP,
  MAX_GAME_RUN_CREDITS,
  type CurrencyType,
} from '@/features/arcade/lib/rewards';
import { query, queryOne, withTransaction } from '@/server/db/client';
import {
  isFeaturedGame,
  FEATURED_CREDIT_MULTIPLIER,
  FEATURED_CAP_BONUS,
} from '@/server/arcade/featured-game';
import { isGuestUserId } from '@/server/auth/guest';
import { TICKET_COLUMN_MAX } from '@/server/arcade/arcade-constants';
import { TICKET_STOP_LOCK_REWARD_DIVISOR } from '@/server/arcade/ticket-stop-lock-engine';
import { trickShotTryTickets } from '@/features/arcade/lib/trick-shot/rules';
import { derbyTickets } from '@/features/arcade/lib/derby/rules';
import { MG_REWARD_BASE, MG_REWARD_DIVISOR } from '@/server/arcade/mini-golf-round';
import { bumperCarsTickets } from '@/features/arcade/lib/bumper-cars/rules';
import { STRIKER_REWARD_DIVISOR, STRIKER_REWARD_POWER } from '@/server/arcade/high-striker-replay';
import { STACK_REWARD_POWER, STACK_REWARD_SCALE } from '@/server/arcade/stack-replay';
import { GALLERY_REWARD_DIVISOR } from '@/server/arcade/tin-duck-gallery';
import { RING_REWARD_DIVISOR } from '@/server/arcade/ring-toss-play';
import { stackerPrizeTickets } from '@/server/arcade/stack-cabinet-engine';

import type {
  DailyGameCreditsProgress,
  GameRewardContext,
  GameRewardResult,
  LedgerEntry,
  LedgerSourceType,
  StoreVisibilityConfig,
  WalletRow,
} from './types';
import { normalizeCombinedWalletRow } from './store-credits';
import { mergeXpResults, type AddAccountXpResult } from '@/server/arcade/levels';
export type { GameRewardResult } from './types';

type QueryClient = {
  query: <T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ) => Promise<{ rows: T[] }>;
};

type WalletStorageRow = {
  user_id: string;
  credits: number | string;
  store_credits: number | string;
  wupiupi?: number | string;
  updated_at: number | string;
};

const STORE_VISIBILITY_SETTINGS_ID = 'games-store-visibility';
const DEFAULT_STORE_VISIBILITY_CONFIG: StoreVisibilityConfig = {
  creditsEnabled: true,
  gameCreditsEnabled: true,
};

const pad2 = (value: number) => value.toString().padStart(2, '0');

const getServerDateKey = (date: Date = new Date()) =>
  `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;

const normalizeCurrencyType = (value: string): CurrencyType =>
  value === 'credits' ? 'credits' : 'credits';

const normalizeWalletRow = (row: WalletStorageRow): WalletRow =>
  normalizeCombinedWalletRow(row);

const getBalanceForCurrency = (wallet: WalletRow, currencyType: CurrencyType) =>
  currencyType === 'credits' ? wallet.credits : wallet.credits;

const updateWalletBalanceSql = (currencyType: CurrencyType) =>
  currencyType === 'credits'
    ? 'UPDATE wallets SET credits = $1, updated_at = $2 WHERE user_id = $3'
    : 'UPDATE wallets SET credits = $1, updated_at = $2 WHERE user_id = $3';

const getOrCreateWalletWithClient = async (
  client: QueryClient,
  userId: string,
  now = Date.now(),
  forUpdate = false,
): Promise<WalletRow> => {
  await client.query(
    `
      INSERT INTO wallets (user_id, credits, wupiupi, updated_at)
      VALUES ($1, 0, 0, $2)
      ON CONFLICT(user_id) DO NOTHING
    `,
    [userId, now],
  );

  const result = await client.query<WalletStorageRow>(
    `
      SELECT user_id, credits, store_credits, updated_at
      FROM wallets
      WHERE user_id = $1
      ${forUpdate ? 'FOR UPDATE' : ''}
    `,
    [userId],
  );
  const row = result.rows[0];
  if (!row) {
    throw new Error('Failed to load wallet.');
  }
  return normalizeWalletRow(row);
};

const mutateWalletAndLedger = async (
  client: QueryClient,
  {
    userId,
    currencyType,
    amount,
    sourceType,
    sourceId,
    meta,
    createdBy,
  }: {
    userId: string;
    currencyType: CurrencyType;
    amount: number;
    sourceType: LedgerSourceType;
    sourceId: string;
    meta?: Record<string, unknown>;
    createdBy?: string | null;
  },
) => {
  if (!Number.isInteger(amount)) {
    throw new Error('Currency amount must be an integer.');
  }

  const existing = await client.query(
    `
      SELECT id, balance_after
      FROM currency_ledger
      WHERE user_id = $1
        AND currency_type = $2
        AND source_type = $3
        AND source_id = $4
      LIMIT 1
    `,
    [userId, currencyType, sourceType, sourceId],
  );
  if (existing.rows[0]) {
    return {
      deduped: true,
      ledgerId: existing.rows[0].id as string,
      balanceAfter: Number(existing.rows[0].balance_after ?? 0),
    };
  }

  const now = Date.now();
  const wallet = await getOrCreateWalletWithClient(client, userId, now, true);
  const currentBalance = getBalanceForCurrency(wallet, currencyType);
  if (currentBalance + amount < 0) {
    throw new Error('Insufficient balance.');
  }
  // The balance column is a 32-bit integer. A credit that would pass it
  // fills the wallet instead of failing the transaction, so a big win is
  // never lost to a database error. A balance only gets near that after
  // wins of hundreds of millions; this is the backstop, not the rule.
  const nextBalance = Math.min(currentBalance + amount, TICKET_COLUMN_MAX);
  const appliedAmount = nextBalance - currentBalance;

  await client.query(updateWalletBalanceSql(currencyType), [
    nextBalance,
    now,
    userId,
  ]);

  const ledgerId = crypto.randomUUID();
  await client.query(
    `
      INSERT INTO currency_ledger (
        id,
        user_id,
        currency_type,
        amount,
        balance_after,
        source_type,
        source_id,
        meta_json,
        created_at,
        created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    `,
    [
      ledgerId,
      userId,
      currencyType,
      appliedAmount,
      nextBalance,
      sourceType,
      sourceId,
      meta ? JSON.stringify(meta) : null,
      now,
      createdBy ?? null,
    ],
  );

  return {
    deduped: false,
    ledgerId,
    balanceAfter: nextBalance,
  };
};

export const mutateWalletAndLedgerForTransaction = mutateWalletAndLedger;

export const getWalletForUser = async (userId: string): Promise<WalletRow> =>
  withTransaction((client) => getOrCreateWalletWithClient(client, userId));

export const adjustCurrencyByAdmin = async ({
  userId,
  currencyType,
  amount,
  reason,
  actorUserId,
}: {
  userId: string;
  currencyType: CurrencyType;
  amount: number;
  reason: string;
  actorUserId: string;
}) => {
  const normalizedReason = reason.trim();
  if (!normalizedReason) {
    throw new Error('Reason is required.');
  }
  const normalizedAmount = Number(amount);
  if (!Number.isInteger(normalizedAmount) || normalizedAmount === 0) {
    throw new Error('Amount must be a non-zero integer.');
  }

  return withTransaction((client) =>
    mutateWalletAndLedger(client, {
      userId,
      currencyType,
      amount: normalizedAmount,
      sourceType: 'admin_adjust',
      sourceId: `admin-adjust:${crypto.randomUUID()}`,
      meta: {
        reason: normalizedReason,
        requestedAmount: normalizedAmount,
      },
      createdBy: actorUserId,
    }),
  );
};

export const adjustCurrencyByAdminForUsers = async ({
  userIds,
  currencyType,
  amount,
  reason,
  actorUserId,
}: {
  userIds: string[];
  currencyType: CurrencyType;
  amount: number;
  reason: string;
  actorUserId: string;
}) => {
  const normalizedReason = reason.trim();
  if (!normalizedReason) {
    throw new Error('Reason is required.');
  }
  const normalizedAmount = Number(amount);
  if (!Number.isInteger(normalizedAmount) || normalizedAmount === 0) {
    throw new Error('Amount must be a non-zero integer.');
  }

  const normalizedUserIds = Array.from(
    new Set(
      userIds
        .map((userId) => userId.trim())
        .filter((userId) => userId.length > 0),
    ),
  );

  if (normalizedUserIds.length === 0) {
    return {
      affectedUsers: 0,
      totalDelta: 0,
    };
  }

  const operationId = crypto.randomUUID();
  return withTransaction(async (client) => {
    let totalDelta = 0;
    for (const userId of normalizedUserIds) {
      const result = await mutateWalletAndLedger(client, {
        userId,
        currencyType,
        amount: normalizedAmount,
        sourceType: 'admin_adjust',
        sourceId: `bulk-admin-adjust:${operationId}:${userId}`,
        meta: {
          reason: normalizedReason,
          bulk: true,
          affectedUsers: normalizedUserIds.length,
        },
        createdBy: actorUserId,
      });
      if (!result.deduped) totalDelta += normalizedAmount;
    }

    return {
      affectedUsers: normalizedUserIds.length,
      totalDelta,
    };
  });
};

const computeRtpPercent = (wagered: number, paidOut: number): number =>
  wagered > 0 ? Number(((paidOut / wagered) * 100).toFixed(2)) : 0;

export const getArcadeEconomyStats = async () => {
  const [walletTotals, storeTotals, arcadeTotals, perGameRows] =
    await Promise.all([
      queryOne<{
        wallet_count: string | number;
        total_credits_in_wallets: string | number;
      }>(`
        SELECT
          COUNT(*) AS wallet_count,
          COALESCE(SUM(credits), 0) AS total_credits_in_wallets
        FROM wallets
      `),
      queryOne<{
        store_credits_spent: string | number;
      }>(`
        SELECT
          COALESCE(SUM(CASE
            WHEN currency_type = 'credits'
             AND source_type = 'purchase'
             AND amount < 0
            THEN -amount ELSE 0 END), 0) AS store_credits_spent
        FROM currency_ledger
      `),
      queryOne<{
        rounds: string | number;
        total_wagered: string | number;
        total_paid_out: string | number;
      }>(`
        SELECT
          COUNT(*) AS rounds,
          COALESCE(SUM(wager_amount), 0) AS total_wagered,
          COALESCE(SUM(payout_amount), 0) AS total_paid_out
        FROM arcade_round_history
      `),
      query<{
        gameType: string;
        rounds: string | number;
        wagered: string | number;
        paidOut: string | number;
      }>(`
        SELECT
          game_type AS "gameType",
          COUNT(*) AS rounds,
          COALESCE(SUM(wager_amount), 0) AS wagered,
          COALESCE(SUM(payout_amount), 0) AS "paidOut"
        FROM arcade_round_history
        GROUP BY game_type
        ORDER BY wagered DESC
      `),
    ]);

  const arcadeCreditsWagered = Number(arcadeTotals?.total_wagered ?? 0);
  const arcadeCreditsPaidOut = Number(arcadeTotals?.total_paid_out ?? 0);
  const arcadeRoundsPlayed = Number(arcadeTotals?.rounds ?? 0);
  const arcadeHouseProfit = arcadeCreditsWagered - arcadeCreditsPaidOut;

  const perGame = perGameRows.rows.map((row) => {
    const wagered = Number(row.wagered ?? 0);
    const paidOut = Number(row.paidOut ?? 0);
    return {
      gameType: String(row.gameType ?? ''),
      rounds: Number(row.rounds ?? 0),
      wagered,
      paidOut,
      houseProfit: wagered - paidOut,
      actualRtp: computeRtpPercent(wagered, paidOut),
    };
  });

  return {
    walletCount: Number(walletTotals?.wallet_count ?? 0),
    totalCreditsInWallets: Number(walletTotals?.total_credits_in_wallets ?? 0),

    arcadeRoundsPlayed,
    arcadeCreditsWagered,
    arcadeCreditsPaidOut,
    arcadeHouseProfit,
    arcadeActualRtp: computeRtpPercent(
      arcadeCreditsWagered,
      arcadeCreditsPaidOut,
    ),
    perGame,

    storeCreditsSpent: Number(storeTotals?.store_credits_spent ?? 0),
  };
};

export const awardWalletCurrency = async ({
  userId,
  currencyType,
  amount,
  sourceType = 'game_reward',
  sourceId,
  meta,
}: {
  userId: string;
  currencyType: CurrencyType;
  amount: number;
  sourceType?: LedgerSourceType;
  sourceId: string;
  meta?: Record<string, unknown>;
}) => {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new Error('Award amount must be a positive integer.');
  }
  return withTransaction((client) =>
    mutateWalletAndLedger(client, {
      userId,
      currencyType,
      amount,
      sourceType,
      sourceId,
      meta,
      createdBy: null,
    }),
  );
};

const normalizeGameRewardRaw = (raw: number) => {
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return Math.max(0, Math.floor(Math.min(GAME_DAILY_CREDIT_CAP, raw)));
};

const normalizeGameRewardRounded = (raw: number) => {
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return Math.max(0, Math.round(Math.min(GAME_DAILY_CREDIT_CAP, raw)));
};

export const getDailyGameCreditsProgress = async (
  userId: string,
  dateKey: string = getServerDateKey(),
): Promise<DailyGameCreditsProgress> => {
  const row = await queryOne<{ total_earned: string | number }>(
    `
      SELECT COALESCE(SUM(earned_credits), 0) AS total_earned
      FROM game_daily_earnings
      WHERE user_id = $1 AND date_key = $2
    `,
    [userId, dateKey],
  );
  const earned = Math.max(0, Math.floor(Number(row?.total_earned ?? 0)));
  const remaining = Math.max(0, GAME_DAILY_CREDIT_CAP - earned);
  return {
    dateKey,
    earned,
    cap: GAME_DAILY_CREDIT_CAP,
    remaining,
  };
};

/** Tickets a run wants before the daily cap. Pure; exported for verifiers. */
export const calculateGameRewardCredits = (context: GameRewardContext) => {
  const maxRunCredits = MAX_GAME_RUN_CREDITS;
  const saturatingCurve = (normalized: number) => {
    const clamped = Math.max(0, normalized);
    const raw = maxRunCredits * (1 - Math.exp(-Math.pow(clamped, 1.15)));
    return normalizeGameRewardRaw(raw);
  };

  if (context.gameType === 'snake') return saturatingCurve(context.score / 100);
  if (context.gameType === 'flappy-bird') return saturatingCurve(context.score / 75);
  if (context.gameType === 'typing-test') {
    const modeFactor = Math.sqrt(context.mode / 30);
    return saturatingCurve((context.wpm * modeFactor) / 85);
  }
  if (context.gameType === 'coin-flip') return saturatingCurve(context.streak / 8);
  if (context.gameType === 'tetris') return saturatingCurve(context.score / 2500);
  if (context.gameType === '2048') return saturatingCurve(context.score / 3000);
  // Stacker endless, rules 2 (2026-10: time-based, speed on a curve, fast
  // rows from 30, narrower blocks from 60). Runs are shorter for the same
  // skill, so the curve is front-loaded (power 0.6 where the shared curve
  // uses 1.15) and fitted so new and good players earn within 10% of what
  // they did per minute under rules 1 (score / 40). Strong players earn
  // more, inside the 75 per-run cap and the daily cap. The fit is in
  // scripts/verify-stack-endless-replay.ts, which fails when it drifts.
  if (context.gameType === 'stack') {
    const x = Math.max(0, context.score / STACK_REWARD_SCALE);
    return normalizeGameRewardRaw(maxRunCredits * (1 - Math.exp(-Math.pow(x, STACK_REWARD_POWER))));
  }
  if (context.gameType === 'sequence') return saturatingCurve(context.score / 4);
  if (context.gameType === 'breakout') return saturatingCurve(context.score / 500);
  // Tumbler 2026-07 precision-scoring rescale: score is now points (clean picks
  // pay 2-3, grazes 1, sticky pins +1) instead of raw pins, so a typical run
  // scores ~2x its old pin count. Divisor doubles to keep ticket payouts flat.
  if (context.gameType === 'tumbler') return saturatingCurve(context.score / 50);
  // Gopher 2026-07 combo-scoring rescale: a typical good run is ~1000 pts
  // (was ~50 bonks), so the divisor scales up 20x to keep ticket payouts flat.
  if (context.gameType === 'gopher') return saturatingCurve(context.score / 1000);
  if (context.gameType === 'ricochet') return saturatingCurve(context.score / 25);
  // Swerve 2026-07 traffic-rework rescale: score is now points (rows + forced
  // "close call" streak bonuses, ~2x rows) and fair generation makes runs last
  // longer, so a strong run is ~300 pts (was ~80 rows). Divisor retuned so
  // typical runs keep earning roughly the same tickets.
  if (context.gameType === 'swerve') return saturatingCurve(context.score / 300);
  // New quick-play high-score games. Divisor ≈ a strong-run score (the curve
  // saturates toward MAX_GAME_RUN_CREDITS at ~2-3× the divisor).
  if (context.gameType === 'bubble-shooter') return saturatingCurve(context.score / 1500);
  if (context.gameType === 'gem-swap') return saturatingCurve(context.score / 2500);
  if (context.gameType === 'sky-climber') return saturatingCurve(context.score / 500);
  // Log Splitter: score is chops. A safe-side bot at the 60ms cadence floor tops
  // out at ~649 chops; a realistic sustained-expert run (~7-8 chops/s) is ~180-230,
  // and a typical good run is ~110-140. Divisor 100 puts a good run mid-curve
  // (score 130 ⇒ ~54 tickets), matching the other quick-play games' payout curve.
  if (context.gameType === 'log-splitter') return saturatingCurve(context.score / 100);
  // Knife Booth: score is points (1/knife, +5/fruit, depth-scaled stage-clear
  // bonuses). A human-timing bot measured over 500 seeds: a typical good run
  // (σ≈40ms) ≈ 130-190, a sustained-expert run (σ≈28ms) reaches ~260-350. Divisor
  // 150 puts a good run mid-curve (score 150 ⇒ ~47 tickets), matching the other
  // quick-play games' payout position.
  if (context.gameType === 'knife-booth') return saturatingCurve(context.score / 150);
  // Melon Chop: score is points (fruit base 10, combo-multiplied up to ×3 per
  // stroke) over a 60s blitz. A human-ish swipe bot over 500 seeds: casual runs
  // ≈820 (bomb-ends most runs), a good run ≈980-1200, a sustained-expert run
  // reaches ~1800-2800, a near-perfect run ~2900-3600 (exact ceiling ≈7400).
  // Divisor 1100 puts a good run mid-curve (score 1000 ⇒ ~44 tickets), matching
  // the other quick-play games' payout position.
  if (context.gameType === 'melon-chop') return saturatingCurve(context.score / 1100);
  // Tin Duck Gallery rules 2 (2026-10, a thirty second gallery of three rows
  // on chains, a bonus duck, six corks): a run is 30 s where rules 1's was 75 s,
  // and scores run about 60 to 250 (ducks 1 to 3, plates and bullseyes up to 9,
  // the gold duck 10) where rules 1's ran to 850. The divisor is solved so a
  // good player earns about what a good rules 1 player did per minute of play
  // (rules 1 paid score / 750), and a perfect run stays well inside
  // MAX_GAME_RUN_CREDITS. The maths and the tables by skill are in
  // scripts/verify-tin-duck-gallery.ts, which fails when this drifts.
  if (context.gameType === 'tin-duck') return saturatingCurve(context.score / GALLERY_REWARD_DIVISOR);
  // Boardwalk Hop 2026-07: score is furthest row + close-call bonuses (swerve's
  // scoring DNA), so magnitudes mirror swerve and the divisor matches it. A
  // greedy survivor bot over 2000 seeds/skill: casual p50≈152, good p50≈235,
  // strong p50≈336, expert p50≈474 (expert p90≈1061, perfect max≈6162). Divisor
  // 300 puts a solid ~300 run mid-curve (⇒ ~47 tickets), matching swerve's and
  // the other quick-play games' payout position.
  if (context.gameType === 'boardwalk-hop') return saturatingCurve(context.score / 300);
  // High Striker rules 3 (October 2026, the endless tower: a hit pays 1, a
  // bell 3 to 8, the first miss ends the run). Power 1.4 where the shared
  // curve uses 1.15, so a minute pays more as timing improves up to a good
  // player, and the divisor is solved so a good player earns about 46 tickets
  // a minute, like ticket stop's lock. Past a good player the 75 a run caps a
  // longer run, as it does in every endless game. The tables by skill are in
  // HIGH_STRIKER.md and scripts/verify-high-striker-replay.ts, which fails
  // when this drifts. Rules 2 (five swings) paid score / 64 on the shared
  // curve; rules 1 score / 60.
  if (context.gameType === 'high-striker') {
    const x = Math.max(0, context.score / STRIKER_REWARD_DIVISOR);
    return normalizeGameRewardRaw(maxRunCredits * (1 - Math.exp(-Math.pow(x, STRIKER_REWARD_POWER))));
  }
  // Skee-Ball 2026-07: score is points over a fixed 9-ball frame (rings pay
  // 10-50, corner pockets 100, one seeded lit ring per ball pays x2/x3). A
  // typical good frame lands ~200-300; a sustained-expert frame (deep rings
  // + lit-ring reads) reaches ~450-600. Divisor 260 puts a good frame
  // mid-curve, matching the other quick-play games' payout position.
  // Skee-Ball rules 2 (2026-10, real alley-roller physics, a bonus ball per
  // 100 pocket, 9 to 12 balls): scripts/sim-skee-ball.ts by skill put mean
  // tickets a frame at -4.7% (first go), -5.3% (casual), -5.0% (good) and
  // -0.4% (sharp) against rules 1 at 260. Divisor 245 brings them to -1.5%,
  // -2.9%, -3.7% and 0.0%.
  if (context.gameType === 'skee-ball') return saturatingCurve(context.score / 245);
  // Gunrush 2026-08: score is row payouts over an endless seeded squad runner
  // (gate rows pay 10 + 4×row, wave rows far more), so the scale is an order of
  // magnitude above the other quick-play games. Measured by
  // scripts/verify-gunrush-replay.ts: a casual run ends around 2,000-8,000, a
  // strong run 20,000-30,000, and perfect greedy play over 60 seeds tops out at
  // 66,165 before the difficulty curve outruns the DPS ceiling. Divisor 25,000
  // puts a strong (good-but-not-perfect) run at the saturation knee
  // (score 25,000 ⇒ ~45 tickets) and leaves near-optimal play saturating toward
  // the max, matching the other quick-play games' payout position.
  if (context.gameType === 'gunrush') return saturatingCurve(context.score / 25_000);
  // Ticket stop, rules 2 (the lock): score is hits before the first miss. The
  // divisor is 60 (TICKET_STOP_LOCK_REWARD_DIVISOR): simulated players over
  // 4,000 runs each, a new player (48 ms timing noise) scores 7 and takes 6
  // tickets, a casual one (34 ms) 20 and takes 18, a good one (24 ms) 55 in
  // 48 s and takes 41, a sharp one (15 ms) 150 and takes 65. 215 hits pay 74
  // of the 75 per-run cap. A good player earns about 46 tickets a minute with
  // the result card between runs, so the 300 daily cap is about 7 good runs. Distribution in scripts/verify-ticket-stop-replay.ts.
  if (context.gameType === 'ticket-stop') {
    return saturatingCurve(context.score / TICKET_STOP_LOCK_REWARD_DIVISOR);
  }
  // Stacker's cabinet mode (tixy rev. 2): a fixed prize, not a curve. Row 11
  // pays the minor and row 15 the major, which replaces it. The numbers and
  // why the mockup's 50 and 500 can't be paid are in stack-cabinet-engine.ts;
  // the maths is in scripts/verify-stack-cabinet-replay.ts.
  // Mini golf (daily): the day's first full round pays once. score is the
  // round's points (7 minus each hole's strokes); a round of nine fours (27)
  // pays nothing and each stroke saved on that counts. The fit by skill is in
  // scripts/verify-mini-golf-replay.ts and MINI_GOLF.md.
  if (context.gameType === 'mini-golf') {
    return saturatingCurve(Math.max(0, context.score - MG_REWARD_BASE) / MG_REWARD_DIVISOR);
  }
  if (context.gameType === 'stack-cabinet') {
    return normalizeGameRewardRaw(stackerPrizeTickets(context.score));
  }
  // Ring toss: score is points from ten rings (10 to 50 by row, the gold
  // bottle 100). The divisor (RING_REWARD_DIVISOR, 950) is solved so a good
  // simulated player earns about 51 tickets a minute with 6 s between rounds;
  // a perfect round (1000) pays 49 of the 75 a run allows. The tables by
  // skill are in RING_TOSS.md and scripts/verify-ring-toss-replay.ts, which
  // fails when this drifts.
  if (context.gameType === 'ring-toss') return saturatingCurve(context.score / RING_REWARD_DIVISOR);
  if (context.gameType === 'minesweeper') {
    // Lower solve time is better; mirror the sudoku per-difficulty par/weight model.
    const par: Record<string, number> = { beginner: 20000, intermediate: 60000, expert: 150000 };
    const weight: Record<string, number> = { beginner: 0.7, intermediate: 1.2, expert: 1.8 };
    const p = par[context.difficulty] ?? 60000;
    const w = weight[context.difficulty] ?? 1;
    return saturatingCurve((p / Math.max(context.solveTimeMs, 1000)) * w);
  }
  if (context.gameType === 'sudoku') {
    const par: Record<string, number> = { easy: 240000, medium: 420000, hard: 660000, expert: 900000, evil: 1200000 };
    const weight: Record<string, number> = { easy: 0.7, medium: 1.0, hard: 1.35, expert: 1.7, evil: 2.1 };
    const p = par[context.difficulty] ?? 420000;
    const w = weight[context.difficulty] ?? 1;
    return saturatingCurve((p / Math.max(context.solveTimeMs, 1000)) * w);
  }
  if (context.gameType === 'punch-card') {
    // Lower recorded time is better; mirror the sudoku per-tier par/weight model.
    // `par` = a typical good clean-solve time per board size (5×5 blitz ~30s,
    // 10×10 ranked ~3min, 15×15 marathon ~7min); a solve at par earns a mid-curve
    // ticket payout, faster/cleaner solves earn more, larger boards weigh more.
    const par: Record<string, number> = { '5x5': 30000, '10x10': 180000, '15x15': 420000 };
    const weight: Record<string, number> = { '5x5': 0.6, '10x10': 1.1, '15x15': 1.7 };
    const p = par[context.size] ?? 180000;
    const w = weight[context.size] ?? 1;
    return saturatingCurve((p / Math.max(context.solveTimeMs, 1000)) * w);
  }
  if (context.gameType === 'freecell') {
    // Lower recorded clear time is better; mirror the sudoku/punch-card per-mode
    // par model. `par` = a typical good solve time. A measured best-first bot
    // solves random deals in ~110-160 moves; a competent human clears in
    // ~2-4 min, a strong player ~90-150s, a speed-runner well under a minute.
    // par 180s puts a ~3-min solve mid-curve; faster solves saturate toward the
    // max. daily/free share the same par (deals are comparably hard).
    const p = 180000;
    return saturatingCurve(p / Math.max(context.solveTimeMs, 1000));
  }
  if (context.gameType === 'math') return saturatingCurve(context.score / 30);
  // Blitz Tactics: score is puzzles solved in a 5-min rush. On an escalating
  // rating ladder a strong player clears ~3-6/min → ~18-28 over the run; the
  // sustained-expert ceiling is ~30. Divisor 22 puts a strong ~22-solve run
  // mid-curve (≈47 tickets) and saturates toward the max for an elite run,
  // matching the other skill games' payout position.
  if (context.gameType === 'blitz-tactics') return saturatingCurve(context.score / 22);
  if (context.gameType === 'connect-four' || context.gameType === 'checkers') {
    if (context.vsBot) {
      const botWinCredits =
        context.botDifficulty === 'hard' ? 105 : context.botDifficulty === 'medium' ? 80 : 60;
      return context.result === 'win' ? botWinCredits : Math.max(10, Math.floor(botWinCredits / 4));
    }
    return context.result === 'win' ? 105 : 52;
  }

  if (context.gameType === 'reversi' || context.gameType === 'battleship') {
    if (context.vsBot) {
      const botWinCredits =
        context.botDifficulty === 'hard' ? 105 : context.botDifficulty === 'medium' ? 80 : 60;
      return context.result === 'win' ? botWinCredits : Math.max(10, Math.floor(botWinCredits / 4));
    }
    return context.result === 'win' ? 105 : 52;
  }

  if (context.gameType === '8-ball') {
    if (context.vsBot) {
      const botWinCredits =
        context.botDifficulty === 'hard'
          ? 72
          : context.botDifficulty === 'medium'
            ? 50
            : 30;
      return context.result === 'win'
        ? botWinCredits
        : Math.max(8, Math.floor(botWinCredits / 3));
    }
    return context.result === 'win' ? 84 : 42;
  }

  if (context.gameType === 'chess') {
    if (context.vsBot) {
      const botWinCredits =
        context.botDifficulty === 'hard'
          ? 120
          : context.botDifficulty === 'medium'
            ? 98
            : 75;
      return context.result === 'win'
        ? botWinCredits
        : Math.max(10, Math.floor(botWinCredits / 4));
    }
    return context.result === 'win' ? 120 : 60;
  }

  if (context.gameType === 'connections') {
    if (!context.solved) return 12;
    return Math.max(18, 72 - context.mistakes * 15);
  }

  // Trick shot: a day's best try, 0 to 100. A miss is worth 12 like a word
  // grid miss, then 75 × (1 − exp(−(s/45)^1.3)): a clear is worth 71, word
  // grid's best is 72. The first try pays its value and each later new best
  // the difference, so a day pays its best's value once. The table by score
  // is in scripts/verify-trick-shot.ts.
  if (context.gameType === 'trick-shot') return trickShotTryTickets(context.score, context.previousBest ?? null);
  // Bumper cars: 75 × (1 − exp(−(s/37)^1.1)) on a round's score, nothing for
  // a round without a bump. The table is in scripts/verify-bumper-cars.ts.
  if (context.gameType === 'bumper-cars') return bumperCarsTickets(context.score);
  // Derby: by place, 75 × (1 − exp(−((s + 0.05) / 0.64)^1.4)) on the share of
  // the field beaten, at least 10: 65, 60, 54, 46, 36, 25, 13, 10. A good
  // player earns about 61 a minute (DERBY.md, scripts/sim-derby.ts).
  if (context.gameType === 'derby') return derbyTickets(context.place, context.field);
  if (context.gameType === 'word-grid') {
    if (!context.solved) return 12;
    return Math.max(18, 72 - (context.guesses - 1) * 10);
  }

  if (context.gameType === 'pangram') {
    return Math.min(72, 12 + Math.floor(context.score / 4) + context.pangrams * 9);
  }

  const reactionNormalized = Math.max(0, 430 - context.averageTime) / 200;
  const reactionRaw =
    maxRunCredits *
    (1 - Math.exp(-Math.pow(Math.max(0, reactionNormalized), 1.15)));
  return normalizeGameRewardRounded(reactionRaw);
};

const getStoreVisibilityConfig = async (): Promise<StoreVisibilityConfig> => {
  const row = await queryOne<{ config_json: string }>(
    `
      SELECT config_json
      FROM site_settings
      WHERE id = $1
      LIMIT 1
    `,
    [STORE_VISIBILITY_SETTINGS_ID],
  );
  if (!row?.config_json) {
    return { ...DEFAULT_STORE_VISIBILITY_CONFIG };
  }
  try {
    const parsed = JSON.parse(row.config_json) as Partial<StoreVisibilityConfig>;
    return {
      creditsEnabled:
        typeof parsed.creditsEnabled === 'boolean'
          ? parsed.creditsEnabled
          : DEFAULT_STORE_VISIBILITY_CONFIG.creditsEnabled,
      gameCreditsEnabled:
        typeof parsed.gameCreditsEnabled === 'boolean'
          ? parsed.gameCreditsEnabled
          : DEFAULT_STORE_VISIBILITY_CONFIG.gameCreditsEnabled,
    };
  } catch {
    return { ...DEFAULT_STORE_VISIBILITY_CONFIG };
  }
};

export const awardGameRunCredits = async ({
  userId,
  context,
  sourceId,
  meta,
}: {
  userId: string;
  context: GameRewardContext;
  sourceId: string;
  meta?: Record<string, unknown>;
}): Promise<GameRewardResult> => {
  const dateKey = getServerDateKey(new Date());
  // Guest play is local practice only. Keep this guard at the persistence
  // boundary as defense in depth if a future route forgets to reject guests.
  if (isGuestUserId(userId)) {
    return {
      awardedTickets: 0,
      wantedTickets: 0,
      awardedCredits: 0,
      wantedCredits: 0,
      dateKey,
      earnedTodayTotal: 0,
      capRemaining: 0,
    };
  }

  const baseCredits = calculateGameRewardCredits(context);
  // Daily Featured Game: the day's featured game pays DOUBLE credits and may earn
  // a little above the normal daily cap (FEATURED_CAP_BONUS of extra headroom).
  const featured = isFeaturedGame(context.gameType, dateKey);
  const wantedCredits = featured
    ? baseCredits * FEATURED_CREDIT_MULTIPLIER
    : baseCredits;
  const visibility = await getStoreVisibilityConfig();
  // Effective daily ceiling: the normal cap, plus the featured bonus headroom on
  // the featured game only. Computed against today's earned TOTAL (not added per
  // run) so the bonus is a one-time "+N over the cap" for the day — it can't be
  // farmed by replaying the featured game past cap + FEATURED_CAP_BONUS.
  //
  // NOTE: today's earned total is read INSIDE the award transaction below (under
  // a per-user advisory lock), never here — reading it out here would be a
  // TOCTOU: a concurrent burst of submissions could all decide the cap against
  // the same stale total and collectively blow past it.
  const effectiveCap =
    GAME_DAILY_CREDIT_CAP + (featured ? FEATURED_CAP_BONUS : 0);

  // A run's XP is its ticket value BEFORE the daily ticket cap, so it keeps
  // accruing after the ticket cap is hit, up to the 2,500 a day run XP cap that
  // grantXp enforces in the same transaction as the grant. No multiplier.
  // Best-effort and never throws.
  const grantRunXp = async (): Promise<AddAccountXpResult | null> => {
    if (wantedCredits <= 0) return null;
    try {
      const { grantXp } = await import('@/server/arcade/levels');
      return await grantXp(userId, wantedCredits, 'run', dateKey);
    } catch (error) {
      console.error('[levels] run XP grant failed:', error);
      return null;
    }
  };

  // One XP result for the player: the run's XP and the participation XP that
  // comes with it, shown once.
  const toAccount = (
    results: Array<AddAccountXpResult | null>,
  ): GameRewardResult['account'] | undefined => {
    const merged = mergeXpResults(results);
    if (!merged) return undefined;
    return {
      xpGained: merged.xpGained,
      xp: merged.after.xp,
      level: merged.after.level,
      into: merged.after.into,
      need: merged.after.need,
      leveledUp: merged.leveledUp,
      bonusTickets: merged.grantedTickets,
      levelBefore: merged.levelBefore,
      intoBefore: merged.before.into,
      needBefore: merged.before.need,
      milestones: merged.milestones,
      tier: merged.after.tier,
      ...(merged.season
        ? {
            season: {
              tierBefore: merged.season.before.tier,
              tier: merged.season.after.tier,
              into: merged.season.after.into,
              need: merged.season.after.need,
              atMax: merged.season.after.atMax,
            },
          }
        : {}),
    };
  };

  // Battlepass: feed season XP + quest progress from this run. Best-effort and
  // only AFTER the reward commit — a battlepass hiccup must never void a payout.
  // IMPORTANT: this must run exactly ONCE per physical run — on the awarded,
  // capped AND skipped paths (creditsEarned 0 when nothing was paid, so
  // "play N games"/"play game X"/score quests keep progressing after the daily
  // ticket cap) but NOT on the deduped path: a dedup means a parallel/retried
  // submit of a run the awarding request already recorded, so recording it again
  // would double-count play quests and participation XP.
  const recordSeasonRun = async (
    creditsEarned: number,
  ): Promise<AddAccountXpResult | null> => {
    if (isGuestUserId(userId)) return null;
    try {
      // Friends games have no score: a win is a score of 1, which is what a
      // "win a game" daily quest (goal 1) tracks. A loss reports nothing.
      const score =
        'score' in context
          ? (context as { score?: number }).score
          : context.gameType === 'derby'
            ? // Derby: the lanes you beat, so a "top three" quest has goal 5.
              Math.max(0, context.field - context.place)
          : 'result' in context && context.result === 'win'
            ? 1
            : undefined;
      // Dynamic import: battlepass imports from this module, so a static import
      // would be circular. Runtime import sidesteps the eval-order problem.
      const { recordGameRunForSeason } = await import('@/server/arcade/battlepass');
      return await recordGameRunForSeason(userId, {
        gameType: context.gameType,
        creditsEarned,
        score,
      });
    } catch (error) {
      console.error('[battlepass] recordGameRunForSeason failed:', error);
      return null;
    }
  };

  // The daily-cap read, the wallet/ledger write, and the daily-earnings bump all
  // happen inside ONE transaction, serialized per user by a transaction-scoped
  // advisory lock (auto-released on COMMIT/ROLLBACK). This closes the TOCTOU: the
  // next writer can't read today's earned total until our rows are durably
  // committed, so the cap can't be blown past by a concurrent burst. Because the
  // reward `sourceId` is deterministic per run (no timestamp — see callers), the
  // ledger's UNIQUE(user, currency, source_type, source_id) turns a second
  // writer into a dedup no-op, so one run is paid exactly once.
  type AwardOutcome =
    | { status: 'skipped'; earned: number; remaining: number }
    | { status: 'capped'; earned: number; remaining: number }
    | {
        status: 'deduped';
        earned: number;
        remaining: number;
        ledgerId: string;
        balanceAfter: number;
      }
    | {
        status: 'awarded';
        awardedCredits: number;
        earned: number;
        remaining: number;
        ledgerId: string;
        balanceAfter: number;
      };

  const outcome = await withTransaction<AwardOutcome>(async (client) => {
    // Serialize ALL award activity for this user for the life of the tx.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
      `game-reward:${userId}`,
    ]);

    // Authoritative daily total, read UNDER the lock — never stale.
    const earnedRow = await client.query<{ total_earned: string | number }>(
      `
        SELECT COALESCE(SUM(earned_credits), 0) AS total_earned
        FROM game_daily_earnings
        WHERE user_id = $1 AND date_key = $2
      `,
      [userId, dateKey],
    );
    const earned = Math.max(
      0,
      Math.floor(Number(earnedRow.rows[0]?.total_earned ?? 0)),
    );
    const remaining = Math.max(0, effectiveCap - earned);

    if (!visibility.gameCreditsEnabled || wantedCredits <= 0) {
      return { status: 'skipped', earned, remaining };
    }

    const awardedCredits = Math.min(wantedCredits, remaining);
    if (awardedCredits <= 0) {
      // Daily Ticket cap is hit: no Tickets, but account XP keeps flowing.
      return { status: 'capped', earned, remaining };
    }

    const ledgerResult = await mutateWalletAndLedger(client, {
      userId,
      currencyType: 'credits',
      amount: awardedCredits,
      sourceType: 'game_reward',
      sourceId,
      meta: {
        gameType: context.gameType,
        ...meta,
      },
      createdBy: null,
    });

    if (ledgerResult.deduped) {
      return {
        status: 'deduped',
        earned,
        remaining,
        ledgerId: ledgerResult.ledgerId,
        balanceAfter: ledgerResult.balanceAfter,
      };
    }

    await client.query(
      `
        INSERT INTO game_daily_earnings (
          user_id,
          game_type,
          date_key,
          earned_credits
        ) VALUES ($1, $2, $3, $4)
        ON CONFLICT(user_id, game_type, date_key) DO UPDATE SET
          earned_credits = game_daily_earnings.earned_credits + excluded.earned_credits
      `,
      [userId, context.gameType, dateKey, awardedCredits],
    );

    return {
      status: 'awarded',
      awardedCredits,
      earned,
      remaining,
      ledgerId: ledgerResult.ledgerId,
      balanceAfter: ledgerResult.balanceAfter,
    };
  });

  if (outcome.status === 'skipped') {
    // No Tickets paid, but the run still happened — quests/participation flow.
    const participation = await recordSeasonRun(0);
    return {
      awardedTickets: 0,
      wantedTickets: wantedCredits,
      awardedCredits: 0,
      wantedCredits,
      dateKey,
      earnedTodayTotal: outcome.earned,
      capRemaining: outcome.remaining,
      account: toAccount([participation]),
    };
  }

  if (outcome.status === 'capped') {
    // Daily Ticket cap is hit: no Tickets, but account XP keeps flowing — and so
    // do quest progress + participation XP (with creditsEarned 0), otherwise
    // play/score quests would freeze the moment a player caps out.
    const runXp = await grantRunXp();
    const participation = await recordSeasonRun(0);
    return {
      awardedTickets: 0,
      wantedTickets: wantedCredits,
      awardedCredits: 0,
      wantedCredits,
      dateKey,
      earnedTodayTotal: outcome.earned,
      capRemaining: outcome.remaining,
      account: toAccount([runXp, participation]),
    };
  }

  if (outcome.status === 'deduped') {
    // A retry or parallel submit of a run that was already paid: no new Tickets,
    // no account XP, and NO season/quest recording — the request that actually
    // awarded this run already recorded it; doing it again would double-count
    // play quests and participation XP (reproduced via parallel score POSTs).
    return {
      awardedTickets: 0,
      wantedTickets: wantedCredits,
      awardedCredits: 0,
      wantedCredits,
      dateKey,
      earnedTodayTotal: outcome.earned,
      capRemaining: outcome.remaining,
      ledgerId: outcome.ledgerId,
      balanceAfter: outcome.balanceAfter,
    };
  }

  const result: GameRewardResult = {
    awardedTickets: outcome.awardedCredits,
    wantedTickets: wantedCredits,
    awardedCredits: outcome.awardedCredits,
    wantedCredits,
    dateKey,
    earnedTodayTotal: outcome.earned + outcome.awardedCredits,
    capRemaining: Math.max(0, outcome.remaining - outcome.awardedCredits),
    ledgerId: outcome.ledgerId,
    balanceAfter: outcome.balanceAfter,
  };

  // Account XP: the run's pre-cap ticket value plus participation, in one
  // result. Best-effort and after the reward commit: an XP hiccup must never
  // void a payout.
  const runXp = result.awardedCredits > 0 ? await grantRunXp() : null;
  const participation = await recordSeasonRun(result.awardedCredits);
  result.account = toAccount([runXp, participation]);

  return result;
};

const parseMeta = (raw: string | null): Record<string, unknown> | null => {
  if (!raw || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object'
      ? (parsed as Record<string, unknown>)
      : { raw: String(parsed) };
  } catch {
    return { raw };
  }
};

const readStringMeta = (
  meta: Record<string, unknown> | null,
  key: string,
) => {
  const value = meta?.[key];
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const toTitleLabel = (value: string | null) => {
  if (!value) return null;
  return value
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
};

const getReasonFromEntry = ({
  sourceType,
  meta,
}: {
  sourceType: LedgerSourceType;
  meta: Record<string, unknown> | null;
}) => {
  const explicitReason = readStringMeta(meta, 'reason');
  if (explicitReason) return explicitReason;

  if (sourceType === 'admin_adjust') return 'Admin adjustment';
  if (sourceType === 'purchase') {
    const itemName = readStringMeta(meta, 'itemName');
    const itemId = readStringMeta(meta, 'itemId');
    const itemLabel = itemName ?? itemId;
    return itemLabel ? `Purchased item ${itemLabel}` : 'Store purchase';
  }
  if (sourceType === 'game_reward') {
    const gameTypeLabel = toTitleLabel(readStringMeta(meta, 'gameType'));
    const bonusTypeLabel = toTitleLabel(readStringMeta(meta, 'bonusType'));
    if (gameTypeLabel && bonusTypeLabel) {
      return `${gameTypeLabel} ${bonusTypeLabel} reward`;
    }
    return gameTypeLabel ? `${gameTypeLabel} reward` : 'Game reward';
  }
  if (sourceType === 'daily_claim') return 'Daily claim';
  if (sourceType === 'shift_reward') return 'Shift reward';
  if (sourceType === 'monthly_reward') return 'Monthly reward';
  if (sourceType === 'weekly_board') return 'Weekly board prize';
  if (sourceType === 'refund') return 'Refund';
  if (sourceType === 'wager_hold') return 'Wager placed';
  if (sourceType === 'wager_payout') return 'Wager winnings';
  if (sourceType === 'wager_refund') return 'Wager refund';
  if (sourceType === 'admin_grant') return 'Admin grant';
  return null;
};

/** The label a ledger row gets in the admin console, for either ledger. */
export const ledgerRowLabel = (sourceType: string, metaJson: string | null): string =>
  getReasonFromEntry({
    sourceType: sourceType as LedgerSourceType,
    meta: parseMeta(metaJson),
  }) ??
  toTitleLabel(sourceType) ??
  'Entry';

/** The few meta fields worth showing next to a ledger row; never the raw meta. */
export const ledgerRowMetaSummary = (metaJson: string | null) => {
  const meta = parseMeta(metaJson);
  const summary: { itemName?: string; gameType?: string; dateKey?: string } = {};
  const itemName = readStringMeta(meta, 'itemName');
  const gameType = readStringMeta(meta, 'gameType');
  const dateKey = readStringMeta(meta, 'dateKey');
  if (itemName) summary.itemName = itemName.slice(0, 120);
  if (gameType) summary.gameType = gameType.slice(0, 60);
  if (dateKey) summary.dateKey = dateKey.slice(0, 20);
  return summary;
};

export const queryCurrencyLedger = async ({
  userId,
  currencyType,
  sourceType,
  fromTs,
  toTs,
  limit = 250,
}: {
  userId?: string;
  currencyType?: CurrencyType;
  sourceType?: LedgerSourceType;
  fromTs?: number;
  toTs?: number;
  limit?: number;
}): Promise<LedgerEntry[]> => {
  const conditions: string[] = [];
  const params: Array<string | number> = [];

  const addCondition = (sql: string, value: string | number) => {
    params.push(value);
    conditions.push(sql.replace('?', `$${params.length}`));
  };

  if (userId) addCondition('user_id = ?', userId);
  if (currencyType) addCondition('currency_type = ?', currencyType);
  if (sourceType) addCondition('source_type = ?', sourceType);
  if (typeof fromTs === 'number') addCondition('created_at >= ?', fromTs);
  if (typeof toTs === 'number') addCondition('created_at <= ?', toTs);

  const normalizedLimit = Math.max(1, Math.min(1000, Math.floor(limit)));
  params.push(normalizedLimit);
  const whereClause =
    conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const result = await query<{
    id: string;
    user_id: string;
    currency_type: string;
    amount: string | number;
    balance_after: string | number;
    source_type: LedgerSourceType;
    source_id: string;
    meta_json: string | null;
    created_at: string | number;
    created_by: string | null;
  }>(
    `
      SELECT id, user_id, currency_type, amount, balance_after, source_type, source_id, meta_json, created_at, created_by
      FROM currency_ledger
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT $${params.length}
    `,
    params,
  );

  return result.rows.map((row) => {
    const meta = parseMeta(row.meta_json);
    const sourceTypeValue = row.source_type;
    return {
      id: row.id,
      userId: row.user_id,
      currencyType: normalizeCurrencyType(row.currency_type),
      amount: Number(row.amount ?? 0),
      balanceAfter: Number(row.balance_after ?? 0),
      sourceType: sourceTypeValue,
      sourceId: row.source_id,
      reason: getReasonFromEntry({
        sourceType: sourceTypeValue,
        meta,
      }),
      meta,
      createdAt: Number(row.created_at ?? 0),
      createdBy: row.created_by,
    };
  });
};
