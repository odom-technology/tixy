import type { Direction, Position } from './_snake-types';

// Game constants - tuned for better web experience
export const GRID_SIZE = 18; // Smaller grid for better gameplay
export const CELL_SIZE = 34; // Integer cell size for crisp rendering
export const BASE_WIDTH = GRID_SIZE * CELL_SIZE;
export const BASE_HEIGHT = GRID_SIZE * CELL_SIZE;
export const INITIAL_TICK_RATE = 8; // Ticks per second at the start of a run
export const MAX_DIRECTION_QUEUE = 2; // Maximum number of buffered direction changes

// Speed ramp: the run starts at INITIAL_TICK_RATE and steps up every
// SPEED_RAMP_APPLES apples, to MAX_TICK_RATE. The server's replay
// (src/server/arcade/snake-replay.ts) reads tickRateForApples below for the
// least time a run of so many ticks can take, so changing the ramp changes
// which runs the score route accepts.
export const SPEED_RAMP_APPLES = 5;
export const SPEED_RAMP_STEP = 0.75;
export const MAX_TICK_RATE = 15;
export const WINNING_SNAKE_LENGTH = GRID_SIZE * GRID_SIZE;

/** The run's reward note while signed out. The result checks for this exact value. */
export const GUEST_RUN_MESSAGE = 'Sign in to save scores and earn tickets.';

export const REWARDS_HINT_TEXT =
  'Rewards hint: score 20 = 1 Ticket | score 70 = 5 Tickets | score 160 = 10 Tickets | rewards taper at higher scores.';

export const getSubmitErrorMessage = (
  status: number,
  data: { error?: string; details?: string; retryAfterSec?: number } | null,
) => {
  if (status === 429) {
    const retry =
      typeof data?.retryAfterSec === 'number'
        ? ` Try again in ${data.retryAfterSec}s.`
        : '';
    return `${data?.error ?? 'Too many runs.'}${retry}`;
  }
  if (typeof data?.details === 'string' && data.details.trim()) {
    return data.details;
  }
  if (typeof data?.error === 'string' && data.error.trim()) {
    return data.error;
  }
  return 'Could not save your run. Try again.';
};

/** Ticks per second after `apples` have been eaten this run. */
export function tickRateForApples(apples: number): number {
  const steps = Math.floor(Math.max(0, apples) / SPEED_RAMP_APPLES);
  return Math.min(MAX_TICK_RATE, INITIAL_TICK_RATE + steps * SPEED_RAMP_STEP);
}

// Direction vectors for quick lookup
export const DIRECTION_VECTORS: Record<Direction, Position> = {
  UP: { x: 0, y: -1 },
  DOWN: { x: 0, y: 1 },
  LEFT: { x: -1, y: 0 },
  RIGHT: { x: 1, y: 0 },
};

// Opposite directions for validation
export const OPPOSITE_DIRECTIONS: Record<Direction, Direction> = {
  UP: 'DOWN',
  DOWN: 'UP',
  LEFT: 'RIGHT',
  RIGHT: 'LEFT',
};

// The wire form of a turn in the run log the score route replays.
export const SNAKE_DIRECTION_LETTER: Record<Direction, string> = {
  UP: 'U',
  DOWN: 'D',
  LEFT: 'L',
  RIGHT: 'R',
};

// Score awarded per food eaten. Referenced by the run loop and by tests that
// pin the scoring contract.
export const FOOD_SCORE = 10;

export { isNewBest } from '@/features/arcade/lib/new-best';

// ---------------------------------------------------------------------------
// Deterministic run RNG (mulberry32-style). The session server hands the
// client a snakeSeed; the SAME seed must always produce the SAME food
// sequence — replays and anti-cheat depend on this. Do not change the math.
// ---------------------------------------------------------------------------
export function createSnakeRng(seed: number): () => number {
  let rngState = seed >>> 0;
  return () => {
    rngState += 0x6d2b79f5;
    let t = rngState;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Direction queue — the exact input-buffer contract used by keyboard, touch,
// and the realtime replay channel. A direction is accepted only when it is
// neither a reversal nor a duplicate of the last queued (or current)
// direction, and the buffer is capped so inputs stay responsive.
// Returns true when the direction was queued (callers mirror it to the ws).
// ---------------------------------------------------------------------------
export function pushDirection(
  queue: Direction[],
  currentDir: Direction,
  newDir: Direction,
  maxQueue: number = MAX_DIRECTION_QUEUE,
): boolean {
  const lastDir = queue.length > 0 ? queue[queue.length - 1] : currentDir;
  // Can't reverse direction
  if (newDir === OPPOSITE_DIRECTIONS[lastDir]) return false;
  // Don't queue same direction twice
  if (newDir === lastDir) return false;
  // Limit queue size
  if (queue.length >= maxQueue) return false;
  queue.push(newDir);
  // Limit queue size to prevent input lag
  if (queue.length > 2) queue.shift();
  return true;
}

// ---------------------------------------------------------------------------
// Food placement — uniform over free cells, never on the snake body. Driven
// entirely by the run RNG so seeded runs stay replayable.
// ---------------------------------------------------------------------------
export function generateFoodPosition(
  snake: readonly Position[],
  nextRandom: () => number,
): Position {
  let newFood: Position;
  do {
    newFood = {
      x: Math.floor(nextRandom() * GRID_SIZE),
      y: Math.floor(nextRandom() * GRID_SIZE),
    };
  } while (
    snake.some(
      (segment: Position) =>
        segment.x === newFood.x && segment.y === newFood.y,
    )
  );
  return newFood;
}
