/**
 * Score distributions by skill for the tiered series of snake, 2048 and
 * stack, used to set the tiers in src/server/arcade/achievements/registry.ts.
 * Skee-ball and connect four have their own sims (sim-skeeball-thresholds.ts,
 * sim-connect-four-thresholds.ts).
 *
 *   npx tsx scripts/sim-achievement-thresholds.ts [snake|2048|stack]
 *
 * Each game's own rules code plays a bot, with a mistake rate per skill:
 *
 * - snake: runs stop at 200 apples or 12,000 ticks. A bot that takes the shortest path to the apple when it can still
 *   reach its own tail afterwards, otherwise chases its tail. Each tick it
 *   mis-presses a random turn with a probability that grows with the tick
 *   rate. 18 x 18 board, 8 ticks a second rising to 15.
 * - 2048: a bot that looks two moves ahead (a move, a sampled spawn, a move)
 *   and scores a board by its tiles' places along a snake from one corner plus
 *   its empty cells, and plays a random legal move with probability eps. Tiles
 *   and spawns follow the game's rules (90% 2, 10% 4). DEPTH and N2048 in the
 *   environment set the lookahead (2) and the runs per skill (150).
 * - stack: the real rules (stack-replay.ts, rules 2). Each drop aims at the
 *   tower's centre and misses by a normal timing error (SD in milliseconds)
 *   plus a normal error in where the eye puts the block (SD in pixels). Runs
 *   stop at 400. scripts/verify-stack-endless-replay.ts uses the same model.
 *
 * Prints single-run p10 / p50 / p90, then the median best after 10 runs (a
 * first session) and after 100 runs (a few weeks), because the achievement
 * keeps a player's best run, not their typical one.
 */
import {
  DIRECTION_VECTORS,
  FOOD_SCORE,
  GRID_SIZE,
  INITIAL_TICK_RATE,
  OPPOSITE_DIRECTIONS,
  createSnakeRng,
  generateFoodPosition,
  tickRateForApples,
} from '../src/app/(games)/snake/_snake-helpers';
import type { Direction, Position } from '../src/app/(games)/snake/_snake-types';
import {
  createStackRun,
  stackAimElapsedMs,
  stackDropAt,
  stackRow,
} from '../src/server/arcade/stack-replay';

const RUNS = 300;

let s32 = 0x9e3779b9;
const rand = () => {
  s32 ^= s32 << 13;
  s32 ^= s32 >>> 17;
  s32 ^= s32 << 5;
  return ((s32 >>> 0) % 1_000_000) / 1_000_000;
};
const gauss = () => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
const pct = (xs: number[], p: number) => xs[Math.min(xs.length - 1, Math.floor(p * xs.length))]!;
const sorted = (xs: number[]) => [...xs].sort((a, b) => a - b);

function report(game: string, skill: string, runs: number[]) {
  const s = sorted(runs);
  const bestOf = (n: number) => {
    const bests: number[] = [];
    for (let i = 0; i < 600; i += 1) {
      let b = 0;
      for (let k = 0; k < n; k += 1) b = Math.max(b, runs[Math.floor(rand() * runs.length)]!);
      bests.push(b);
    }
    const sb = sorted(bests);
    return `${pct(sb, 0.5)} (p25 ${pct(sb, 0.25)}, p75 ${pct(sb, 0.75)})`;
  };
  console.log(
    `${game.padEnd(6)} ${skill.padEnd(7)} run p10 ${String(pct(s, 0.1)).padStart(5)} p50 ${String(pct(s, 0.5)).padStart(5)} p90 ${String(pct(s, 0.9)).padStart(5)}  best of 10: ${bestOf(10)}  best of 100: ${bestOf(100)}`,
  );
}

/* ------------------------------ snake ------------------------------ */

const DIRS: Direction[] = ['UP', 'DOWN', 'LEFT', 'RIGHT'];
const SNAKE_SKILLS = [
  { name: 'novice', slip: 0.06 },
  { name: 'casual', slip: 0.03 },
  { name: 'good', slip: 0.015 },
  { name: 'strong', slip: 0.006 },
  { name: 'expert', slip: 0.002 },
] as const;

const idx = (p: Position) => p.y * GRID_SIZE + p.x;
function reach(snake: Position[], from: Position, goal: (p: Position) => boolean): Position[] | null {
  const blocked = new Set(snake.slice(0, -1).map(idx));
  const prev = new Map<number, number>([[idx(from), -1]]);
  const queue = [from];
  while (queue.length) {
    const at = queue.shift()!;
    if (goal(at) && (at !== from || goal(from))) {
      const path: Position[] = [];
      let k = idx(at);
      while (k !== -1) {
        path.unshift({ x: k % GRID_SIZE, y: Math.floor(k / GRID_SIZE) });
        k = prev.get(k)!;
      }
      return path;
    }
    for (const d of DIRS) {
      const n = { x: at.x + DIRECTION_VECTORS[d].x, y: at.y + DIRECTION_VECTORS[d].y };
      if (n.x < 0 || n.y < 0 || n.x >= GRID_SIZE || n.y >= GRID_SIZE) continue;
      if (blocked.has(idx(n)) || prev.has(idx(n))) continue;
      prev.set(idx(n), idx(at));
      queue.push(n);
    }
  }
  return null;
}
const dirTo = (a: Position, b: Position): Direction =>
  DIRS.find((d) => a.x + DIRECTION_VECTORS[d].x === b.x && a.y + DIRECTION_VECTORS[d].y === b.y)!;

function snakeWant(snake: Position[], food: Position): Direction | null {
  const head = snake[0]!;
  const path = reach(snake, head, (p) => p.x === food.x && p.y === food.y);
  if (path && path.length > 1) {
    // After eating, the snake is the path's cells plus its old body, minus the tail it didn't drop.
    const grown = [...path.slice().reverse(), ...snake.slice(1)].slice(0, snake.length + 1);
    const tail = grown[grown.length - 1]!;
    const safe = reach([...grown.slice(0, -1), tail], grown[0]!, (p) => p.x === tail.x && p.y === tail.y);
    if (safe || grown.length < 6) return dirTo(head, path[1]!);
  }
  // Chase the tail, or take any open neighbour with the most room.
  const tail = snake[snake.length - 1]!;
  const toTail = reach(snake.slice(0, -1).concat(snake[snake.length - 1]!), head, (p) => p.x === tail.x && p.y === tail.y);
  if (toTail && toTail.length > 1) return dirTo(head, toTail[1]!);
  return null;
}

function playSnake(seed: number, slip: number): number {
  const next = createSnakeRng(seed);
  let snake: Position[] = [
    { x: 4, y: 9 },
    { x: 3, y: 9 },
    { x: 2, y: 9 },
  ];
  let dir: Direction = 'RIGHT';
  let food = generateFoodPosition(snake, next);
  let apples = 0;
  for (let tick = 0; tick < 12_000 && apples < 200; tick += 1) {
    const want = snakeWant(snake, food);
    if (want && want !== OPPOSITE_DIRECTIONS[dir]) dir = want;
    const rate = tickRateForApples(apples);
    if (rand() < slip * (rate / INITIAL_TICK_RATE)) {
      const options = DIRS.filter((d) => d !== OPPOSITE_DIRECTIONS[dir]);
      dir = options[Math.floor(rand() * options.length)]!;
    }
    const head = { x: snake[0]!.x + DIRECTION_VECTORS[dir].x, y: snake[0]!.y + DIRECTION_VECTORS[dir].y };
    if (head.x < 0 || head.y < 0 || head.x >= GRID_SIZE || head.y >= GRID_SIZE) break;
    if (snake.slice(0, -1).some((p) => p.x === head.x && p.y === head.y)) break;
    snake = [head, ...snake];
    if (head.x === food.x && head.y === food.y) {
      apples += 1;
      food = generateFoodPosition(snake, next);
    } else snake.pop();
  }
  return apples * FOOD_SCORE;
}

/* ------------------------------ 2048 ------------------------------ */

const DEPTH = Number(process.env.DEPTH ?? 2);
type Board = number[]; // 16 cells, exponent (0 = empty)
const EPS = [
  { name: 'novice', eps: 0.35 },
  { name: 'casual', eps: 0.16 },
  { name: 'good', eps: 0.06 },
  { name: 'strong', eps: 0.02 },
  { name: 'expert', eps: 0.004 },
] as const;

function slideLine(line: number[]): { line: number[]; gained: number } {
  const tiles = line.filter(Boolean);
  const out: number[] = [];
  let gained = 0;
  for (let i = 0; i < tiles.length; i += 1) {
    if (tiles[i] === tiles[i + 1]) {
      out.push(tiles[i]! + 1);
      gained += 2 ** (tiles[i]! + 1);
      i += 1;
    } else out.push(tiles[i]!);
  }
  while (out.length < 4) out.push(0);
  return { line: out, gained };
}
function move(board: Board, dir: number): { board: Board; moved: boolean } {
  const out = board.slice();
  let moved = false;
  for (let i = 0; i < 4; i += 1) {
    const cells = [0, 1, 2, 3].map((k) => (dir < 2 ? (dir === 0 ? i * 4 + k : i * 4 + 3 - k) : dir === 2 ? k * 4 + i : (3 - k) * 4 + i));
    const { line } = slideLine(cells.map((c) => board[c]!));
    cells.forEach((c, k) => {
      if (out[c] !== line[k]) moved = true;
      out[c] = line[k]!;
    });
  }
  return { board: out, moved };
}
/* Weight each cell by its place along a snake through the board, so the big
   tiles sit in one corner in a line, and reward empty cells. */
const SNAKE_W = [15, 14, 13, 12, 8, 9, 10, 11, 7, 6, 5, 4, 0, 1, 2, 3].map((e) => 4 ** (e / 2));
function heuristic(b: Board): number {
  let w = 0;
  let empty = 0;
  for (let i = 0; i < 16; i += 1) {
    if (b[i]) w += SNAKE_W[i]! * 2 ** b[i]!;
    else empty += 1;
  }
  return w / 1000 + empty * 40;
}
function spawn(b: Board) {
  const empties = b.flatMap((v, i) => (v ? [] : [i]));
  if (!empties.length) return;
  b[empties[Math.floor(rand() * empties.length)]!] = rand() < 0.9 ? 1 : 2;
}
function expect(b: Board, depth: number): number {
  const empties = b.flatMap((v, i) => (v ? [] : [i]));
  if (!empties.length) return -1e9;
  const sample = empties.length > 4 ? [...empties].sort(() => rand() - 0.5).slice(0, 4) : empties;
  let total = 0;
  for (const cell of sample) {
    for (const [value, p] of [[1, 0.9], [2, 0.1]] as const) {
      const n = b.slice();
      n[cell] = value;
      total += p * best(n, depth);
    }
  }
  return total / sample.length;
}
function best(b: Board, depth: number): number {
  let top = -1e9;
  for (let d = 0; d < 4; d += 1) {
    const m = move(b, d);
    if (!m.moved) continue;
    top = Math.max(top, depth <= 1 ? heuristic(m.board) : expect(m.board, depth - 1));
  }
  return top;
}
function play2048(eps: number): number {
  const b: Board = new Array(16).fill(0);
  spawn(b);
  spawn(b);
  let board = b;
  for (;;) {
    const options = [0, 1, 2, 3].map((d) => ({ d, m: move(board, d) })).filter((o) => o.m.moved);
    if (!options.length) break;
    let pick = options[Math.floor(rand() * options.length)]!;
    if (rand() >= eps) {
      let top = -Infinity;
      for (const o of options) {
        const v = expect(o.m.board, DEPTH);
        if (v > top) {
          top = v;
          pick = o;
        }
      }
    }
    board = pick.m.board;
    spawn(board);
  }
  return 2 ** Math.max(...board);
}

/* ------------------------------ stack ------------------------------ */

/* ms: timing error of the press. px: how far off the eye judges the block's
   position, which doesn't shrink as the block gets faster. */
const STACK_SKILLS = [
  { name: 'novice', ms: 90, px: 30 },
  { name: 'casual', ms: 60, px: 20 },
  { name: 'good', ms: 40, px: 13 },
  { name: 'strong', ms: 28, px: 9 },
  { name: 'expert', ms: 18, px: 6 },
] as const;

function playStack(ms: number, px: number): number {
  const run = createStackRun();
  while (!run.died && run.height < 400) {
    // The first time, 180 ms or more into the row, that the block lines up.
    const aim = stackAimElapsedMs(run, 180);
    const speed = stackRow(run.height).speed;
    const t = Math.round(run.rowStartMs + aim + gauss() * ms + (gauss() * px) / speed);
    stackDropAt(run, Math.max(run.rowStartMs + 130, t));
  }
  return run.height;
}

const only = process.argv[2];
if (!only || only === 'snake') {
  for (const k of SNAKE_SKILLS) report('snake', k.name, Array.from({ length: RUNS }, (_, i) => playSnake(1000 + i * 37, k.slip)));
}
if (!only || only === '2048') {
  for (const k of EPS) report('2048', k.name, Array.from({ length: Number(process.env.N2048 ?? 150) }, () => play2048(k.eps)));
}
if (!only || only === 'stack') {
  for (const k of STACK_SKILLS) report('stack', k.name, Array.from({ length: RUNS }, () => playStack(k.ms, k.px)));
}
process.exit(0);
