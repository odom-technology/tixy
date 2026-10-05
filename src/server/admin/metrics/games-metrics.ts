import { query } from '@/server/db/client';

import { cached } from './cache';
import { aliasKeySql, canonicalGameKey, floorGameKeys, gameRef, splitFloor } from './games';
import { ensureRollups } from './rollup';
import type { GameRow, GamesMetrics } from './types';
import { buildWindow, hasBaseline, num, parseWindow, windowDays } from './window';

type Acc = {
  key: string;
  runs: number;
  players: number;
  playMs: number;
  timedRuns: number;
  starts: number;
  finishes: number;
  series: Map<string, number>;
  previousRuns: number;
};

/**
 * Games definitions. One row per game seen in admin_play_days or
 * admin_funnel_days in the window, plus every floor game even with zeros. Keys
 * are merged through the registry, so the funnel's slug '21' and the machine key
 * 'arcade-blackjack' are one row.
 *
 * starts, finishes: browser sessions that sent game_started / game_completed
 *   (product analytics), distinct per day, summed over the days.
 * finishRate: finishes / starts, null with no starts.
 * runs, players, playMs: SUM(runs), distinct players and SUM(play_ms) in
 *   admin_play_days. Runs are finished scored runs, machine rounds and
 *   completed friends matches (one per player).
 * avgRunMs: play_ms / runs over the player-days that recorded time; null when
 *   none did (machines record no time).
 * shareOfRuns, shareOfTime: this game's part of all runs and all time in the
 *   window.
 * runsSeries: runs per day, one value per window day, oldest first.
 * previousRuns: runs over the previous window; null without a baseline.
 * totals.players is distinct over all games, not the sum of the rows.
 */
async function load(daysInput: number): Promise<GamesMetrics> {
  await ensureRollups();
  const days = parseWindow(daysInput);
  const window = await buildWindow(days);
  const baseline = await hasBaseline(window);
  const list = windowDays(window);
  const keyed = aliasKeySql('game_key');

  const [play, perDay, previous, funnel, totals] = await Promise.all([
    query<{ game_key: string; runs: string; players: string; play_ms: string; timed_runs: string }>(
      `SELECT ${keyed} AS game_key, SUM(runs) AS runs, COUNT(DISTINCT user_id) AS players,
              SUM(play_ms) AS play_ms, COALESCE(SUM(runs) FILTER (WHERE play_ms > 0), 0) AS timed_runs
       FROM admin_play_days WHERE day >= $1::date AND day <= $2::date GROUP BY 1`,
      [window.from, window.to],
    ),
    query<{ game_key: string; day: string; runs: string }>(
      `SELECT ${keyed} AS game_key, day::text AS day, SUM(runs) AS runs
       FROM admin_play_days WHERE day >= $1::date AND day <= $2::date GROUP BY 1, 2`,
      [window.from, window.to],
    ),
    query<{ game_key: string; runs: string }>(
      `SELECT ${keyed} AS game_key, SUM(runs) AS runs
       FROM admin_play_days WHERE day >= $1::date AND day <= $2::date GROUP BY 1`,
      [window.previousFrom, window.previousTo],
    ),
    query<{ game_key: string; starts: string; finishes: string }>(
      `SELECT game_key, SUM(starts) AS starts, SUM(finishes) AS finishes
       FROM admin_funnel_days WHERE day >= $1::date AND day <= $2::date GROUP BY game_key`,
      [window.from, window.to],
    ),
    query<{ players: string }>(
      `SELECT COUNT(DISTINCT user_id) AS players FROM admin_play_days WHERE day >= $1::date AND day <= $2::date`,
      [window.from, window.to],
    ),
  ]);

  const acc = new Map<string, Acc>();
  const slot = (rawKey: string) => {
    const key = canonicalGameKey(rawKey);
    let row = acc.get(key);
    if (!row) {
      row = {
        key,
        runs: 0,
        players: 0,
        playMs: 0,
        timedRuns: 0,
        starts: 0,
        finishes: 0,
        series: new Map(),
        previousRuns: 0,
      };
      acc.set(key, row);
    }
    return row;
  };
  for (const key of floorGameKeys()) slot(key);
  for (const row of play.rows) {
    const entry = slot(row.game_key);
    entry.runs += num(row.runs);
    entry.players += num(row.players);
    entry.playMs += num(row.play_ms);
    entry.timedRuns += num(row.timed_runs);
  }
  for (const row of perDay.rows) {
    const entry = slot(row.game_key);
    entry.series.set(row.day, (entry.series.get(row.day) ?? 0) + num(row.runs));
  }
  for (const row of previous.rows) slot(row.game_key).previousRuns += num(row.runs);
  for (const row of funnel.rows) {
    const entry = slot(row.game_key);
    entry.starts += num(row.starts);
    entry.finishes += num(row.finishes);
  }

  let totalRuns = 0;
  let totalMs = 0;
  let totalStarts = 0;
  let totalFinishes = 0;
  for (const entry of acc.values()) {
    totalRuns += entry.runs;
    totalMs += entry.playMs;
    totalStarts += entry.starts;
    totalFinishes += entry.finishes;
  }

  const rows: GameRow[] = [...acc.values()].map((entry) => ({
    game: gameRef(entry.key),
    starts: entry.starts,
    finishes: entry.finishes,
    finishRate: entry.starts > 0 ? entry.finishes / entry.starts : null,
    runs: entry.runs,
    players: entry.players,
    playMs: entry.playMs,
    avgRunMs: entry.timedRuns > 0 ? entry.playMs / entry.timedRuns : null,
    shareOfRuns: totalRuns > 0 ? entry.runs / totalRuns : 0,
    shareOfTime: totalMs > 0 ? entry.playMs / totalMs : 0,
    runsSeries: list.map((day) => entry.series.get(day) ?? 0),
    previousRuns: baseline ? entry.previousRuns : null,
  }));

  const { floor, offFloor } = splitFloor(
    rows,
    (row) => row.game.key,
    (row) => row.runs,
  );

  return {
    window,
    floor,
    offFloor,
    totals: {
      runs: totalRuns,
      players: num(totals.rows[0]?.players),
      playMs: totalMs,
      starts: totalStarts,
      finishes: totalFinishes,
    },
  };
}

export function getGamesMetrics(days: number): Promise<GamesMetrics> {
  const window = parseWindow(days);
  return cached('games', window, () => load(window));
}
