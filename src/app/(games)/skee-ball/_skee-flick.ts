/* Skee-ball input and playback: pure, no three.js, no DOM.

   The flick: the pointer's speed over the last 90 ms of the stroke, read
   from event timestamps, sets the launch speed; its direction sets the aim.
   Both maps are straight lines, so the same flick always throws the same
   ball. scripts/verify-skeeball-replay.ts prints flick against ring.

   The playback: the client steps the shared sim live at its fixed 240 Hz
   from the display's frame times, and draws the ball between the last two
   steps. Nothing is pre-recorded or stretched, so the ball moves the same
   at 30, 60, 120 or 144 Hz, and lands where the server's replay lands. */

import {
  SKEE_MAX_AIM,
  SKEE_MAX_POWER,
  SKEE_MIN_POWER,
  SKEE_SIM_DT,
  skeeStartThrow,
  skeeStep,
  type SkeeBallState,
  type SkeeStepEvent,
} from '@/server/arcade/skee-ball-replay';

/** Forward flick speed (CSS px per ms) at the bottom and top of the range. */
export const FLICK_MIN_SPEED = 0.3;
export const FLICK_MAX_SPEED = 2.3;
/** A flick this far off straight (sideways over forward) is full aim. */
export const FLICK_FULL_AIM = 0.6;
/** Samples older than this before release don't count toward the flick. */
export const FLICK_WINDOW_MS = 90;

export type FlickSample = { x: number; y: number; t: number };

/** Forward and sideways speed over the flick window (px/ms; up is forward). */
export function flickVelocity(samples: ReadonlyArray<FlickSample>): { forward: number; side: number } | null {
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
  return { forward: -(last.y - first.y) / span, side: (last.x - first.x) / span };
}

/** Flick speed (px/ms) to a 0 to 1 share of the launch-speed range. */
export function flickPowerShare(forward: number): number {
  return Math.min(1, Math.max(0, (forward - FLICK_MIN_SPEED) / (FLICK_MAX_SPEED - FLICK_MIN_SPEED)));
}

/**
 * A flick to release params. `side` is screen-right positive; the sim's +x
 * is screen-left (the camera looks down the lane from -z), so it flips.
 */
export function flickToRelease(forward: number, side: number): { aim: number; power: number } {
  const power = SKEE_MIN_POWER + flickPowerShare(forward) * (SKEE_MAX_POWER - SKEE_MIN_POWER);
  const slant = Math.min(1, Math.max(-1, side / Math.max(forward, FLICK_MIN_SPEED) / FLICK_FULL_AIM));
  return { aim: -slant * SKEE_MAX_AIM, power };
}

/** Step length in ms. */
export const SKEE_STEP_MS = SKEE_SIM_DT * 1000;

export type SkeePlayback = {
  readonly state: SkeeBallState;
  /** Advance by `ms` of effect time; returns what happened in the steps run. */
  advance(ms: number): SkeeStepEvent[];
  /** The ball's centre and velocity drawn between the last two steps. */
  sample(out: { x: number; y: number; z: number; vx: number; vy: number; vz: number }): void;
};

/** Live playback of one throw. */
export function createSkeePlayback(aim: number, power: number): SkeePlayback {
  const state = skeeStartThrow(aim, power);
  const prev = { x: state.x, y: state.y, z: state.z, vx: state.vx, vy: state.vy, vz: state.vz };
  let acc = 0;
  return {
    state,
    advance(ms) {
      const events: SkeeStepEvent[] = [];
      // A long stall (a background tab) never runs more than a quarter second.
      acc += Math.min(250, Math.max(0, ms));
      while (acc >= SKEE_STEP_MS) {
        acc -= SKEE_STEP_MS;
        if (state.phase === 'done') {
          acc = 0;
          break;
        }
        prev.x = state.x;
        prev.y = state.y;
        prev.z = state.z;
        prev.vx = state.vx;
        prev.vy = state.vy;
        prev.vz = state.vz;
        skeeStep(state, events);
      }
      return events;
    },
    sample(out) {
      const k = state.phase === 'done' ? 1 : acc / SKEE_STEP_MS;
      out.x = prev.x + (state.x - prev.x) * k;
      out.y = prev.y + (state.y - prev.y) * k;
      out.z = prev.z + (state.z - prev.z) * k;
      out.vx = prev.vx + (state.vx - prev.vx) * k;
      out.vy = prev.vy + (state.vy - prev.vy) * k;
      out.vz = prev.vz + (state.vz - prev.vz) * k;
    },
  };
}
