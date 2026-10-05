/**
 * Snake's trusted score: seeded-replay, tick-clock and tamper proof.
 *
 *   npx tsx scripts/verify-snake-replay.ts
 *
 *  1. Rules lock: the start board, the tick ramp (8 a second, up to 15, a
 *     step every 5 apples) and the wire form.
 *  2. Honest runs: a reference client built from the client's own helpers
 *     (createSnakeRng, generateFoodPosition, pushDirection, tickRateForApples)
 *     plays a bot to a crash, logging each queued turn with its tick, as
 *     _snake-client.tsx does. The server's replay of the log must reach the
 *     same score, apple count and tick count, so the score the player saw is
 *     the score saved and the tickets it pays don't change.
 *  3. Clock: the same client driven by its frame loop at 30, 60, 120 and 144
 *     Hz with jitter and dropped frames. The replay's least possible duration
 *     never exceeds the wall time the run really took, so an honest run is
 *     never rejected as too long for its session.
 *  4. Tampered runs: an inflated score, the old one-POST exploit (any score,
 *     no game), apples out of place (a bot steered to another seed's apples),
 *     forged and dropped turns, illegal turns, impossible speed, a run longer
 *     than the session, turns after the run ended, and bad shapes.
 *
 * Replayed sessions are the score route's job (the session row is consumed
 * once); scripts/verify-trusted-scores-http.ts covers that over HTTP.
 *
 * Exits non-zero on any failed assertion.
 */
import {
  INITIAL_TICK_RATE,
  MAX_TICK_RATE,
  SNAKE_DIRECTION_LETTER,
  tickRateForApples,
} from '@/app/(games)/snake/_snake-helpers';
import type { Direction } from '@/app/(games)/snake/_snake-types';
import { playClient, type ClientRun } from './lib/snake-bot';
import {
  SNAKE_CLOCK_SLACK_MS,
  SNAKE_MAX_INPUTS,
  parseSnakeInputs,
  replaySnakeRun,
  verifySnakeRun,
  type SnakeInput,
} from '@/server/arcade/snake-replay';
import { calculateGameRewardCredits } from '@/server/arcade/rewards/wallet';

let failures = 0;
let checks = 0;
const assert = (cond: boolean, msg: string) => {
  checks += 1;
  if (!cond) {
    console.error('  FAIL: ' + msg);
    failures += 1;
  }
};

function mulberry32(seed: number) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DIRS: Direction[] = ['UP', 'DOWN', 'LEFT', 'RIGHT'];

const verify = (
  run: ClientRun,
  inputs: readonly SnakeInput[] = run.inputs,
  claim = run.score,
  elapsedMs: number | undefined = run.wallMs + 400,
  seed = run.seed,
) => verifySnakeRun(seed, inputs, claim, { elapsedMs });

const failure = (run: ReturnType<typeof verifySnakeRun>) =>
  run.ok === false ? (run as Extract<typeof run, { ok: false }>).reason : null;

// ── 1. Rules lock ──────────────────────────────────────────────────────────
console.log('1. Rules');
{
  assert(INITIAL_TICK_RATE === 8 && MAX_TICK_RATE === 15, 'tick rate bounds');
  assert(tickRateForApples(0) === 8 && tickRateForApples(4) === 8, '8 a second to start');
  assert(tickRateForApples(5) === 8.75 && tickRateForApples(10) === 9.5, 'a step every 5 apples');
  assert(tickRateForApples(47) === 14.75 && tickRateForApples(50) === 15 && tickRateForApples(500) === 15, 'capped at 15');
  // No turns: the snake runs straight and hits the wall on tick 14 (x 4 to 18).
  const straight = replaySnakeRun(1, []);
  assert(straight.ok && straight.ticks === 14 && straight.ended === 'died', 'a snake with no turns dies at the wall');
  assert(straight.ok && Math.abs(straight.minDurationMs - 14 * 125) < 1e-6, 'fourteen ticks at 8 a second');
  const parsed = parseSnakeInputs([[0, 'U'], [3, 'L']]);
  assert(parsed !== null && parsed.length === 2 && parsed[1]!.dir === 'LEFT', 'wire form parses');
  assert(parseSnakeInputs([[0, 'X']]) === null, 'unknown letter');
  assert(parseSnakeInputs([[-1, 'U']]) === null, 'negative tick');
  assert(parseSnakeInputs([[1.5, 'U']]) === null, 'fractional tick');
  assert(parseSnakeInputs([['0', 'U']]) === null, 'string tick');
  assert(parseSnakeInputs('U') === null && parseSnakeInputs(undefined) === null, 'not a list');
  assert(parseSnakeInputs(new Array(SNAKE_MAX_INPUTS + 1).fill([0, 'U'])) === null, 'too many turns');
  for (const dir of DIRS) assert(parseSnakeInputs([[0, SNAKE_DIRECTION_LETTER[dir]]])?.[0]?.dir === dir, `letter for ${dir}`);
}

// ── 2. Honest runs ─────────────────────────────────────────────────────────
console.log('2. Honest runs');
const honest: ClientRun[] = [];
{
  const rng = mulberry32(20261003);
  for (let i = 0; i < 300; i += 1) {
    const seed = Math.floor(rng() * 2 ** 31);
    const apples = Math.floor(rng() * rng() * 120);
    const run = playClient(seed, { apples, rng, humanDoubles: i % 3 === 0 ? 0.1 : 0 });
    honest.push(run);
    const result = verify(run);
    if (result.ok === false) {
      assert(false, `honest run seed ${seed} (${apples} apples) rejected: ${failure(result)}`);
      continue;
    }
    assert(result.score === run.score, `seed ${seed}: score ${result.score} vs client ${run.score}`);
    assert(result.ticks === run.ticks, `seed ${seed}: ticks ${result.ticks} vs client ${run.ticks}`);
    assert(Math.abs(result.minDurationMs - run.minMs) < 1e-6, `seed ${seed}: the tick clock agrees`);
    assert(result.ended === 'died', `seed ${seed}: ends in a crash`);
  }
  const scores = honest.map((r) => r.score).sort((a, b) => a - b);
  const q = (p: number) => scores[Math.floor(p * (scores.length - 1))];
  console.log(
    `   ${honest.length} runs accepted with the same score, apples and ticks; score p10/p50/p90/max ${q(0.1)}/${q(0.5)}/${q(0.9)}/${scores[scores.length - 1]}, ` +
      `longest ${Math.max(...honest.map((r) => r.ticks))} ticks, ${honest.reduce((n, r) => n + r.inputs.length, 0)} turns`,
  );
  let same = 0;
  for (const run of honest) {
    const server = verify(run);
    if (
      server.ok &&
      calculateGameRewardCredits({ gameType: 'snake', score: server.score }) ===
        calculateGameRewardCredits({ gameType: 'snake', score: run.score })
    ) {
      same += 1;
    }
  }
  assert(same === honest.length, 'every honest run pays the tickets it showed');
  console.log(
    `   tickets by score: ${[20, 70, 160, 400, 1000].map((s) => `${s} -> ${calculateGameRewardCredits({ gameType: 'snake', score: s })}`).join(', ')}`,
  );
  assert(Math.max(...scores) >= 300, 'the bots reach long runs');
}

// ── 3. Clock ───────────────────────────────────────────────────────────────
console.log('3. Frame rates');
{
  const rng = mulberry32(31);
  for (const frames of [
    { hz: 30, jitterMs: 2, dropRate: 0 },
    { hz: 60, jitterMs: 1, dropRate: 0 },
    { hz: 60, jitterMs: 4, dropRate: 0.03 },
    { hz: 120, jitterMs: 1, dropRate: 0 },
    { hz: 144, jitterMs: 1, dropRate: 0.01 },
    { hz: 24, jitterMs: 6, dropRate: 0.05 },
  ] as const) {
    let worst = Infinity;
    let accepted = 0;
    const runs = 25;
    for (let i = 0; i < runs; i += 1) {
      const seed = Math.floor(rng() * 2 ** 31);
      const run = playClient(seed, { apples: 20 + Math.floor(rng() * 80), rng, frames, humanDoubles: 0.05 });
      // The session is stamped before the run's clock starts: 150 to 900 ms earlier.
      const elapsed = run.wallMs + 150 + rng() * 750;
      const result = verify(run, undefined, undefined, elapsed);
      if (result.ok && result.score === run.score) accepted += 1;
      else assert(false, `${frames.hz} Hz seed ${seed}: ${failure(result)}`);
      // How far the least possible duration sits under the real wall time.
      worst = Math.min(worst, run.wallMs - run.minMs);
    }
    assert(accepted === runs, `${frames.hz} Hz accepted ${accepted}/${runs}`);
    // The clock never runs ahead of the wall by more than the slack the route allows.
    assert(worst > -SNAKE_CLOCK_SLACK_MS, `${frames.hz} Hz: least duration vs wall ${worst.toFixed(0)} ms`);
    console.log(`   ${frames.hz} Hz jitter ${frames.jitterMs} ms drops ${frames.dropRate}: ${accepted}/${runs} accepted; the least duration runs past the wall by at most ${Math.max(0, -worst).toFixed(0)} ms (slack ${SNAKE_CLOCK_SLACK_MS})`);
  }
}

// ── 4. Tampered runs ───────────────────────────────────────────────────────
console.log('4. Tampered runs');
{
  const base = honest.filter((r) => r.apples >= 40).sort((a, b) => b.apples - a.apples)[3]!;
  const rejected = (label: string, result: ReturnType<typeof verifySnakeRun>) => {
    assert(result.ok === false, `${label} is rejected`);
    return failure(result);
  };
  console.log(`   base run: seed ${base.seed}, ${base.apples} apples (score ${base.score}), ${base.ticks} ticks, ${base.inputs.length} turns`);

  // The claim
  rejected('an inflated score', verify(base, undefined, base.score + 10));
  rejected('a doubled score', verify(base, undefined, base.score * 2));
  rejected('a deflated score', verify(base, undefined, base.score - 10));
  // The old exploit: a run no game was played for.
  rejected('the one-POST exploit (no turns, 3000)', verify(base, [], 3000, 600_000));
  rejected('a long scripted run (no turns, 2000)', verify(base, [], 2000, 3_600_000));
  assert(parseSnakeInputs(undefined) === null, 'the one-POST exploit with no turn list does not parse');

  // Apples out of place: a bot steered to another seed's apples, submitted on
  // this session's seed with the score it earned on its own.
  let misplaced = 0;
  const rng = mulberry32(99);
  for (let i = 0; i < 30; i += 1) {
    const other = playClient(Math.floor(rng() * 2 ** 31), { apples: 60, rng });
    const result = verify(other, other.inputs, other.score, 3_600_000, base.seed + i + 1);
    if (result.ok === false) misplaced += 1;
  }
  assert(misplaced === 30, `runs steered at other apples rejected ${misplaced}/30`);

  // Forged turns
  let forged = 0;
  let caught = 0;
  for (let i = 0; i < 60; i += 1) {
    const at = Math.floor(rng() * base.inputs.length);
    const copy = base.inputs.map((m) => ({ ...m }));
    if (i % 3 === 0) {
      copy[at] = { k: copy[at]!.k, dir: DIRS[Math.floor(rng() * 4)]! };
    } else if (i % 3 === 1) {
      copy.splice(at, 1);
    } else {
      copy[at] = { k: copy[at]!.k + 1 + Math.floor(rng() * 3), dir: copy[at]!.dir };
      copy.sort((a, b) => a.k - b.k);
    }
    forged += 1;
    const result = verify(base, copy, undefined, 3_600_000);
    if (result.ok === false) caught += 1;
    // A forged list that still eats the claimed apples is a legal run with
    // that score (a turn that made no difference): saved as the replay's.
    else assert(result.score === base.score, 'a forged list was accepted with a different score');
  }
  assert(caught >= forged * 0.85, `forged turns rejected ${caught}/${forged}`);
  console.log(`   changed, dropped and shifted turns: rejected ${caught}/${forged}; the rest still eat the same apples, a legal run`);

  // Illegal turns
  rejected('a reversal into the neck', verify(base, [{ k: 0, dir: 'LEFT' }, ...base.inputs], undefined, 3_600_000));
  rejected('a repeated direction', verify(base, [{ k: 0, dir: 'RIGHT' }, ...base.inputs], undefined, 3_600_000));
  const crowd: SnakeInput[] = [{ k: 0, dir: 'UP' }, { k: 0, dir: 'LEFT' }, { k: 0, dir: 'UP' }, ...base.inputs];
  rejected('three turns queued in one tick', verify(base, crowd, undefined, 3_600_000));
  rejected('turns out of order', verify(base, [base.inputs[1]!, base.inputs[0]!, ...base.inputs.slice(2)], undefined, 3_600_000));
  rejected('turns after the run ended', verify(base, [...base.inputs, { k: base.ticks + 3, dir: 'UP' }], undefined, 3_600_000));
  rejected('a turn on the tick the snake died', verify(base, [...base.inputs, { k: base.ticks, dir: 'UP' }], undefined, 3_600_000));

  // Speed: the same run on a session too young for its ticks.
  rejected('twice the tick rate (half the time)', verify(base, undefined, undefined, base.minMs / 2));
  rejected('a run of a minute on a session of five seconds', verify(base, undefined, undefined, 5000));
  assert(verify(base, undefined, undefined, base.minMs - 500).ok, 'a session 500 ms younger than the run (clock rounding) is accepted');
  rejected('a session 2 s younger than the run', verify(base, undefined, undefined, base.minMs - 2000));
  rejected('a session created just now', verify(base, undefined, undefined, 400));
  // A run too long for the session by a script that plays at 3x.
  const fast = playClient(base.seed, { apples: 150, rng });
  rejected('150 apples inside 40 s', verify(fast, undefined, undefined, 40_000));
  // The replay itself bounds a run that never ends.
  const loop: SnakeInput[] = [];
  for (let k = 0; k < 4000; k += 1) {
    const cycle: Direction[] = ['DOWN', 'LEFT', 'UP', 'RIGHT'];
    loop.push({ k: k * 2, dir: cycle[k % 4]! });
  }
  const looped = replaySnakeRun(base.seed, loop, { elapsedMs: 60_000 });
  assert(looped.ok === false, 'a run that never ends is cut off by the session clock');
}

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) process.exit(1);
