import { query } from '@/server/db/client';

import { cached } from './cache';
import { ensureRollups } from './rollup';
import { dailyActive, distinctPlayers, firstDayCounts } from './shared';
import type { PlayersMetrics } from './types';
import {
  addDays,
  buildWindow,
  dayBoundsMs,
  dayRange,
  densify,
  hasBaseline,
  kpi,
  mondayOf,
  num,
  parseWindow,
  readRollupSpan,
  windowDays,
} from './window';

const COHORT_WEEKS = 12;
const AFTER_WEEKS = 8;

/**
 * Players definitions.
 *
 * dau: the mean of daily active players over the window's complete days (today
 *   is partial, so it is left out). previous is the same over the previous
 *   window. wau, mau: distinct players over the last 7 / 30 days ending today,
 *   previous the 7 / 30 days before those. stickiness: DAU / MAU on yesterday,
 *   MAU being the 30 days ending yesterday.
 * daily: active (distinct players, accounts and guests), newPlayers (first day
 *   in admin_play_days is that day), returning (active - new), accounts and
 *   guests (user_id 'guest:%').
 * signups: arcade_accounts created per UTC day, all of them.
 * cohorts: accounts by signup week (Monday, UTC), the last 12 weeks, newest
 *   first, with every week present. dN is the share of the cohort active on
 *   exactly signup day + N, null unless week Monday + 6 + N is before today (the
 *   day has happened for every member) and the day is inside the rolled history.
 *   weeks[N-1] is the share active at least once in signup week + N (N = 1..8),
 *   null while that week is not over. An empty cohort has size 0 and nulls.
 * retention: over accounts that signed up in the window, dN counts the ones
 *   whose signup day + N is on or before yesterday (eligible) and those active
 *   on exactly that day (retained).
 * Activity is admin_play_days, so only days from the first rolled day count.
 */
async function load(daysInput: number): Promise<PlayersMetrics> {
  await ensureRollups();
  const days = parseWindow(daysInput);
  const window = await buildWindow(days);
  const baseline = await hasBaseline(window);
  const span = await readRollupSpan();
  const firstRolled = span.first ?? window.to;
  const today = window.to;
  const yesterday = addDays(today, -1);
  const list = windowDays(window);
  const cur = dayBoundsMs(window.from, window.to);

  const cohortFirstWeek = addDays(mondayOf(today), -7 * (COHORT_WEEKS - 1));
  const cohortBounds = dayBoundsMs(cohortFirstWeek, today);

  const [active, firsts, wau, wauPrev, mau, mauPrev, mauYesterday, signups, cohortRows, retentionRows] =
    await Promise.all([
      dailyActive(window.previousFrom, window.to),
      firstDayCounts(window.from, window.to),
      distinctPlayers(addDays(today, -6), today),
      distinctPlayers(addDays(today, -13), addDays(today, -7)),
      distinctPlayers(addDays(today, -29), today),
      distinctPlayers(addDays(today, -59), addDays(today, -30)),
      distinctPlayers(addDays(yesterday, -29), yesterday),
      query<{ day: string; n: string }>(
        `SELECT (to_timestamp(created_at / 1000.0) AT TIME ZONE 'UTC')::date::text AS day, COUNT(*) AS n
         FROM arcade_accounts WHERE created_at >= $1 AND created_at < $2 GROUP BY 1`,
        [cur.startMs, cur.endMs],
      ),
      query<Record<string, string>>(
        `WITH c AS (
           SELECT id AS user_id, d AS signup_day, date_trunc('week', d)::date AS week
           FROM (
             SELECT id, (to_timestamp(created_at / 1000.0) AT TIME ZONE 'UTC')::date AS d
             FROM arcade_accounts WHERE created_at >= $1 AND created_at < $2
           ) a
         )
         SELECT c.week::text AS week,
                COUNT(DISTINCT c.user_id) AS size,
                COUNT(DISTINCT c.user_id) FILTER (WHERE p.day = c.signup_day + 1) AS d1,
                COUNT(DISTINCT c.user_id) FILTER (WHERE p.day = c.signup_day + 7) AS d7,
                COUNT(DISTINCT c.user_id) FILTER (WHERE p.day = c.signup_day + 30) AS d30,
                ${Array.from(
                  { length: AFTER_WEEKS },
                  (_, i) =>
                    `COUNT(DISTINCT c.user_id) FILTER (WHERE p.day >= c.week + ${7 * (i + 1)} AND p.day < c.week + ${7 * (i + 2)}) AS w${i + 1}`,
                ).join(',\n                ')}
         FROM c
         LEFT JOIN admin_play_days p
           ON p.user_id = c.user_id
          AND p.day >= c.signup_day
          AND p.day < c.week + ${7 * (AFTER_WEEKS + 1)}
          AND p.day <= $3::date
         GROUP BY c.week`,
        [cohortBounds.startMs, cohortBounds.endMs, today],
      ),
      query<Record<string, string>>(
        `WITH c AS (
           SELECT id AS user_id,
                  (to_timestamp(created_at / 1000.0) AT TIME ZONE 'UTC')::date AS signup_day
           FROM arcade_accounts WHERE created_at >= $1 AND created_at < $2
         )
         SELECT
           COUNT(*) FILTER (WHERE n = 1 AND eligible) AS e1, COUNT(*) FILTER (WHERE n = 1 AND hit) AS r1,
           COUNT(*) FILTER (WHERE n = 7 AND eligible) AS e7, COUNT(*) FILTER (WHERE n = 7 AND hit) AS r7,
           COUNT(*) FILTER (WHERE n = 30 AND eligible) AS e30, COUNT(*) FILTER (WHERE n = 30 AND hit) AS r30
         FROM (
           SELECT c.user_id, k.n,
                  (c.signup_day + k.n <= $3::date AND c.signup_day + k.n >= $4::date) AS eligible,
                  (c.signup_day + k.n <= $3::date AND c.signup_day + k.n >= $4::date AND EXISTS (
                     SELECT 1 FROM admin_play_days p
                     WHERE p.user_id = c.user_id AND p.day = c.signup_day + k.n)) AS hit
           FROM c CROSS JOIN (VALUES (1), (7), (30)) AS k(n)
         ) t`,
        [cur.startMs, cur.endMs, yesterday, firstRolled],
      ),
    ]);

  // dau: mean over complete days.
  const completeDays = (from: string, to: string) =>
    dayRange(from, to).filter((day) => day < today);
  const meanDau = (from: string, to: string) => {
    const complete = completeDays(from, to);
    if (complete.length === 0) return 0;
    return complete.reduce((sum, day) => sum + (active.get(day)?.active ?? 0), 0) / complete.length;
  };

  const daily = list.map((day) => {
    const row = active.get(day) ?? { active: 0, accounts: 0, guests: 0 };
    const fresh = Math.min(firsts.get(day) ?? 0, row.active);
    return {
      day,
      active: row.active,
      newPlayers: fresh,
      returning: row.active - fresh,
      accounts: row.accounts,
      guests: row.guests,
    };
  });

  const cohorts = Array.from({ length: COHORT_WEEKS }, (_, i) => {
    const week = addDays(cohortFirstWeek, 7 * (COHORT_WEEKS - 1 - i));
    const row = cohortRows.rows.find((r) => r.week === week);
    const size = num(row?.size);
    const share = (count: unknown, dayAfterWeek: number) => {
      // The day is complete for every member once week + 6 + N is before today,
      // and measured once it is inside the rolled history.
      if (size === 0) return null;
      if (!(addDays(week, 6 + dayAfterWeek) < today)) return null;
      if (addDays(week, dayAfterWeek) < firstRolled) return null;
      return num(count) / size;
    };
    return {
      week,
      size,
      d1: share(row?.d1, 1),
      d7: share(row?.d7, 7),
      d30: share(row?.d30, 30),
      weeks: Array.from({ length: AFTER_WEEKS }, (_, n) => {
        if (size === 0) return null;
        const weekN = n + 1;
        if (!(addDays(week, 7 * weekN + 6) < today)) return null;
        if (addDays(week, 7 * weekN) < firstRolled) return null;
        return num(row?.[`w${weekN}`]) / size;
      }),
    };
  });

  const ret = retentionRows.rows[0] ?? {};
  return {
    window,
    dau: kpi(meanDau(window.from, window.to), meanDau(window.previousFrom, window.previousTo), baseline),
    wau: kpi(wau, wauPrev, baseline),
    mau: kpi(mau, mauPrev, baseline),
    stickiness: mauYesterday > 0 ? (active.get(yesterday)?.active ?? 0) / mauYesterday : null,
    daily,
    signups: densify(list, new Map(signups.rows.map((row) => [row.day, num(row.n)]))),
    cohorts,
    retention: {
      d1: { eligible: num(ret.e1), retained: num(ret.r1) },
      d7: { eligible: num(ret.e7), retained: num(ret.r7) },
      d30: { eligible: num(ret.e30), retained: num(ret.r30) },
    },
  };
}

export function getPlayersMetrics(days: number): Promise<PlayersMetrics> {
  const window = parseWindow(days);
  return cached('players', window, () => load(window));
}

