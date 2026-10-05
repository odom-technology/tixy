/* Ricochet's rules, its engine and its server replay. Pure TypeScript: no
   React, no DOM, no Date.now(), no Math.random(). The client plays the run
   with `stepRicochet` and the score route plays it again with the same
   function, so the two cannot drift apart without scripts/verify-ricochet-
   replay.ts failing.

   The game: a bird flies between two walls, a seeded gap on each. Tap to flap.
   Reach a wall inside its gap and the bird bounces back toward the other wall
   (+1); anywhere else, or the floor or the ceiling, ends the run. Each wall is
   a little faster than the last, and the gaps shrink to a floor.

   Clock. The sim runs on a fixed 60 Hz step (RICOCHET_STEP_MS), the rate the
   shared frame loop holds (game-frame-loop.ts). The display can run at any
   rate: it only draws between two steps. A tap is logged as the number of
   steps already played when it landed (`k`), and flaps on step k + 1, so what
   the player flew is a function of the seed and those integers alone. The
   numbers in `stepRicochet` are the ones the game has always run on (gravity,
   flap, speed per frame), in the same order, so a run's score means what it
   did before the replay existed.

   The server never reads a score, a wall event or a bird position from the
   client. The score is the walls the replay clears. The only time that
   matters is the server's own: the session's start stamp. A run of S steps
   takes at least S steps of real time, so a run longer than the session has
   existed is rejected. */

// ── Logical playfield (the client draws in these units) ──
export const RICOCHET_BASE_WIDTH = 480;
export const RICOCHET_BASE_HEIGHT = 640;

/** Bird radius used for the gap test and the floor and ceiling. */
export const RICOCHET_BIRD_RADIUS = 14;

/** Inner faces of the two walls (the bird bounces between these). */
export const RICOCHET_WALL_THICKNESS = 34;
export const RICOCHET_LEFT_FACE = RICOCHET_WALL_THICKNESS;
export const RICOCHET_RIGHT_FACE = RICOCHET_BASE_WIDTH - RICOCHET_WALL_THICKNESS;
/** Horizontal distance the bird travels between consecutive wall hits. */
export const RICOCHET_SPAN = RICOCHET_RIGHT_FACE - RICOCHET_LEFT_FACE;

// ── Gap geometry. The gap is a vertical band on the wall the bird is flying
//    toward; the bird must overlap it on contact or the run ends. It starts
//    generous and shrinks with the wall index, never past a floor. ──
export const RICOCHET_GAP_BASE = 200; // gap height at wall 1 (px)
export const RICOCHET_GAP_MIN = 116; // never tighter than this (px)
export const RICOCHET_GAP_SHRINK_PER_WALL = 5; // px removed per wall index
/** Vertical margin kept between a gap band and the top and bottom edges. */
export const RICOCHET_GAP_EDGE_MARGIN = 26;

// ── The step ──
export const RICOCHET_STEP_HZ = 60;
export const RICOCHET_STEP_MS = 1000 / RICOCHET_STEP_HZ;
export const RICOCHET_GRAVITY = 0.5; // px per step², downward
export const RICOCHET_FLAP_IMPULSE = -7.6; // px per step, up, on a flap
export const RICOCHET_MAX_FALL_SPEED = 11; // terminal downward speed, px per step
export const RICOCHET_BASE_SPEED = 2.6; // px per step heading into wall 1
export const RICOCHET_SPEED_PER_WALL = 0.085; // added per wall index
export const RICOCHET_MAX_SPEED = 6.4; // ceiling on horizontal speed

/** The bird's first move: flying right from the middle, already lifting. */
export const RICOCHET_START_X = RICOCHET_BASE_WIDTH / 2;
export const RICOCHET_START_Y = RICOCHET_BASE_HEIGHT / 2;
export const RICOCHET_START_DIR = 1;

/** Most walls one run can clear. A 1,000-wall run is about 18 minutes of
 *  crossing at top speed. */
export const RICOCHET_MAX_WALLS = 1000;

/** Most taps one payload may carry. A tap flaps once per step at most, and a
 *  hand taps ten times a second; this is more than 18 minutes of that. */
export const RICOCHET_MAX_TAPS = 12_000;

/** Steps no run can pass: the session's own 30 minutes. */
export const RICOCHET_MAX_STEPS = 30 * 60 * RICOCHET_STEP_HZ;

/** The run's clock starts after the session is stamped (the client stamps,
 *  then starts), so the replay's least duration can't exceed the session's
 *  age by more than rounding. A second covers the steps the frame loop
 *  batches after a dropped frame. */
export const RICOCHET_CLOCK_SLACK_MS = 1000;

// ---------------------------------------------------------------------------
// Seeded gaps. mulberry32, as everywhere else in the repo.
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A per-wall RNG from (seed, wallIndex): the gap for wall N is a pure
 *  function of N, so there is no schedule to replay and nothing to drift. */
function rngForWall(seed: number, wallIndex: number): () => number {
  let mixed = (seed ^ Math.imul(wallIndex + 1, 0x9e3779b1)) | 0;
  mixed = (mixed + 0x6d2b79f5) | 0;
  return mulberry32(mixed);
}

export interface RicochetGap {
  /** Top edge (y) of the safe band on this wall. */
  start: number;
  /** Bottom edge (y) of the safe band on this wall. */
  end: number;
  /** Band height in px. */
  height: number;
}

/** Gap band height for a given wall index (1-based). Shrinks with depth. */
export function ricochetGapHeightFor(wallIndex: number): number {
  const idx = wallIndex < 1 ? 1 : Math.floor(wallIndex);
  const raw = RICOCHET_GAP_BASE - (idx - 1) * RICOCHET_GAP_SHRINK_PER_WALL;
  return Math.max(RICOCHET_GAP_MIN, raw);
}

/** The gap for a seed and a wall index (1-based). Identical on client and
 *  server: the client draws it, the replay tests the bird against it. */
export function ricochetGapFor(seed: number, wallIndex: number): RicochetGap {
  const height = ricochetGapHeightFor(wallIndex);
  const rng = rngForWall(seed | 0, wallIndex);
  const minStart = RICOCHET_GAP_EDGE_MARGIN;
  const maxStart = RICOCHET_BASE_HEIGHT - RICOCHET_GAP_EDGE_MARGIN - height;
  const span = Math.max(0, maxStart - minStart);
  const start = minStart + rng() * span;
  return { start, end: start + height, height };
}

/** Horizontal speed (px per step) heading into a wall index (1-based). */
export function ricochetSpeedFor(wallIndex: number): number {
  const idx = wallIndex < 1 ? 1 : Math.floor(wallIndex);
  return Math.min(
    RICOCHET_MAX_SPEED,
    RICOCHET_BASE_SPEED + (idx - 1) * RICOCHET_SPEED_PER_WALL,
  );
}

/** The least time (ms) the bird needs to cross the span at the speed for a
 *  wall: the flat part of a wall's time, before any climbing. */
export function ricochetCrossingMsFor(wallIndex: number): number {
  return (RICOCHET_SPAN / ricochetSpeedFor(wallIndex)) * RICOCHET_STEP_MS;
}

// ---------------------------------------------------------------------------
// The engine
// ---------------------------------------------------------------------------

export type RicochetState = {
  /** Steps played so far. */
  step: number;
  x: number;
  y: number;
  /** px per step, down is positive. */
  vy: number;
  /** +1 heading for the right wall, -1 for the left. */
  dir: 1 | -1;
  /** The wall the bird is flying toward (1-based). Equals score + 1. */
  wall: number;
  /** Walls cleared. */
  score: number;
};

export type RicochetEvent =
  /** The bird cleared a wall and turned. `y` is where it met the face. */
  | { kind: 'bounce'; wall: number; y: number; side: 'left' | 'right' }
  /** The run ended: it met the face outside the gap, or the floor or ceiling. */
  | { kind: 'death'; cause: 'spike' | 'floor' | 'ceiling'; wall: number; y: number; side: 'left' | 'right' | 'top' | 'bottom' };

export function createRicochetState(): RicochetState {
  return {
    step: 0,
    x: RICOCHET_START_X,
    y: RICOCHET_START_Y,
    vy: RICOCHET_FLAP_IMPULSE,
    dir: RICOCHET_START_DIR,
    wall: 1,
    score: 0,
  };
}

/** Whether the bird overlaps a gap at height `y`. The test the game has
 *  always used: any part of the bird in the band clears the wall. */
export function ricochetInGap(gap: RicochetGap, y: number): boolean {
  return !(y + RICOCHET_BIRD_RADIUS < gap.start || y - RICOCHET_BIRD_RADIUS > gap.end);
}

/** One 60 Hz step, in place. `flap` is a tap that landed before this step.
 *  Returns what happened, or null when nothing did. After a death the state
 *  must not be stepped again. */
export function stepRicochet(
  state: RicochetState,
  seed: number,
  flap: boolean,
): RicochetEvent | null {
  state.step += 1;
  if (flap) state.vy = RICOCHET_FLAP_IMPULSE;

  // Vertical: gravity, then the move.
  state.vy = Math.min(RICOCHET_MAX_FALL_SPEED, state.vy + RICOCHET_GRAVITY);
  state.y += state.vy;

  // The open top and bottom are lethal, like the spikes.
  if (
    state.y - RICOCHET_BIRD_RADIUS <= 0 ||
    state.y + RICOCHET_BIRD_RADIUS >= RICOCHET_BASE_HEIGHT
  ) {
    const ceiling = state.y - RICOCHET_BIRD_RADIUS <= 0;
    state.y = Math.max(
      RICOCHET_BIRD_RADIUS,
      Math.min(RICOCHET_BASE_HEIGHT - RICOCHET_BIRD_RADIUS, state.y),
    );
    return {
      kind: 'death',
      cause: ceiling ? 'ceiling' : 'floor',
      wall: state.wall,
      y: state.y,
      side: ceiling ? 'top' : 'bottom',
    };
  }

  // Horizontal: constant speed toward the wall it is heading for.
  state.x += state.dir * ricochetSpeedFor(state.wall);

  const right = state.dir > 0 && state.x + RICOCHET_BIRD_RADIUS >= RICOCHET_RIGHT_FACE;
  const left = state.dir < 0 && state.x - RICOCHET_BIRD_RADIUS <= RICOCHET_LEFT_FACE;
  if (!right && !left) return null;

  const side = right ? 'right' : 'left';
  state.x = right
    ? RICOCHET_RIGHT_FACE - RICOCHET_BIRD_RADIUS
    : RICOCHET_LEFT_FACE + RICOCHET_BIRD_RADIUS;
  if (!ricochetInGap(ricochetGapFor(seed, state.wall), state.y)) {
    return { kind: 'death', cause: 'spike', wall: state.wall, y: state.y, side };
  }
  const wall = state.wall;
  state.score += 1;
  state.wall += 1;
  state.dir = right ? -1 : 1;
  return { kind: 'bounce', wall, y: state.y, side };
}

// ---------------------------------------------------------------------------
// The server's replay
// ---------------------------------------------------------------------------

/** Reads the wire form: a list of whole step counts, strictly increasing. Null
 *  when it isn't that. */
export function parseRicochetTaps(raw: unknown): number[] | null {
  if (!Array.isArray(raw) || raw.length > RICOCHET_MAX_TAPS) return null;
  const taps: number[] = [];
  let previous = -1;
  for (const entry of raw) {
    if (typeof entry !== 'number' || !Number.isSafeInteger(entry)) return null;
    if (entry < 0 || entry > RICOCHET_MAX_STEPS || entry <= previous) return null;
    taps.push(entry);
    previous = entry;
  }
  return taps;
}

export type RicochetRun =
  | {
      ok: true;
      score: number;
      steps: number;
      /** The run's length at the step rate: the least time it could take. */
      durationMs: number;
      /** How it ended. `cap` is the run that cleared RICOCHET_MAX_WALLS. */
      cause: 'spike' | 'floor' | 'ceiling' | 'cap';
      /** The step each wall was cleared on, in order. */
      bounceSteps: number[];
      /** The step each tap flapped on, in order. */
      tapCount: number;
    }
  | { ok: false; reason: string; tap?: number };

export type RicochetReplayOptions = {
  /** The server's age of the run: now minus the start stamp. When set, a run
   *  that couldn't fit in it is rejected. */
  elapsedMs?: number;
};

/** Plays a run from its seed and taps. A tap with step count k flaps on step
 *  k + 1. The run ends at the first death; a tap after it is rejected. */
export function replayRicochetRun(
  seed: number,
  taps: readonly number[],
  options: RicochetReplayOptions = {},
): RicochetRun {
  for (let i = 0; i < taps.length; i += 1) {
    const k = taps[i]!;
    if (!Number.isSafeInteger(k) || k < 0) return { ok: false, reason: 'Malformed tap', tap: i };
    if (i > 0 && k <= taps[i - 1]!) return { ok: false, reason: 'Taps out of order', tap: i };
  }

  const maxSteps =
    options.elapsedMs === undefined
      ? RICOCHET_MAX_STEPS
      : Math.min(
          RICOCHET_MAX_STEPS,
          Math.ceil(((options.elapsedMs + RICOCHET_CLOCK_SLACK_MS) * RICOCHET_STEP_HZ) / 1000) + 1,
        );

  const state = createRicochetState();
  const bounceSteps: number[] = [];
  let tapIndex = 0;
  let cause: 'spike' | 'floor' | 'ceiling' | 'cap' | null = null;

  while (cause === null) {
    if (state.step >= maxSteps) {
      return {
        ok: false,
        reason: `Run longer than the session allows (${state.step} steps)`,
      };
    }
    // The tap that landed after `step` steps and before the next one.
    let flap = false;
    while (tapIndex < taps.length && taps[tapIndex]! <= state.step) {
      if (taps[tapIndex]! === state.step) flap = true;
      tapIndex += 1;
    }
    const event = stepRicochet(state, seed, flap);
    if (event?.kind === 'bounce') {
      bounceSteps.push(state.step);
      // The run ends on the last wall it may clear.
      if (state.score >= RICOCHET_MAX_WALLS) cause = 'cap';
    } else if (event?.kind === 'death') {
      cause = event.cause;
    }
  }

  if (tapIndex < taps.length) {
    return { ok: false, reason: `${taps.length - tapIndex} taps after the run ended`, tap: tapIndex };
  }
  const durationMs = state.step * RICOCHET_STEP_MS;
  if (options.elapsedMs !== undefined && durationMs > options.elapsedMs + RICOCHET_CLOCK_SLACK_MS) {
    return {
      ok: false,
      reason: `Run needs ${Math.round(durationMs)}ms at the step rate; the session is ${Math.round(options.elapsedMs)}ms old`,
    };
  }

  return {
    ok: true,
    score: state.score,
    steps: state.step,
    durationMs,
    cause,
    bounceSteps,
    tapCount: taps.length,
  };
}

/** The replay, held to the client's claimed score: what the score route
 *  runs. A run whose score isn't the replay's is rejected. */
export function verifyRicochetRun(
  seed: number,
  taps: readonly number[],
  claimedScore: number,
  options: RicochetReplayOptions = {},
): RicochetRun {
  const run = replayRicochetRun(seed, taps, options);
  if (run.ok === false) return run;
  if (run.score !== claimedScore) {
    return {
      ok: false,
      reason: `Authoritative score mismatch (server=${run.score}, client=${claimedScore}, steps=${run.steps})`,
    };
  }
  return run;
}
