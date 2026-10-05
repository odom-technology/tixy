/* A reference snake client for the verifiers: the client's own helpers, the
   tick of _snake-client.tsx's updateGame and the frame loop of runFrame,
   driven by a bot. Shared by verify-snake-replay.ts and
   verify-trusted-scores-http.ts. */
import {
  DIRECTION_VECTORS,
  FOOD_SCORE,
  GRID_SIZE,
  INITIAL_TICK_RATE,
  OPPOSITE_DIRECTIONS,
  createSnakeRng,
  generateFoodPosition,
  pushDirection,
  tickRateForApples,
} from '@/app/(games)/snake/_snake-helpers';
import type { Direction, Position } from '@/app/(games)/snake/_snake-types';
import type { SnakeInput } from '@/server/arcade/snake-replay';

const DIRS: Direction[] = ['UP', 'DOWN', 'LEFT', 'RIGHT'];

/** Steers toward the food by breadth-first search over free cells; falls back
 *  to any safe neighbour. Returns the direction it wants next. */
export function botWant(snake: Position[], food: Position, direction: Direction): Direction {
  const blocked = new Set(snake.slice(0, -1).map((p) => p.y * GRID_SIZE + p.x));
  const head = snake[0]!;
  const prev = new Map<number, { from: number; dir: Direction }>();
  const start = head.y * GRID_SIZE + head.x;
  const queue = [start];
  prev.set(start, { from: -1, dir: direction });
  const goal = food.y * GRID_SIZE + food.x;
  while (queue.length > 0 && !prev.has(goal)) {
    const at = queue.shift()!;
    const ax = at % GRID_SIZE;
    const ay = Math.floor(at / GRID_SIZE);
    for (const dir of DIRS) {
      if (at === start && dir === OPPOSITE_DIRECTIONS[direction]) continue;
      const nx = ax + DIRECTION_VECTORS[dir].x;
      const ny = ay + DIRECTION_VECTORS[dir].y;
      if (nx < 0 || ny < 0 || nx >= GRID_SIZE || ny >= GRID_SIZE) continue;
      const cell = ny * GRID_SIZE + nx;
      if (blocked.has(cell) || prev.has(cell)) continue;
      prev.set(cell, { from: at, dir });
      queue.push(cell);
    }
  }
  if (prev.has(goal)) {
    let at = goal;
    while (prev.get(at)!.from !== start) at = prev.get(at)!.from;
    return prev.get(at)!.dir;
  }
  for (const dir of DIRS) {
    if (dir === OPPOSITE_DIRECTIONS[direction]) continue;
    const nx = head.x + DIRECTION_VECTORS[dir].x;
    const ny = head.y + DIRECTION_VECTORS[dir].y;
    if (nx < 0 || ny < 0 || nx >= GRID_SIZE || ny >= GRID_SIZE) continue;
    if (!blocked.has(ny * GRID_SIZE + nx)) return dir;
  }
  return direction;
}

export type ClientRun = {
  seed: number;
  inputs: SnakeInput[];
  score: number;
  apples: number;
  ticks: number;
  /** Wall time at the last tick, when driven by a frame loop. */
  wallMs: number;
  /** The least time the tick rate allows. */
  minMs: number;
};

export type Frames = { hz: number; jitterMs: number; dropRate: number } | null;

/** The client's run: the tick of _snake-client.tsx's updateGame, the queue of
 *  queueDirection (pushDirection, logged when it takes the turn), and, with
 *  `frames`, the frame loop of runFrame that decides when ticks fire. The bot
 *  plays `apples` apples, then stops steering and runs into the wall.
 *  `humanDoubles` queues a second turn in the same tick now and then, as a
 *  quick U-turn does. */
export function playClient(
  seed: number,
  options: { apples: number; rng: () => number; frames?: Frames; humanDoubles?: number },
): ClientRun {
  const nextRandom = createSnakeRng(seed);
  let snake: Position[] = [
    { x: 4, y: 9 },
    { x: 3, y: 9 },
    { x: 2, y: 9 },
  ];
  let direction: Direction = 'RIGHT';
  const queue: Direction[] = [];
  let food = generateFoodPosition(snake, nextRandom);
  let score = 0;
  let tickCount = 0;
  let tickRate = INITIAL_TICK_RATE;
  const inputs: SnakeInput[] = [];
  let minMs = 0;

  const queueDirection = (dir: Direction) => {
    if (pushDirection(queue, direction, dir)) {
      inputs.push({ k: tickCount, dir });
    }
  };

  /** One updateGame. Returns false when the run ends. */
  const update = (): boolean => {
    if (score / FOOD_SCORE < options.apples) {
      const want = botWant(snake, food, queue.length > 0 ? queue[queue.length - 1]! : direction);
      const last = queue.length > 0 ? queue[queue.length - 1]! : direction;
      if (want !== last) {
        queueDirection(want);
        if (options.humanDoubles && options.rng() < options.humanDoubles) {
          // A second turn queued in the same tick (a U-turn takes two).
          const extra = DIRS[Math.floor(options.rng() * 4)]!;
          if (extra !== want) queueDirection(extra);
        }
      }
    }
    tickCount += 1;
    minMs += 1000 / tickRate;
    if (queue.length > 0) {
      const next = queue.shift()!;
      if (next !== OPPOSITE_DIRECTIONS[direction]) direction = next;
    }
    const v = DIRECTION_VECTORS[direction];
    const head = { x: snake[0]!.x + v.x, y: snake[0]!.y + v.y };
    if (head.x < 0 || head.x >= GRID_SIZE || head.y < 0 || head.y >= GRID_SIZE) return false;
    if (snake.slice(0, -1).some((s) => s.x === head.x && s.y === head.y)) return false;
    snake = [head, ...snake];
    if (head.x === food.x && head.y === food.y) {
      score += FOOD_SCORE;
      tickRate = tickRateForApples(score / FOOD_SCORE);
      food = generateFoodPosition(snake, nextRandom);
    } else {
      snake.pop();
    }
    return true;
  };

  let wallMs = 0;
  if (!options.frames) {
    while (update()) {
      /* the bot plays on */
    }
    wallMs = minMs;
  } else {
    const { hz, jitterMs, dropRate } = options.frames;
    const frameMs = 1000 / hz;
    let ts = 0;
    let lastTick = 0;
    let alive = true;
    while (alive) {
      ts += frameMs + (options.rng() - 0.5) * 2 * jitterMs;
      if (options.rng() < dropRate) ts += frameMs * (2 + Math.floor(options.rng() * 6));
      const interval = 1000 / tickRate;
      const delta = ts - lastTick;
      if (delta >= interval) {
        const due = Math.min(4, Math.floor(delta / interval));
        for (let step = 0; step < due; step += 1) {
          if (!update()) {
            alive = false;
            break;
          }
          lastTick += interval;
        }
        if (alive && ts - lastTick > interval * 4) lastTick = ts;
      }
    }
    wallMs = ts;
  }
  return { seed, inputs, score, apples: score / FOOD_SCORE, ticks: tickCount, wallMs, minMs };
}
