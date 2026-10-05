/* Derby's bots: a pure function of the race seed and the lane.

   A bot is a hand chasing the target. Each tick it looks at where the
   target was a reaction time ago, leads it by how fast it was moving, adds
   a slow wandering error, and moves its aim part of the way there. Now and
   then it lets go of the trigger for a moment. Every phone and the server
   draw the same samples from the seed with + - * / only, and the speed
   comes from those samples exactly as it does for a person.

   Skills are tuned by scripts/sim-derby.ts so that a good bot runs a race
   in about the time a good player does (DERBY.md, "Bots"). */

import { derbyLaneSeed, derbyNoise, derbyRng } from './rng';
import {
  DERBY_AIM_MAX_STEP,
  DERBY_AIM_SCALE,
  DERBY_FIELD_X,
  DERBY_FIELD_Y,
  DERBY_MAX_TICKS,
  DERBY_TICK_MS,
} from './rules';
import type { DerbyTargetPath } from './target';

export type DerbyBotSkill = {
  name: 'first go' | 'casual' | 'good' | 'sharp';
  /** Reaction: the bot chases where the target was this long ago (ms). */
  lag: number;
  /** How far ahead it leads the target's motion (ms). */
  lead: number;
  /** Share of the way to its goal the aim moves each tick. */
  gain: number;
  /** The wandering error's size (field units) and how slowly it turns. */
  sigma: number;
  rho: number;
  /** Lets go of the trigger this often (a second), for this long (ms). */
  lapses: number;
  lapseMs: number;
};

export const DERBY_BOT_SKILLS: readonly DerbyBotSkill[] = [
  { name: 'first go', lag: 300, lead: 0, gain: 0.16, sigma: 0.15, rho: 0.975, lapses: 0.3, lapseMs: 700 },
  { name: 'casual', lag: 240, lead: 80, gain: 0.22, sigma: 0.11, rho: 0.975, lapses: 0.15, lapseMs: 550 },
  { name: 'good', lag: 190, lead: 150, gain: 0.3, sigma: 0.075, rho: 0.97, lapses: 0.06, lapseMs: 400 },
  { name: 'sharp', lag: 160, lead: 190, gain: 0.38, sigma: 0.055, rho: 0.965, lapses: 0.025, lapseMs: 300 },
];

/** Which skill a bot lane gets: a field of mixed bots, fixed by the seed. */
export function derbyBotSkillFor(seed: number, lane: number): number {
  const u = derbyRng(derbyLaneSeed(seed, lane, 1))();
  // 15% first go, 35% casual, 35% good, 15% sharp.
  return u < 0.15 ? 0 : u < 0.5 ? 1 : u < 0.85 ? 2 : 3;
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/** The target at race time t from the path's per-tick table (between ticks
 *  the earlier tick; before the gate the first). */
function targetAtTick(path: DerbyTargetPath, t: number, axis: 0 | 1): number {
  let k = Math.floor(t / DERBY_TICK_MS);
  if (k < 0) k = 0;
  if (k >= DERBY_MAX_TICKS) k = DERBY_MAX_TICKS - 1;
  return path.ticks[k * 2 + axis]!;
}

/**
 * Every sample a bot makes in a race, flat [x, y, squirt] integers per tick
 * from the gate, the same shape a phone sends.
 */
export function derbyBotSamples(seed: number, lane: number, skillIndex: number, path: DerbyTargetPath): Int32Array {
  const skill = DERBY_BOT_SKILLS[Math.min(DERBY_BOT_SKILLS.length - 1, Math.max(0, skillIndex | 0))]!;
  const rng = derbyRng(derbyLaneSeed(seed, lane, 2));
  const out = new Int32Array(DERBY_MAX_TICKS * 3);
  const kick = skill.sigma * Math.sqrt(1 - skill.rho * skill.rho);
  // Off the gate after a reaction of 250 to 750 ms; the aim starts near
  // the middle, where the target sits for the countdown.
  const startMs = 250 + Math.floor(rng() * 500);
  let ax = (rng() * 2 - 1) * 0.15;
  let ay = (rng() * 2 - 1) * 0.1;
  let ex = derbyNoise(rng) * skill.sigma;
  let ey = derbyNoise(rng) * skill.sigma * 0.8;
  let lapseUntil = -1;
  const lapseChance = (skill.lapses * DERBY_TICK_MS) / 1000;
  const step = DERBY_AIM_MAX_STEP * 0.98;
  for (let k = 0; k < DERBY_MAX_TICKS; k += 1) {
    const t = k * DERBY_TICK_MS;
    const seen = t - skill.lag;
    const tx = targetAtTick(path, seen, 0);
    const ty = targetAtTick(path, seen, 1);
    // The motion it saw over the last 100 ms, led forward.
    const vx = (tx - targetAtTick(path, seen - 100, 0)) / 100;
    const vy = (ty - targetAtTick(path, seen - 100, 1)) / 100;
    ex = ex * skill.rho + kick * derbyNoise(rng);
    ey = ey * skill.rho + kick * 0.8 * derbyNoise(rng);
    const gx = tx + vx * skill.lead + ex;
    const gy = ty + vy * skill.lead + ey;
    let mx = (gx - ax) * skill.gain;
    let my = (gy - ay) * skill.gain;
    const m2 = mx * mx + my * my;
    if (m2 > step * step) {
      const m = Math.sqrt(m2);
      mx = (mx / m) * step;
      my = (my / m) * step;
    }
    ax = clamp(ax + mx, -DERBY_FIELD_X, DERBY_FIELD_X);
    ay = clamp(ay + my, -DERBY_FIELD_Y, DERBY_FIELD_Y);
    if (lapseUntil < t && rng() < lapseChance) lapseUntil = t + skill.lapseMs * (0.5 + rng());
    const squirt = t >= startMs && t >= lapseUntil ? 1 : 0;
    out[k * 3] = Math.round(ax * DERBY_AIM_SCALE);
    out[k * 3 + 1] = Math.round(ay * DERBY_AIM_SCALE);
    out[k * 3 + 2] = squirt;
  }
  return out;
}
