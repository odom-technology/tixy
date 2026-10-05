/* Flappy bird's server replay. The client posts the flaps it played, each
   stamped with the sim tick it landed on (not a time), and the server plays
   the run again from the session's seed through the client's own step
   (_flappy-sim.ts). The score is the pipes the replay passes.

   The server never reads a score, a pipe event or a clock from the client.
   The only time that matters is the server's: the session row's start
   stamp. The first flap starts the run, and every step after it is 1/60 s
   of the client's clock, which only ever runs behind the wall (the frame
   loop drops time it can't catch up, and the hit-stop pauses it). So a run
   longer than the session has existed didn't happen.

   A run always ends: without a flap the bird falls to the ground in under
   two seconds, so the replay plays on after the last flap until it dies. */

import {
  FLAPPY_PIPE_SPACING,
  FLAPPY_PIPE_SPEED,
  FLAPPY_STEP_MS,
  createFlappyState,
  stepFlappy,
} from '@/app/(games)/flappy-bird/_flappy-sim';

/** Most flaps one payload may carry. An honest run flaps about twice a
 *  second; 100,000 is over 13 hours of it. */
export const FLAPPY_MAX_FLAPS = 100_000;
/** Ticks no run can pass: the session's six-hour life at 60 a second. */
const FLAPPY_MAX_TICKS = 6 * 60 * 60 * 60;
/** The run's clock starts after the session row is stamped (the client
 *  fetches the session, then the bird hovers until the first flap), so a
 *  run can't take longer than the session is old. A second covers rounding
 *  and the frame the first flap lands on. */
export const FLAPPY_CLOCK_SLACK_MS = 1000;
/** Steps between two pipes passing: 200 px at 2.5 px a step, rounded up. */
export const FLAPPY_STEPS_PER_PIPE = Math.ceil(FLAPPY_PIPE_SPACING / FLAPPY_PIPE_SPEED);

/** Reads the wire form: the tick of each flap, strictly increasing, the
 *  first at 0. Null when it isn't that. */
export function parseFlappyFlaps(raw: unknown): number[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > FLAPPY_MAX_FLAPS) return null;
  const flaps: number[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'number' || !Number.isSafeInteger(entry) || entry < 0) return null;
    flaps.push(entry);
  }
  return flaps;
}

export type FlappyRun =
  | {
      ok: true;
      score: number;
      /** Steps from the first flap to the crash. */
      ticks: number;
      flaps: number;
      deathBy: 'pipe' | 'ground' | 'ceiling';
      /** How long the run took on the sim clock. */
      durationMs: number;
      /** When each pipe was passed and each flap landed, on the sim clock. */
      pipeTimesMs: number[];
      flapTimesMs: number[];
    }
  | { ok: false; reason: string };

export type FlappyReplayOptions = {
  /** The session's age on the server. When set, a run that couldn't fit in
   *  it is rejected. */
  elapsedMs?: number;
};

export function replayFlappyRun(
  seed: number,
  flaps: readonly number[],
  options: FlappyReplayOptions = {},
): FlappyRun {
  if (flaps.length === 0) return { ok: false, reason: 'No flaps' };
  if (flaps[0] !== 0) return { ok: false, reason: `First flap at tick ${flaps[0]}, not 0` };
  for (let i = 1; i < flaps.length; i += 1) {
    if (!(flaps[i]! > flaps[i - 1]!)) {
      return { ok: false, reason: `Flaps out of order at ${i}` };
    }
  }

  const maxTicks =
    options.elapsedMs === undefined
      ? FLAPPY_MAX_TICKS
      : Math.min(
          FLAPPY_MAX_TICKS,
          Math.ceil((options.elapsedMs + FLAPPY_CLOCK_SLACK_MS) / FLAPPY_STEP_MS) + 1,
        );

  const state = createFlappyState(seed);
  const pipeTimesMs: number[] = [];
  const flapTimesMs: number[] = [];
  let next = 0;
  while (!state.dead) {
    if (state.tick >= maxTicks) {
      return { ok: false, reason: `Run longer than the session allows (${state.tick} ticks)` };
    }
    const flap = next < flaps.length && flaps[next] === state.tick;
    if (flap) {
      flapTimesMs.push(Math.round(state.tick * FLAPPY_STEP_MS));
      next += 1;
    }
    const step = stepFlappy(state, flap);
    if (step.passed) pipeTimesMs.push(Math.round(state.tick * FLAPPY_STEP_MS));
  }

  if (next < flaps.length) {
    return { ok: false, reason: `${flaps.length - next} flaps after the run ended at tick ${state.tick}` };
  }
  const durationMs = state.tick * FLAPPY_STEP_MS;
  if (options.elapsedMs !== undefined && durationMs > options.elapsedMs + FLAPPY_CLOCK_SLACK_MS) {
    return {
      ok: false,
      reason: `Run needs ${Math.round(durationMs)}ms on the sim clock; the session is ${Math.round(options.elapsedMs)}ms old`,
    };
  }

  return {
    ok: true,
    score: state.score,
    ticks: state.tick,
    flaps: flaps.length,
    deathBy: state.deathBy ?? 'ground',
    durationMs,
    pipeTimesMs,
    flapTimesMs,
  };
}

/** The replay, held to the client's claim: what the score route runs. */
export function verifyFlappyRun(
  seed: number,
  flaps: readonly number[],
  claimedScore: number,
  options: FlappyReplayOptions = {},
): FlappyRun {
  const run = replayFlappyRun(seed, flaps, options);
  if (run.ok === false) return run;
  if (run.score !== claimedScore) {
    return {
      ok: false,
      reason: `Authoritative score mismatch (server=${run.score}, client=${claimedScore}, flaps=${run.flaps}, ticks=${run.ticks})`,
    };
  }
  return run;
}
