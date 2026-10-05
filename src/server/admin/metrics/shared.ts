import { query } from '@/server/db/client';

import { mintedSql, spentSql } from './buckets';
import { addDays, num } from './window';

/* Queries more than one section reads. Every one is bounded by a day range on
   the admin_*_days tables (primary keys lead on day) or by a ms range on an
   indexed timestamp. */

export type DayCounts = Map<string, number>;

/** Distinct players per day in admin_play_days, accounts and guests together. */
export async function dailyActive(
  from: string,
  to: string,
): Promise<Map<string, { active: number; accounts: number; guests: number }>> {
  const result = await query<{ day: string; active: string; guests: string }>(
    `SELECT day::text AS day,
            COUNT(DISTINCT user_id) AS active,
            COUNT(DISTINCT user_id) FILTER (WHERE is_guest) AS guests
     FROM admin_play_days
     WHERE day >= $1::date AND day <= $2::date
     GROUP BY day`,
    [from, to],
  );
  return new Map(
    result.rows.map((row) => {
      const active = num(row.active);
      const guests = num(row.guests);
      return [row.day, { active, accounts: active - guests, guests }];
    }),
  );
}

/** Distinct players over a day range, e.g. the 7 days a WAU is counted on. */
export async function distinctPlayers(from: string, to: string): Promise<number> {
  const result = await query<{ n: string }>(
    `SELECT COUNT(DISTINCT user_id) AS n FROM admin_play_days WHERE day >= $1::date AND day <= $2::date`,
    [from, to],
  );
  return num(result.rows[0]?.n);
}

/** Players per first day in admin_play_days, for first days inside from..to.
    A player counts as new on the first day they appear, so the first
    rolled days overstate new players: everyone looks new then. */
export async function firstDayCounts(from: string, to: string): Promise<DayCounts> {
  const result = await query<{ day: string; n: string }>(
    `SELECT w.first_day::text AS day, COUNT(*) AS n
     FROM (
       SELECT user_id, MIN(day) AS first_day
       FROM admin_play_days
       WHERE day >= $1::date AND day <= $2::date
       GROUP BY user_id
     ) w
     WHERE NOT EXISTS (
       SELECT 1 FROM admin_play_days e WHERE e.user_id = w.user_id AND e.day < $1::date
     )
     GROUP BY w.first_day`,
    [from, to],
  );
  return new Map(result.rows.map((row) => [row.day, num(row.n)]));
}

/** Tickets minted and spent per day from admin_ledger_days (earned ledger). */
export async function ledgerDaily(from: string, to: string): Promise<Map<string, { minted: number; spent: number }>> {
  const result = await query<{ day: string; minted: string; spent: string }>(
    `SELECT day::text AS day,
            SUM(${mintedSql()}) AS minted,
            SUM(${spentSql()}) AS spent
     FROM admin_ledger_days
     WHERE ledger = 'earned' AND day >= $1::date AND day <= $2::date
     GROUP BY day`,
    [from, to],
  );
  return new Map(result.rows.map((row) => [row.day, { minted: num(row.minted), spent: num(row.spent) }]));
}

export function sumMinted(map: Map<string, { minted: number; spent: number }>, from: string, to: string) {
  let minted = 0;
  let spent = 0;
  for (let day = from; day <= to; day = addDays(day, 1)) {
    const row = map.get(day);
    if (row) {
      minted += row.minted;
      spent += row.spent;
    }
  }
  return { minted, spent };
}

export type RevenueRow = { currency: string; cents: number; previous: number };

/** Revenue by currency over the window and the one before: fulfilled and not
    reversed (a refund or dispute moves the row off status 'fulfilled'),
    created in the range. Reads only what the app recorded; never Stripe. */
export async function revenueByCurrency(
  startMs: number,
  endMs: number,
  prevStartMs: number,
): Promise<RevenueRow[]> {
  const result = await query<{ currency: string; cents: string; previous: string }>(
    `SELECT currency,
            COALESCE(SUM(amount_total) FILTER (WHERE created_at >= $2), 0) AS cents,
            COALESCE(SUM(amount_total) FILTER (WHERE created_at < $2), 0) AS previous
     FROM ticket_purchases
     WHERE status = 'fulfilled' AND reversed_at IS NULL
       AND created_at >= $1 AND created_at < $3
     GROUP BY currency
     ORDER BY cents DESC, currency`,
    [prevStartMs, startMs, endMs],
  );
  return result.rows.map((row) => ({
    currency: row.currency,
    cents: num(row.cents),
    previous: num(row.previous),
  }));
}
