/* Flappy bird's rules, shared by the client and the server replay
   (src/server/arcade/flappy-replay.ts). One copy, so the two can't drift
   apart without scripts/verify-flappy-replay.ts failing.

   The sim is a fixed 60 Hz step in the 400 x 600 play space. Everything in
   it is plain arithmetic on numbers, in one order, so the same seed and the
   same flap ticks give the same run on every engine. The client paints it
   at the display's rate by interpolating between steps; nothing it paints
   reaches back in here.

   The constants are the ones the game has always had (gravity 0.4, a flap
   of -7, pipes at 2.5 a step, a 150 gap), so a score means what it always
   meant: pipes passed. What changed in October 2026 is when the clock
   starts. The bird hovers until the first flap, and that flap is tick 0. */

export const FLAPPY_WIDTH = 400;
export const FLAPPY_HEIGHT = 600;
export const FLAPPY_GROUND_HEIGHT = 50;
export const FLAPPY_GROUND_Y = FLAPPY_HEIGHT - FLAPPY_GROUND_HEIGHT;
export const FLAPPY_BIRD_X = 80;
export const FLAPPY_BIRD_SIZE = 30;
/** The hitbox: a circle a little inside the drawn bird. */
export const FLAPPY_BIRD_RADIUS = FLAPPY_BIRD_SIZE / 2 - 3;
export const FLAPPY_PIPE_WIDTH = 60;
export const FLAPPY_PIPE_GAP = 150;
export const FLAPPY_GRAVITY = 0.4;
export const FLAPPY_JUMP = -7;
export const FLAPPY_PIPE_SPEED = 2.5;
/** A new pipe enters when the last one is this far in from the right edge. */
export const FLAPPY_PIPE_SPACING = 200;
const PIPE_MIN_TOP = 80;
const PIPE_MAX_TOP = FLAPPY_HEIGHT - FLAPPY_PIPE_GAP - 130;
/** One sim step, in ms. The server's clock check uses the same figure. */
export const FLAPPY_STEP_MS = 1000 / 60;
export const FLAPPY_START_Y = FLAPPY_HEIGHT / 2;

/** The seeded gap heights: mulberry32, as the game has always dealt them. */
export function createFlappyRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type FlappyPipe = {
  id: number;
  x: number;
  topHeight: number;
  passed: boolean;
  /** The least room the bird had above or below while beside this pipe, in
   *  play-space px. Infinity until the bird is beside it. Read by the
   *  near-miss; it never decides anything. */
  clearance: number;
  /** True once the pipe is behind the bird's hitbox. */
  cleared: boolean;
};

export type FlappyState = {
  /** Steps played since the first flap. */
  tick: number;
  y: number;
  velocity: number;
  pipes: FlappyPipe[];
  nextPipeId: number;
  score: number;
  dead: boolean;
  /** How the run ended: a pipe, the ground, or the top of the screen. */
  deathBy: 'pipe' | 'ground' | 'ceiling' | null;
  rng: () => number;
};

export function createFlappyState(seed: number): FlappyState {
  return {
    tick: 0,
    y: FLAPPY_START_Y,
    velocity: 0,
    pipes: [],
    nextPipeId: 0,
    score: 0,
    dead: false,
    deathBy: null,
    rng: createFlappyRng(seed),
  };
}

export type FlappyStepResult = {
  /** The pipe the bird passed this step (the score went up by one). */
  passed: FlappyPipe | null;
  /** The pipe whose far edge the hitbox left this step, with its clearance. */
  cleared: FlappyPipe | null;
  died: boolean;
};

const overlapsBird = (pipe: FlappyPipe) =>
  FLAPPY_BIRD_X + FLAPPY_BIRD_RADIUS > pipe.x &&
  FLAPPY_BIRD_X - FLAPPY_BIRD_RADIUS < pipe.x + FLAPPY_PIPE_WIDTH;

/** One step. `flap` is true when a flap lands on this step: it sets the
 *  velocity before gravity, which is how a tap between two steps has always
 *  played. A dead run doesn't move. */
export function stepFlappy(state: FlappyState, flap: boolean): FlappyStepResult {
  const result: FlappyStepResult = { passed: null, cleared: null, died: false };
  if (state.dead) return result;

  if (flap) state.velocity = FLAPPY_JUMP;
  state.velocity += FLAPPY_GRAVITY;
  state.y += state.velocity;

  state.pipes = state.pipes.filter((pipe) => pipe.x + FLAPPY_PIPE_WIDTH > 0);
  for (const pipe of state.pipes) {
    pipe.x -= FLAPPY_PIPE_SPEED;
    if (!pipe.passed && pipe.x + FLAPPY_PIPE_WIDTH < FLAPPY_BIRD_X) {
      pipe.passed = true;
      state.score += 1;
      result.passed = pipe;
    }
  }

  const last = state.pipes[state.pipes.length - 1];
  if (!last || last.x < FLAPPY_WIDTH - FLAPPY_PIPE_SPACING) {
    const topHeight = state.rng() * (PIPE_MAX_TOP - PIPE_MIN_TOP) + PIPE_MIN_TOP;
    state.pipes.push({
      id: state.nextPipeId++,
      x: FLAPPY_WIDTH,
      topHeight,
      passed: false,
      clearance: Number.POSITIVE_INFINITY,
      cleared: false,
    });
  }

  state.tick += 1;

  const top = state.y - FLAPPY_BIRD_RADIUS;
  const bottom = state.y + FLAPPY_BIRD_RADIUS;
  if (bottom > FLAPPY_GROUND_Y) {
    state.dead = true;
    state.deathBy = 'ground';
  } else if (top < 0) {
    state.dead = true;
    state.deathBy = 'ceiling';
  }
  for (const pipe of state.pipes) {
    if (overlapsBird(pipe)) {
      const room = Math.min(top - pipe.topHeight, pipe.topHeight + FLAPPY_PIPE_GAP - bottom);
      if (room < pipe.clearance) pipe.clearance = room;
      if (!state.dead && room < 0) {
        state.dead = true;
        state.deathBy = 'pipe';
      }
    } else if (!pipe.cleared && pipe.x + FLAPPY_PIPE_WIDTH <= FLAPPY_BIRD_X - FLAPPY_BIRD_RADIUS) {
      pipe.cleared = true;
      if (Number.isFinite(pipe.clearance)) result.cleared = pipe;
    }
  }
  result.died = state.dead;
  return result;
}
