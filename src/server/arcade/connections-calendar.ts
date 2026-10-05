import { query } from '@/server/db/client';

const pad2 = (n: number) => n.toString().padStart(2, '0');

export function formatDateKey(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function parseDateKey(dateKey: string): Date {
  const [y, m, d] = dateKey.split('-').map(Number);
  return new Date(y!, m! - 1, d!);
}

function nthWeekdayOfMonth(year: number, month: number, weekday: number, nth: number): Date {
  const d = new Date(year, month, 1);
  while (d.getDay() !== weekday) d.setDate(d.getDate() + 1);
  d.setDate(d.getDate() + (nth - 1) * 7);
  return d;
}

function lastWeekdayOfMonth(year: number, month: number, weekday: number): Date {
  const d = new Date(year, month + 1, 0);
  while (d.getDay() !== weekday) d.setDate(d.getDate() - 1);
  return d;
}

function observedDate(year: number, month: number, day: number): Date {
  const d = new Date(year, month, day);
  const dow = d.getDay();
  if (dow === 6) d.setDate(d.getDate() - 1);
  if (dow === 0) d.setDate(d.getDate() + 1);
  return d;
}

export function getFederalHolidays(year: number): Map<string, string> {
  const holidays = new Map<string, string>();
  const add = (d: Date, name: string) => holidays.set(formatDateKey(d), name);

  add(observedDate(year, 0, 1), "New Year's Day");
  add(nthWeekdayOfMonth(year, 0, 1, 3), 'Martin Luther King Jr. Day');
  add(nthWeekdayOfMonth(year, 1, 1, 3), "Presidents' Day");
  add(lastWeekdayOfMonth(year, 4, 1), 'Memorial Day');
  add(observedDate(year, 5, 19), 'Juneteenth');
  add(observedDate(year, 6, 4), 'Independence Day');
  add(nthWeekdayOfMonth(year, 8, 1, 1), 'Labor Day');
  add(nthWeekdayOfMonth(year, 9, 1, 2), 'Columbus Day');
  add(observedDate(year, 10, 11), 'Veterans Day');
  add(nthWeekdayOfMonth(year, 10, 4, 4), 'Thanksgiving Day');
  add(observedDate(year, 11, 25), 'Christmas Day');

  return holidays;
}

type BlackoutRow = { date: string; reason: string };

const blackoutCache = { data: null as Map<string, string> | null, ts: 0 };
const CACHE_TTL_MS = 30_000;

export async function getBlackoutDates(): Promise<Map<string, string>> {
  const now = Date.now();
  if (blackoutCache.data && now - blackoutCache.ts < CACHE_TTL_MS) {
    return blackoutCache.data;
  }

  const result = await query<BlackoutRow>(
    'SELECT date, reason FROM connections_blackout_dates',
  );
  const map = new Map<string, string>();
  for (const row of result.rows) map.set(row.date, row.reason);
  blackoutCache.data = map;
  blackoutCache.ts = now;
  return map;
}

export function invalidateBlackoutCache() {
  blackoutCache.data = null;
  blackoutCache.ts = 0;
}

export type NonPuzzleDayReason = {
  isPuzzleDay: boolean;
  reason?: 'holiday' | 'blackout';
  holiday?: string;
  blackoutReason?: string;
};

export function checkPuzzleDay(
  dateKey: string,
  blackouts: Map<string, string> = blackoutCache.data ?? new Map(),
): NonPuzzleDayReason {
  const d = parseDateKey(dateKey);
  const year = d.getFullYear();
  const holiday =
    getFederalHolidays(year).get(dateKey) ??
    (d.getMonth() === 0 ? getFederalHolidays(year - 1).get(dateKey) : undefined) ??
    (d.getMonth() === 11 ? getFederalHolidays(year + 1).get(dateKey) : undefined);
  if (holiday) {
    return { isPuzzleDay: false, reason: 'holiday', holiday };
  }

  const blackout = blackouts.get(dateKey);
  if (blackout) {
    return { isPuzzleDay: false, reason: 'blackout', blackoutReason: blackout };
  }

  return { isPuzzleDay: true };
}

export async function checkPuzzleDayWithBlackouts(dateKey: string) {
  return checkPuzzleDay(dateKey, await getBlackoutDates());
}

export function isPuzzleDay(
  dateKey: string,
  blackouts: Map<string, string> = blackoutCache.data ?? new Map(),
): boolean {
  return checkPuzzleDay(dateKey, blackouts).isPuzzleDay;
}

export async function isPuzzleDayWithBlackouts(dateKey: string) {
  return isPuzzleDay(dateKey, await getBlackoutDates());
}

const EPOCH = new Date(2026, 3, 9);

export function getPuzzleDayIndex(
  dateKey: string,
  blackouts: Map<string, string> = blackoutCache.data ?? new Map(),
): number {
  const target = parseDateKey(dateKey);
  target.setHours(0, 0, 0, 0);

  if (!isPuzzleDay(dateKey, blackouts)) return -1;

  let puzzleDays = 0;
  const cursor = new Date(EPOCH);
  cursor.setHours(0, 0, 0, 0);

  while (cursor < target) {
    const cursorKey = formatDateKey(cursor);
    if (isPuzzleDay(cursorKey, blackouts)) puzzleDays++;
    cursor.setDate(cursor.getDate() + 1);
  }
  return puzzleDays;
}

export async function getPuzzleDayIndexWithBlackouts(dateKey: string) {
  return getPuzzleDayIndex(dateKey, await getBlackoutDates());
}

export function getRecentPuzzleDays(
  fromDateKey: string,
  count: number,
  includeFrom = true,
  blackouts: Map<string, string> = blackoutCache.data ?? new Map(),
): string[] {
  const dates: string[] = [];
  if (includeFrom && isPuzzleDay(fromDateKey, blackouts)) {
    dates.push(fromDateKey);
  }

  const cursor = parseDateKey(fromDateKey);
  const maxCalendarDays = 730;
  let walked = 0;
  while (dates.length < count && walked < maxCalendarDays) {
    cursor.setDate(cursor.getDate() - 1);
    walked++;
    const key = formatDateKey(cursor);
    if (isPuzzleDay(key, blackouts)) {
      dates.push(key);
    }
  }
  return dates;
}

export async function getRecentPuzzleDaysWithBlackouts(
  fromDateKey: string,
  count: number,
  includeFrom = true,
) {
  return getRecentPuzzleDays(
    fromDateKey,
    count,
    includeFrom,
    await getBlackoutDates(),
  );
}
