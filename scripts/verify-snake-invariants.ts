/**
 * Offline RULE + REPLAY-DETERMINISM invariant proof for Snake.
 *
 *   npx tsx scripts/verify-snake-invariants.ts
 *
 * Pins the contract the score route, leaderboard, replay channel, and
 * anti-cheat rely on, so cosmetic/game-feel work cannot silently change the
 * rules:
 *  1. Board/timing/scoring constants — grid, tick rate, direction-queue cap,
 *     win length, and the +10-per-food score step.
 *  2. RNG determinism + parity — createSnakeRng reproduces the legacy inline
 *     mulberry32 implementation bit-for-bit; same seed → same stream.
 *  3. Direction-queue contract — pushDirection matches the legacy inline
 *     buffer logic over exhaustive input sequences (reversal rejection,
 *     duplicate rejection, validate-against-last-queued, size cap).
 *  4. Food placement — deterministic per seed, never on the snake body, and
 *     identical to the legacy inline loop.
 *  5. Submit-error message + rewards-hint semantics are unchanged.
 *
 * Exits non-zero on any failed assertion.
 */
import { readFileSync } from 'node:fs';

import {
  GRID_SIZE,
  CELL_SIZE,
  BASE_WIDTH,
  BASE_HEIGHT,
  INITIAL_TICK_RATE,
  MAX_DIRECTION_QUEUE,
  WINNING_SNAKE_LENGTH,
  FOOD_SCORE,
  REWARDS_HINT_TEXT,
  DIRECTION_VECTORS,
  OPPOSITE_DIRECTIONS,
  createSnakeRng,
  pushDirection,
  generateFoodPosition,
  getSubmitErrorMessage,
  isNewBest,
} from '@/app/(games)/snake/_snake-helpers';
import type { Direction, Position } from '@/app/(games)/snake/_snake-types';

let failures = 0;
const assert = (cond: boolean, msg: string) => {
  if (!cond) {
    console.error('  FAIL: ' + msg);
    failures += 1;
  }
};

// ── 1. Constants (exact parity lock) ────────────────────────────────────────
console.log('1. Board / timing / scoring constants…');
{
  assert(GRID_SIZE === 18, `GRID_SIZE ${GRID_SIZE}`);
  assert(CELL_SIZE === 34, `CELL_SIZE ${CELL_SIZE}`);
  assert(BASE_WIDTH === 612 && BASE_HEIGHT === 612, 'base board size drifted');
  assert(INITIAL_TICK_RATE === 8, `INITIAL_TICK_RATE ${INITIAL_TICK_RATE}`);
  assert(MAX_DIRECTION_QUEUE === 2, `MAX_DIRECTION_QUEUE ${MAX_DIRECTION_QUEUE}`);
  assert(WINNING_SNAKE_LENGTH === 18 * 18, `WINNING_SNAKE_LENGTH ${WINNING_SNAKE_LENGTH}`);
  assert(FOOD_SCORE === 10, `FOOD_SCORE ${FOOD_SCORE}`);
  assert(
    REWARDS_HINT_TEXT.includes('score 20 = 1 Ticket') &&
      REWARDS_HINT_TEXT.includes('score 70 = 5 Tickets') &&
      REWARDS_HINT_TEXT.includes('score 160 = 10 Tickets'),
    'rewards hint thresholds drifted',
  );
  // Direction algebra used by movement + reversal validation.
  assert(
    DIRECTION_VECTORS.UP.x === 0 && DIRECTION_VECTORS.UP.y === -1 &&
      DIRECTION_VECTORS.DOWN.x === 0 && DIRECTION_VECTORS.DOWN.y === 1 &&
      DIRECTION_VECTORS.LEFT.x === -1 && DIRECTION_VECTORS.LEFT.y === 0 &&
      DIRECTION_VECTORS.RIGHT.x === 1 && DIRECTION_VECTORS.RIGHT.y === 0,
    'direction vectors drifted',
  );
  for (const dir of ['UP', 'DOWN', 'LEFT', 'RIGHT'] as const) {
    const opp = OPPOSITE_DIRECTIONS[dir];
    const v = DIRECTION_VECTORS[dir];
    const ov = DIRECTION_VECTORS[opp];
    assert(v.x === -ov.x && v.y === -ov.y, `opposite of ${dir} is not a reversal`);
  }
}

// ── 2. RNG determinism + legacy parity ──────────────────────────────────────
console.log('2. RNG determinism + legacy parity…');
{
  // Verbatim copy of the legacy inline implementation that used to live in
  // the client. The extracted helper must match it bit-for-bit.
  const legacyRng = (seed: number) => {
    let rngState = seed >>> 0;
    return () => {
      rngState += 0x6d2b79f5;
      let t = rngState;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  for (const seed of [0, 1, 42, 123456789, 0xffffffff, 2718281828]) {
    const a = createSnakeRng(seed);
    const b = legacyRng(seed);
    for (let i = 0; i < 5000; i++) {
      const va = a();
      const vb = b();
      assert(va === vb, `rng parity drift at seed=${seed} draw=${i}: ${va} vs ${vb}`);
      assert(va >= 0 && va < 1, `rng out of range at seed=${seed} draw=${i}`);
    }
    // Same seed → same stream (replay determinism).
    const r1 = createSnakeRng(seed);
    const r2 = createSnakeRng(seed);
    for (let i = 0; i < 100; i++) {
      assert(r1() === r2(), `same-seed streams diverge at seed=${seed} draw=${i}`);
    }
  }
  const d1 = createSnakeRng(1);
  const d2 = createSnakeRng(2);
  assert(d1() !== d2(), 'different seeds produced identical first draws');
}

// ── 3. Direction-queue contract (legacy parity, exhaustive) ─────────────────
console.log('3. Direction-queue contract…');
{
  // Verbatim copy of the legacy inline queue logic from the client.
  const legacyPush = (
    queue: Direction[],
    currentDir: Direction,
    newDir: Direction,
  ): boolean => {
    const lastDir = queue.length > 0 ? queue[queue.length - 1] : currentDir;
    if (newDir === OPPOSITE_DIRECTIONS[lastDir]) return false;
    if (newDir === lastDir) return false;
    if (queue.length < MAX_DIRECTION_QUEUE) {
      queue.push(newDir);
      if (queue.length > 2) queue.shift();
      return true;
    }
    return false;
  };

  const DIRS: Direction[] = ['UP', 'DOWN', 'LEFT', 'RIGHT'];

  // Exhaustive: every starting direction × every input sequence up to
  // length 5 — compare queue contents AND accept/reject outcome.
  const enumerate = (prefix: Direction[], depth: number) => {
    for (const current of DIRS) {
      const qNew: Direction[] = [];
      const qOld: Direction[] = [];
      for (const dir of prefix) {
        const rNew = pushDirection(qNew, current, dir);
        const rOld = legacyPush(qOld, current, dir);
        assert(rNew === rOld,
          `accept mismatch current=${current} seq=${prefix.join(',')}`);
        assert(JSON.stringify(qNew) === JSON.stringify(qOld),
          `queue drift current=${current} seq=${prefix.join(',')}: ${qNew} vs ${qOld}`);
      }
    }
    if (depth > 0) {
      for (const d of DIRS) enumerate([...prefix, d], depth - 1);
    }
  };
  enumerate([], 4); // 4 + 16 + 64 + 256 + 1024 sequences × 4 start dirs

  // Spot-check the semantic rules directly.
  const q: Direction[] = [];
  assert(pushDirection(q, 'RIGHT', 'LEFT') === false, 'reversal accepted');
  assert(pushDirection(q, 'RIGHT', 'RIGHT') === false, 'duplicate accepted');
  assert(pushDirection(q, 'RIGHT', 'UP') === true, 'valid turn rejected');
  // Last queued is UP, so RIGHT is a legal second buffered turn…
  assert(pushDirection(q, 'RIGHT', 'RIGHT') === true, 'second buffered turn rejected');
  // …and a third input is dropped once the buffer is full.
  assert(pushDirection(q, 'RIGHT', 'DOWN') === false, 'queue overflow accepted');
  assert(
    q.length === MAX_DIRECTION_QUEUE && q[0] === 'UP' && q[1] === 'RIGHT',
    `queue cap not enforced: ${q}`,
  );
  // Validation is against the LAST QUEUED direction, not the current one:
  // with UP queued from RIGHT, DOWN is a reversal of UP → rejected.
  const q2: Direction[] = ['UP'];
  assert(pushDirection(q2, 'RIGHT', 'DOWN') === false, 'last-queued validation broken');
}

// ── 4. Food placement determinism + body avoidance ──────────────────────────
console.log('4. Food placement…');
{
  // Legacy verbatim loop for parity comparison.
  const legacyGenerate = (snake: readonly Position[], nextRandom: () => number) => {
    let newFood: Position;
    do {
      newFood = {
        x: Math.floor(nextRandom() * GRID_SIZE),
        y: Math.floor(nextRandom() * GRID_SIZE),
      };
    } while (
      snake.some(
        (segment: Position) => segment.x === newFood.x && segment.y === newFood.y,
      )
    );
    return newFood;
  };

  for (const seed of [7, 99, 2024, 0xdeadbeef]) {
    const rngA = createSnakeRng(seed);
    const rngB = createSnakeRng(seed);
    // Simulate a growing snake coiled through the middle rows.
    const snake: Position[] = [];
    for (let i = 0; i < 40; i++) {
      snake.push({ x: i % GRID_SIZE, y: 4 + Math.floor(i / GRID_SIZE) });
    }
    for (let i = 0; i < 300; i++) {
      const a = generateFoodPosition(snake, rngA);
      const b = legacyGenerate(snake, rngB);
      assert(a.x === b.x && a.y === b.y,
        `food parity drift seed=${seed} i=${i}: (${a.x},${a.y}) vs (${b.x},${b.y})`);
      assert(a.x >= 0 && a.x < GRID_SIZE && a.y >= 0 && a.y < GRID_SIZE,
        `food off-grid seed=${seed} i=${i}`);
      assert(!snake.some((s) => s.x === a.x && s.y === a.y),
        `food spawned on snake body seed=${seed} i=${i}`);
    }
  }

  // Nearly-full board: placement still terminates on the one free cell.
  const snake: Position[] = [];
  for (let y = 0; y < GRID_SIZE; y++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      if (x !== 5 || y !== 7) snake.push({ x, y });
    }
  }
  const rng = createSnakeRng(1234);
  const food = generateFoodPosition(snake, rng);
  assert(food.x === 5 && food.y === 7,
    `only-free-cell placement failed: (${food.x},${food.y})`);
}

// ── 5. Submit-error message semantics ───────────────────────────────────────
console.log('5. Submit-error message semantics…');
{
  assert(
    getSubmitErrorMessage(429, { error: 'Too many score submissions.', retryAfterSec: 42 }) ===
      'Too many score submissions. Try again in 42s.',
    '429 message drifted',
  );
  assert(
    getSubmitErrorMessage(429, null) === 'Too many runs.',
    '429 fallback drifted',
  );
  assert(
    getSubmitErrorMessage(400, { error: 'Bad', details: 'Detailed reason.' }) === 'Detailed reason.',
    'details precedence drifted',
  );
  assert(getSubmitErrorMessage(400, { error: 'Bad' }) === 'Bad', 'error fallback drifted');
  assert(
    getSubmitErrorMessage(500, null) === 'Could not save your run. Try again.',
    'generic fallback drifted',
  );
}

// ── 6. A new best beats the stored best, and is never 0 ─────────────────────
console.log('6. New best needs a score above 0 and above the stored best…');
{
  assert(!isNewBest(0, 0), 'a score of 0 is never a new best (nothing stored)');
  assert(!isNewBest(0, 120), 'a score of 0 is never a new best (best stored)');
  assert(!isNewBest(10, 10), 'a tie is not a new best');
  assert(!isNewBest(10, 500), 'a score under the stored best is not a new best');
  assert(isNewBest(10, 0), 'a first scoring run is a new best');
  assert(isNewBest(510, 500), 'a score over the stored best is a new best');
  assert(!isNewBest(Number.NaN, 0) && !isNewBest(-10, 0), 'a bad score is not a new best');
  assert(isNewBest(10, Number.NaN), 'an unknown best counts as 0 once a run scores');
  // The client has one rule for the callout and the result.
  const client = readFileSync(
    new URL('../src/app/(games)/snake/_snake-client.tsx', import.meta.url),
    'utf8',
  );
  assert(!/>\s*bestAtRunStartRef\.current/.test(client), 'the client compares to the best by hand');
  // The callout is useNewBestMoment, which uses isNewBest too.
  const hook = readFileSync(
    new URL('../src/features/arcade/lib/use-gameplay-callouts.ts', import.meta.url),
    'utf8',
  );
  assert(/useNewBestMoment\(/.test(client) && /isNewBest\(/.test(client), 'the client lost the moment or the result rule');
  assert(/isNewBest\(score, best\)/.test(hook), 'the new-best moment does not use isNewBest');
}

// ── Summary ─────────────────────────────────────────────────────────────────
if (failures > 0) {
  console.error(`\n${failures} invariant failure(s).`);
  process.exit(1);
}
console.log('\nAll Snake invariants hold.');
