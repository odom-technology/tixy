/* Snake's server replay. The client posts the turns it queued, each stamped
   with the tick it was queued on (not a time), and the server plays the run
   again from the session's seed: the same board, the same apples, the same
   queue rules as the client's tick (updateGame in _snake-client.tsx), through
   the same helpers (_snake-helpers.ts), so the two can't drift apart without
   a verifier failing.

   The server never reads a score, an apple event or a clock from the client.
   The score is the apples the replay eats. The only time that matters is the
   server's own: the session row's start stamp. A run of T ticks takes at
   least the sum of its tick intervals (8 ticks a second, stepping up to 15
   every 5 apples), so a run longer than the session has existed is rejected.

   Because the replay plays the inputs on the real rules, an apple that isn't
   where the seed put it, or one the snake couldn't have reached in the ticks
   it had, can't be eaten: the head never gets there. */

import {
  DIRECTION_VECTORS,
  FOOD_SCORE,
  GRID_SIZE,
  MAX_TICK_RATE,
  OPPOSITE_DIRECTIONS,
  SNAKE_DIRECTION_LETTER,
  WINNING_SNAKE_LENGTH,
  createSnakeRng,
  generateFoodPosition,
  pushDirection,
  tickRateForApples,
} from '@/app/(games)/snake/_snake-helpers';
import type { Direction, Position } from '@/app/(games)/snake/_snake-types';

/** The board a run starts on, as the client deals it. */
const START_SNAKE: readonly Position[] = [
  { x: 4, y: 9 },
  { x: 3, y: 9 },
  { x: 2, y: 9 },
];
const START_DIRECTION: Direction = 'RIGHT';

/** A turn the client queued: the tick count when it was queued (the number of
 *  ticks already played) and the direction. */
export type SnakeInput = { k: number; dir: Direction };

/** Most turns one payload may carry. A 6-hour run at the top speed holds
 *  about 1.4 million ticks; no honest run turns anywhere near this often. */
export const SNAKE_MAX_INPUTS = 100_000;
/** Ticks no run can pass: the session's own six-hour life at 15 a second. */
const SNAKE_MAX_TICKS = 6 * 60 * 60 * MAX_TICK_RATE;
/** The run's clock starts after the session row is stamped (the client
 *  fetches the session, then connects, then starts), so the replay's minimum
 *  duration can't exceed the session's age by more than rounding. A second
 *  covers the tick batching the client does after a dropped frame. */
export const SNAKE_CLOCK_SLACK_MS = 1000;

const DIRECTION_CODES: Record<string, Direction> = Object.fromEntries(
  (Object.entries(SNAKE_DIRECTION_LETTER) as Array<[Direction, string]>).map(
    ([dir, letter]) => [letter, dir],
  ),
);

/** Reads the wire form, `[[tick, 'U'], ...]`. Null when it isn't that. */
export function parseSnakeInputs(raw: unknown): SnakeInput[] | null {
  if (!Array.isArray(raw) || raw.length > SNAKE_MAX_INPUTS) return null;
  const inputs: SnakeInput[] = [];
  for (const entry of raw) {
    if (!Array.isArray(entry) || entry.length !== 2) return null;
    const [k, letter] = entry as [unknown, unknown];
    if (typeof k !== 'number' || !Number.isSafeInteger(k) || k < 0) return null;
    const dir = typeof letter === 'string' ? DIRECTION_CODES[letter] : undefined;
    if (!dir) return null;
    inputs.push({ k, dir });
  }
  return inputs;
}

export type SnakeRun =
  | {
      ok: true;
      score: number;
      apples: number;
      ticks: number;
      ended: 'died' | 'won';
      /** The least time the run could have taken, from the tick rate. */
      minDurationMs: number;
      /** When each apple was eaten, at the fastest legal clock. */
      foodTimesMs: number[];
      /** When each turn was queued, at the fastest legal clock. */
      inputTimesMs: number[];
    }
  | { ok: false; reason: string };

export type SnakeReplayOptions = {
  /** The server's age of the session. When set, a run that couldn't fit
   *  in it is rejected. */
  elapsedMs?: number;
};

export function replaySnakeRun(
  seed: number,
  inputs: readonly SnakeInput[],
  options: SnakeReplayOptions = {},
): SnakeRun {
  for (let i = 1; i < inputs.length; i += 1) {
    if (inputs[i]!.k < inputs[i - 1]!.k) {
      return { ok: false, reason: `Inputs out of order at ${i}` };
    }
  }

  const nextRandom = createSnakeRng(seed);
  const snake: Position[] = START_SNAKE.map((segment) => ({ ...segment }));
  let direction: Direction = START_DIRECTION;
  const queue: Direction[] = [];
  let food = generateFoodPosition(snake, nextRandom);

  const maxTicks =
    options.elapsedMs === undefined
      ? SNAKE_MAX_TICKS
      : Math.min(
          SNAKE_MAX_TICKS,
          Math.ceil(((options.elapsedMs + SNAKE_CLOCK_SLACK_MS) * MAX_TICK_RATE) / 1000) + 1,
        );

  let tick = 0;
  let inputIndex = 0;
  let apples = 0;
  let clockMs = 0;
  let ended: 'died' | 'won' | null = null;
  const foodTimesMs: number[] = [];
  const inputTimesMs: number[] = [];

  while (ended === null) {
    // Turns queued after `tick` ticks and before the next one.
    while (inputIndex < inputs.length && inputs[inputIndex]!.k === tick) {
      const input = inputs[inputIndex]!;
      // The client only logs a turn the queue took, so a turn it wouldn't
      // take (a reversal, a repeat, a full queue) was not made on this board.
      if (!pushDirection(queue, direction, input.dir)) {
        return { ok: false, reason: `Illegal turn at tick ${tick} (${input.dir})` };
      }
      inputTimesMs.push(Math.round(clockMs));
      inputIndex += 1;
    }
    if (tick >= maxTicks) {
      return { ok: false, reason: `Run longer than the session allows (${tick} ticks)` };
    }

    // One tick, as updateGame plays it.
    tick += 1;
    clockMs += 1000 / tickRateForApples(apples);

    if (queue.length > 0) {
      const next = queue.shift()!;
      if (next !== OPPOSITE_DIRECTIONS[direction]) direction = next;
    }
    const vector = DIRECTION_VECTORS[direction];
    const head = { x: snake[0]!.x + vector.x, y: snake[0]!.y + vector.y };

    if (head.x < 0 || head.x >= GRID_SIZE || head.y < 0 || head.y >= GRID_SIZE) {
      ended = 'died';
      break;
    }
    // The tail moves away this tick, so it isn't a collision.
    let hitSelf = false;
    for (let i = 0; i < snake.length - 1; i += 1) {
      if (snake[i]!.x === head.x && snake[i]!.y === head.y) {
        hitSelf = true;
        break;
      }
    }
    if (hitSelf) {
      ended = 'died';
      break;
    }

    snake.unshift(head);
    if (head.x === food.x && head.y === food.y) {
      apples += 1;
      foodTimesMs.push(Math.round(clockMs));
      if (snake.length >= WINNING_SNAKE_LENGTH) {
        ended = 'won';
        break;
      }
      food = generateFoodPosition(snake, nextRandom);
    } else {
      snake.pop();
    }
  }

  if (inputIndex < inputs.length) {
    return { ok: false, reason: `${inputs.length - inputIndex} turns after the run ended` };
  }
  if (options.elapsedMs !== undefined && clockMs > options.elapsedMs + SNAKE_CLOCK_SLACK_MS) {
    return {
      ok: false,
      reason: `Run needs ${Math.round(clockMs)}ms at the tick rate; the session is ${Math.round(options.elapsedMs)}ms old`,
    };
  }

  return {
    ok: true,
    score: apples * FOOD_SCORE,
    apples,
    ticks: tick,
    ended,
    minDurationMs: clockMs,
    foodTimesMs,
    inputTimesMs,
  };
}

/** The replay, held to the client's claimed score: what the score route
 *  runs. A run whose score isn't the replay's is rejected. */
export function verifySnakeRun(
  seed: number,
  inputs: readonly SnakeInput[],
  claimedScore: number,
  options: SnakeReplayOptions = {},
): SnakeRun {
  const run = replaySnakeRun(seed, inputs, options);
  if (run.ok === false) return run;
  if (run.score !== claimedScore) {
    return {
      ok: false,
      reason: `Authoritative score mismatch (server=${run.score}, client=${claimedScore}, apples=${run.apples}, ticks=${run.ticks})`,
    };
  }
  return run;
}
