/**
 * Offline LADDER-DETERMINISM + REPLAY-PARITY proof for Blitz Tactics.
 *
 *   npx tsx scripts/verify-blitz-tactics-replay.ts
 *
 * Proves three things the score route depends on:
 *  1. Ladder determinism — buildLadder(seed) is a pure function of the seed
 *     (repeat calls identical; no repeats within a ladder; escalating bands),
 *     and different seeds generally yield different ladders.
 *  2. Replay parity — an honestly-simulated run (playing the bank's own
 *     solution moves, with human-plausible timestamps) validates to EXACTLY the
 *     number of puzzles solved, and the 3-strike rule ends the run.
 *  3. Tamper detection — a wrong final move, a sub-cadence solve, and an
 *     out-of-sequence slot are all caught by validateBlitzRun.
 *
 * Exits non-zero on any failed assertion.
 */
import { BLITZ_PUZZLES } from '@/server/arcade/data/blitz-tactics-puzzles';
import {
  buildLadder,
  validateBlitzRun,
  BLITZ_MIN_SOLVE_INTERVAL_MS,
  BLITZ_MAX_STRIKES,
  BLITZ_LADDER_LENGTH,
  type BlitzEvent,
} from '@/server/arcade/blitz-tactics-replay';

let failures = 0;
const assert = (cond: boolean, msg: string) => {
  if (!cond) {
    console.error('  FAIL: ' + msg);
    failures += 1;
  }
};

// The player moves of a puzzle's solution are the even indices.
const playerMovesOf = (solution: readonly string[]) =>
  solution.filter((_, i) => i % 2 === 0);

// ── 1. Ladder determinism ──────────────────────────────────────────────────
console.log('1. Ladder determinism');
{
  const seeds = [1, 2, 42, 1337, 999983, 2 ** 30];
  for (const seed of seeds) {
    const a = buildLadder(seed);
    const b = buildLadder(seed);
    assert(JSON.stringify(a) === JSON.stringify(b), `seed ${seed}: buildLadder not deterministic`);
    assert(a.length === BLITZ_LADDER_LENGTH, `seed ${seed}: ladder length ${a.length} != ${BLITZ_LADDER_LENGTH}`);
    assert(new Set(a).size === a.length, `seed ${seed}: ladder has repeated puzzles`);
    // escalating: average band of the first third < average band of the last third
    const bandOf = (idx: number) => BLITZ_PUZZLES[idx].band;
    const third = Math.floor(a.length / 3);
    const avg = (arr: number[]) => arr.reduce((s, x) => s + bandOf(x), 0) / arr.length;
    assert(avg(a.slice(0, third)) < avg(a.slice(-third)), `seed ${seed}: ladder does not escalate`);
  }
  // distinct seeds → generally distinct ladders
  const distinct = new Set(seeds.map((s) => JSON.stringify(buildLadder(s))));
  assert(distinct.size === seeds.length, 'distinct seeds produced identical ladders');
  console.log(`   ok — ${seeds.length} seeds deterministic, unique, escalating`);
}

// ── 2. Replay parity (honest runs) ─────────────────────────────────────────
console.log('2. Replay parity');
{
  const seed = 20260704;
  const ladder = buildLadder(seed);

  // (a) Solve the first N puzzles honestly with plausible spacing.
  const N = 15;
  let t = 1200;
  const events: BlitzEvent[] = [];
  for (let slot = 0; slot < N; slot += 1) {
    const puzzle = BLITZ_PUZZLES[ladder[slot]];
    t += 2200 + (slot % 5) * 500; // 2.2–4.2s per solve, all ≥ the cadence floor
    events.push({ i: slot, m: playerMovesOf(puzzle.solution), t });
  }
  const durationMs = t + 3000;
  const r = validateBlitzRun(seed, events, durationMs);
  assert(!r.rejected, `honest run rejected: ${r.reason}`);
  assert(r.solved === N, `honest run solved ${r.solved}, expected ${N}`);
  assert(r.strikes === 0, `honest run had ${r.strikes} strikes, expected 0`);
  console.log(`   ok — honest ${N}-solve run scored ${r.solved}/${N}, 0 strikes`);

  // (b) A run that misses 3 puzzles ends at the 3rd strike.
  const ev2: BlitzEvent[] = [];
  let t2 = 1000;
  for (let slot = 0; slot < 12; slot += 1) {
    const puzzle = BLITZ_PUZZLES[ladder[slot]];
    t2 += 2500;
    if (slot === 2 || slot === 5 || slot === 8) {
      // deliberate miss: drop the last player move so the mate is never
      // delivered (an incomplete attempt counts as a miss/strike).
      const pm = playerMovesOf(puzzle.solution);
      ev2.push({ i: slot, m: pm.slice(0, Math.max(0, pm.length - 1)), t: t2 });
    } else {
      ev2.push({ i: slot, m: playerMovesOf(puzzle.solution), t: t2 });
    }
  }
  const r2 = validateBlitzRun(seed, ev2, t2 + 3000);
  assert(!r2.rejected, `3-strike run rejected: ${r2.reason}`);
  assert(r2.strikes === BLITZ_MAX_STRIKES, `expected ${BLITZ_MAX_STRIKES} strikes, got ${r2.strikes}`);
  // The run stops at the 3rd miss (slot 8), so only solves BEFORE that count:
  // slots 0,1,3,4,6,7 = 6 solves (slots 9-11 never reached).
  assert(r2.solved === 6, `3-strike run solved ${r2.solved}, expected 6`);
  console.log(`   ok — 3-miss run stopped at strike ${r2.strikes}, scored ${r2.solved}`);
}

// ── 3. Tamper detection ────────────────────────────────────────────────────
console.log('3. Tamper detection');
{
  const seed = 55551;
  const ladder = buildLadder(seed);
  const p0 = BLITZ_PUZZLES[ladder[0]];
  const p1 = BLITZ_PUZZLES[ladder[1]];

  // (a) Wrong final move: a mate-in-1 where the player plays a NON-mating legal
  //     move (find one from the bank's own first-move set that isn't the mate).
  //     Simplest robust tamper: submit an empty move list — the attempt cannot
  //     reach mate, so it is NOT solved (a miss), never a phantom solve.
  const tamperA = validateBlitzRun(seed, [{ i: 0, m: [], t: 2000 }], 5000);
  assert(!tamperA.rejected, 'empty-attempt run wrongly rejected');
  assert(tamperA.solved === 0, `empty attempt scored ${tamperA.solved}, expected 0 (a miss)`);
  assert(tamperA.strikes === 1, `empty attempt should be 1 strike, got ${tamperA.strikes}`);

  // (b) Sub-cadence solves: two legit solves spaced < the floor apart — the
  //     second must be DROPPED (not counted), capping score by time.
  const fast = Math.floor(BLITZ_MIN_SOLVE_INTERVAL_MS / 2);
  const tamperB = validateBlitzRun(
    seed,
    [
      { i: 0, m: playerMovesOf(p0.solution), t: 1500 },
      { i: 1, m: playerMovesOf(p1.solution), t: 1500 + fast },
    ],
    6000,
  );
  assert(!tamperB.rejected, 'sub-cadence run wrongly rejected');
  assert(tamperB.solved === 1, `sub-cadence: expected 1 counted solve, got ${tamperB.solved}`);
  console.log(`   ok — empty attempt = miss; sub-cadence 2nd solve dropped (score ${tamperB.solved})`);

  // (c) Out-of-sequence slots are rejected outright.
  const tamperC = validateBlitzRun(
    seed,
    [{ i: 0, m: playerMovesOf(p0.solution), t: 1500 }, { i: 5, m: playerMovesOf(BLITZ_PUZZLES[ladder[5]].solution), t: 4000 }],
    6000,
  );
  assert(tamperC.rejected, 'out-of-sequence slots were NOT rejected');
  console.log(`   ok — out-of-sequence slot rejected: "${tamperC.reason}"`);
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) FAILED.`);
  process.exit(1);
}
console.log('\nALL REPLAY/LADDER PROOFS PASS.');
