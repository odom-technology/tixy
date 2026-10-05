import { query } from '@/server/db/client';

import {
  METRIC_WINDOWS,
  type DayPoint,
  type MetricWindow,
  type MetricWindowDays,
} from './types';

/* Window and day helpers shared by every section. All days are UTC calendar
   days, 'YYYY-MM-DD'. Timestamps in the schema are BIGINT ms since epoch, so a
   day's range is computed here in JS and the SQL filters
   `ts >= $1 AND ts < $2`, which an index on the column can serve. */

export const DAY_MS = 86_400_000;

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 7, 30 or 90; anything else is 30. Accepts a number or a string. */
export function parseWindow(value: unknown): MetricWindowDays {
  const n = typeof value === 'string' ? Number.parseInt(value, 10) : Number(value);
  return (METRIC_WINDOWS as readonly number[]).includes(n) ? (n as MetricWindowDays) : 30;
}

export function isDayKey(value: string): boolean {
  return DAY_RE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

export function dayKeyOf(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function todayUtc(now: number = Date.now()): string {
  return dayKeyOf(now);
}

export function addDays(day: string, n: number): string {
  return dayKeyOf(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS);
}

/** Monday of the UTC week that holds `day`. */
export function mondayOf(day: string): string {
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(day, -((weekday + 6) % 7));
}

/** Every day from `from` to `to`, inclusive, oldest first. */
export function dayRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) out.push(day);
  return out;
}

/** ms bounds for the days from..to inclusive: [startMs, endMs). */
export function dayBoundsMs(from: string, to: string = from): { startMs: number; endMs: number } {
  return {
    startMs: Date.parse(`${from}T00:00:00Z`),
    endMs: Date.parse(`${to}T00:00:00Z`) + DAY_MS,
  };
}

/** A dense series: one value per day in `days`, zero (or `fill`) where the
    source has no row. */
export function densify(
  days: readonly string[],
  source: ReadonlyMap<string, number> | readonly { day: string; value: number }[],
  fill = 0,
): DayPoint[] {
  const map =
    source instanceof Map
      ? (source as ReadonlyMap<string, number>)
      : new Map((source as readonly { day: string; value: number }[]).map((p) => [p.day, p.value]));
  return days.map((day) => ({ day, value: map.get(day) ?? fill }));
}

/** The window's day list, oldest first. */
export function windowDays(window: Pick<MetricWindow, 'from' | 'to'>): string[] {
  return dayRange(window.from, window.to);
}

export function num(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function numOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/** The window pieces without the database read: from, to and the previous
    window of the same length. */
export function windowShape(days: MetricWindowDays, now: number = Date.now()): Omit<MetricWindow, 'rolledAt'> {
  const to = todayUtc(now);
  const from = addDays(to, -(days - 1));
  return {
    days,
    from,
    to,
    previousFrom: addDays(from, -days),
    previousTo: addDays(from, -1),
  };
}

type RollupSpan = { first: string | null; rolledAt: number | null };

/** The first rolled day and the newest rollup time, from admin_rollup_days. */
export async function readRollupSpan(): Promise<RollupSpan> {
  const result = await query<{ first: string | null; rolled_at: string | null }>(
    `SELECT MIN(day)::text AS first, MAX(rolled_at) AS rolled_at FROM admin_rollup_days`,
  );
  const row = result.rows[0];
  return { first: row?.first ?? null, rolledAt: row?.rolled_at == null ? null : Number(row.rolled_at) };
}

export async function buildWindow(days: MetricWindowDays): Promise<MetricWindow> {
  const span = await readRollupSpan();
  return { ...windowShape(days), rolledAt: span.rolledAt };
}

let siteStartCache: { at: number; day: string | null } | null = null;

/** The day of the oldest account. The baseline for tables read live (revenue,
    signups, achievements): there is no previous window before the site existed. */
export async function siteStartDay(): Promise<string | null> {
  if (siteStartCache && Date.now() - siteStartCache.at < 5 * 60_000) return siteStartCache.day;
  const result = await query<{ first: string | null }>(`SELECT MIN(created_at) AS first FROM arcade_accounts`);
  const first = result.rows[0]?.first;
  const day = first == null ? null : dayKeyOf(Number(first));
  siteStartCache = { at: Date.now(), day };
  return day;
}

/** True when data reaches back to the start of the previous window, so a delta
    means something. `source` picks the baseline: the first rolled day for
    anything read from the rollup tables, the oldest account for live reads. */
export async function hasBaseline(
  window: MetricWindow,
  source: 'rollup' | 'live' = 'rollup',
): Promise<boolean> {
  const first = source === 'rollup' ? (await readRollupSpan()).first : await siteStartDay();
  return first !== null && first <= window.previousFrom;
}

/** A Kpi whose previous is null without a baseline. */
export function kpi(value: number, previous: number, baseline: boolean) {
  return { value, previous: baseline ? previous : null };
}
