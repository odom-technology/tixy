import { ARCADE_RTP, type ArcadeGameType } from '@/server/arcade/arcade-constants';
import { query } from '@/server/db/client';

import { cached } from './cache';
import { canonicalGameKey, floorMachineKeys, gameRef, splitFloor } from './games';
import { ensureRollups } from './rollup';
import type { MachineRow, MachinesMetrics } from './types';
import { buildWindow, dayBoundsMs, hasBaseline, num, parseWindow, windowDays } from './window';

/** The return each machine pays in theory, for machines whose ARCADE_RTP is
    1.0 because the house edge is baked into the rules or the table rather
    than applied as a multiplier. Anything not listed uses ARCADE_RTP. */
export const MACHINE_THEORETICAL_RTP: Readonly<Record<string, number>> = {
  // Dealer stands on soft 17, blackjack pays 3:2, basic strategy. Approximate.
  'arcade-blackjack': 0.995,
  // 8/5 jacks or better, optimal strategy (video-poker.ts says about 97.3%).
  'arcade-video-poker': 0.973,
  // One zero, 37 pockets, every bet pays 36/37 in expectation.
  'arcade-roulette': 36 / 37,
  // Each wheel layout sums to 0.99 (prize-wheel.ts).
  'arcade-prize-wheel': 0.99,
  // Each card's value is pinned so the three draws compound to 0.99 (fortune-teller.ts).
  'arcade-fortune-teller': 0.99,
  // The seven patterns' multipliers sum to 0.99 by enumeration (gem-roll.ts).
  'arcade-gem-roll': 0.99,
  // Banker bet with the 5% commission: a 1.06% edge (baccarat.ts).
  'arcade-baccarat': 0.9894,
  // Every scratch tier is solved to SCRATCH_TARGET_EV = 0.96 (scratch.ts).
  'arcade-scratch': 0.96,
};

/** The RTP a machine is meant to pay. */
export function configuredRtp(key: string): number {
  const base = (ARCADE_RTP as Record<string, number | undefined>)[key as ArcadeGameType];
  if (base === 1 && MACHINE_THEORETICAL_RTP[key] !== undefined) return MACHINE_THEORETICAL_RTP[key];
  return base ?? MACHINE_THEORETICAL_RTP[key] ?? 0.97;
}

/**
 * z for a machine over some rounds. With k the configured RTP, n rounds and
 * S = sum(p - k w) over the rounds, the variance per round is
 * (sum_p2 - 2 k sum_wp + k^2 sum_w2) / n - (S / n)^2, and z = S / sqrt(var * n).
 * Null under 30 rounds or when the variance is not positive. |z| above 3 is
 * worth a look.
 */
export function machineZ(input: {
  rounds: number;
  wagered: number;
  paid: number;
  sumW2: number;
  sumP2: number;
  sumWP: number;
  rtp: number;
}): number | null {
  const { rounds: n, wagered, paid, sumW2, sumP2, sumWP, rtp: k } = input;
  if (n < 30) return null;
  const s = paid - k * wagered;
  const variance = (sumP2 - 2 * k * sumWP + k * k * sumW2) / n - (s / n) ** 2;
  if (!(variance > 1e-9)) return null;
  return s / Math.sqrt(variance * n);
}

/**
 * Machines definitions, from admin_machine_days (arcade_round_history per day).
 *
 * rounds, wagered, paid: sums over the window. actualRtp: paid / wagered, null
 *   when nothing was wagered. houseNet: wagered - paid. players: distinct players
 *   in admin_play_days for the machine. biggestWin: the largest payout minus
 *   wager in one round (never below 0). previousRounds: rounds over the previous
 *   window, null without a baseline.
 * configuredRtp: ARCADE_RTP, except machines whose edge is baked in (value 1.0),
 *   which use MACHINE_THEORETICAL_RTP.
 * z: see machineZ.
 * daily: wagered and paid per day, dense.
 * biggestWins: the 10 rounds with the largest payout minus wager in the window,
 *   straight from arcade_round_history (read through created_at), with the
 *   username stored on the row.
 * Floor machines are listed even with no rounds.
 */
async function load(daysInput: number): Promise<MachinesMetrics> {
  await ensureRollups();
  const days = parseWindow(daysInput);
  const window = await buildWindow(days);
  const baseline = await hasBaseline(window);
  const list = windowDays(window);
  const cur = dayBoundsMs(window.from, window.to);

  const [sums, previous, players, perDay, wins] = await Promise.all([
    query<Record<string, string>>(
      `SELECT game_key, SUM(rounds) AS rounds, SUM(wagered) AS wagered, SUM(paid) AS paid,
              SUM(sum_w2) AS sum_w2, SUM(sum_p2) AS sum_p2, SUM(sum_wp) AS sum_wp,
              MAX(biggest_win) AS biggest_win
       FROM admin_machine_days WHERE day >= $1::date AND day <= $2::date GROUP BY game_key`,
      [window.from, window.to],
    ),
    query<{ game_key: string; rounds: string }>(
      `SELECT game_key, SUM(rounds) AS rounds FROM admin_machine_days
       WHERE day >= $1::date AND day <= $2::date GROUP BY game_key`,
      [window.previousFrom, window.previousTo],
    ),
    query<{ game_key: string; players: string }>(
      `SELECT game_key, COUNT(DISTINCT user_id) AS players FROM admin_play_days
       WHERE day >= $1::date AND day <= $2::date AND game_key IN (
         SELECT DISTINCT game_key FROM admin_machine_days WHERE day >= $1::date AND day <= $2::date)
       GROUP BY game_key`,
      [window.from, window.to],
    ),
    query<{ day: string; wagered: string; paid: string }>(
      `SELECT day::text AS day, SUM(wagered) AS wagered, SUM(paid) AS paid FROM admin_machine_days
       WHERE day >= $1::date AND day <= $2::date GROUP BY day`,
      [window.from, window.to],
    ),
    query<{
      id: string;
      game_type: string;
      user_id: string;
      user_name: string;
      wager_amount: number;
      payout_amount: number;
      multiplier: number;
      created_at: string;
    }>(
      `SELECT id, game_type, user_id, user_name, wager_amount, payout_amount, multiplier, created_at
       FROM arcade_round_history
       WHERE created_at >= $1 AND created_at < $2 AND payout_amount > wager_amount
       ORDER BY payout_amount - wager_amount DESC, created_at DESC
       LIMIT 10`,
      [cur.startMs, cur.endMs],
    ),
  ]);

  const rowFor = (key: string): MachineRow => {
    const row = sums.rows.find((r) => r.game_key === key);
    const rounds = num(row?.rounds);
    const wagered = num(row?.wagered);
    const paid = num(row?.paid);
    const rtp = configuredRtp(key);
    return {
      game: gameRef(key),
      rounds,
      players: num(players.rows.find((r) => r.game_key === key)?.players),
      wagered,
      paid,
      actualRtp: wagered > 0 ? paid / wagered : null,
      configuredRtp: rtp,
      z: machineZ({
        rounds,
        wagered,
        paid,
        sumW2: num(row?.sum_w2),
        sumP2: num(row?.sum_p2),
        sumWP: num(row?.sum_wp),
        rtp,
      }),
      houseNet: wagered - paid,
      biggestWin: Math.max(0, num(row?.biggest_win)),
      previousRounds: baseline ? num(previous.rows.find((r) => r.game_key === key)?.rounds) : null,
    };
  };

  const keys = new Set<string>(floorMachineKeys());
  for (const row of sums.rows) keys.add(row.game_key);
  const rows = [...keys].map(rowFor);
  const { floor, offFloor } = splitFloor(rows, (r) => r.game.key, (r) => r.rounds);

  const total = rows.reduce(
    (acc, r) => ({ rounds: acc.rounds + r.rounds, wagered: acc.wagered + r.wagered, paid: acc.paid + r.paid }),
    { rounds: 0, wagered: 0, paid: 0 },
  );
  const dayMap = new Map(perDay.rows.map((r) => [r.day, r]));

  return {
    window,
    floor,
    offFloor,
    totals: { ...total, actualRtp: total.wagered > 0 ? total.paid / total.wagered : null },
    daily: list.map((day) => ({
      day,
      wagered: num(dayMap.get(day)?.wagered),
      paid: num(dayMap.get(day)?.paid),
    })),
    biggestWins: wins.rows.map((r) => ({
      id: r.id,
      game: gameRef(canonicalGameKey(r.game_type)),
      userId: r.user_id,
      username: r.user_name,
      wager: r.wager_amount,
      payout: r.payout_amount,
      multiplier: r.multiplier,
      at: num(r.created_at),
    })),
  };
}

export function getMachinesMetrics(days: number): Promise<MachinesMetrics> {
  const window = parseWindow(days);
  return cached('machines', window, () => load(window));
}
