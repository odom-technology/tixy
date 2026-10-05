/**
 * Client/server draw-parity gate for Lucky Cage.
 *
 *   npx tsx scripts/verify-lucky-cage-client-parity.ts
 *
 * src/features/arcade/lib/lucky-cage-draw.ts re-states mulberry32 and the
 * Fisher-Yates shuffle so the browser can recompute a revealed round without
 * pulling node:crypto into the client bundle. That replica is only honest if it
 * is byte-identical to the server path, so this script drives both over a large
 * seed corpus and requires exact agreement on:
 *
 *   - the five ball numbers AND their chute order;
 *   - the raw PRNG stream (mulberry32 vs luckyCageRng), bit for bit;
 *   - the shuffle of the full 20-ball rack, not just the truncated head;
 *   - luckyCageDrawMatches()'s accept/reject behaviour.
 *
 * Corpus: every seed in [0, 100000) plus edge seeds plus a scrambled
 * deterministic sample across the whole 2^31 session-seed space.
 *
 * Exits non-zero on any mismatch.
 */
import {
  LUCKY_CAGE_BALL_COUNT,
  LUCKY_CAGE_DRAW_COUNT,
  drawLuckyCage,
} from '@/server/arcade/wager-games/lucky-cage';
import { mulberry32, seededShuffle } from '@/server/arcade/arcade-rng';
import {
  LUCKY_CAGE_BALLS,
  LUCKY_CAGE_DRAWN,
  drawLuckyCageClient,
  luckyCageDrawMatches,
  luckyCageRng,
  luckyCageShuffle,
} from '@/features/arcade/lib/lucky-cage-draw';

const MAX_FAILURES_PRINTED = 40;
const failures: string[] = [];
let suppressedFailures = 0;

function fail(msg: string): void {
  if (failures.length < MAX_FAILURES_PRINTED) failures.push(msg);
  else suppressedFailures += 1;
}

function assert(cond: boolean, msg: string): void {
  if (!cond) fail(msg);
}

/** Contiguous low seeds — catches sign/truncation bugs around zero. */
const CONTIGUOUS_SEEDS = 100_000;
/** Scrambled samples spread across the real crypto.randomInt(0, 2**31) range. */
const SCATTERED_SEEDS = 100_000;
/** How many seeds also get the deeper stream/full-shuffle comparison. */
const DEEP_CHECK_SEEDS = 20_000;
/** PRNG draws compared per deep-checked seed. */
const STREAM_DEPTH = 40;

const SEED_SPACE = 2 ** 31;

function scatteredSeed(index: number): number {
  let z = (index + 0x9e3779b9) | 0;
  z = Math.imul(z ^ (z >>> 16), 0x21f0aaad);
  z = Math.imul(z ^ (z >>> 15), 0x735a2d97);
  z = z ^ (z >>> 15);
  return (z >>> 0) % SEED_SPACE;
}

const EDGE_SEEDS = [
  0,
  1,
  2,
  7,
  255,
  256,
  65_535,
  65_536,
  1 << 20,
  (1 << 30) - 1,
  1 << 30,
  SEED_SPACE - 3,
  SEED_SPACE - 2,
  SEED_SPACE - 1,
];

console.log('Lucky Cage client/server draw parity');
console.log(`  contiguous seeds : ${CONTIGUOUS_SEEDS.toLocaleString()}`);
console.log(`  scattered seeds  : ${SCATTERED_SEEDS.toLocaleString()}`);
console.log(`  edge seeds       : ${EDGE_SEEDS.length}`);
console.log(
  `  deep stream/shuffle checks : ${DEEP_CHECK_SEEDS.toLocaleString()} seeds x ${STREAM_DEPTH} draws`,
);
console.log('');

/* ── constants agree ────────────────────────────────────────────────── */

assert(
  LUCKY_CAGE_BALLS === LUCKY_CAGE_BALL_COUNT,
  `client ball count ${LUCKY_CAGE_BALLS} != server ${LUCKY_CAGE_BALL_COUNT}`,
);
assert(
  LUCKY_CAGE_DRAWN === LUCKY_CAGE_DRAW_COUNT,
  `client draw count ${LUCKY_CAGE_DRAWN} != server ${LUCKY_CAGE_DRAW_COUNT}`,
);

/* ── the corpus ─────────────────────────────────────────────────────── */

const seeds: number[] = [];
for (let s = 0; s < CONTIGUOUS_SEEDS; s += 1) seeds.push(s);
for (let i = 0; i < SCATTERED_SEEDS; i += 1) seeds.push(scatteredSeed(i));
for (const s of EDGE_SEEDS) seeds.push(s);

const rack = Array.from({ length: LUCKY_CAGE_BALL_COUNT }, (_, i) => i + 1);

let compared = 0;
let drawMismatches = 0;
let streamMismatches = 0;
let shuffleMismatches = 0;
let matcherMismatches = 0;

for (let i = 0; i < seeds.length; i += 1) {
  const seed = seeds[i]!;

  const serverDraw = drawLuckyCage(seed);
  const clientDraw = drawLuckyCageClient(seed);
  compared += 1;

  let identical = serverDraw.length === clientDraw.length;
  if (identical) {
    for (let k = 0; k < serverDraw.length; k += 1) {
      if (serverDraw[k] !== clientDraw[k]) {
        identical = false;
        break;
      }
    }
  }
  if (!identical) {
    drawMismatches += 1;
    fail(
      `seed ${seed}: server [${serverDraw.join(',')}] != client [${clientDraw.join(',')}]`,
    );
  }

  // luckyCageDrawMatches must accept the true draw and reject a perturbed one
  // (including a mere re-ordering — chute order is part of the outcome).
  if (!luckyCageDrawMatches(seed, serverDraw)) {
    matcherMismatches += 1;
    fail(`seed ${seed}: luckyCageDrawMatches rejected the authoritative draw`);
  }
  if (i % 997 === 0) {
    const swapped = [...serverDraw];
    const tmp = swapped[0]!;
    swapped[0] = swapped[1]!;
    swapped[1] = tmp;
    if (swapped[0] !== serverDraw[0] && luckyCageDrawMatches(seed, swapped)) {
      matcherMismatches += 1;
      fail(`seed ${seed}: luckyCageDrawMatches accepted a re-ordered draw`);
    }
    if (luckyCageDrawMatches(seed, serverDraw.slice(0, 4))) {
      matcherMismatches += 1;
      fail(`seed ${seed}: luckyCageDrawMatches accepted a short draw`);
    }
    if (luckyCageDrawMatches(seed, null)) {
      matcherMismatches += 1;
      fail(`seed ${seed}: luckyCageDrawMatches accepted null`);
    }
  }

  if (i < DEEP_CHECK_SEEDS) {
    // Raw PRNG stream, bit for bit.
    const serverRng = mulberry32(seed);
    const clientRng = luckyCageRng(seed);
    for (let k = 0; k < STREAM_DEPTH; k += 1) {
      const a = serverRng();
      const b = clientRng();
      if (a !== b) {
        streamMismatches += 1;
        fail(`seed ${seed}: PRNG draw ${k} server ${a} != client ${b}`);
        break;
      }
    }

    // Full 20-ball shuffle, not just the truncated head.
    const serverShuffle = seededShuffle(rack, seed);
    const clientShuffle = luckyCageShuffle(rack, seed);
    if (serverShuffle.join(',') !== clientShuffle.join(',')) {
      shuffleMismatches += 1;
      fail(
        `seed ${seed}: full shuffle server [${serverShuffle.join(',')}] != client [${clientShuffle.join(',')}]`,
      );
    }
  }
}

assert(
  compared >= 100_000,
  `only ${compared} seeds compared, expected at least 100,000`,
);
assert(drawMismatches === 0, `${drawMismatches} draw mismatches`);
assert(streamMismatches === 0, `${streamMismatches} PRNG stream mismatches`);
assert(shuffleMismatches === 0, `${shuffleMismatches} full-shuffle mismatches`);
assert(matcherMismatches === 0, `${matcherMismatches} luckyCageDrawMatches faults`);

console.log(`Seeds compared          : ${compared.toLocaleString()}`);
console.log(`Draw mismatches         : ${drawMismatches}`);
console.log(`PRNG stream mismatches  : ${streamMismatches}`);
console.log(`Full-shuffle mismatches : ${shuffleMismatches}`);
console.log(`Matcher faults          : ${matcherMismatches}`);

if (failures.length > 0) {
  console.error(`\nFAILURES (${failures.length + suppressedFailures}):`);
  for (const f of failures) console.error('  FAIL: ' + f);
  if (suppressedFailures > 0) {
    console.error(`  ... ${suppressedFailures} more failure(s) suppressed`);
  }
  process.exit(1);
}

console.log('\nLUCKY CAGE CLIENT/SERVER DRAW PARITY: BYTE-IDENTICAL.');
process.exit(0);
