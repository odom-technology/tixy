/**
 * Offline fairness / RTP / invariant gate for Prize Claw.
 *
 *   npx tsx scripts/verify-prize-claw-rtp.ts
 *
 * Replays the exact production derivation path:
 *   validatePrizeClawConfig -> generatePrizeBed(bedSeed, cabinet)
 *   resolveClawDrop(seed, bed, x, z)  ->  u1 = 'prize-claw:grab'
 *                                         u2 = 'prize-claw:hold'
 *   generateClawScript(seed, resolution)
 *   computePrizeClawPayout(wager, resolution, seed)
 *
 * What it proves:
 *   1. the shared browser-safe RNG is byte-identical to arcade-rng.ts;
 *   2. the RTP identity holds exactly for every tier, and empirically over
 *      millions of Monte-Carlo drops on a clear prize's grip cross;
 *   3. the exposure penalties land where the paytable says they do;
 *   4. the reroll-proof invariant holds on every generated bed, so opening and
 *      forfeiting sessions until a favourable bed appears gains nothing;
 *   5. beds are deterministic, in-bounds, non-interpenetrating, and carry the
 *      cabinet's exact tier multiset;
 *   6. bedSeed is independent of the session seed;
 *   7. resolution is deterministic and replay-safe, clamps hostile
 *      coordinates, and never pays on a non-`won` outcome;
 *   8. the script is deterministic and its phases are sane;
 *   9. the grip strength the cabinet publishes (clawGripTable) equals what
 *      resolveClawDrop rolls against, for every tier and exposure, and its
 *      printed text reads back as that number.
 *
 * Exits non-zero on any failed assertion.
 */
import crypto from 'node:crypto';

import { ARCADE_RTP } from '@/server/arcade/arcade-constants';
import { mulberry32, seededShuffle } from '@/server/arcade/arcade-rng';
import {
  CLAW_BED_X,
  CLAW_BED_Z0,
  CLAW_BED_Z1,
  CLAW_BRUSH_BAND,
  CLAW_CABINETS,
  CLAW_CABINET_IDS,
  CLAW_EXPOSURE_MULT,
  CLAW_MIN_SEPARATION,
  CLAW_PLACE_X,
  CLAW_PLACE_Z0,
  CLAW_PLACE_Z1,
  CLAW_R_GRIP,
  CLAW_R_OVERLAP,
  CLAW_TIERS,
  CLAW_TIER_IDS,
  PRIZE_CLAW_RTP,
  clampToBed,
  clawAimAt,
  clawCabinetTiers,
  clawGripCurve,
  clawGripTable,
  clawRng,
  clawShuffle,
  formatClawPct,
  computePrizeClawPayout,
  generateClawScript,
  generatePrizeBed,
  playPrizeClawDrop,
  readPrizeClawConfig,
  resolveClawDrop,
  validatePrizeClawConfig,
  type ClawCabinetId,
  type ClawExposure,
  type ClawTierId,
  type PrizeBed,
} from '@/server/arcade/wager-games/prize-claw';
import {
  assignClawShelf,
  clawShelfBands,
  type ClawShelfItem,
} from '@/features/arcade/lib/prize-claw-shelf';
import {
  CLAW_HEAD_SWAY,
  makePileSpring,
  makeSwing,
  shovePile,
  stepPileSpring,
  stepSwing,
  pileAtRest,
  swingAtRest,
} from '@/app/(games)/prize-claw/_prize-claw-sway';

/* ── harness ─────────────────────────────────────────────────────────────── */

const MONTE_CARLO_DROPS = 250_000; // per tier
const BEDS_PER_CABINET = 120_000;
const SCRIPT_SAMPLES = 5_000;
const RNG_PARITY_SAMPLES = 50_000;
const RTP_ABS_TOLERANCE = 0.006;
const RTP_SIGMA_TOLERANCE = 4.5;
const CABINET_RTP_ABS_FLOOR = 0.01;
const CABINET_RTP_SIGMA_TOLERANCE = 6;
const MAX_FAILURES_PRINTED = 40;

let suppressed = 0;
const failures: string[] = [];

function fail(msg: string): void {
  if (failures.length < MAX_FAILURES_PRINTED) failures.push(msg);
  else suppressed += 1;
}

function assert(cond: boolean, msg: string): void {
  if (!cond) fail(msg);
}

function pct(v: number): string {
  return `${(v * 100).toFixed(4)}%`;
}

/**
 * Batched CSPRNG seeds in the same 31-bit range as generateArcadeSeed().
 * Batched purely for speed — millions of draws through crypto.randomInt would
 * dominate the runtime of this gate.
 */
let seedPool = crypto.randomBytes(1 << 16);
let seedCursor = 0;
function randomSeed(): number {
  if (seedCursor + 4 > seedPool.length) {
    seedPool = crypto.randomBytes(1 << 16);
    seedCursor = 0;
  }
  const value = seedPool.readUInt32BE(seedCursor) & 0x7fffffff;
  seedCursor += 4;
  return value;
}

console.log('Prize Claw RTP / fairness verification');
console.log(`  monte-carlo drops per tier: ${MONTE_CARLO_DROPS.toLocaleString()}`);
console.log(`  beds per cabinet:           ${BEDS_PER_CABINET.toLocaleString()}`);
console.log('');

/* ── 1. the browser-safe RNG copies are byte-identical ───────────────────── */

for (let i = 0; i < RNG_PARITY_SAMPLES; i += 1) {
  const seed = randomSeed();
  const a = mulberry32(seed);
  const b = clawRng(seed);
  for (let k = 0; k < 4; k += 1) {
    const x = a();
    const y = b();
    if (x !== y) {
      fail(`clawRng diverges from mulberry32 at seed=${seed} draw=${k}: ${x} vs ${y}`);
      break;
    }
  }
  if (i % 5 === 0) {
    const len = 1 + (i % 12);
    const items = Array.from({ length: len }, (_, n) => n);
    const shuffleA = JSON.stringify(seededShuffle(items, seed));
    const shuffleB = JSON.stringify(clawShuffle(items, seed));
    if (shuffleA !== shuffleB) {
      fail(`clawShuffle diverges from seededShuffle at seed=${seed} len=${len}`);
    }
  }
}
console.log(`RNG parity: ${RNG_PARITY_SAMPLES.toLocaleString()} seeds checked`);

/* ── 2. the RTP identity, exactly ────────────────────────────────────────── */

assert(
  PRIZE_CLAW_RTP === ARCADE_RTP['arcade-prize-claw'] && PRIZE_CLAW_RTP === 0.97,
  `PRIZE_CLAW_RTP ${PRIZE_CLAW_RTP} is not ARCADE_RTP['arcade-prize-claw'] === 0.97`,
);

console.log('');
console.log('Tier table (identity: pGrabMax x pHold x mult = RTP)');
console.log('  tier  prize             mult     pHold    pGrabMax    P(win)      EV');
for (const id of CLAW_TIER_IDS) {
  const tier = CLAW_TIERS[id];
  const pWin = tier.grabChanceMax * tier.holdChance;
  const ev = pWin * tier.multiplier;
  assert(
    Math.abs(ev - PRIZE_CLAW_RTP) < 1e-12,
    `tier ${id} EV ${ev} != ${PRIZE_CLAW_RTP}`,
  );
  assert(
    tier.grabChanceMax > 0 && tier.grabChanceMax <= 0.95,
    `tier ${id} pGrabMax ${tier.grabChanceMax} outside (0, 0.95] — no tier may be a certainty`,
  );
  assert(tier.holdChance > 0 && tier.holdChance < 1, `tier ${id} pHold ${tier.holdChance} outside (0, 1)`);
  console.log(
    `  ${id}     ${tier.name.padEnd(16)} ${String(tier.multiplier).padStart(5)}   ${tier.holdChance.toFixed(
      2,
    )}     ${tier.grabChanceMax.toFixed(7)}   ${pct(pWin).padStart(9)}   ${ev.toFixed(6)}`,
  );
}

// The grip curve is forgiving near the cross and zero at the rim.
assert(clawGripCurve(0) === 1, 'gripCurve(0) must be 1');
assert(clawGripCurve(1) === 0, 'gripCurve(1) must be 0');
assert(
  Math.abs(clawGripCurve(0.25) - 0.9375) < 1e-12,
  `gripCurve(0.25) ${clawGripCurve(0.25)} != 0.9375`,
);
for (let e = 0; e <= 1.0001; e += 0.01) {
  const g = clawGripCurve(e);
  assert(g >= 0 && g <= 1, `gripCurve(${e}) = ${g} outside [0,1]`);
}
assert(clawGripCurve(9) === 0, 'gripCurve must clamp above 1');
assert(clawGripCurve(-3) === 1, 'gripCurve must clamp below 0');

/* ── 2b. the published grip strength is what the engine does ──────────────
   The cabinet prints clawGripTable() on its glass, its fascia and its ? sheet.
   Every number in it has to equal what resolveClawDrop uses, to the last bit,
   and the printed text has to read back as that number. */

{
  const published = clawGripTable();
  assert(
    published.length === CLAW_TIER_IDS.length &&
      published.every((row, i) => row.id === CLAW_TIER_IDS[i]),
    'the published grip table must list every tier, in order',
  );
  const exposures: Array<[ClawExposure, 'grab' | 'grabLeaning' | 'grabBuried']> = [
    ['clear', 'grab'],
    ['leaning', 'grabLeaning'],
    ['buried', 'grabBuried'],
  ];
  const printed = (text: string) => Number(text.replace('%', '')) / 100;
  console.log('');
  console.log('Published grip strength (printed vs engine)');
  console.log('  tier  mult   grab      grip      leaning   buried');
  for (const row of published) {
    for (const [exposure, field] of exposures) {
      const bed = referenceBed(row.id);
      bed.prizes[0]!.exposure = exposure;
      const cross = bed.prizes[0]!;
      const res = resolveClawDrop(12345, bed, cross.x, cross.z);
      assert(
        res.grip === row[field],
        `tier ${row.id} ${exposure}: engine grab ${res.grip} != published ${row[field]}`,
      );
      assert(
        res.holdChance === row.grip,
        `tier ${row.id} ${exposure}: engine grip ${res.holdChance} != published ${row.grip}`,
      );
      assert(
        res.target?.tier === row.id && res.target.exposure === exposure,
        `tier ${row.id} ${exposure}: the reference prize was not the one resolved`,
      );
    }
    // A win pays the published multiple, and the published chance of one is
    // the grab times the grip that the engine rolled against.
    const won = (() => {
      for (let seed = 1; seed < 5_000; seed += 1) {
        const bed = referenceBed(row.id);
        const res = resolveClawDrop(seed, bed, bed.prizes[0]!.x, bed.prizes[0]!.z);
        if (res.outcome === 'won') return res;
      }
      return null;
    })();
    assert(won !== null, `tier ${row.id}: no winning drop found to check the multiple`);
    if (won) {
      assert(won.multiplier === row.multiplier, `tier ${row.id}: engine pays ${won.multiplier}x, published ${row.multiplier}x`);
    }
    assert(
      row.win === row.grab * row.grip && Math.abs(row.win * row.multiplier - PRIZE_CLAW_RTP) < 1e-12,
      `tier ${row.id}: published win chance does not satisfy the RTP identity`,
    );
    // The printed text reads back as the number, to its printed precision.
    for (const value of [row.grab, row.grip, row.grabLeaning, row.grabBuried]) {
      const text = formatClawPct(value);
      const digits = text.split('.')[1]!.length - 1;
      assert(
        Math.abs(printed(text) - value) <= 0.5 * 10 ** -(digits + 2) + 1e-12,
        `tier ${row.id}: "${text}" does not read back as ${value}`,
      );
    }
    console.log(
      `  ${row.id}     ${String(row.multiplier).padStart(5)}  ${formatClawPct(row.grab).padStart(8)}  ${formatClawPct(row.grip).padStart(8)}  ` +
        `${formatClawPct(row.grabLeaning).padStart(8)}  ${formatClawPct(row.grabBuried).padStart(8)}`,
    );
  }
}

/* ── 2c. presentation only: the case's stock and the springs ───────────────
   Neither may touch the engine. The shelf puts a counter item in every slot
   without changing the slot, and the springs settle and stay bounded. */

{
  const items: ClawShelfItem[] = Array.from({ length: 42 }, (_, i) => ({
    id: `item-${String(i).padStart(2, '0')}`,
    name: `item ${i}`,
    kind: 'avatar',
    price: 400 + i * 40,
    gameType: 'profile',
    slots: [i % 3 === 0 ? 'avatar' : i % 3 === 1 ? 'board' : 'unlisted-slot'],
    rarity: 'common',
  }));
  const bands = clawShelfBands(items);
  const cheapestOf = (id: ClawTierId) => Math.min(...bands[id].map((i) => i.price));
  for (let r = 1; r < CLAW_TIER_IDS.length; r += 1) {
    assert(
      cheapestOf(CLAW_TIER_IDS[r]!) > cheapestOf(CLAW_TIER_IDS[r - 1]!),
      'a higher tier must draw from a higher price band',
    );
  }
  for (const cabinet of CLAW_CABINET_IDS) {
    for (let seed = 1; seed <= 200; seed += 1) {
      const bed = generatePrizeBed(seed * 7919, cabinet);
      const before = JSON.stringify(bed);
      const shelf = assignClawShelf(bed, items);
      assert(JSON.stringify(bed) === before, 'assigning the shelf must not change the bed');
      assert(
        JSON.stringify(shelf) === JSON.stringify(assignClawShelf(bed, items)),
        'the shelf must be deterministic for a bed',
      );
      assert(shelf.length === bed.prizes.length, 'every slot gets a shelf entry');
      assert(
        shelf.every((entry, i) => entry.item !== null && entry.tier === bed.prizes[i]!.tier),
        'every slot has an item, and the tier is the bed\'s',
      );
    }
  }
  assert(
    assignClawShelf(generatePrizeBed(5, 'top'), []).every((e) => e.item === null && e.form === 'box'),
    'an empty counter leaves plain boxes',
  );

  // The claw's sway: bounded by its limit, and at rest within five seconds.
  const swing = makeSwing();
  for (let i = 0; i < 90; i += 1) {
    stepSwing(swing, i < 20 ? 60 : -60, 30, 1 / 60, CLAW_HEAD_SWAY);
    assert(
      Math.abs(swing.rx) <= CLAW_HEAD_SWAY.limit && Math.abs(swing.rz) <= CLAW_HEAD_SWAY.limit,
      'sway must stay inside its limit',
    );
  }
  for (let i = 0; i < 300; i += 1) stepSwing(swing, 0, 0, 1 / 60, CLAW_HEAD_SWAY);
  assert(swingAtRest(swing), 'sway must settle within five seconds of the last move');
  // A slow frame gives the same answer as the same time in small frames.
  const coarse = makeSwing();
  const fine = makeSwing();
  stepSwing(coarse, 40, -20, 0.1, CLAW_HEAD_SWAY);
  for (let i = 0; i < 6; i += 1) stepSwing(fine, 40, -20, 0.1 / 6, CLAW_HEAD_SWAY);
  assert(
    Math.abs(coarse.rx - fine.rx) < 1e-3 && Math.abs(coarse.rz - fine.rz) < 1e-3,
    'sway must not depend on the frame length',
  );
  const pile = makePileSpring();
  shovePile(pile, 1, 0.5, 0.5);
  for (let i = 0; i < 240; i += 1) stepPileSpring(pile, 1 / 60);
  assert(pileAtRest(pile), 'a shoved prize must settle');
  console.log('Presentation: shelf and springs OK (no engine state touched)');
}

/* ── 3. bed generation: determinism, bounds, multiset, invariant ─────────── */

type BedStats = {
  beds: number;
  prizes: number;
  exposure: Record<ClawExposure, number>;
  forcedClear: number;
  minSeparation: number;
};

const bedStats: Record<ClawCabinetId, BedStats> = {} as Record<
  ClawCabinetId,
  BedStats
>;

function checkBed(cabinet: ClawCabinetId, bedSeed: number, bed: PrizeBed): void {
  const spec = CLAW_CABINETS[cabinet];
  const stats = bedStats[cabinet];
  stats.beds += 1;

  assert(bed.cabinet === cabinet, `bed cabinet ${bed.cabinet} != ${cabinet}`);
  assert(bed.bedSeed === bedSeed, `bed seed ${bed.bedSeed} != ${bedSeed}`);
  assert(
    bed.prizes.length === spec.tiers.length,
    `${cabinet} bed has ${bed.prizes.length} prizes, expected ${spec.tiers.length}`,
  );

  // Exact tier multiset — the bed may shuffle placement, never composition.
  const wanted = [...spec.tiers].sort().join('');
  const got = bed.prizes.map((p) => p.tier).sort().join('');
  assert(got === wanted, `${cabinet} bed multiset ${got} != ${wanted} (seed ${bedSeed})`);

  for (let i = 0; i < bed.prizes.length; i += 1) {
    const prize = bed.prizes[i]!;
    stats.prizes += 1;
    stats.exposure[prize.exposure] += 1;
    if (prize.forcedClear) stats.forcedClear += 1;

    assert(prize.index === i, `${cabinet} prize index ${prize.index} != ${i}`);
    assert(
      Number.isFinite(prize.x) && Number.isFinite(prize.z),
      `${cabinet} prize ${i} has non-finite position (seed ${bedSeed})`,
    );
    assert(
      Math.abs(prize.x) <= CLAW_PLACE_X + 1e-9,
      `${cabinet} prize ${i} x=${prize.x} outside placement box (seed ${bedSeed})`,
    );
    assert(
      prize.z >= CLAW_PLACE_Z0 - 1e-9 && prize.z <= CLAW_PLACE_Z1 + 1e-9,
      `${cabinet} prize ${i} z=${prize.z} outside placement box (seed ${bedSeed})`,
    );
    // The whole grip footprint must sit on the felt.
    assert(
      Math.abs(prize.x) + CLAW_R_GRIP <= CLAW_BED_X + 1e-9 &&
        prize.z - CLAW_R_GRIP >= CLAW_BED_Z0 - 1e-9 &&
        prize.z + CLAW_R_GRIP <= CLAW_BED_Z1 + 1e-9,
      `${cabinet} prize ${i} grip footprint leaves the bed (seed ${bedSeed})`,
    );
    assert(
      prize.variant >= 0 && prize.variant < 4,
      `${cabinet} prize ${i} variant ${prize.variant} out of range`,
    );

    // The published neighbour count must match the published geometry, and the
    // exposure class must follow from it (unless the repair forced it).
    let neighbours = 0;
    for (let j = 0; j < bed.prizes.length; j += 1) {
      if (j === i) continue;
      const other = bed.prizes[j]!;
      const d = Math.hypot(prize.x - other.x, prize.z - other.z);
      if (j > i) stats.minSeparation = Math.min(stats.minSeparation, d);
      if (d < CLAW_R_OVERLAP) neighbours += 1;
      assert(
        d >= CLAW_MIN_SEPARATION - 1e-6,
        `${cabinet} prizes ${i}/${j} only ${d.toFixed(4)} apart (seed ${bedSeed})`,
      );
    }
    assert(
      prize.neighbours === neighbours,
      `${cabinet} prize ${i} claims ${prize.neighbours} neighbours, geometry says ${neighbours} (seed ${bedSeed})`,
    );
    const expected: ClawExposure =
      neighbours === 0 ? 'clear' : neighbours === 1 ? 'leaning' : 'buried';
    assert(
      prize.exposure === expected || (prize.forcedClear && prize.exposure === 'clear'),
      `${cabinet} prize ${i} exposure ${prize.exposure} != ${expected} (seed ${bedSeed})`,
    );
  }

  // THE REROLL-PROOF INVARIANT.
  for (const tier of clawCabinetTiers(cabinet)) {
    const clear = bed.prizes.some((p) => p.tier === tier && p.exposure === 'clear');
    assert(
      clear,
      `${cabinet} bed has no CLEAR ${tier} — reroll-proof invariant broken (seed ${bedSeed})`,
    );
  }
}

for (const cabinet of CLAW_CABINET_IDS) {
  bedStats[cabinet] = {
    beds: 0,
    prizes: 0,
    exposure: { clear: 0, leaning: 0, buried: 0 },
    forcedClear: 0,
    minSeparation: Number.POSITIVE_INFINITY,
  };
}

for (const cabinet of CLAW_CABINET_IDS) {
  for (let i = 0; i < BEDS_PER_CABINET; i += 1) {
    const bedSeed = randomSeed();
    const bed = generatePrizeBed(bedSeed, cabinet);
    checkBed(cabinet, bedSeed, bed);

    // Determinism: the client rebuilds this exact bed from the public seed.
    if (i % 2_000 === 0) {
      const again = generatePrizeBed(bedSeed, cabinet);
      assert(
        JSON.stringify(again) === JSON.stringify(bed),
        `${cabinet} bed is not deterministic at seed ${bedSeed}`,
      );
    }
  }
}

console.log('');
console.log('Bed generation');
console.log('  cabinet  beds       prizes     clear     leaning   buried    forced   min sep');
for (const cabinet of CLAW_CABINET_IDS) {
  const s = bedStats[cabinet];
  console.log(
    `  ${cabinet.padEnd(8)} ${String(s.beds).padStart(9)}  ${String(s.prizes).padStart(9)}  ` +
      `${pct(s.exposure.clear / s.prizes).padStart(8)}  ${pct(s.exposure.leaning / s.prizes).padStart(8)}  ` +
      `${pct(s.exposure.buried / s.prizes).padStart(8)}  ${pct(s.forcedClear / s.prizes).padStart(7)}  ` +
      `${s.minSeparation.toFixed(4)}`,
  );
  // Reading the bed has to actually matter: if practically nothing ever
  // crowds, the strategic layer is decorative.
  const crowded = (s.exposure.leaning + s.exposure.buried) / s.prizes;
  assert(
    crowded > 0.02,
    `${cabinet}: only ${pct(crowded)} of prizes are crowded — exposure is decorative`,
  );
  assert(
    crowded < 0.75,
    `${cabinet}: ${pct(crowded)} of prizes are crowded — the bed reads as a heap`,
  );
}

/* ── 4. bedSeed independence from the session seed ───────────────────────── */

{
  // validatePrizeClawConfig must mint its own seed, ignore any client-supplied
  // one, and never repeat.
  const seen = new Set<number>();
  let collisions = 0;
  for (let i = 0; i < 20_000; i += 1) {
    const config = validatePrizeClawConfig({ cabinet: 'top', bedSeed: 12345 });
    assert(config != null, 'validatePrizeClawConfig rejected a valid cabinet');
    if (!config) break;
    assert(
      config.bedSeed !== 12345,
      'validatePrizeClawConfig echoed the CLIENT-SUPPLIED bedSeed — the player could shop for a bed',
    );
    assert(
      Number.isInteger(config.bedSeed) && config.bedSeed >= 0 && config.bedSeed < 2 ** 31,
      `validatePrizeClawConfig produced an out-of-range bedSeed ${config.bedSeed}`,
    );
    if (seen.has(config.bedSeed)) collisions += 1;
    seen.add(config.bedSeed);
  }
  // 20k draws from 2^31 — the birthday expectation is ~0.09, so anything above
  // a handful means the seed is not really random.
  assert(collisions <= 5, `validatePrizeClawConfig repeated ${collisions} bed seeds in 20,000 draws`);

  for (const bad of [
    null,
    undefined,
    {},
    { cabinet: 'nope' },
    { cabinet: 3 },
    'top',
    { cabinet: null },
  ]) {
    assert(
      validatePrizeClawConfig(bad) === null,
      `validatePrizeClawConfig accepted ${JSON.stringify(bad)}`,
    );
  }
  for (const bad of [{ cabinet: 'top' }, { cabinet: 'top', bedSeed: 'x' }, { cabinet: 'x', bedSeed: 1 }]) {
    assert(
      readPrizeClawConfig(bad) === null,
      `readPrizeClawConfig accepted ${JSON.stringify(bad)}`,
    );
  }

  // The bed must not correlate with the session seed. Generating a bed from a
  // session seed and from its own seed must be uncorrelated by construction —
  // here we simply assert the code path never consults the session seed: the
  // same bedSeed with different session seeds yields identical beds.
  const bedSeed = randomSeed();
  const bedA = generatePrizeBed(bedSeed, 'top');
  for (let i = 0; i < 200; i += 1) {
    const sessionSeed = randomSeed();
    const round = playPrizeClawDrop({ cabinet: 'top', bedSeed }, sessionSeed, 0, 1.4);
    assert(round != null, 'playPrizeClawDrop returned null for a valid config');
    assert(
      JSON.stringify(round?.bed) === JSON.stringify(bedA),
      'the bed changed with the session seed — bedSeed is not independent',
    );
  }
}
console.log('');
console.log('bedSeed independence: OK (own CSPRNG draw, client value ignored, bed invariant to session seed)');

/* ── 5. clamping and hostile input ───────────────────────────────────────── */

{
  const hostile: Array<[unknown, unknown]> = [
    [Number.NaN, 0],
    [0, Number.NaN],
    [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY],
    [1e9, -1e9],
    ['0.5', {}],
    [null, undefined],
    [-99, 99],
  ];
  for (const [x, z] of hostile) {
    const p = clampToBed(x, z);
    assert(
      Number.isFinite(p.x) && Number.isFinite(p.z),
      `clampToBed(${String(x)}, ${String(z)}) produced non-finite output`,
    );
    assert(
      Math.abs(p.x) <= CLAW_BED_X && p.z >= CLAW_BED_Z0 && p.z <= CLAW_BED_Z1,
      `clampToBed(${String(x)}, ${String(z)}) escaped the bed: ${JSON.stringify(p)}`,
    );
  }

  // A hostile drop must resolve, not throw, and must never pay.
  const bed = generatePrizeBed(randomSeed(), 'top');
  for (const [x, z] of hostile) {
    const res = resolveClawDrop(randomSeed(), bed, x as number, z as number);
    assert(
      Math.abs(res.point.x) <= CLAW_BED_X && res.point.z >= CLAW_BED_Z0 && res.point.z <= CLAW_BED_Z1,
      'resolveClawDrop kept an out-of-bounds commit point',
    );
    if (res.outcome !== 'won') {
      assert(res.multiplier === 0, 'a non-won outcome carries a multiplier');
      assert(
        computePrizeClawPayout(1_000, res, 12345) === 0,
        'a non-won outcome paid out',
      );
    }
  }
}
console.log('Hostile coordinate handling: OK (clamped, resolved, never paid)');

/* ── 6. Monte-Carlo RTP per tier, at optimal play ────────────────────────── */

type TierStats = {
  drops: number;
  wins: number;
  payoutSum: number;
  payoutSumSq: number;
  grabs: number;
  brushes: number;
  slips: number;
};

const tierStats: Record<ClawTierId, TierStats> = {} as Record<ClawTierId, TierStats>;
for (const id of CLAW_TIER_IDS) {
  tierStats[id] = { drops: 0, wins: 0, payoutSum: 0, payoutSumSq: 0, grabs: 0, brushes: 0, slips: 0 };
}

/**
 * A synthetic single-prize bed pinned to the middle of the felt with the
 * requested tier and a clear exposure — the "optimal play" reference the RTP
 * is advertised against. Built by hand rather than searched for so the sample
 * is not biased by which cabinets happen to produce clear prizes.
 */
function referenceBed(tier: ClawTierId): PrizeBed {
  return {
    cabinet: 'top',
    bedSeed: 0,
    prizes: [
      {
        index: 0,
        tier,
        x: 0,
        z: (CLAW_BED_Z0 + CLAW_BED_Z1) / 2,
        neighbours: 0,
        exposure: 'clear',
        yaw: 0,
        variant: 0,
        forcedClear: false,
      },
    ],
  };
}

const WAGER = 1_000_000; // large so integer rounding contributes < 1e-6
for (const id of CLAW_TIER_IDS) {
  const bed = referenceBed(id);
  const cross = bed.prizes[0]!;
  const stats = tierStats[id];
  for (let i = 0; i < MONTE_CARLO_DROPS; i += 1) {
    const seed = randomSeed();
    const res = resolveClawDrop(seed, bed, cross.x, cross.z);
    stats.drops += 1;
    if (res.grabbed) stats.grabs += 1;
    if (res.outcome === 'brushed') stats.brushes += 1;
    if (res.outcome === 'slipped') stats.slips += 1;

    // Every drop must be self-consistent with its own revealed rolls.
    assert(
      res.grabbed === (res.grabRoll < res.grip),
      `tier ${id}: grabbed flag disagrees with the revealed roll`,
    );
    assert(
      res.held === (res.grabbed && res.holdRoll < res.holdChance),
      `tier ${id}: held flag disagrees with the revealed roll`,
    );
    if (res.outcome === 'won') assert(res.grabbed && res.held, `tier ${id}: won without grab+hold`);
    if (res.outcome === 'slipped') assert(res.grabbed && !res.held, `tier ${id}: slipped without a grab`);
    if (res.outcome === 'brushed') {
      assert(
        !res.grabbed && res.grabRoll < res.grip + CLAW_BRUSH_BAND,
        `tier ${id}: brushed outside the brush band`,
      );
    }
    if (res.outcome === 'missed') {
      assert(
        res.grabRoll >= res.grip + CLAW_BRUSH_BAND,
        `tier ${id}: missed inside the brush band`,
      );
    }

    const payout = computePrizeClawPayout(WAGER, res, seed) / WAGER;
    if (res.outcome === 'won') stats.wins += 1;
    stats.payoutSum += payout;
    stats.payoutSumSq += payout * payout;
  }
}

console.log('');
console.log('Monte-Carlo RTP on a clear prize, dead centre (optimal play)');
console.log('  tier  drops      grab rate   win rate    RTP         stderr     tol        diff');
for (const id of CLAW_TIER_IDS) {
  const s = tierStats[id];
  const tier = CLAW_TIERS[id];
  const rtp = s.payoutSum / s.drops;
  const variance = Math.max(0, s.payoutSumSq / s.drops - rtp * rtp);
  const stderr = Math.sqrt(variance / s.drops);
  const tolerance = Math.max(RTP_ABS_TOLERANCE, RTP_SIGMA_TOLERANCE * stderr);
  const diff = Math.abs(rtp - PRIZE_CLAW_RTP);
  assert(
    diff <= tolerance,
    `tier ${id} empirical RTP ${rtp} differs from ${PRIZE_CLAW_RTP} by ${diff} (tolerance ${tolerance})`,
  );
  // The grab rate must track the published maximum.
  const grabRate = s.grabs / s.drops;
  const grabTol = Math.max(0.004, 4.5 * Math.sqrt((grabRate * (1 - grabRate)) / s.drops));
  assert(
    Math.abs(grabRate - tier.grabChanceMax) <= grabTol,
    `tier ${id} grab rate ${grabRate} differs from published ${tier.grabChanceMax} by more than ${grabTol}`,
  );
  console.log(
    `  ${id}     ${String(s.drops).padStart(9)}  ${pct(grabRate).padStart(9)}  ${pct(s.wins / s.drops).padStart(9)}  ` +
      `${pct(rtp).padStart(10)}  ${pct(stderr).padStart(9)}  ${pct(tolerance).padStart(9)}  ${pct(diff).padStart(9)}`,
  );
}

/* ── 7. exposure and aim penalties land where the paytable says ──────────── */

{
  const SAMPLES = 120_000;
  console.log('');
  console.log('Exposure / aim penalties (tier B, empirical vs published)');
  console.log('  case                    published    empirical');
  for (const exposure of ['clear', 'leaning', 'buried'] as ClawExposure[]) {
    const bed = referenceBed('B');
    bed.prizes[0]!.exposure = exposure;
    bed.prizes[0]!.neighbours = exposure === 'clear' ? 0 : exposure === 'leaning' ? 1 : 2;
    let payoutSum = 0;
    for (let i = 0; i < SAMPLES; i += 1) {
      const seed = randomSeed();
      const res = resolveClawDrop(seed, bed, bed.prizes[0]!.x, bed.prizes[0]!.z);
      payoutSum += computePrizeClawPayout(WAGER, res, seed) / WAGER;
    }
    const empirical = payoutSum / SAMPLES;
    const expected = PRIZE_CLAW_RTP * CLAW_EXPOSURE_MULT[exposure];
    assert(
      Math.abs(empirical - expected) <= 0.02,
      `exposure ${exposure}: empirical RTP ${empirical} != expected ${expected}`,
    );
    console.log(
      `  ${exposure.padEnd(22)}  ${expected.toFixed(4)}       ${empirical.toFixed(4)}`,
    );
  }

  // Aim: half a footprint off the cross costs exactly 1 - 0.5^2 = 75%.
  const bed = referenceBed('B');
  const cross = bed.prizes[0]!;
  let payoutSum = 0;
  for (let i = 0; i < SAMPLES; i += 1) {
    const seed = randomSeed();
    const res = resolveClawDrop(seed, bed, cross.x + CLAW_R_GRIP * 0.5, cross.z);
    payoutSum += computePrizeClawPayout(WAGER, res, seed) / WAGER;
  }
  const empirical = payoutSum / SAMPLES;
  const expected = PRIZE_CLAW_RTP * 0.75;
  assert(
    Math.abs(empirical - expected) <= 0.02,
    `half-footprint aim error: empirical RTP ${empirical} != expected ${expected}`,
  );
  console.log(`  aim 50% off cross       ${expected.toFixed(4)}       ${empirical.toFixed(4)}`);

  // Off the footprint entirely: bare felt, never a payout.
  for (let i = 0; i < 5_000; i += 1) {
    const seed = randomSeed();
    const res = resolveClawDrop(seed, bed, cross.x + CLAW_R_GRIP * 1.4, cross.z);
    assert(res.outcome === 'empty', `commit off the footprint returned ${res.outcome}`);
    assert(computePrizeClawPayout(WAGER, res, seed) === 0, 'bare felt paid out');
  }
  console.log('  off the footprint       0.0000       0.0000  (always `empty`)');
}

/* ── 8. determinism, replay safety and the script ────────────────────────── */

{
  let scriptChecks = 0;
  for (let i = 0; i < SCRIPT_SAMPLES; i += 1) {
    const cabinet = CLAW_CABINET_IDS[i % CLAW_CABINET_IDS.length]!;
    const config = validatePrizeClawConfig({ cabinet });
    if (!config) {
      fail('validatePrizeClawConfig returned null in the script sample');
      break;
    }
    const seed = randomSeed();
    const bed = generatePrizeBed(config.bedSeed, cabinet);
    const prize = bed.prizes[i % bed.prizes.length]!;
    const x = prize.x + (i % 7) * 0.02;
    const z = prize.z - (i % 5) * 0.02;

    const first = resolveClawDrop(seed, bed, x, z);
    const second = resolveClawDrop(seed, bed, x, z);
    assert(
      JSON.stringify(first) === JSON.stringify(second),
      `resolveClawDrop is not deterministic (seed ${seed})`,
    );

    // The replay path — a retried POST recomputes the identical outcome from
    // the stored config and the stored choice, without touching the wallet.
    const replay = playPrizeClawDrop(config, seed, x, z);
    assert(
      JSON.stringify(replay?.resolution) === JSON.stringify(first),
      `replay diverges from the live drop (seed ${seed})`,
    );

    const script = generateClawScript(seed, first);
    const scriptAgain = generateClawScript(seed, first);
    assert(
      JSON.stringify(script) === JSON.stringify(scriptAgain),
      `generateClawScript is not deterministic (seed ${seed})`,
    );
    assert(script.outcome === first.outcome, 'script outcome disagrees with the resolution');
    assert(
      script.descendMs > 0 && script.closeMs > 0 && script.gripMs > 0 && script.liftMs > 0,
      'script has a non-positive core phase',
    );
    assert(
      script.totalMs >= 2_000 && script.totalMs <= 6_500,
      `script total ${script.totalMs}ms outside the 2.0-6.5s design band`,
    );
    if (first.outcome === 'won') {
      assert(
        script.travelMs > 0 && script.releaseMs > 0 && script.chuteMs > 0,
        'a won script has no chute phases',
      );
    } else {
      assert(
        script.travelMs === 0 && script.releaseMs === 0 && script.chuteMs === 0,
        `a ${first.outcome} script plays the chute phases`,
      );
    }
    if (first.outcome === 'slipped') {
      assert(
        script.slipAtT != null && script.slipAtT >= 0.28 && script.slipAtT <= 0.82,
        `slipAtT ${script.slipAtT} outside [0.28, 0.82]`,
      );
    } else {
      assert(script.slipAtT === null, `slipAtT set on a ${first.outcome} script`);
    }

    // The live readout the client prints before commit must equal the grip the
    // server actually rolled against.
    const clamped = clampToBed(x, z);
    const serverAim = clawAimAt(bed, clamped.x, clamped.z);
    assert(
      Math.abs(serverAim.grip - first.grip) < 1e-12,
      'the shared clawAimAt readout disagrees with the resolved grip',
    );
    scriptChecks += 1;
  }
  console.log('');
  console.log(`Determinism / replay / script: ${scriptChecks.toLocaleString()} samples OK`);
}

/* ── 9. cabinet-level RTP with a simple optimal-play policy ──────────────── */

{
  // Play each cabinet the way the readout tells you to: pick the highest-value
  // CLEAR prize and hit its cross. Every tier is pinned to the same EV, so the
  // cabinet RTP must come out at the advertised figure regardless of policy.
  const ROUNDS = 120_000;
  console.log('');
  console.log('Cabinet RTP under "best clear prize, dead centre" play');
  console.log('  cabinet  rounds     wins       RTP         stderr     tol        diff');
  for (const cabinet of CLAW_CABINET_IDS) {
    let payoutSum = 0;
    let payoutSumSq = 0;
    let relevantPicks = 0;
    let wins = 0;
    for (let i = 0; i < ROUNDS; i += 1) {
      const bedSeed = randomSeed();
      const seed = randomSeed();
      const bed = generatePrizeBed(bedSeed, cabinet);
      let pick = bed.prizes.find((p) => p.exposure === 'clear');
      if (!pick) {
        fail(`${cabinet} cabinet produced no clear prize at bed seed ${bedSeed}`);
        continue;
      }
      for (const prize of bed.prizes) {
        if (prize.exposure !== 'clear') continue;
        if (CLAW_TIERS[prize.tier].multiplier > CLAW_TIERS[pick.tier].multiplier) {
          pick = prize;
        }
      }
      relevantPicks += 1;
      const res = resolveClawDrop(seed, bed, pick.x, pick.z);
      const payout = computePrizeClawPayout(WAGER, res, seed) / WAGER;
      if (res.outcome === 'won') wins += 1;
      payoutSum += payout;
      payoutSumSq += payout * payout;
    }
    assert(
      relevantPicks === ROUNDS,
      `${cabinet} cabinet evaluated ${relevantPicks}/${ROUNDS} relevant clear-prize outcomes`,
    );
    assert(wins > 0 && payoutSum > 0, `${cabinet} cabinet observed no winning payout`);
    const rtp = payoutSum / relevantPicks;
    const variance = Math.max(0, payoutSumSq / relevantPicks - rtp * rtp);
    const stderr = Math.sqrt(variance / relevantPicks);
    // Six standard errors makes a valid-run rejection vanishingly unlikely
    // (about 2 in a billion under a normal approximation), while the absolute
    // floor keeps low-variance cabinets from receiving a brittle tiny band.
    const tolerance = Math.max(
      CABINET_RTP_ABS_FLOOR,
      CABINET_RTP_SIGMA_TOLERANCE * stderr,
    );
    const diff = Math.abs(rtp - PRIZE_CLAW_RTP);
    assert(
      diff <= tolerance,
      `${cabinet} cabinet RTP ${rtp} differs from ${PRIZE_CLAW_RTP} by ${diff} (stderr ${stderr}, tolerance ${tolerance})`,
    );
    console.log(
      `  ${cabinet.padEnd(8)} ${String(relevantPicks).padStart(9)}  ${String(wins).padStart(7)}  ` +
        `${pct(rtp).padStart(10)}  ${pct(stderr).padStart(9)}  ${pct(tolerance).padStart(9)}  ${pct(diff).padStart(9)}`,
    );
  }
}

/* ── result ──────────────────────────────────────────────────────────────── */

if (failures.length > 0) {
  console.error(`\nFAILURES (${failures.length + suppressed}):`);
  for (const f of failures) console.error('  FAIL: ' + f);
  if (suppressed > 0) console.error(`  ... ${suppressed} more failure(s) suppressed`);
  process.exit(1);
}

console.log('\nALL PRIZE CLAW RTP/FAIRNESS CHECKS PASS.');
process.exit(0);
