import { GAME_DAILY_CREDIT_CAP } from '@/features/arcade/lib/rewards';
import { DAILY_WHEEL_BASE, DAILY_WHEEL_SEGMENTS, DAILY_WHEEL_UNITS } from '@/features/arcade/lib/daily-wheel';
import { query } from '@/server/db/client';

import { FAUCET_BUCKETS, SINK_BUCKETS } from './buckets';
import { cached } from './cache';
import { canonicalGameKey, gameRef } from './games';
import { ensureRollups } from './rollup';
import { ledgerDaily, sumMinted } from './shared';
import type { EconomyMetrics, LedgerBucket } from './types';
import { buildWindow, hasBaseline, kpi, num, parseWindow, windowDays } from './window';

type BucketRow = {
  bucket: string;
  cur: string;
  prev: string;
  entries: string;
  users: string;
  pos_cur: string;
  pos_prev: string;
  pos_entries: string;
  pos_users: string;
  neg_cur: string;
  neg_prev: string;
  neg_entries: string;
  neg_users: string;
};

export const BALANCE_BUCKETS = [
  { label: '0', min: 0, max: 0 },
  { label: '1-99', min: 1, max: 99 },
  { label: '100-499', min: 100, max: 499 },
  { label: '500-1,999', min: 500, max: 1999 },
  { label: '2,000-9,999', min: 2000, max: 9999 },
  { label: '10,000+', min: 10000, max: null },
] as const;

/**
 * Economy definitions. Tickets are credits in the code.
 *
 * minted, spent: as the overview. minted sums faucet buckets of the earned
 *   ledger (rows with amount > 0), spent the sinks, both from admin_ledger_days.
 *   net = minted - spent. previous is the same over the previous window.
 * supply: SUM(wallets.credits); holders: wallets with credits > 0.
 * daily: minted, spent and net per window day, dense.
 * sources, sinks: one row per bucket with data, largest first. amount is
 *   SUM over the window (sinks positive). entries is the ledger row count.
 *   users is the sum of each day's distinct players (player-days), because the
 *   rollup keeps distinct players per day, not per window. previous is the
 *   amount over the previous window. admin is net per day: positive days are
 *   a source, negative days a sink.
 * bought: from the bought ledger (store_credit_ledger): granted is stripe pack
 *   tickets, spent is counter spending (positive), reversed is refunded packs
 *   (positive), adRewards is rewarded ads, supply is SUM(wallets.store_credits).
 * dailyCap: cap is GAME_DAILY_CREDIT_CAP. From game_daily_earnings rows whose
 *   date_key is in the window: earningDays are rows with earned_credits > 0,
 *   cappedDays rows at or over the cap, cappedPlayers distinct players with a
 *   capped row, byGame the same per game. The table is read through an index
 *   on date_key (migration 0061).
 * dailySpin: daily_credit_claims rows with a wheel unit, dated in the window.
 *   paid is what they paid (holds included); expected is 25 x multiplier per
 *   spin, the ladder each spin stands for. bySlot has every slot value on the
 *   wheel with its chance (units / 50), spins and tickets paid.
 * balances: wallets of accounts (wallets whose user_id is in arcade_accounts, so
 *   no guests), in six buckets with the zero wallets as their own bucket.
 *   median, p90, p99 are percentile_disc over holders (credits > 0). top1Share is
 *   the tickets held by the top 1% of holders (at least one) over all tickets
 *   held; null with no holders.
 */
async function load(daysInput: number): Promise<EconomyMetrics> {
  await ensureRollups();
  const days = parseWindow(daysInput);
  const window = await buildWindow(days);
  const baseline = await hasBaseline(window);
  const list = windowDays(window);

  const [ledger, buckets, bought, wallets, capGame, capTotal, balanceRows, dist, spins] = await Promise.all([
    ledgerDaily(window.previousFrom, window.to),
    query<BucketRow>(
      `SELECT bucket,
              COALESCE(SUM(amount) FILTER (WHERE day >= $2::date), 0) AS cur,
              COALESCE(SUM(amount) FILTER (WHERE day < $2::date), 0) AS prev,
              COALESCE(SUM(entries) FILTER (WHERE day >= $2::date), 0) AS entries,
              COALESCE(SUM(users) FILTER (WHERE day >= $2::date), 0) AS users,
              COALESCE(SUM(amount) FILTER (WHERE day >= $2::date AND amount > 0), 0) AS pos_cur,
              COALESCE(SUM(amount) FILTER (WHERE day < $2::date AND amount > 0), 0) AS pos_prev,
              COALESCE(SUM(entries) FILTER (WHERE day >= $2::date AND amount > 0), 0) AS pos_entries,
              COALESCE(SUM(users) FILTER (WHERE day >= $2::date AND amount > 0), 0) AS pos_users,
              COALESCE(SUM(amount) FILTER (WHERE day >= $2::date AND amount < 0), 0) AS neg_cur,
              COALESCE(SUM(amount) FILTER (WHERE day < $2::date AND amount < 0), 0) AS neg_prev,
              COALESCE(SUM(entries) FILTER (WHERE day >= $2::date AND amount < 0), 0) AS neg_entries,
              COALESCE(SUM(users) FILTER (WHERE day >= $2::date AND amount < 0), 0) AS neg_users
       FROM admin_ledger_days
       WHERE ledger = 'earned' AND day >= $1::date AND day <= $3::date
       GROUP BY bucket`,
      [window.previousFrom, window.from, window.to],
    ),
    query<{ bucket: string; amount: string }>(
      `SELECT bucket, SUM(amount) AS amount FROM admin_ledger_days
       WHERE ledger = 'bought' AND day >= $1::date AND day <= $2::date GROUP BY bucket`,
      [window.from, window.to],
    ),
    query<{ supply: string; holders: string; store_supply: string }>(
      `SELECT COALESCE(SUM(credits), 0) AS supply, COUNT(*) FILTER (WHERE credits > 0) AS holders,
              COALESCE(SUM(store_credits), 0) AS store_supply
       FROM wallets`,
    ),
    query<{ game_type: string; earning: string; capped: string }>(
      `SELECT game_type, COUNT(*) FILTER (WHERE earned_credits > 0) AS earning,
              COUNT(*) FILTER (WHERE earned_credits >= $3) AS capped
       FROM game_daily_earnings WHERE date_key >= $1 AND date_key <= $2 GROUP BY game_type`,
      [window.from, window.to, GAME_DAILY_CREDIT_CAP],
    ),
    query<{ players: string }>(
      `SELECT COUNT(DISTINCT user_id) AS players FROM game_daily_earnings
       WHERE date_key >= $1 AND date_key <= $2 AND earned_credits >= $3`,
      [window.from, window.to, GAME_DAILY_CREDIT_CAP],
    ),
    query<{ bucket: number; players: string; tickets: string }>(
      `SELECT (CASE WHEN w.credits <= 0 THEN 0 WHEN w.credits < 100 THEN 1 WHEN w.credits < 500 THEN 2
                    WHEN w.credits < 2000 THEN 3 WHEN w.credits < 10000 THEN 4 ELSE 5 END) AS bucket,
              COUNT(*) AS players, COALESCE(SUM(w.credits), 0) AS tickets
       FROM wallets w JOIN arcade_accounts a ON a.id = w.user_id
       GROUP BY 1`,
    ),
    query<{ median: number | null; p90: number | null; p99: number | null; top1: string | null }>(
      `WITH h AS (
         SELECT w.credits, row_number() OVER (ORDER BY w.credits DESC) AS rn, COUNT(*) OVER () AS n
         FROM wallets w JOIN arcade_accounts a ON a.id = w.user_id
         WHERE w.credits > 0
       )
       SELECT (SELECT percentile_disc(0.5) WITHIN GROUP (ORDER BY credits) FROM h) AS median,
              (SELECT percentile_disc(0.9) WITHIN GROUP (ORDER BY credits) FROM h) AS p90,
              (SELECT percentile_disc(0.99) WITHIN GROUP (ORDER BY credits) FROM h) AS p99,
              (SELECT SUM(credits) FILTER (WHERE rn <= GREATEST(1, CEIL(n * 0.01)))::float8
                      / NULLIF(SUM(credits), 0) FROM h) AS top1`,
    ),
    query<{ value: number; spins: string; paid: string; expected: string }>(
      `SELECT wheel_value AS value, COUNT(*) AS spins, COALESCE(SUM(credits_awarded), 0) AS paid,
              COALESCE(SUM($3::int * wheel_multiplier), 0) AS expected
       FROM daily_credit_claims
       WHERE date_key >= $1 AND date_key <= $2 AND wheel_unit IS NOT NULL
       GROUP BY wheel_value`,
      [window.from, window.to, DAILY_WHEEL_BASE],
    ),
  ]);

  const now = sumMinted(ledger, window.from, window.to);
  const before = sumMinted(ledger, window.previousFrom, window.previousTo);

  const byBucket = new Map(buckets.rows.map((row) => [row.bucket, row]));
  const side = (kind: 'source' | 'sink') => {
    const names = kind === 'source' ? FAUCET_BUCKETS : SINK_BUCKETS;
    const out: EconomyMetrics['sources'] = [];
    for (const bucket of names) {
      const row = byBucket.get(bucket);
      if (!row) continue;
      let cur: number;
      let prev: number;
      let entries: number;
      let users: number;
      if (bucket === 'admin') {
        // admin is net per day: positive days are a source, negative days a sink.
        const pre = kind === 'source' ? 'pos' : 'neg';
        const sign = kind === 'source' ? 1 : -1;
        cur = num(row[`${pre}_cur` as keyof BucketRow]) * sign;
        prev = num(row[`${pre}_prev` as keyof BucketRow]) * sign;
        entries = num(row[`${pre}_entries` as keyof BucketRow]);
        users = num(row[`${pre}_users` as keyof BucketRow]);
      } else {
        // Sinks are reported positive.
        const sign = kind === 'source' ? 1 : -1;
        cur = num(row.cur) * sign;
        prev = num(row.prev) * sign;
        entries = num(row.entries);
        users = num(row.users);
      }
      if (cur === 0 && entries === 0) continue;
      out.push({
        bucket: bucket as LedgerBucket,
        amount: cur,
        entries,
        users,
        previous: baseline ? prev : null,
      });
    }
    return out.sort((a, b) => b.amount - a.amount || a.bucket.localeCompare(b.bucket));
  };

  const boughtBy = new Map(bought.rows.map((row) => [row.bucket, num(row.amount)]));

  const byGame = new Map<string, { earningDays: number; cappedDays: number }>();
  for (const row of capGame.rows) {
    const key = canonicalGameKey(row.game_type);
    const entry = byGame.get(key) ?? { earningDays: 0, cappedDays: 0 };
    entry.earningDays += num(row.earning);
    entry.cappedDays += num(row.capped);
    byGame.set(key, entry);
  }
  const capRows = [...byGame.entries()]
    .map(([key, v]) => ({ game: gameRef(key), ...v }))
    .sort((a, b) => b.cappedDays - a.cappedDays || b.earningDays - a.earningDays || a.game.key.localeCompare(b.game.key));

  const balanceBy = new Map(balanceRows.rows.map((row) => [Number(row.bucket), row]));

  return {
    window,
    minted: kpi(now.minted, before.minted, baseline),
    spent: kpi(now.spent, before.spent, baseline),
    net: kpi(now.minted - now.spent, before.minted - before.spent, baseline),
    supply: num(wallets.rows[0]?.supply),
    holders: num(wallets.rows[0]?.holders),
    daily: list.map((day) => {
      const row = ledger.get(day) ?? { minted: 0, spent: 0 };
      return { day, minted: row.minted, spent: row.spent, net: row.minted - row.spent };
    }),
    sources: side('source'),
    sinks: side('sink'),
    bought: {
      granted: boughtBy.get('packs') ?? 0,
      spent: -(boughtBy.get('counter') ?? 0),
      reversed: -(boughtBy.get('reversals') ?? 0),
      adRewards: boughtBy.get('ads') ?? 0,
      supply: num(wallets.rows[0]?.store_supply),
    },
    dailyCap: {
      cap: GAME_DAILY_CREDIT_CAP,
      earningDays: capRows.reduce((sum, row) => sum + row.earningDays, 0),
      cappedDays: capRows.reduce((sum, row) => sum + row.cappedDays, 0),
      cappedPlayers: num(capTotal.rows[0]?.players),
      byGame: capRows,
    },
    dailySpin: (() => {
      const byValue = new Map(spins.rows.map((row) => [Number(row.value), row]));
      const total = spins.rows.reduce((sum, row) => sum + num(row.spins), 0);
      const slots = [...new Set(DAILY_WHEEL_SEGMENTS.map((segment) => segment.value))].sort((a, b) => a - b);
      return {
        spins: total,
        paid: spins.rows.reduce((sum, row) => sum + num(row.paid), 0),
        expected: spins.rows.reduce((sum, row) => sum + num(row.expected), 0),
        bySlot: slots.map((value) => ({
          value,
          chance:
            DAILY_WHEEL_SEGMENTS.filter((segment) => segment.value === value).reduce((sum, segment) => sum + segment.units, 0) /
            DAILY_WHEEL_UNITS,
          spins: num(byValue.get(value)?.spins),
          paid: num(byValue.get(value)?.paid),
        })),
      };
    })(),
    balances: {
      buckets: BALANCE_BUCKETS.map((bucket, index) => ({
        label: bucket.label,
        min: bucket.min,
        max: bucket.max,
        players: num(balanceBy.get(index)?.players),
        tickets: num(balanceBy.get(index)?.tickets),
      })),
      median: num(dist.rows[0]?.median),
      p90: num(dist.rows[0]?.p90),
      p99: num(dist.rows[0]?.p99),
      top1Share: dist.rows[0]?.top1 == null ? null : num(dist.rows[0]?.top1),
    },
  };
}

export function getEconomyMetrics(days: number): Promise<EconomyMetrics> {
  const window = parseWindow(days);
  return cached('economy', window, () => load(window));
}

