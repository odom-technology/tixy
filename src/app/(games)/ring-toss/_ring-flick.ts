/* Ring toss input and playback: pure, no three.js, no DOM.

   The flick: the pointer's forward speed over the last 90 ms of the stroke,
   read from event timestamps, sets the power; its slant sets the aim; how
   much it hooks sets the curl; where the stroke started sets the hand. All
   four are straight lines, so the same flick always throws the same ring.
   scripts/verify-ring-toss-replay.ts prints flick against ringer.

   The playback: the shared sim is stepped ahead of the picture, a few
   hundred steps a frame, into a buffer of poses and events, so by the time
   the ring reaches the crate the client knows how its flight ends (the
   ringer's hit-stop lands on the drop, not after it). The picture plays the
   buffer at the fixed step and draws between two steps, so the ring moves the
   same at 30, 60, 120 or 144 Hz and lands where the server's replay lands. */

import {
  AIM_RANGE,
  HAND_Z,
  RING_BODY_ID,
  RING_STEP_MS,
  ringAimDepth,
  ringStep,
  type RingOutcome,
  type RingParams,
  type RingState,
  type RingStepEvent,
} from '@/server/arcade/ring-toss-engine';

/** Forward flick speed (CSS px per ms) at power 0 and power 1. */
export const FLICK_MIN_SPEED = 0.45;
export const FLICK_MAX_SPEED = 2.4;
/** Slower than this at release is not a throw (the ring goes back to the hand). */
export const FLICK_THROW_SPEED = 0.3;
/** A flick this far off straight (sideways over forward) is full aim. */
export const FLICK_FULL_AIM = 0.6;
/** Turning this much (sine of the angle) between the halves of the window is full curl. */
export const FLICK_FULL_CURL = 0.5;
/** Samples older than this before release don't count toward the flick. */
export const FLICK_WINDOW_MS = 90;

export type FlickSample = { x: number; y: number; t: number };

/** Forward and sideways speed over the window (px/ms; up is forward). */
export function flickVelocity(samples: ReadonlyArray<FlickSample>): { forward: number; side: number; first: FlickSample } | null {
  const last = samples[samples.length - 1];
  if (!last) return null;
  let first: FlickSample | undefined;
  for (const s of samples) {
    if (s.t >= last.t - FLICK_WINDOW_MS) {
      first = s;
      break;
    }
  }
  if (!first || last.t - first.t < 8) return null;
  const span = last.t - first.t;
  return { forward: -(last.y - first.y) / span, side: (last.x - first.x) / span, first };
}

/** How much the stroke hooks: the sine of the turn between the window's halves, signed (right hook positive). */
export function flickCurl(samples: ReadonlyArray<FlickSample>): number {
  const last = samples[samples.length - 1];
  if (!last) return 0;
  const inWindow = samples.filter((s) => s.t >= last.t - FLICK_WINDOW_MS - 30);
  if (inWindow.length < 3) return 0;
  const first = inWindow[0]!;
  const midT = (first.t + last.t) / 2;
  let mid = inWindow[0]!;
  for (const s of inWindow) if (Math.abs(s.t - midT) < Math.abs(mid.t - midT)) mid = s;
  const ax = mid.x - first.x;
  const ay = mid.y - first.y;
  const bx = last.x - mid.x;
  const by = last.y - mid.y;
  const la = Math.sqrt(ax * ax + ay * ay);
  const lb = Math.sqrt(bx * bx + by * by);
  if (la < 4 || lb < 4) return 0;
  // Screen y grows down, so a stroke that turns right has a positive cross.
  const cross = (ax * by - ay * bx) / (la * lb);
  return Math.max(-1, Math.min(1, cross / FLICK_FULL_CURL));
}

export function flickPowerShare(forward: number): number {
  return Math.min(1, Math.max(0, (forward - FLICK_MIN_SPEED) / (FLICK_MAX_SPEED - FLICK_MIN_SPEED)));
}

/** Round to 4 places: what is sent is what is simulated. */
const r4 = (v: number) => Math.round(v * 10000) / 10000;

/** Full slant moves the aim this far sideways at the necks (metres), for a
 *  throw of FLICK_AIM_REACH; it grows with the throw, the way an angle does. */
export const FLICK_AIM_SHIFT = 0.11;
export const FLICK_AIM_REACH = 0.55;

/** How far a full slant moves a throw aimed at engine depth z. */
export function flickAimShift(z: number): number {
  return (FLICK_AIM_SHIFT * (z - HAND_Z)) / FLICK_AIM_REACH;
}

/** The flick's slant, -1 to 1 (full at FLICK_FULL_AIM). */
export function flickSlant(forward: number, side: number): number {
  return Math.max(-1, Math.min(1, side / Math.max(forward, FLICK_MIN_SPEED) / FLICK_FULL_AIM));
}

/**
 * A flick to the engine's params. `hand` is where the ring is (-1 to 1);
 * `sightX` is the crate's x under the finger where the flick started, at the
 * depth this power aims at (the scene's line of sight), and the slant adds to it.
 */
export function flickToParams(hand: number, sightX: number, forward: number, side: number, curl: number): RingParams {
  const aimX = sightX + flickSlant(forward, side) * flickAimShift(ringAimDepth(flickPowerShare(forward)));
  return {
    h: r4(Math.max(-1, Math.min(1, hand))),
    p: r4(flickPowerShare(forward)),
    a: r4(Math.max(-1, Math.min(1, aimX / AIM_RANGE))),
    c: r4(Math.max(-1, Math.min(1, curl))),
  };
}

export type RingPose = { x: number; y: number; z: number; qw: number; qx: number; qy: number; qz: number };

export type RingPlayback = {
  /** Step the sim ahead of the picture, at most `budget` steps. True when it has finished. */
  lookahead(budget: number): boolean;
  readonly finished: boolean;
  /** Steps in the whole flight, once finished. */
  readonly totalSteps: number;
  readonly outcome: RingOutcome | null;
  readonly events: readonly RingStepEvent[];
  readonly state: RingState;
  /** Draw the ring at `ms` of effect time since release (clamped to what is stepped). */
  sample(ms: number, out: RingPose): void;
  /** Events between two effect times (ms), in order. */
  eventsBetween(fromMs: number, toMs: number): RingStepEvent[];
};

/** Pose buffer of one throw, filled ahead of the picture. */
export function createRingPlayback(state: RingState): RingPlayback {
  // Room for the longest flight.
  const cap = 1600;
  const buf = new Float64Array((cap + 1) * 7);
  const write = (i: number) => {
    const o = i * 7;
    buf[o] = state.x;
    buf[o + 1] = state.y;
    buf[o + 2] = state.z;
    buf[o + 3] = state.qw;
    buf[o + 4] = state.qx;
    buf[o + 5] = state.qy;
    buf[o + 6] = state.qz;
  };
  write(0);
  const events: RingStepEvent[] = [];
  let stepped = 0;
  return {
    lookahead(budget) {
      let n = 0;
      while (!state.done && n < budget && stepped < cap) {
        ringStep(state, events);
        stepped += 1;
        write(stepped);
        n += 1;
      }
      return state.done;
    },
    get finished() {
      return state.done;
    },
    get totalSteps() {
      return stepped;
    },
    get outcome() {
      return state.outcome;
    },
    events,
    state,
    sample(ms, out) {
      const f = Math.max(0, ms / RING_STEP_MS);
      let i = Math.floor(f);
      let k = f - i;
      if (i >= stepped) {
        i = stepped;
        k = 0;
      }
      const a = i * 7;
      const b = Math.min(i + 1, stepped) * 7;
      out.x = buf[a]! + (buf[b]! - buf[a]!) * k;
      out.y = buf[a + 1]! + (buf[b + 1]! - buf[a + 1]!) * k;
      out.z = buf[a + 2]! + (buf[b + 2]! - buf[a + 2]!) * k;
      // nlerp, on the short way round.
      let bw = buf[b + 3]!;
      let bx = buf[b + 4]!;
      let by = buf[b + 5]!;
      let bz = buf[b + 6]!;
      const aw = buf[a + 3]!;
      const ax = buf[a + 4]!;
      const ay = buf[a + 5]!;
      const az = buf[a + 6]!;
      if (aw * bw + ax * bx + ay * by + az * bz < 0) {
        bw = -bw;
        bx = -bx;
        by = -by;
        bz = -bz;
      }
      let w = aw + (bw - aw) * k;
      let x = ax + (bx - ax) * k;
      let y = ay + (by - ay) * k;
      let z = az + (bz - az) * k;
      const inv = 1 / Math.sqrt(w * w + x * x + y * y + z * z);
      w *= inv;
      x *= inv;
      y *= inv;
      z *= inv;
      out.qw = w;
      out.qx = x;
      out.qy = y;
      out.qz = z;
    },
    eventsBetween(fromMs, toMs) {
      const out: RingStepEvent[] = [];
      for (const e of events) {
        const at = e.step * RING_STEP_MS;
        if (at > fromMs && at <= toMs) out.push(e);
      }
      return out;
    },
  };
}

/** Where to put the ringer's hit-stop: the step the ring lands on the shoulder it rings. */
export function ringerDropStep(events: readonly RingStepEvent[], bottle: number): number | null {
  let overStep = -1;
  for (const e of events) {
    if (e.type === 'over' && e.bottle === bottle) overStep = e.step;
  }
  if (overStep < 0) return null;
  for (const e of events) {
    if (e.type === 'hit' && e.step >= overStep && e.collider === RING_BODY_ID + bottle) return e.step;
  }
  return overStep;
}
