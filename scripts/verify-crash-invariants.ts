/**
 * Offline invariant proof for Crash ("Rocket Launch").
 *
 *   npx tsx scripts/verify-crash-invariants.ts
 *
 * Locks the wager/RNG/RTP/provably-fair/cashout contract so presentation-only
 * work in src/app/(games)/crash cannot silently change the math:
 *
 *  1. Constants — growth rate, max multiplier, and the crash RTP entry.
 *  2. Deterministic crash points — exact per-seed outputs of getCrashPoint,
 *     checked both against a frozen independent reference implementation and
 *     against hard-coded snapshots captured from the production build.
 *  3. RTP shape — instant-crash floor rate and P(crash > m) ≈ RTP/m over a
 *     large deterministic seed sweep.
 *  4. Multiplier ↔ time inversion — getMultiplierAtTime/getTimeForMultiplier
 *     round-trips and exact snapshots.
 *  5. Cashout validation — every branch of validateCashout (success, legacy
 *     path, too-late, too-high, grace windows) pinned to frozen verdicts.
 *  6. Payout rounding — computeCrashPayout matches a frozen independent
 *     reference (integer part + deterministic fractional lottery) and exact
 *     per-tuple snapshots.
 *  7. Scope guard — no file under src/server or src/app/api may differ from
 *     HEAD (tracks both unstaged/staged edits and untracked files).
 *
 * Exits non-zero on any failed assertion.
 */

import { execFileSync } from 'node:child_process';

import {
  getCrashPoint,
  getMultiplierAtTime,
  getTimeForMultiplier,
  validateCashout,
  computeCrashPayout,
} from '@/server/arcade/wager-games/crash';
import {
  ARCADE_RTP,
  CRASH_GROWTH_RATE,
  CRASH_MAX_MULTIPLIER,
} from '@/server/arcade/arcade-constants';
import { deriveSubSeed, mulberry32 } from '@/server/arcade/arcade-rng';
import { roundArcadePayout } from '@/server/arcade/arcade-payout';

let failures = 0;
const assert = (cond: boolean, msg: string) => {
  if (!cond) {
    console.error('  FAIL: ' + msg);
    failures += 1;
  }
};

/* ── Frozen independent reference implementation ──────────────────────────
   Written from the documented contract (3% house edge inverse-CDF, exp growth
   curve, deterministic fractional payout lottery) WITHOUT sharing code with
   production. If production drifts, these comparisons break. */

const REF_RTP = 0.97;
const REF_GROWTH_RATE = 0.06;
const REF_MAX_MULTIPLIER = 1000;
const REF_TARGET_TIME_GRACE_MS = 500;

function refMulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function refCrashPoint(seed: number): number {
  const r = refMulberry32(seed)();
  if (r < 1 - REF_RTP) return 1.0;
  const crash = REF_RTP / (1 - r);
  return Math.min(REF_MAX_MULTIPLIER, Math.floor(crash * 100) / 100);
}

function refMultiplierAtTime(elapsedMs: number): number {
  const mult = Math.exp(REF_GROWTH_RATE * (elapsedMs / 100));
  return Math.min(REF_MAX_MULTIPLIER, Math.floor(mult * 100) / 100);
}

function refTimeForMultiplier(multiplier: number): number {
  if (multiplier <= 1) return 0;
  return (Math.log(multiplier) / REF_GROWTH_RATE) * 100;
}

function refRoundPayout(exactPayout: number, seed: number, label: string): number {
  if (!Number.isFinite(exactPayout) || exactPayout <= 0) return 0;
  const integerPart = Math.floor(exactPayout);
  const fractionalPart = exactPayout - integerPart;
  if (fractionalPart <= 0) return integerPart;
  // Same derivation as production: sha256(`${seed}:arcade-payout:${label}`),
  // first UInt32BE as sub-seed — exercised here through the real deriveSubSeed
  // (its own snapshots are pinned below) so the lottery comparison is exact.
  const roll = refMulberry32(deriveSubSeed(seed, `arcade-payout:${label}`))();
  return integerPart + (roll < fractionalPart ? 1 : 0);
}

function refCrashPayout(wager: number, multiplier: number, seed: number): number {
  if (multiplier <= 0) return 0;
  return refRoundPayout(wager * multiplier, seed, `crash:${multiplier.toFixed(2)}`);
}

// ── 1. Constants (exact parity lock) ───────────────────────────────────────
console.log('1. Crash constants…');
{
  assert(CRASH_GROWTH_RATE === 0.06, `CRASH_GROWTH_RATE ${CRASH_GROWTH_RATE}`);
  assert(CRASH_MAX_MULTIPLIER === 1000, `CRASH_MAX_MULTIPLIER ${CRASH_MAX_MULTIPLIER}`);
  assert(ARCADE_RTP['arcade-crash'] === 0.97, `crash RTP ${ARCADE_RTP['arcade-crash']}`);
}

// ── 2. Deterministic crash points ──────────────────────────────────────────
console.log('2. Crash points — reference parity + frozen snapshots…');
{
  const SEEDS = [0, 1, 7, 42, 1337, 65535, 1000003, 2147483646, 999999937, 271828182, 314159265, 8675309];
  // Captured from the production implementation at HEAD (job-1785081131176).
  const FROZEN = [1.32, 2.6, 1, 2.43, 1.18, 1.55, 13.17, 152.62, 1.67, 1.05, 1.32, 2.57];
  const FROZEN_RNG_FIRST = [
    0.26642920868471265, 0.6270739405881613, 0.011704753153026104,
    0.6011037519201636, 0.1844118325971067, 0.3745830114930868,
    0.926348441047594, 0.9936443585902452, 0.4222431951202452,
    0.07626659120433033, 0.26962751406244934, 0.6227154401130974,
  ];

  for (let i = 0; i < SEEDS.length; i++) {
    const seed = SEEDS[i]!;
    const cp = getCrashPoint(seed);
    assert(cp === refCrashPoint(seed), `crashPoint(${seed}) ${cp} vs ref ${refCrashPoint(seed)}`);
    assert(cp === FROZEN[i], `crashPoint(${seed}) ${cp} vs frozen ${FROZEN[i]}`);
    const r0 = mulberry32(seed)();
    assert(r0 === FROZEN_RNG_FIRST[i], `mulberry32(${seed}) first float drifted: ${r0}`);
  }

  // Wide reference sweep — 50k seeds, exact match per seed.
  for (let seed = 0; seed < 50_000; seed++) {
    if (getCrashPoint(seed) !== refCrashPoint(seed)) {
      assert(false, `crashPoint(${seed}) diverged from reference`);
      break;
    }
  }

  // Boundary semantics.
  assert(getCrashPoint(7) === 1, 'instant-crash floor must return exactly 1');
  const huge = getCrashPoint(2147483646);
  assert(huge > 1 && huge <= CRASH_MAX_MULTIPLIER, `clamp broken: ${huge}`);
}

// ── 3. RTP shape ───────────────────────────────────────────────────────────
console.log('3. RTP shape over a deterministic seed sweep…');
{
  const N = 200_000;
  let floorRate = 0;
  const thresholds = [1.5, 2, 5, 10, 100];
  const above = thresholds.map(() => 0);
  for (let seed = 0; seed < N; seed++) {
    const cp = getCrashPoint(seed);
    // getCrashPoint floors to 2dp, so cp === 1 also absorbs raw crashes in
    // [1, 1.01): the floor bucket is P(r < 1 - RTP/1.01), not just the 3%.
    if (cp === 1) floorRate++;
    for (let t = 0; t < thresholds.length; t++) {
      if (cp > thresholds[t]!) above[t]!++;
    }
  }
  const expectedFloor = 1 - REF_RTP / 1.01;
  const actualFloor = floorRate / N;
  assert(
    Math.abs(actualFloor - expectedFloor) < 0.005,
    `floor rate ${actualFloor} vs expected ${expectedFloor}`,
  );
  for (let t = 0; t < thresholds.length; t++) {
    const m = thresholds[t]!;
    const expected = REF_RTP / m; // P(crash > m) = RTP/m → EV per wager = RTP
    const actual = above[t]! / N;
    assert(
      Math.abs(actual - expected) < 0.01,
      `P(crash > ${m}) ${actual} vs expected ${expected}`,
    );
  }
}

// ── 4. Multiplier ↔ time ───────────────────────────────────────────────────
console.log('4. Multiplier/time curve + inversion…');
{
  const ELAPSED = [0, 50, 100, 250, 1000, 5000, 10000, 30000, 60000, 120000, 200000];
  const FROZEN_MULTS = [1, 1.03, 1.06, 1.16, 1.82, 20.08, 403.42, 1000, 1000, 1000, 1000];
  for (let i = 0; i < ELAPSED.length; i++) {
    const m = getMultiplierAtTime(ELAPSED[i]!);
    assert(m === refMultiplierAtTime(ELAPSED[i]!), `mult(${ELAPSED[i]}ms) ${m} vs ref`);
    assert(m === FROZEN_MULTS[i], `mult(${ELAPSED[i]}ms) ${m} vs frozen ${FROZEN_MULTS[i]}`);
  }

  const MULTS = [0.5, 1, 1.01, 1.5, 2, 3.14, 10, 100, 999.99, 1000];
  const FROZEN_TIMES = [
    0, 0, 16.583884755280152, 675.775180180274, 1155.2453009332423,
    1907.0379998669366, 3837.641821656743, 7675.283643313486,
    11512.908798220227, 11512.925464970229,
  ];
  for (let i = 0; i < MULTS.length; i++) {
    const t = getTimeForMultiplier(MULTS[i]!);
    assert(t === refTimeForMultiplier(MULTS[i]!), `time(${MULTS[i]}x) ${t} vs ref`);
    assert(t === FROZEN_TIMES[i], `time(${MULTS[i]}x) ${t} vs frozen`);
  }

  // Inversion: for every whole-cent multiplier, the (cent-floored) curve is
  // within one cent of the target at the ideal time, reaches the target at
  // most 2ms later, and has not reached it 2ms earlier.
  for (let cents = 101; cents <= 2000; cents += 7) {
    const m = cents / 100;
    const t = getTimeForMultiplier(m);
    const at = getMultiplierAtTime(t);
    assert(
      at === m || at === Math.round((m - 0.01) * 100) / 100,
      `curve off ${m}x by >1c at ${t}ms: ${at}`,
    );
    assert(getMultiplierAtTime(t + 2) >= m, `curve not at ${m}x by ${t + 2}ms`);
    assert(
      t === 0 || getMultiplierAtTime(Math.max(0, t - 2)) <= m,
      `curve overshoots ${m}x well before ${t}ms`,
    );
  }
  assert(getTimeForMultiplier(1) === 0, 'time(1x) must be 0');
  assert(getTimeForMultiplier(0.5) === 0, 'time(<1x) must clamp to 0');
}

// ── 5. Cashout validation — every branch frozen ────────────────────────────
console.log('5. Cashout validation branches…');
{
  // [crashPoint, startedAt, cashoutAt, clientTarget] → frozen verdict.
  const CASES: Array<{
    args: [number, number, number, number?];
    expect: { success: boolean; multiplier: number; reason?: string };
  }> = [
    { args: [2, 0, 1000, 1.5], expect: { success: true, multiplier: 1.5 } },
    { args: [2, 0, 1000, 1.4], expect: { success: true, multiplier: 1.4 } },
    // Claimed target above the real crash point — the rocket was already down.
    { args: [2, 0, 1000, 2.5], expect: { success: false, multiplier: 0, reason: 'too-late' } },
    { args: [1.5, 0, 5000, 10], expect: { success: false, multiplier: 0, reason: 'too-late' } },
    // Legacy path (no target): pays the server-time multiplier…
    { args: [2, 0, 1000, undefined], expect: { success: true, multiplier: 1.82 } },
    // …but never after the crash time.
    { args: [2, 0, 20000, undefined], expect: { success: false, multiplier: 0, reason: 'too-late' } },
    { args: [2, 0, 20000, 1.05], expect: { success: false, multiplier: 0, reason: 'too-late' } },
    // Target fits the crash point but is far ahead of the server timeline.
    { args: [1000, 0, 2000, 5], expect: { success: false, multiplier: 0, reason: 'too-high' } },
    // Inside the 10% upward grace over server-current…
    { args: [1000, 0, 1000, 1.9], expect: { success: true, multiplier: 1.9 } },
    // …and just outside it.
    { args: [1000, 0, 1000, 2.05], expect: { success: false, multiplier: 0, reason: 'too-high' } },
    // Degenerate targets (≤1, non-finite) are ignored → legacy path.
    { args: [2, 0, 1000, 1], expect: { success: true, multiplier: 1.82 } },
    { args: [2, 0, 1000, NaN], expect: { success: true, multiplier: 1.82 } },
    // Target time long past: outside the 500ms honor window → too-late.
    { args: [3, 0, 1907, 1.9], expect: { success: false, multiplier: 0, reason: 'too-late' } },
    { args: [3, 0, 2408, 1.9], expect: { success: false, multiplier: 0, reason: 'too-late' } },
  ];
  for (const { args, expect } of CASES) {
    const got = validateCashout(...args);
    assert(
      got.success === expect.success &&
        got.multiplier === expect.multiplier &&
        got.reason === expect.reason,
      `validateCashout(${args.map(String).join(',')}) → ${JSON.stringify(got)} vs ${JSON.stringify(expect)}`,
    );
  }

  // Grace-window edges, derived from the frozen grace constant.
  const cp = 1000;
  const target = 2;
  const targetTime = getTimeForMultiplier(target); // 1155.245…
  const startedAt = 0;
  // At targetTime + grace the claim must still be honored…
  const inGrace = validateCashout(cp, startedAt, Math.floor(targetTime + REF_TARGET_TIME_GRACE_MS) - 1, target);
  assert(inGrace.success && inGrace.multiplier === target, `grace window honor broke: ${JSON.stringify(inGrace)}`);
  // …and well past it must not.
  const pastGrace = validateCashout(cp, startedAt, targetTime + REF_TARGET_TIME_GRACE_MS + 60_000, target);
  assert(!pastGrace.success && pastGrace.reason === 'too-late', 'grace window never closes');

  // A winning cashout can never pay above the crash point.
  for (let seed = 0; seed < 2000; seed++) {
    const crash = getCrashPoint(seed);
    if (crash <= 1.01) continue;
    const targetM = Math.floor((crash - 0.01) * 100) / 100;
    const t = getTimeForMultiplier(targetM);
    const verdict = validateCashout(crash, 0, Math.max(0, t - 50), targetM);
    if (verdict.success) {
      assert(verdict.multiplier <= crash, `paid ${verdict.multiplier} above crash ${crash}`);
    }
  }
}

// ── 6. Payout rounding ─────────────────────────────────────────────────────
console.log('6. Cashout payout rounding…');
{
  const TUPLES: Array<[number, number, number]> = [
    [10, 2, 42], [10, 2, 43], [10, 2, 44], [10, 1.5, 7], [25, 3.33, 1337],
    [7, 1.01, 1000003], [100, 10, 8675309], [3, 2.718, 271828182], [10, 0, 42], [10, -1, 42],
  ];
  const FROZEN = [20, 20, 20, 15, 83, 7, 1000, 9, 0, 0];
  for (let i = 0; i < TUPLES.length; i++) {
    const [w, m, s] = TUPLES[i]!;
    const got = computeCrashPayout(w, m, s);
    assert(got === FROZEN[i], `payout(${w},${m},${s}) ${got} vs frozen ${FROZEN[i]}`);
    assert(got === refCrashPayout(w, m, s), `payout(${w},${m},${s}) ${got} vs ref ${refCrashPayout(w, m, s)}`);
    // Production must route through the shared payout rounder with the
    // exact `crash:<mult>` label — a different label shifts the lottery.
    if (m > 0) {
      assert(
        got === roundArcadePayout(w * m, s, `crash:${m.toFixed(2)}`),
        `payout(${w},${m},${s}) no longer uses roundArcadePayout(crash:…)`,
      );
    }
  }

  // Rounding shape: payout is always floor or ceil of the exact amount…
  for (let seed = 0; seed < 5000; seed++) {
    const w = 7;
    const m = 2.37;
    const exact = w * m;
    const p = computeCrashPayout(w, m, seed);
    assert(p === Math.floor(exact) || p === Math.ceil(exact), `payout ${p} not adjacent to ${exact}`);
  }
  // …and the fractional lottery fires at roughly the fractional rate.
  const exact = 7 * 2.37; // 16.59
  let bumped = 0;
  const N = 20_000;
  for (let seed = 0; seed < N; seed++) {
    if (computeCrashPayout(7, 2.37, seed) === Math.ceil(exact)) bumped++;
  }
  const rate = bumped / N;
  assert(Math.abs(rate - 0.59) < 0.02, `fractional lottery rate ${rate} vs 0.59`);

  // deriveSubSeed snapshots (the payout lottery depends on them).
  assert(
    deriveSubSeed(42, 'arcade-payout:crash:2.00') === 4117430446,
    'deriveSubSeed(42, crash:2.00) drifted',
  );
  assert(
    deriveSubSeed(1337, 'arcade-payout:crash:3.33') === 4243269726,
    'deriveSubSeed(1337, crash:3.33) drifted',
  );
}

// ── 7. Scope guard: production server/API files untouched ──────────────────
console.log('7. Production server/API files unchanged from HEAD…');
{
  if (process.env.ARCADE_SKIP_CRASH_SCOPE_GUARD === '1') {
    console.log('   skipped by the multi-game orchestrator (direct command retains this guard)');
  } else {
    const git = (args: string[]) =>
      execFileSync('git', args, { encoding: 'utf8' }).trim();
    const dirty = git(['diff', 'HEAD', '--name-only', '--', 'src/server', 'src/app/api']);
    const untracked = git(['ls-files', '--others', '--exclude-standard', '--', 'src/server', 'src/app/api']);
    assert(dirty === '', `modified server/api files:\n${dirty}`);
    assert(untracked === '', `untracked server/api files:\n${untracked}`);
  }
}

// ── Summary ────────────────────────────────────────────────────────────────
if (failures > 0) {
  console.error(`\n${failures} invariant failure(s).`);
  process.exit(1);
}
console.log('\nAll Crash invariants hold.');
