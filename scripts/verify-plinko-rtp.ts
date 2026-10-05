/**
 * Plinko RTP and fairness gate.
 *
 *   npx tsx scripts/verify-plinko-rtp.ts
 *
 * Four layers, all of which must agree:
 *
 *   1. TABLES     : every rows x risk the server accepts has a multiplier
 *                    table of rows + 1 symmetric slots and an RTP factor.
 *   2. EXACT      : expected return of each configuration from the binomial
 *                    path distribution: sum C(n,k)/2^n * multiplier[k] *
 *                    factor. roundArcadePayout is unbiased, so this is the
 *                    exact ticket-level RTP. Each must sit within
 *                    RTP_TOLERANCE of ARCADE_RTP['arcade-plinko'], and must
 *                    equal the pinned value below to 1e-12, so a table edit
 *                    can't move the RTP without this file changing too.
 *                    The tables themselves are pinned by a SHA-256, so a
 *                    retune that keeps the same RTP fails too.
 *   3. CLIENT     : the client has no copy of the tables (it imports
 *                    PLINKO_MULTIPLIERS), and its WebCrypto path rebuild
 *                    (_plinko-path.ts) lands in the same slot as
 *                    resolvePlinko for every sampled seed.
 *   4. MONTE CARLO: a deterministic sweep of session seeds through
 *                    resolvePlinko and computePlinkoPayout: slot frequencies
 *                    match the binomial, payouts round to floor or ceil of the
 *                    exact amount, and the empirical RTP sits within 5 sigma.
 *
 * Exits non-zero on any failed assertion.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  ARCADE_RTP,
  PLINKO_ALLOWED_RISKS,
  PLINKO_ALLOWED_ROWS,
  PLINKO_MULTIPLIERS,
  PLINKO_RTP_FACTORS,
  type PlinkoRisk,
  type PlinkoRows,
} from '@/server/arcade/arcade-constants';
import {
  computePlinkoPayout,
  resolvePlinko,
  validatePlinkoConfig,
} from '@/server/arcade/wager-games/plinko';
import { derivePlinkoPath } from '@/app/(games)/plinko/_plinko-path';

/* ── assertion plumbing ─────────────────────────────────────────────── */

const failures: string[] = [];
function assert(cond: boolean, msg: string): void {
  if (!cond) failures.push(msg);
}
const pct = (v: number, d = 4) => `${(v * 100).toFixed(d)}%`;

/* ── tuning ─────────────────────────────────────────────────────────── */

const TARGET = ARCADE_RTP['arcade-plinko'];
/** The factors are rounded to 4 places, so each configuration sits a hair
    off 0.97. This is how far it may sit. */
const RTP_TOLERANCE = 0.0005;
const MONTE_CARLO_ROUNDS = 120_000;
const PARITY_SEEDS = 3_000;
const SIGMA = 5;
const WAGER = 10;
const SEED_ORIGIN = 7_654_321;
const SEED_SPACE = 2 ** 31;

/** The exact RTP of every configuration on tixy/rev2 before tixy/1-plinko.
    Change only with a payout-table change approved in the brief. */
const PINNED_RTP: Record<PlinkoRisk, Record<PlinkoRows, number>> = {
  low: { 8: 0.970046875, 12: 0.9699823974609375, 16: 0.9699894415283203 },
  medium: { 8: 0.9699735937499999, 12: 0.969969345703125, 16: 0.9699867660522461 },
  high: { 8: 0.97002, 12: 0.9699512402343751, 16: 0.9700336096191406 },
};

/** sha256 of JSON.stringify({ multipliers: PLINKO_MULTIPLIERS, factors:
    PLINKO_RTP_FACTORS }), computed from origin/tixy/rev2's
    arcade-constants.ts before tixy/1-plinko. */
const PINNED_TABLES_SHA256 = '91c43abc681b17a3e2f1255f1e77e626628130d28f595d76c6ac1d94e8b62bce';

function seedAt(index: number): number {
  let z = (index + SEED_ORIGIN) | 0;
  z = Math.imul(z ^ (z >>> 16), 0x21f0aaad);
  z = Math.imul(z ^ (z >>> 15), 0x735a2d97);
  z = z ^ (z >>> 15);
  return (z >>> 0) % SEED_SPACE;
}

function binomialProbabilities(n: number): number[] {
  const probs: number[] = [];
  let c = 1;
  for (let k = 0; k <= n; k++) {
    probs.push(c / 2 ** n);
    c = (c * (n - k)) / (k + 1);
  }
  return probs;
}

const RISKS = PLINKO_ALLOWED_RISKS as readonly PlinkoRisk[];
const ROWS = PLINKO_ALLOWED_ROWS as readonly PlinkoRows[];

console.log('Plinko RTP/fairness verification');
console.log(`  target RTP: ${pct(TARGET, 2)} (ARCADE_RTP['arcade-plinko'])`);
console.log(`  configurations: ${RISKS.length} risks x ${ROWS.length} row counts`);
console.log(`  monte-carlo rounds per configuration: ${MONTE_CARLO_ROUNDS.toLocaleString()}`);
console.log('');

/* ══ 1. Tables ═════════════════════════════════════════════════════════ */

assert(
  JSON.stringify([...ROWS]) === JSON.stringify([8, 12, 16]),
  `PLINKO_ALLOWED_ROWS is ${JSON.stringify(ROWS)}, expected [8,12,16]`,
);
assert(
  JSON.stringify([...RISKS]) === JSON.stringify(['low', 'medium', 'high']),
  `PLINKO_ALLOWED_RISKS is ${JSON.stringify(RISKS)}`,
);
for (const risk of RISKS) {
  for (const rows of ROWS) {
    const table = PLINKO_MULTIPLIERS[risk]?.[rows];
    const factor = PLINKO_RTP_FACTORS[risk]?.[rows];
    assert(Array.isArray(table), `${risk}/${rows}: no multiplier table`);
    assert(typeof factor === 'number' && factor > 0, `${risk}/${rows}: no RTP factor`);
    if (!table) continue;
    assert(table.length === rows + 1, `${risk}/${rows}: ${table.length} slots, expected ${rows + 1}`);
    for (let k = 0; k <= rows; k++) {
      assert(table[k] === table[rows - k], `${risk}/${rows}: slot ${k} and ${rows - k} differ`);
      assert(table[k] > 0, `${risk}/${rows}: slot ${k} is ${table[k]}`);
    }
    assert(validatePlinkoConfig({ rows, risk }) !== null, `${risk}/${rows}: the server rejects it`);
  }
}
const tablesHash = createHash('sha256')
  .update(JSON.stringify({ multipliers: PLINKO_MULTIPLIERS, factors: PLINKO_RTP_FACTORS }))
  .digest('hex');
assert(
  tablesHash === PINNED_TABLES_SHA256,
  `the multiplier or factor tables changed (sha256 ${tablesHash}); a payout change needs its brief and a new pin`,
);
console.log(`Tables sha256: ${tablesHash} (pinned)`);
assert(validatePlinkoConfig({ rows: 10, risk: 'low' }) === null, 'the server accepts 10 rows');
assert(validatePlinkoConfig({ rows: 8, risk: 'extreme' }) === null, 'the server accepts risk "extreme"');

/* ══ 2. Exact RTP ══════════════════════════════════════════════════════ */

const exact: Record<string, number> = {};
const pinsUnset = RISKS.every((risk) => ROWS.every((rows) => PINNED_RTP[risk][rows] === 0));
console.log('Exact expected return (binomial path distribution)');
console.log('  risk    rows  raw RTP     factor   RTP           off target   top slot');
for (const risk of RISKS) {
  for (const rows of ROWS) {
    const table = PLINKO_MULTIPLIERS[risk][rows];
    const factor = PLINKO_RTP_FACTORS[risk][rows];
    const probs = binomialProbabilities(rows);
    assert(Math.abs(probs.reduce((a, b) => a + b, 0) - 1) < 1e-15, `${rows}: probabilities don't sum to 1`);
    const raw = probs.reduce((sum, p, k) => sum + p * table[k], 0);
    const rtp = raw * factor;
    exact[`${risk}/${rows}`] = rtp;
    console.log(
      `  ${risk.padEnd(7)} ${String(rows).padStart(4)}  ${raw.toFixed(8)}  ${factor.toFixed(4)}   ${rtp.toFixed(10)}  ${((rtp - TARGET >= 0 ? '+' : '') + pct(rtp - TARGET, 4)).padStart(10)}   ${table[0]}x`,
    );
    assert(
      Math.abs(rtp - TARGET) <= RTP_TOLERANCE,
      `${risk}/${rows}: RTP ${rtp.toFixed(8)} is more than ${RTP_TOLERANCE} from ${TARGET}`,
    );
    if (!pinsUnset) {
      assert(
        Math.abs(rtp - PINNED_RTP[risk][rows]) < 1e-12,
        `${risk}/${rows}: RTP ${rtp.toFixed(12)} moved from the pinned ${PINNED_RTP[risk][rows].toFixed(12)}`,
      );
    }
  }
}
if (pinsUnset) {
  failures.push('PINNED_RTP is not filled in. Paste these values:');
  for (const risk of RISKS) {
    failures.push(`  ${risk}: { ${ROWS.map((rows) => `${rows}: ${exact[`${risk}/${rows}`]}`).join(', ')} },`);
  }
}
console.log('');

/* ══ 3. Client parity ══════════════════════════════════════════════════ */

const clientDir = path.join(process.cwd(), 'src', 'app', '(games)', 'plinko');
const clientSource = readFileSync(path.join(clientDir, '_plinko-client.tsx'), 'utf8');
assert(
  !/MULTIPLIER_TABLES\s*[:=]/.test(clientSource),
  'the client defines its own MULTIPLIER_TABLES again; import PLINKO_MULTIPLIERS instead',
);
assert(
  /PLINKO_MULTIPLIERS/.test(clientSource),
  'the client does not read PLINKO_MULTIPLIERS from arcade-constants',
);
// A multiplier table literal anywhere in the plinko client files.
for (const file of ['_plinko-client.tsx', '_plinko-board.tsx', '_plinko-trajectory.ts', '_plinko-path.ts']) {
  let source = '';
  try {
    source = readFileSync(path.join(clientDir, file), 'utf8');
  } catch {
    continue;
  }
  assert(!/\[\s*555\s*,\s*118/.test(source) && !/\[\s*5\.6\s*,\s*2\.1/.test(source), `${file} holds a copy of a multiplier table`);
}

let parityChecked = 0;
for (let i = 0; i < PARITY_SEEDS; i++) {
  const seed = seedAt(1_000_000 + i);
  for (const rows of ROWS) {
    const server = resolvePlinko(seed, rows, 'medium');
    const client = await derivePlinkoPath(seed, rows);
    parityChecked += 1;
    if (client.slotIndex !== server.slotIndex || client.path.join('') !== server.path.join('')) {
      failures.push(`seed ${seed}, ${rows} rows: client path ${client.path.join('')} != server ${server.path.join('')}`);
      break;
    }
  }
}
console.log(`Client parity: ${parityChecked.toLocaleString()} seed x rows paths rebuilt in the browser code, all equal to resolvePlinko.`);
console.log('');

/* ══ 4. Monte Carlo ════════════════════════════════════════════════════ */

console.log(`Monte Carlo (${MONTE_CARLO_ROUNDS.toLocaleString()} seeded rounds each, wager ${WAGER})`);
console.log('  risk    rows  empirical RTP   exact RTP     sigma     z');
let seedIndex = 0;
for (const risk of RISKS) {
  for (const rows of ROWS) {
    const table = PLINKO_MULTIPLIERS[risk][rows];
    const factor = PLINKO_RTP_FACTORS[risk][rows];
    const probs = binomialProbabilities(rows);
    const counts = new Array<number>(rows + 1).fill(0);
    let paid = 0;
    let roundingFailures = 0;
    for (let i = 0; i < MONTE_CARLO_ROUNDS; i++) {
      const seed = seedAt(seedIndex++);
      const result = resolvePlinko(seed, rows, risk);
      counts[result.slotIndex] += 1;
      if (result.multiplier !== table[result.slotIndex]) roundingFailures += 1;
      const payout = computePlinkoPayout(WAGER, result, seed);
      const exactPayout = WAGER * result.multiplier * factor;
      if (
        !Number.isInteger(payout) ||
        (payout !== Math.floor(exactPayout) && payout !== Math.ceil(exactPayout))
      ) {
        roundingFailures += 1;
      }
      paid += payout;
    }
    assert(roundingFailures === 0, `${risk}/${rows}: ${roundingFailures} payouts off the table or badly rounded`);

    // Slot frequencies against the binomial.
    for (let k = 0; k <= rows; k++) {
      const expected = probs[k] * MONTE_CARLO_ROUNDS;
      if (expected < 50) continue;
      const sd = Math.sqrt(MONTE_CARLO_ROUNDS * probs[k] * (1 - probs[k]));
      const z = (counts[k] - expected) / sd;
      assert(Math.abs(z) <= SIGMA, `${risk}/${rows}: slot ${k} hit ${counts[k]} times, expected ${expected.toFixed(0)} (z ${z.toFixed(2)})`);
    }

    // Empirical RTP. Per-ball variance from the exact distribution, plus
    // the rounding coin (at most 1/4 ticket squared per ball).
    const rtp = exact[`${risk}/${rows}`];
    const meanSq = probs.reduce((s, p, k) => s + p * (table[k] * factor) ** 2, 0);
    const variance = meanSq - rtp ** 2 + 0.25 / WAGER ** 2;
    const sigma = Math.sqrt(variance / MONTE_CARLO_ROUNDS);
    const empirical = paid / (WAGER * MONTE_CARLO_ROUNDS);
    const z = (empirical - rtp) / sigma;
    console.log(
      `  ${risk.padEnd(7)} ${String(rows).padStart(4)}  ${pct(empirical).padStart(12)}   ${pct(rtp).padStart(10)}  ${pct(sigma, 3).padStart(8)}  ${z >= 0 ? '+' : ''}${z.toFixed(2)}`,
    );
    assert(Math.abs(z) <= SIGMA, `${risk}/${rows}: empirical RTP ${pct(empirical)} is ${z.toFixed(2)} sigma from ${pct(rtp)}`);
  }
}

if (failures.length > 0) {
  console.error(`\nFAILURES (${failures.length}):`);
  for (const f of failures) console.error('  FAIL: ' + f);
  process.exit(1);
}

console.log('\nALL PLINKO RTP/FAIRNESS CHECKS PASS.');
process.exit(0);
