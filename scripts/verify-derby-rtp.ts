/**
 * Offline fairness/RTP verification gate for Derby Royale.
 *
 *   npx tsx scripts/verify-derby-rtp.ts
 *
 * Replays the production derivation path from a fresh 32-byte round seed:
 *   'form'   -> computeRoundOdds
 *   'winner' -> drawWinner
 *   'script' -> generateRaceScript
 *
 * Exits non-zero on any failed assertion.
 */
import crypto from 'node:crypto';

import {
  DERBY_HORSE_COUNT,
  DERBY_HORSES,
  DERBY_RTP,
  RACE_SAMPLE_MS,
  computeRoundOdds,
  drawWinner,
  effectiveRtp,
  generateRaceScript,
  mulberry32,
  type RaceScript,
  type RoundOdds,
} from '@/server/arcade/derby/derby-shared';
import { hmacFloat52, hmacUint32 } from '@/server/arcade/derby/engine';

const ROUNDS = 1_000_000;
const ODDS_SANITY_EVERY = 10_000;
const SCRIPT_SAMPLES = 2_000;
const SEED_BYTES = 32;
const SEED_BATCH = 50_000;

const RTP_ABS_TOLERANCE = 0.005;
const RTP_SIGMA_TOLERANCE = 4.5;
const MAX_FAILURES_PRINTED = 60;

let suppressedFailures = 0;
const failures: string[] = [];

function fail(msg: string): void {
  if (failures.length < MAX_FAILURES_PRINTED) {
    failures.push(msg);
  } else {
    suppressedFailures += 1;
  }
}

function assert(cond: boolean, msg: string): void {
  if (!cond) fail(msg);
}

function pct(v: number): string {
  return `${(v * 100).toFixed(4)}%`;
}

function pp(v: number): string {
  return `${(v * 100).toFixed(4)} pp`;
}

function fixed(v: number, digits = 4): string {
  return Number.isFinite(v) ? v.toFixed(digits) : String(v);
}

function isPermutation(values: number[], n: number): boolean {
  if (values.length !== n) return false;
  const seen = new Set(values);
  if (seen.size !== n) return false;
  for (let i = 0; i < n; i += 1) {
    if (!seen.has(i)) return false;
  }
  return true;
}

function validateOdds(roundNo: number, odds: RoundOdds): void {
  const prefix = `round ${roundNo}: odds`;
  assert(odds.p.length === DERBY_HORSE_COUNT, `${prefix} p length ${odds.p.length}`);
  assert(odds.m.length === DERBY_HORSE_COUNT, `${prefix} m length ${odds.m.length}`);
  assert(odds.slot.length === DERBY_HORSE_COUNT, `${prefix} slot length ${odds.slot.length}`);

  const pSum = odds.p.reduce((sum, p) => sum + p, 0);
  assert(Math.abs(pSum - 1) <= 1e-9, `${prefix} probabilities sum to ${pSum}, expected 1`);

  for (let i = 0; i < DERBY_HORSE_COUNT; i += 1) {
    assert(Number.isFinite(odds.p[i]) && odds.p[i] > 0, `${prefix} p[${i}] is ${odds.p[i]}`);
    assert(Number.isFinite(odds.m[i]) && odds.m[i] >= 1.05, `${prefix} m[${i}] is ${odds.m[i]}`);
  }

  assert(isPermutation(odds.slot, DERBY_HORSE_COUNT), `${prefix} slot assignment is not a permutation: ${JSON.stringify(odds.slot)}`);

  const er = effectiveRtp(odds.m);
  assert(er >= 0.955 && er <= 0.965, `${prefix} effectiveRtp=${er}, expected [0.955, 0.965]`);
}

function firstProgressOneIndex(progress: number[]): number {
  return progress.findIndex((v) => v >= 1);
}

function validateRaceScript(sampleNo: number, seedHex: string, odds: RoundOdds, winnerIdx: number, script: RaceScript): boolean {
  const prefix = `script sample ${sampleNo} seed=${seedHex}`;
  const deterministic = generateRaceScript(
    mulberry32(hmacUint32(seedHex, 'script')),
    winnerIdx,
    odds.m,
  );
  assert(JSON.stringify(script) === JSON.stringify(deterministic), `${prefix}: script is not deterministic`);

  assert(script.winnerIdx === winnerIdx, `${prefix}: script winnerIdx ${script.winnerIdx} != drawn winner ${winnerIdx}`);
  assert(script.finishOrder[0] === winnerIdx, `${prefix}: finishOrder[0] ${script.finishOrder[0]} != winner ${winnerIdx}`);
  assert(isPermutation(script.finishOrder, DERBY_HORSE_COUNT), `${prefix}: finishOrder is not a permutation: ${JSON.stringify(script.finishOrder)}`);
  assert(script.finishTimesMs.length === DERBY_HORSE_COUNT, `${prefix}: finishTimesMs length ${script.finishTimesMs.length}`);
  assert(script.progress.length === DERBY_HORSE_COUNT, `${prefix}: progress horse count ${script.progress.length}`);

  assert(script.durationMs >= 55_000 && script.durationMs <= 75_000, `${prefix}: durationMs ${script.durationMs} outside [55000, 75000]`);

  let minFinish = Number.POSITIVE_INFINITY;
  let minHorse = -1;
  let minCount = 0;
  for (let i = 0; i < DERBY_HORSE_COUNT; i += 1) {
    const t = script.finishTimesMs[i];
    assert(Number.isFinite(t) && t > 0, `${prefix}: finishTimesMs[${i}] is ${t}`);
    assert(t <= script.durationMs, `${prefix}: finishTimesMs[${i}] ${t} > durationMs ${script.durationMs}`);
    if (t < minFinish) {
      minFinish = t;
      minHorse = i;
      minCount = 1;
    } else if (t === minFinish) {
      minCount += 1;
    }
  }

  // Progress is sampled every 500ms, so a photo finish can quantize two horses
  // to the same first 1.0 sample. The continuous finish clock is authoritative.
  assert(minHorse === winnerIdx && minCount === 1, `${prefix}: winner is not the unique earliest finish time`);

  for (let place = 1; place < script.finishOrder.length; place += 1) {
    const prev = script.finishOrder[place - 1];
    const cur = script.finishOrder[place];
    assert(
      script.finishTimesMs[prev] < script.finishTimesMs[cur],
      `${prefix}: finishOrder inconsistent at place ${place}: ${prev}@${script.finishTimesMs[prev]} >= ${cur}@${script.finishTimesMs[cur]}`,
    );
  }

  const expectedSamples = Math.floor(script.durationMs / RACE_SAMPLE_MS) + 1;
  for (let h = 0; h < DERBY_HORSE_COUNT; h += 1) {
    const progress = script.progress[h];
    assert(progress.length === expectedSamples, `${prefix}: progress[${h}] length ${progress.length} != ${expectedSamples}`);
    if (progress.length === 0) continue;

    assert(progress[0] >= 0 && progress[0] <= 1, `${prefix}: progress[${h}][0] outside [0,1]: ${progress[0]}`);
    for (let s = 1; s < progress.length; s += 1) {
      const prev = progress[s - 1];
      const cur = progress[s];
      assert(cur >= prev - 1e-12, `${prefix}: progress[${h}] decreases at sample ${s}: ${prev} -> ${cur}`);
      assert(cur >= -1e-12 && cur <= 1 + 1e-12, `${prefix}: progress[${h}][${s}] outside [0,1]: ${cur}`);
      assert(cur - prev <= 0.03 + 1e-12, `${prefix}: progress[${h}] delta ${cur - prev} exceeds 0.03 at sample ${s}`);
    }

    const expectedFirstOne = Math.ceil(script.finishTimesMs[h] / RACE_SAMPLE_MS);
    const actualFirstOne = firstProgressOneIndex(progress);
    assert(actualFirstOne === expectedFirstOne, `${prefix}: progress[${h}] first 1.0 sample ${actualFirstOne} != finish clock sample ${expectedFirstOne}`);
    assert(progress[progress.length - 1] === 1, `${prefix}: progress[${h}] does not finish by final sample`);
  }

  const runnerUpMargin = script.finishTimesMs[script.finishOrder[1]] - script.finishTimesMs[script.finishOrder[0]];
  return runnerUpMargin < 400;
}

const payoutSum = new Array<number>(DERBY_HORSE_COUNT).fill(0);
const payoutSumSq = new Array<number>(DERBY_HORSE_COUNT).fill(0);
const winsByHorse = new Array<number>(DERBY_HORSE_COUNT).fill(0);
const winsBySlot = new Array<number>(DERBY_HORSE_COUNT).fill(0);
const multiplierSumBySlot = new Array<number>(DERBY_HORSE_COUNT).fill(0);

let oddsSanityChecks = 0;
let scriptChecks = 0;
let photoFinishes = 0;

console.log('Derby Royale RTP/fairness verification');
console.log(`  rounds: ${ROUNDS.toLocaleString()}`);
console.log(`  script samples: ${SCRIPT_SAMPLES.toLocaleString()}`);
console.log('');

for (let offset = 0; offset < ROUNDS; offset += SEED_BATCH) {
  const batchRounds = Math.min(SEED_BATCH, ROUNDS - offset);
  const seeds = crypto.randomBytes(batchRounds * SEED_BYTES);

  for (let j = 0; j < batchRounds; j += 1) {
    const roundNo = offset + j + 1;
    const seedHex = seeds.subarray(j * SEED_BYTES, (j + 1) * SEED_BYTES).toString('hex');

    const odds = computeRoundOdds(mulberry32(hmacUint32(seedHex, 'form')));
    const winnerIdx = drawWinner(hmacFloat52(seedHex, 'winner'), odds.m);

    winsByHorse[winnerIdx] += 1;
    payoutSum[winnerIdx] += odds.m[winnerIdx];
    payoutSumSq[winnerIdx] += odds.m[winnerIdx] * odds.m[winnerIdx];
    winsBySlot[odds.slot[winnerIdx]] += 1;
    for (let h = 0; h < DERBY_HORSE_COUNT; h += 1) {
      multiplierSumBySlot[odds.slot[h]] += odds.m[h];
    }

    if (roundNo % ODDS_SANITY_EVERY === 0) {
      oddsSanityChecks += 1;
      validateOdds(roundNo, odds);
    }

    if (scriptChecks < SCRIPT_SAMPLES) {
      const script = generateRaceScript(
        mulberry32(hmacUint32(seedHex, 'script')),
        winnerIdx,
        odds.m,
      );
      scriptChecks += 1;
      if (validateRaceScript(scriptChecks, seedHex, odds, winnerIdx, script)) {
        photoFinishes += 1;
      }
    }
  }
}

const photoRate = photoFinishes / scriptChecks;
assert(photoRate >= 0.1 && photoRate <= 0.3, `photo-finish rate ${pct(photoRate)} outside [10%, 30%]`);

type HorseSummary = {
  horse: string;
  wins: number;
  winRate: number;
  rtp: number;
  stderr: number;
  tolerance: number;
  diff: number;
};

const horseSummary: HorseSummary[] = [];
for (let h = 0; h < DERBY_HORSE_COUNT; h += 1) {
  const rtp = payoutSum[h] / ROUNDS;
  const variance = Math.max(0, payoutSumSq[h] / ROUNDS - rtp * rtp);
  const stderr = Math.sqrt(variance / ROUNDS);

  // Longshot slots have high payout variance: a horse gets many zero returns
  // and occasional 25x-40x hits. At N=1,000,000, +/-0.005 is only about
  // 1.3-1.5 standard errors, so this gate keeps that floor but widens to 4.5
  // observed standard errors to avoid random false failures.
  const tolerance = Math.max(RTP_ABS_TOLERANCE, RTP_SIGMA_TOLERANCE * stderr);
  const diff = Math.abs(rtp - DERBY_RTP);
  assert(
    diff <= tolerance,
    `${DERBY_HORSES[h].name} RTP ${rtp} differs from ${DERBY_RTP} by ${diff}; tolerance=${tolerance}, stderr=${stderr}`,
  );

  horseSummary.push({
    horse: DERBY_HORSES[h].name,
    wins: winsByHorse[h],
    winRate: winsByHorse[h] / ROUNDS,
    rtp,
    stderr,
    tolerance,
    diff,
  });
}

console.log('Per-horse RTP');
console.log('  horse               wins      win rate    RTP        stderr     tol        diff');
for (const row of horseSummary) {
  console.log(
    `  ${row.horse.padEnd(18)} ${String(row.wins).padStart(7)}  ${pct(row.winRate).padStart(10)}  ${pct(row.rtp).padStart(9)}  ${pct(row.stderr).padStart(9)}  ${pct(row.tolerance).padStart(9)}  ${pp(row.diff).padStart(9)}`,
  );
}

console.log('');
console.log('Win rate by odds slot');
console.log('  slot  wins      win rate    avg multiplier');
for (let slot = 0; slot < DERBY_HORSE_COUNT; slot += 1) {
  console.log(
    `  ${String(slot).padStart(4)}  ${String(winsBySlot[slot]).padStart(7)}  ${pct(winsBySlot[slot] / ROUNDS).padStart(10)}  ${fixed(multiplierSumBySlot[slot] / ROUNDS, 2).padStart(14)}x`,
  );
}

console.log('');
console.log(`Odds sanity checks: ${oddsSanityChecks.toLocaleString()}`);
console.log(`Race-script checks: ${scriptChecks.toLocaleString()}`);
console.log(`Photo finishes: ${photoFinishes.toLocaleString()} / ${scriptChecks.toLocaleString()} (${pct(photoRate)})`);

if (failures.length > 0) {
  console.error(`\nFAILURES (${failures.length + suppressedFailures}):`);
  for (const f of failures) console.error('  FAIL: ' + f);
  if (suppressedFailures > 0) {
    console.error(`  ... ${suppressedFailures} more failure(s) suppressed`);
  }
  process.exit(1);
}

console.log('\nALL DERBY RTP/FAIRNESS CHECKS PASS.');
process.exit(0);
