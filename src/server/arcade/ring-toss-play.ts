/**
 * Ring toss: the reward divisor and the play check. Pure; the score route and
 * scripts/verify-ring-toss-replay.ts read it. The physics is in
 * ring-toss-engine.ts.
 *
 * The play check. The replay proves a run is possible, not that a hand threw
 * it: a program that sends the ideal flick for every ring rings every time.
 * A person's ringers spread around the ideal flick: their power by several
 * hundredths and their aim by millimetres. Over a player's last 50 rounds,
 * if both spreads are tighter than any simulated hand gets (scripts/
 * sim-ring-toss.ts: a sharp hand spreads 0.034 in power and 10 mm in aim
 * among its ringers), the run is flagged. A flag is logged, and repeated
 * flags escalate through the shared anti-cheat. What it can't catch: a
 * program that adds a hand's noise of its own. The daily cap is the
 * backstop.
 */

import { AIM_RANGE, BOTTLES, type RingOutcome, type RingThrow } from './ring-toss-engine';

/** Tickets = 75 x (1 - exp(-(score / 950)^1.15)), through the wallet. */
export const RING_REWARD_DIVISOR = 950;

/** The power that rings each row most often with a steady hand, front to
 *  back. scripts/sim-ring-toss.ts finds it by a sweep; the verifier checks
 *  this matches. */
export const RING_BEST_POWER: readonly number[] = [0.145, 0.35, 0.575, 0.79];

/** Rounds the play check reads. */
export const RING_PLAY_WINDOW = 50;
/** Ringers needed before the check decides anything. */
export const RING_PLAY_MIN_RINGERS = 40;
/** Flag when the power spread is under this AND the aim spread is under RING_PLAY_MIN_AIM. */
export const RING_PLAY_MIN_POWER = 0.018;
export const RING_PLAY_MIN_AIM = 0.005;

/** Each ringer's distance from the ideal flick for its bottle: [power, metres]. */
export function ringOffsets(throws: readonly RingThrow[], outcomes: readonly RingOutcome[]): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let i = 0; i < outcomes.length && i < throws.length; i += 1) {
    const o = outcomes[i]!;
    if (o.kind !== 'ringer') continue;
    const b = BOTTLES[o.bottle]!;
    const t = throws[i]!;
    const dp = Math.round((t.p - RING_BEST_POWER[b.row]!) * 10000) / 10000;
    const dx = Math.round((t.a * AIM_RANGE - b.x) * 100000) / 100000;
    out.push([dp, dx]);
  }
  return out;
}

export type RingPlayCheck = {
  flag: string | null;
  ringers: number;
  sdPower: number | null;
  sdAim: number | null;
};

function sd(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(values.reduce((a, v) => a + (v - mean) * (v - mean), 0) / (values.length - 1));
}

/** The spread check over a player's recent rounds (this one included). */
export function ringPlayCheck(rounds: ReadonlyArray<ReadonlyArray<readonly [number, number]>>): RingPlayCheck {
  const all = rounds.slice(-RING_PLAY_WINDOW).flat();
  if (all.length < RING_PLAY_MIN_RINGERS) return { flag: null, ringers: all.length, sdPower: null, sdAim: null };
  const sdPower = sd(all.map((o) => o[0]));
  const sdAim = sd(all.map((o) => o[1]));
  const flag =
    sdPower < RING_PLAY_MIN_POWER && sdAim < RING_PLAY_MIN_AIM
      ? `Ringer spread too tight for a hand (power sd ${sdPower.toFixed(4)}, aim sd ${(sdAim * 1000).toFixed(2)} mm over ${all.length} ringers)`
      : null;
  return { flag, ringers: all.length, sdPower, sdAim };
}
