/* Derby's target: where it is at any moment, a pure function of the seed.

   The target glides through seeded waypoints on a Hermite curve, with a
   small wobble on top. Early in the race the waypoints are far apart in
   time and close in space and the curve eases into each one; as the race
   goes on they come quicker, the jumps grow and the curve flows straight
   through. It sits still in the middle until the gate opens.

   Only + - * / and Math.floor are used, so the server, every phone and the
   verifier put the target in the same place to the last bit. */

import { derbyLaneSeed, derbyRng } from './rng';
import {
  DERBY_COUNTDOWN_MS,
  DERBY_FIELD_X,
  DERBY_FIELD_Y,
  DERBY_MAX_TICKS,
  DERBY_RACE_MAX_MS,
  DERBY_TARGET_R,
  DERBY_TICK_MS,
} from './rules';

/** How far in the race (ms) the target reaches its hardest. */
export const DERBY_TARGET_RAMP_MS = 40_000;

/** Waypoint spacing (ms) at the gate and at the hardest. */
const GAP_START = 1_500;
const GAP_END = 850;
/** Jump between waypoints (field units) at the gate and at the hardest. */
const JUMP_START = 0.3;
const JUMP_END = 0.62;
/** How hard the curve flows through a waypoint: 0.45 eases in, 1 flows. */
const FLOW_START = 0.45;
const FLOW_END = 1;
/** The wobble on top (field units). */
const WOBBLE_START = 0.012;
const WOBBLE_END = 0.032;

/** The target's middle stays this far inside the field's edge. */
export const DERBY_TARGET_BOUND_X = DERBY_FIELD_X - DERBY_TARGET_R - 0.04;
export const DERBY_TARGET_BOUND_Y = DERBY_FIELD_Y - DERBY_TARGET_R - 0.04;

export type DerbyTargetPath = {
  times: Float64Array;
  xs: Float64Array;
  ys: Float64Array;
  flow: Float64Array;
  /** The target at the start of every tick, x then y. */
  ticks: Float64Array;
};

const ramp = (t: number) => (t <= 0 ? 0 : t >= DERBY_TARGET_RAMP_MS ? 1 : t / DERBY_TARGET_RAMP_MS);

/** Reflect a coordinate back inside [-b, b]. */
function reflect(v: number, b: number): number {
  if (v > b) return b - (v - b);
  if (v < -b) return -b + (-b - v);
  return v;
}

/** Build the path for a race seed. */
export function derbyTargetPath(seed: number): DerbyTargetPath {
  const rng = derbyRng(derbyLaneSeed(seed, 99, 7));
  const times: number[] = [-DERBY_COUNTDOWN_MS - 2_000, 0];
  const xs: number[] = [0, 0];
  const ys: number[] = [0, 0];
  // The second waypoint is the gate: the target leaves the middle from rest.
  const flow: number[] = [FLOW_START, 0];
  let t = 0;
  let x = 0;
  let y = 0;
  while (t < DERBY_RACE_MAX_MS + 4_000) {
    const p = ramp(t);
    const gap = GAP_START + (GAP_END - GAP_START) * p;
    // The first move comes a little sooner, so the gate opens on motion.
    t += times.length === 2 ? 700 : gap * (0.85 + 0.3 * rng());
    const q = ramp(t);
    const jump = (JUMP_START + (JUMP_END - JUMP_START) * q) * (0.75 + 0.5 * rng());
    // A direction: a point in the unit disc, away from the middle.
    let dx = 0;
    let dy = 0;
    let r2 = 0;
    for (let k = 0; k < 32; k += 1) {
      dx = rng() * 2 - 1;
      dy = rng() * 2 - 1;
      r2 = dx * dx + dy * dy;
      if (r2 <= 1 && r2 >= 0.04) break;
    }
    const r = Math.sqrt(r2 > 0 ? r2 : 1);
    // The field is wider than tall: lean the moves sideways.
    x = reflect(x + (dx / r) * jump, DERBY_TARGET_BOUND_X);
    y = reflect(y + ((dy / r) * jump) * 0.7, DERBY_TARGET_BOUND_Y);
    times.push(t);
    xs.push(x);
    ys.push(y);
    flow.push(FLOW_START + (FLOW_END - FLOW_START) * q);
  }
  const path: DerbyTargetPath = {
    times: Float64Array.from(times),
    xs: Float64Array.from(xs),
    ys: Float64Array.from(ys),
    flow: Float64Array.from(flow),
    ticks: new Float64Array(DERBY_MAX_TICKS * 2),
  };
  const out = { x: 0, y: 0 };
  let hint = 0;
  for (let k = 0; k < DERBY_MAX_TICKS; k += 1) {
    hint = derbyTargetAt(path, k * DERBY_TICK_MS, out, hint);
    path.ticks[k * 2] = out.x;
    path.ticks[k * 2 + 1] = out.y;
  }
  return path;
}

/** A smooth wave, period 1, from -1 to 1: two parabolas (no trig). */
function wave(u: number): number {
  const f = u - Math.floor(u);
  if (f < 0.5) return 8 * f * (1 - 2 * f);
  const g = f - 0.5;
  return -8 * g * (1 - 2 * g);
}

/**
 * The target's middle at race time `t` (ms after the gate) into `out`.
 * `hint` is a segment index to start the search from (the last return
 * value, for a clock that moves forward); returns the segment used.
 */
export function derbyTargetAt(path: DerbyTargetPath, t: number, out: { x: number; y: number }, hint = 0): number {
  const { times, xs, ys, flow } = path;
  const last = times.length - 2;
  let i = Math.max(0, Math.min(last, hint | 0));
  while (i > 0 && t < times[i]!) i -= 1;
  while (i < last && t >= times[i + 1]!) i += 1;
  const t0 = times[i]!;
  const t1 = times[i + 1]!;
  const span = t1 - t0;
  let u = span > 0 ? (t - t0) / span : 0;
  if (u < 0) u = 0;
  if (u > 1) u = 1;
  const ip = i > 0 ? i - 1 : i;
  const in2 = i + 2 <= times.length - 1 ? i + 2 : i + 1;
  // Hermite tangents, scaled to this segment's length in time.
  const k0 = (flow[i]! * span) / (t1 - times[ip]! || 1);
  const k1 = (flow[i + 1]! * span) / (times[in2]! - t0 || 1);
  const m0x = (xs[i + 1]! - xs[ip]!) * k0;
  const m0y = (ys[i + 1]! - ys[ip]!) * k0;
  const m1x = (xs[in2]! - xs[i]!) * k1;
  const m1y = (ys[in2]! - ys[i]!) * k1;
  const u2 = u * u;
  const u3 = u2 * u;
  const h00 = 2 * u3 - 3 * u2 + 1;
  const h10 = u3 - 2 * u2 + u;
  const h01 = -2 * u3 + 3 * u2;
  const h11 = u3 - u2;
  let x = h00 * xs[i]! + h10 * m0x + h01 * xs[i + 1]! + h11 * m1x;
  let y = h00 * ys[i]! + h10 * m0y + h01 * ys[i + 1]! + h11 * m1y;
  if (t > 0) {
    const p = ramp(t);
    // The wobble fades in over the first second.
    const amp = (WOBBLE_START + (WOBBLE_END - WOBBLE_START) * p) * (t < 1_000 ? t / 1_000 : 1);
    x += amp * wave(t / 1_700);
    y += amp * 0.8 * wave(t / 1_130 + 0.25);
  }
  const bx = DERBY_TARGET_BOUND_X;
  const by = DERBY_TARGET_BOUND_Y;
  out.x = x > bx ? bx : x < -bx ? -bx : x;
  out.y = y > by ? by : y < -by ? -by : y;
  return i;
}
