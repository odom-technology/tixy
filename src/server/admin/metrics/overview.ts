import { query } from '@/server/db/client';

import { cached } from './cache';
import { canonicalGameKey, gameRef } from './games';
import { countOnline } from './live';
import { ensureRollups } from './rollup';
import {
  dailyActive,
  distinctPlayers,
  firstDayCounts,
  ledgerDaily,
  revenueByCurrency,
  sumMinted,
} from './shared';
import type { OverviewMetrics } from './types';
import {
  addDays,
  buildWindow,
  dayBoundsMs,
  densify,
  hasBaseline,
  kpi,
  num,
  parseWindow,
  windowDays,
} from './window';

/**
 * Overview definitions.
 *
 * dauToday, dauYesterday: distinct user_id in admin_play_days for that UTC day,
 *   accounts and guests together. Today is partial.
 * wau, mau: distinct user_id over the 7 / 30 days ending today, whatever the
 *   window. previous is the 7 / 30 days before those.
 * newPlayers: players whose first day in admin_play_days falls in the window;
 *   previous is the same count in the previous window. The first rolled days
 *   overstate it, since everyone looks new then.
 * runs: SUM(runs) in admin_play_days: scored runs, machine rounds and
 *   completed friends matches.
 * ticketsMinted: SUM(amount) over earned-ledger buckets that are faucets
 *   (game_rewards, daily_claim, quests, season, levels, achievements,
 *   monthly_boards, weekly_boards, wager_payouts, admin, refunds, other_in), day rows with
 *   amount > 0. ticketsSpent: the negated SUM over sinks (counter,
 *   wager_stakes, continues, other_out, and admin when a day nets negative),
 *   reported positive.
 * revenue: SUM(amount_total) of ticket_purchases with status 'fulfilled' and
 *   not reversed, created in the window, by currency, in cents.
 * flags: flag and reject rows in admin_trust_days.
 * onlineNow: accounts with presence seen in the last 2 minutes.
 * activeSeries: DAU per day. runsSeries: runs per day. topGames: the 5 games
 *   with the most runs, share of all runs in the window.
 */
async function load(daysInput: number): Promise<OverviewMetrics> {
  await ensureRollups();
  const days = parseWindow(daysInput);
  const window = await buildWindow(days);
  const baseline = await hasBaseline(window);
  const liveBaseline = await hasBaseline(window, 'live');
  const list = windowDays(window);
  const yesterday = addDays(window.to, -1);
  const cur = dayBoundsMs(window.from, window.to);
  const prev = dayBoundsMs(window.previousFrom, window.previousTo);

  const [
    active,
    wau,
    wauPrev,
    mau,
    mauPrev,
    firsts,
    firstsPrev,
    runsRows,
    ledger,
    revenue,
    flagRows,
    online,
    games,
  ] = await Promise.all([
    dailyActive(window.previousFrom, window.to),
    distinctPlayers(addDays(window.to, -6), window.to),
    distinctPlayers(addDays(window.to, -13), addDays(window.to, -7)),
    distinctPlayers(addDays(window.to, -29), window.to),
    distinctPlayers(addDays(window.to, -59), addDays(window.to, -30)),
    firstDayCounts(window.from, window.to),
    firstDayCounts(window.previousFrom, window.previousTo),
    query<{ day: string; runs: string }>(
      `SELECT day::text AS day, SUM(runs) AS runs FROM admin_play_days
       WHERE day >= $1::date AND day <= $2::date GROUP BY day`,
      [window.previousFrom, window.to],
    ),
    ledgerDaily(window.previousFrom, window.to),
    revenueByCurrency(cur.startMs, cur.endMs, prev.startMs),
    query<{ cur: string; prev: string }>(
      `SELECT COALESCE(SUM(n) FILTER (WHERE day >= $2::date), 0) AS cur,
              COALESCE(SUM(n) FILTER (WHERE day < $2::date), 0) AS prev
       FROM admin_trust_days
       WHERE result IN ('flag', 'reject') AND day >= $1::date AND day <= $3::date`,
      [window.previousFrom, window.from, window.to],
    ),
    countOnline(),
    query<{ game_key: string; runs: string; players: string }>(
      `SELECT game_key, SUM(runs) AS runs, COUNT(DISTINCT user_id) AS players
       FROM admin_play_days WHERE day >= $1::date AND day <= $2::date GROUP BY game_key`,
      [window.from, window.to],
    ),
  ]);

  const runsByDay = new Map(runsRows.rows.map((row) => [row.day, num(row.runs)]));
  const sumRuns = (from: string, to: string) => {
    let total = 0;
    for (let day = from; day <= to; day = addDays(day, 1)) total += runsByDay.get(day) ?? 0;
    return total;
  };
  const sumNew = (map: Map<string, number>) => [...map.values()].reduce((a, b) => a + b, 0);
  const now = sumMinted(ledger, window.from, window.to);
  const before = sumMinted(ledger, window.previousFrom, window.previousTo);

  // Merge keys that are the same game, then take the top 5 by runs.
  const merged = new Map<string, { runs: number; players: number }>();
  let totalRuns = 0;
  for (const row of games.rows) {
    const key = canonicalGameKey(row.game_key);
    const entry = merged.get(key) ?? { runs: 0, players: 0 };
    entry.runs += num(row.runs);
    entry.players += num(row.players);
    merged.set(key, entry);
    totalRuns += num(row.runs);
  }
  const topGames = [...merged.entries()]
    .sort((a, b) => b[1].runs - a[1].runs || a[0].localeCompare(b[0]))
    .slice(0, 5)
    .map(([key, entry]) => ({
      game: gameRef(key),
      runs: entry.runs,
      players: entry.players,
      share: totalRuns > 0 ? entry.runs / totalRuns : 0,
    }));

  return {
    window,
    dauToday: active.get(window.to)?.active ?? 0,
    dauYesterday: active.get(yesterday)?.active ?? 0,
    wau: kpi(wau, wauPrev, baseline),
    mau: kpi(mau, mauPrev, baseline),
    newPlayers: kpi(sumNew(firsts), sumNew(firstsPrev), baseline),
    runs: kpi(sumRuns(window.from, window.to), sumRuns(window.previousFrom, window.previousTo), baseline),
    ticketsMinted: kpi(now.minted, before.minted, baseline),
    ticketsSpent: kpi(now.spent, before.spent, baseline),
    revenue: revenue.map((row) => ({
      currency: row.currency,
      cents: kpi(row.cents, row.previous, liveBaseline),
    })),
    flags: kpi(num(flagRows.rows[0]?.cur), num(flagRows.rows[0]?.prev), baseline),
    onlineNow: online,
    activeSeries: densify(list, new Map([...active].map(([day, row]) => [day, row.active]))),
    runsSeries: densify(list, runsByDay),
    topGames,
  };
}

export function getOverviewMetrics(days: number): Promise<OverviewMetrics> {
  const window = parseWindow(days);
  return cached('overview', window, () => load(window));
}
