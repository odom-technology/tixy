import { query, withTransaction } from '@/server/db/client';

import { boughtBucketSql, earnedBucketSql } from './buckets';
import { addDays, dayBoundsMs, dayRange, isDayKey, todayUtc, DAY_MS } from './window';

/* The nightly rollup. It copies what the metrics need into small per-day
   tables (admin_*_days, migration 0061) because some sources are pruned
   (game_time_metrics_daily keeps this and last month, anti_cheat_logs keeps
   ANTI_CHEAT_LOG_RETENTION_DAYS, game_sessions 6 hours) and some are large
   (currency_ledger, arcade_round_history). Days are UTC calendar days.

   rollupDay(day) is idempotent: one transaction that deletes the day's rows in
   every table and inserts them again. ensureRollups() keeps today and
   yesterday fresh and backfills missing days, and every metrics function
   awaits it first. runRollup() is for the cron route and the CLI. */

const TODAY_STALE_MS = 5 * 60_000;
const YESTERDAY_FINAL_AFTER_MS = 15 * 60_000;
const ENSURE_FRESH_MS = 10_000;

/* game_time_metrics_daily.date_key is the server's local date. Production runs
   in a UTC container, so it is the UTC day and matches the day used here. */

/* Friends matches that are over. A match left open for hours is not play time,
   so a gap over MATCH_PLAY_CAP_MS counts as a run with no recorded time. */
const MATCH_PLAY_CAP_MS = 6 * 3_600_000;

const MATCH_SOURCES = [
  { key: '8-ball', table: 'pool_matches' },
  { key: 'chess', table: 'chess_matches' },
  { key: 'connect-four', table: 'connect_four_matches' },
] as const;

function matchRunsSql(): string {
  // Both players get a run; bot opponents ('bot:%') do not.
  return MATCH_SOURCES.map(
    ({ key, table }) => `
      SELECT '${key}'::text AS game_key, p.user_id, 1 AS runs,
             (CASE WHEN p.dur > 0 AND p.dur <= ${MATCH_PLAY_CAP_MS} THEN p.dur ELSE 0 END)::bigint AS play_ms
      FROM (
        SELECT player1_id AS user_id, completed_at - created_at AS dur
        FROM ${table}
        WHERE completed_at >= $3 AND completed_at < $4 AND status IN ('completed', 'forfeited')
        UNION ALL
        SELECT player2_id, completed_at - created_at
        FROM ${table}
        WHERE completed_at >= $3 AND completed_at < $4 AND status IN ('completed', 'forfeited')
          AND player2_id IS NOT NULL
      ) p
      WHERE p.user_id NOT LIKE 'bot:%'`,
  ).join('\n      UNION ALL\n');
}

const PLAY_SQL = `
  INSERT INTO admin_play_days (day, game_key, user_id, is_guest, runs, play_ms)
  SELECT $1::date, s.game_key, s.user_id, s.user_id LIKE 'guest:%',
         SUM(s.runs)::int, SUM(s.play_ms)::bigint
  FROM (
    SELECT game_type AS game_key, user_id, run_count AS runs, duration_ms AS play_ms
    FROM game_time_metrics_daily
    WHERE date_key = $2
      AND game_type <> 'arcade' AND game_type NOT LIKE 'arcade-%'
      AND game_type NOT IN ('8-ball', 'chess', 'connect-four')
      AND (run_count > 0 OR duration_ms > 0)
    UNION ALL
    SELECT game_type, user_id, COUNT(*)::int, 0::bigint
    FROM arcade_round_history
    WHERE created_at >= $3 AND created_at < $4
    GROUP BY game_type, user_id
    UNION ALL ${matchRunsSql()}
  ) s
  GROUP BY s.game_key, s.user_id`;

const LEDGER_EARNED_SQL = `
  INSERT INTO admin_ledger_days (day, ledger, bucket, amount, entries, users)
  SELECT $1::date, 'earned', t.bucket, SUM(t.amount)::bigint, COUNT(*)::int, COUNT(DISTINCT t.user_id)::int
  FROM (
    SELECT user_id, amount, ${earnedBucketSql()} AS bucket
    FROM currency_ledger
    WHERE currency_type = 'credits' AND created_at >= $2 AND created_at < $3
  ) t
  GROUP BY t.bucket`;

const LEDGER_BOUGHT_SQL = `
  INSERT INTO admin_ledger_days (day, ledger, bucket, amount, entries, users)
  SELECT $1::date, 'bought', t.bucket, SUM(t.amount)::bigint, COUNT(*)::int, COUNT(DISTINCT t.user_id)::int
  FROM (
    SELECT user_id, amount, ${boughtBucketSql()} AS bucket
    FROM store_credit_ledger
    WHERE created_at >= $2 AND created_at < $3
  ) t
  GROUP BY t.bucket`;

const MACHINE_SQL = `
  INSERT INTO admin_machine_days
    (day, game_key, rounds, players, wagered, paid, sum_w2, sum_p2, sum_wp, biggest_win)
  SELECT $1::date, game_type, COUNT(*)::int, COUNT(DISTINCT user_id)::int,
         SUM(wager_amount)::bigint, SUM(payout_amount)::bigint,
         SUM(wager_amount::float8 * wager_amount), SUM(payout_amount::float8 * payout_amount),
         SUM(wager_amount::float8 * payout_amount),
         MAX(payout_amount::bigint - wager_amount)::bigint
  FROM arcade_round_history
  WHERE created_at >= $2 AND created_at < $3
  GROUP BY game_type`;

const TRUST_SQL = `
  INSERT INTO admin_trust_days (day, game_key, result, n, players)
  SELECT $1::date, game_type, result, COUNT(*)::int, COUNT(DISTINCT user_id)::int
  FROM anti_cheat_logs
  WHERE ts >= $2 AND ts < $3
  GROUP BY game_type, result`;

const FUNNEL_SQL = `
  INSERT INTO admin_funnel_days (day, game_key, starts, finishes)
  SELECT $1::date, game_slug,
         COUNT(DISTINCT session_hash) FILTER (WHERE event_name = 'game_started')::int,
         COUNT(DISTINCT session_hash) FILTER (WHERE event_name = 'game_completed')::int
  FROM product_analytics_events
  WHERE created_at >= $2 AND created_at < $3 AND game_slug IS NOT NULL
    AND event_name IN ('game_started', 'game_completed')
  GROUP BY game_slug`;

const DAY_TABLES = [
  'admin_play_days',
  'admin_ledger_days',
  'admin_machine_days',
  'admin_trust_days',
  'admin_funnel_days',
] as const;

/** Roll one UTC day up. One transaction; safe to run again. */
export async function rollupDay(day: string): Promise<{ day: string; durationMs: number }> {
  if (!isDayKey(day)) throw new Error(`Bad day "${day}".`);
  const started = Date.now();
  const { startMs, endMs } = dayBoundsMs(day);
  await withTransaction(async (client) => {
    // One roller per day at a time: the cron, the CLI and a web worker may
    // overlap, and two delete-and-insert passes would collide on the keys.
    await client.query(`SELECT pg_advisory_xact_lock(7340, $1::int)`, [Math.floor(startMs / DAY_MS)]);
    for (const table of DAY_TABLES) {
      await client.query(`DELETE FROM ${table} WHERE day = $1::date`, [day]);
    }
    await client.query(PLAY_SQL, [day, day, startMs, endMs]);
    await client.query(LEDGER_EARNED_SQL, [day, startMs, endMs]);
    await client.query(LEDGER_BOUGHT_SQL, [day, startMs, endMs]);
    await client.query(MACHINE_SQL, [day, startMs, endMs]);
    await client.query(TRUST_SQL, [day, startMs, endMs]);
    await client.query(FUNNEL_SQL, [day, startMs, endMs]);
    const durationMs = Date.now() - started;
    await client.query(
      `INSERT INTO admin_rollup_days (day, rolled_at, duration_ms)
       VALUES ($1::date, $2, $3)
       ON CONFLICT (day) DO UPDATE SET rolled_at = EXCLUDED.rolled_at, duration_ms = EXCLUDED.duration_ms`,
      [day, Date.now(), durationMs],
    );
  });
  return { day, durationMs: Date.now() - started };
}

async function rolledDays(from: string): Promise<Map<string, number>> {
  const result = await query<{ day: string; rolled_at: string }>(
    `SELECT day::text AS day, rolled_at FROM admin_rollup_days WHERE day >= $1::date`,
    [from],
  );
  return new Map(result.rows.map((row) => [row.day, Number(row.rolled_at)]));
}

/** Which days need rolling now, most recent first: today when its row is older
    than 5 minutes, yesterday until it has been copied after the day closed
    (rolled at or after midnight + 15 minutes), and every day missing from
    admin_rollup_days back to maxBackfillDays. */
export function planRollups(
  rolled: ReadonlyMap<string, number>,
  maxBackfillDays: number,
  now: number = Date.now(),
): string[] {
  const today = todayUtc(now);
  const yesterday = addDays(today, -1);
  const midnight = dayBoundsMs(today).startMs;
  const plan: string[] = [];

  const todayAt = rolled.get(today);
  if (todayAt === undefined || now - todayAt > TODAY_STALE_MS) plan.push(today);

  const yesterdayAt = rolled.get(yesterday);
  const finalAt = midnight + YESTERDAY_FINAL_AFTER_MS;
  if (yesterdayAt === undefined || (yesterdayAt < finalAt && now >= finalAt)) plan.push(yesterday);

  for (let back = 2; back <= maxBackfillDays; back += 1) {
    const day = addDays(today, -back);
    if (!rolled.has(day)) plan.push(day);
  }
  return plan;
}

let inflight: Promise<void> | null = null;
let lastEnsuredAt = 0;

async function runPlan(maxBackfillDays: number): Promise<number> {
  const rolled = await rolledDays(addDays(todayUtc(), -maxBackfillDays));
  const plan = planRollups(rolled, maxBackfillDays);
  for (const day of plan) await rollupDay(day);
  return plan.length;
}

/** Keep the rollup tables current. Concurrent callers share one run, and a
    check that finished in the last 10 seconds is not repeated. A failure is
    logged and the reads carry on with what the tables hold. */
export function ensureRollups(options: { maxBackfillDays?: number } = {}): Promise<void> {
  const maxBackfillDays = options.maxBackfillDays ?? 31;
  if (inflight) return inflight;
  if (Date.now() - lastEnsuredAt < ENSURE_FRESH_MS) return Promise.resolve();
  inflight = runPlan(maxBackfillDays)
    .then(() => undefined)
    .catch((error: unknown) => {
      console.error('[admin-metrics] rollup failed', error instanceof Error ? error.message : 'unknown');
    })
    .finally(() => {
      lastEnsuredAt = Date.now();
      inflight = null;
    });
  return inflight;
}

/** For the cron route and the CLI: roll the last `days` days (default 3), then
    any day missing from the last 31. */
export async function runRollup(
  options: { days?: number } = {},
): Promise<{ days: number; durationMs: number }> {
  const days = Math.max(1, Math.min(1000, Math.floor(options.days ?? 3)));
  const started = Date.now();
  const today = todayUtc();
  const list = dayRange(addDays(today, -(days - 1)), today).reverse();
  const done = new Set<string>();
  for (const day of list) {
    await rollupDay(day);
    done.add(day);
  }
  const rolled = await rolledDays(addDays(today, -31));
  for (let back = 0; back <= 31; back += 1) {
    const day = addDays(today, -back);
    if (!rolled.has(day) && !done.has(day)) {
      await rollupDay(day);
      done.add(day);
    }
  }
  lastEnsuredAt = Date.now();
  return { days: done.size, durationMs: Date.now() - started };
}
