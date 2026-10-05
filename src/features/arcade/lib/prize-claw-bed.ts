/* ──────────────────────────────────────────────────────────────────────────
   PRIZE CLAW — the shared pure module.

   This is the SINGLE SOURCE OF TRUTH for everything both the browser and the
   server need to agree on: the prize bed, the grip geometry, the exposure
   classes and the grab probability. The client imports it to build the cabinet
   and to print the live grip readout; the server imports it (through
   src/server/arcade/wager-games/prize-claw.ts) to resolve the drop.

   It lives under features/arcade/lib rather than server/arcade because it must
   be browser-safe: src/server/arcade/arcade-rng.ts pulls in node:crypto, so
   nothing that imports it can enter a client bundle. Everything here is pure
   arithmetic over plain numbers — no I/O, no crypto, no Date, no Math.random.

   ── The two-seed rule (the single most important thing in this feature) ──

   `bedSeed` is PUBLIC and drives everything in this file. The private session
   seed drives the two hidden rolls, and lives only in the server module.
   `bedSeed` MUST be generated independently of the session seed (see
   validatePrizeClawConfig). If it were ever derived from the session seed, a
   client that can see the bed could brute-force the 31-bit session seed —
   arcade-rng.ts warns in-source that this takes seconds — precompute both
   rolls, and only commit on winning rounds.

   ── No timing surface ──

   Nothing here consumes a timestamp, and neither does the resolver. The
   12-second positioning clock is client-side pacing only and is never sent.
   Unlike Skee-Ball / High Striker (which reconstruct outcomes from client
   timestamps and therefore need cadence floors and clock-stretch defences),
   Prize Claw has no clock-based attack surface at all. Please do not
   "helpfully" add a timestamp to the drop payload later.
   ────────────────────────────────────────────────────────────────────────── */

import { ARCADE_RTP } from '@/server/arcade/arcade-constants';

/* ── Bed geometry (world units — the three.js scene uses these verbatim) ── */

/** Bed half-width. The felt spans x ∈ [-1.15, 1.15]. */
export const CLAW_BED_X = 1.15;
/** Bed near edge (closest to the player). */
export const CLAW_BED_Z0 = 0.35;
/** Bed far edge (under the back glass). */
export const CLAW_BED_Z1 = 2.45;

/**
 * Grip footprint radius. IDENTICAL for every tier on purpose: if the marquee
 * prize were easier to aim at than a duck, prize choice would stop being a
 * pure variance choice and the whole EV identity below would collapse.
 */
export const CLAW_R_GRIP = 0.26;

/** Two prizes closer than this crowd each other — see the exposure table. */
export const CLAW_R_OVERLAP = 0.34;

/** Prizes are pushed apart until at least this far, so nothing interpenetrates. */
export const CLAW_MIN_SEPARATION = 0.22;

/**
 * u1 ∈ [p, p + band) reads as a "brush" instead of a clean miss. Presentation
 * only — it pays exactly 0, identically to a miss, and it is derived from the
 * same revealed roll, so it is verifiable rather than fabricated tension.
 */
export const CLAW_BRUSH_BAND = 0.12;

/** Client-side positioning clock. NEVER sent to the server. */
export const CLAW_COMMIT_MS = 12_000;

/* ── Prize placement grid ──
   A 3×3 jittered grid. The spacing/jitter pair is chosen so that neighbouring
   prizes crowd each other (centre distance < CLAW_R_OVERLAP) often enough for
   reading the bed to matter — roughly a quarter of prizes end up leaning or
   buried — without the bed ever reading as a solid heap. */

export const CLAW_GRID_COLS = 3;
export const CLAW_GRID_ROWS = 3;
export const CLAW_CELL_X = 0.66;
export const CLAW_CELL_Z = 0.62;
export const CLAW_JITTER = 0.28;

/** Prize centroids stay inside this box so a full grip footprint fits on felt. */
export const CLAW_PLACE_X = CLAW_BED_X - CLAW_R_GRIP;
export const CLAW_PLACE_Z0 = CLAW_BED_Z0 + CLAW_R_GRIP;
export const CLAW_PLACE_Z1 = CLAW_BED_Z1 - CLAW_R_GRIP;

const BED_MID_Z = (CLAW_BED_Z0 + CLAW_BED_Z1) / 2;

/* ── Exposure ── */

export const CLAW_EXPOSURES = ['clear', 'leaning', 'buried'] as const;
export type ClawExposure = (typeof CLAW_EXPOSURES)[number];

/**
 * How much a crowded footprint costs. Reading the bed and picking a clear
 * prize IS the strategic skill of this cabinet, and it is worth up to 43.7
 * percentage points of return. None of it is hidden: the exposure class, the
 * exact grip percentage and the multiplier are all printed before the commit.
 */
export const CLAW_EXPOSURE_MULT: Record<ClawExposure, number> = {
  clear: 1.0,
  leaning: 0.8,
  buried: 0.55,
};

export const CLAW_EXPOSURE_LABELS: Record<ClawExposure, string> = {
  clear: 'Clear',
  leaning: 'Leaning',
  buried: 'Buried',
};

export const CLAW_EXPOSURE_BLURBS: Record<ClawExposure, string> = {
  clear: 'Nothing crowds it. Full grip chance.',
  leaning: 'One neighbour fouls the fingers. Grip chance ×0.80.',
  buried: 'Two or more neighbours. Grip chance ×0.55.',
};

/** Neighbour count → exposure class. */
export function clawExposureFor(neighbours: number): ClawExposure {
  if (neighbours <= 0) return 'clear';
  if (neighbours === 1) return 'leaning';
  return 'buried';
}

/* ── Tiers ──
   The RTP identity: pGrabMax × pHold × mult = ARCADE_RTP for EVERY tier, so
   every prize on every cabinet has identical expected value at optimal play.
   pGrabMax is COMPUTED from that identity, never typed by hand, so the table
   cannot drift. Prize choice is therefore a variance choice and never an EV
   choice — no trap prize, no dominant prize. */

export const CLAW_TIER_IDS = ['A', 'B', 'C', 'D', 'E'] as const;
export type ClawTierId = (typeof CLAW_TIER_IDS)[number];

export const CLAW_SILHOUETTES = [
  'duck',
  'robot',
  'bear',
  'cat',
  'trophy',
] as const;
export type ClawSilhouette = (typeof CLAW_SILHOUETTES)[number];

/** The RTP every Prize Claw tier is pinned to, on a clear prize's grip cross. */
export const PRIZE_CLAW_RTP = ARCADE_RTP['arcade-prize-claw'];

export type ClawTier = {
  id: ClawTierId;
  name: string;
  /** Payout multiplier on a carried prize. */
  multiplier: number;
  /** Chance the claw keeps hold once it has closed. Published in the paytable. */
  holdChance: number;
  /** Best possible grab chance: clear prize, dead-centre commit. Derived. */
  grabChanceMax: number;
  silhouette: ClawSilhouette;
  /** Distinct silhouette AND a printed plate — colour is never the only channel. */
  plate: string;
  blurb: string;
};

function makeTier(
  id: ClawTierId,
  name: string,
  multiplier: number,
  holdChance: number,
  silhouette: ClawSilhouette,
  blurb: string,
): ClawTier {
  return {
    id,
    name,
    multiplier,
    holdChance,
    // The identity, solved for the grab chance.
    grabChanceMax: PRIZE_CLAW_RTP / (holdChance * multiplier),
    silhouette,
    plate: `×${multiplier}`,
    blurb,
  };
}

export const CLAW_TIERS: Record<ClawTierId, ClawTier> = {
  A: makeTier('A', 'Felt Duck', 1.6, 0.92, 'duck', 'Stitched felt, weighted base.'),
  B: makeTier('B', 'Tin Robot', 3.0, 0.84, 'robot', 'Litho tin, square shoulders.'),
  C: makeTier('C', 'Brass Bear', 8.0, 0.72, 'bear', 'Cast brass, awkward to hold.'),
  D: makeTier('D', 'Porcelain Cat', 25, 0.58, 'cat', 'Glazed and slick.'),
  E: makeTier('E', 'Gilt Trophy', 120, 0.42, 'trophy', 'Top shelf. Slips more than it holds.'),
};

// The identity must hold and no tier may be a certainty. Asserted at module
// load so a bad edit fails fast in dev, in CI and in the RTP gate alike.
for (const id of CLAW_TIER_IDS) {
  const tier = CLAW_TIERS[id];
  const ev = tier.grabChanceMax * tier.holdChance * tier.multiplier;
  if (!(Math.abs(ev - PRIZE_CLAW_RTP) < 1e-12)) {
    throw new Error(
      `Prize Claw tier ${id} EV ${ev} != ARCADE_RTP ${PRIZE_CLAW_RTP}`,
    );
  }
  if (!(tier.grabChanceMax > 0 && tier.grabChanceMax <= 0.95)) {
    throw new Error(
      `Prize Claw tier ${id} grabChanceMax ${tier.grabChanceMax} outside (0, 0.95]`,
    );
  }
}

/* ── Published grip strength ──
   The cabinet prints these numbers for every tier. They are read straight off
   CLAW_TIERS and CLAW_EXPOSURE_MULT, the constants resolveClawDrop rolls
   against, so a change to the engine changes the print with it.
   scripts/verify-prize-claw-rtp.ts asserts the table equals what the engine
   does. */

export type ClawGripRow = {
  id: ClawTierId;
  name: string;
  multiplier: number;
  /** Chance the fingers close on it: clear prize, dead-centre commit. */
  grab: number;
  /** Grip strength: chance it stays in the fingers on the lift once gripped. */
  grip: number;
  /** grab x grip: the best chance a drop on this tier pays. */
  win: number;
  /** The best grab chance when one neighbour crowds it, and when two do. */
  grabLeaning: number;
  grabBuried: number;
};

export function clawGripTable(
  ids: readonly ClawTierId[] = CLAW_TIER_IDS,
): ClawGripRow[] {
  return ids.map((id) => {
    const tier = CLAW_TIERS[id];
    return {
      id,
      name: tier.name,
      multiplier: tier.multiplier,
      grab: tier.grabChanceMax,
      grip: tier.holdChance,
      win: tier.grabChanceMax * tier.holdChance,
      grabLeaning: tier.grabChanceMax * CLAW_EXPOSURE_MULT.leaning,
      grabBuried: tier.grabChanceMax * CLAW_EXPOSURE_MULT.buried,
    };
  });
}

/** One format for every printed chance, so the glass, the sheet and the read-out agree. */
export function formatClawPct(p: number): string {
  const v = p * 100;
  if (v >= 10) return `${v.toFixed(1)}%`;
  if (v >= 1) return `${v.toFixed(2)}%`;
  return `${v.toFixed(3)}%`;
}

/** Rank order, weakest first — used for the back-row bias and the paytable. */
export const CLAW_TIER_RANK: Record<ClawTierId, number> = {
  A: 0,
  B: 1,
  C: 2,
  D: 3,
  E: 4,
};

/* ── Cabinets ──
   The "tier" choice is a CABINET, exactly as Plinko has risk/rows and Cases
   has risk. The bet itself always uses the shared ArcadeBetSelector. */

export const CLAW_CABINET_IDS = ['plush', 'curio', 'top'] as const;
export type ClawCabinetId = (typeof CLAW_CABINET_IDS)[number];

export type ClawCabinet = {
  id: ClawCabinetId;
  name: string;
  blurb: string;
  /** The fixed tier multiset shuffled into the bed. Length = prize count. */
  tiers: ClawTierId[];
};

export const CLAW_CABINETS: Record<ClawCabinetId, ClawCabinet> = {
  plush: {
    id: 'plush',
    name: 'Plush Row',
    blurb: 'Nine soft prizes. A grind — you win often and small.',
    tiers: ['A', 'A', 'A', 'A', 'A', 'A', 'B', 'B', 'B'],
  },
  curio: {
    id: 'curio',
    name: 'Curio Case',
    blurb: 'Eight prizes with a brass bear or two on the back row.',
    tiers: ['A', 'A', 'A', 'B', 'B', 'B', 'C', 'C'],
  },
  top: {
    id: 'top',
    name: 'Top Shelf',
    blurb: 'Seven prizes and one gilt trophy. A hunt, not a grind.',
    tiers: ['B', 'B', 'C', 'C', 'D', 'D', 'E'],
  },
};

export function isClawCabinetId(value: unknown): value is ClawCabinetId {
  return (
    typeof value === 'string' &&
    (CLAW_CABINET_IDS as readonly string[]).includes(value)
  );
}

/** Distinct tiers a cabinet actually stocks, weakest first. */
export function clawCabinetTiers(cabinet: ClawCabinetId): ClawTierId[] {
  const seen = new Set<ClawTierId>(CLAW_CABINETS[cabinet].tiers);
  return CLAW_TIER_IDS.filter((id) => seen.has(id));
}

/* ── Pure seeded RNG ──
   Verbatim copies of mulberry32 and the Fisher-Yates shuffle from
   src/server/arcade/arcade-rng.ts. They are restated here (rather than
   imported) only because that module pulls node:crypto into the graph.
   scripts/verify-prize-claw-rtp.ts asserts both agree with the originals over
   a large seed sample; if you touch either side, run it. */

/** Mulberry32 — byte-identical to arcade-rng.ts. Every operator matters. */
export function clawRng(seed: number): () => number {
  let s = seed | 0;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates — byte-identical to `seededShuffle` in arcade-rng.ts. */
export function clawShuffle<T>(items: readonly T[], seed: number): T[] {
  const arr = [...items];
  const rng = clawRng(seed);
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const a = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = a;
  }
  return arr;
}

/**
 * Independent sub-streams off the PUBLIC bed seed. A plain integer mixer is
 * used instead of the sha256-backed deriveSubSeed because this module must
 * stay node-free — and because nothing here is secret: the bed is published to
 * the client the moment the session opens.
 */
export function clawBedSubSeed(bedSeed: number, tag: number): number {
  let h = (bedSeed ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = (h + Math.imul(tag + 1, 0xc2b2ae35)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0x27d4eb2f) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/* ── The bed ── */

export type PrizeSlot = {
  index: number;
  tier: ClawTierId;
  /** Centroid — and the visible stitched grip cross. There is no hidden offset. */
  x: number;
  z: number;
  /** Prizes whose centroid is within CLAW_R_OVERLAP of this one. */
  neighbours: number;
  exposure: ClawExposure;
  /** Cosmetic: resting yaw and mesh variation. */
  yaw: number;
  variant: number;
  /**
   * True when the reroll-proof repair could not physically clear this prize
   * and had to declare it clear anyway. Expected to be vanishingly rare; the
   * RTP gate reports the observed rate.
   */
  forcedClear: boolean;
};

export type PrizeBed = {
  cabinet: ClawCabinetId;
  bedSeed: number;
  prizes: PrizeSlot[];
};

function clamp(value: number, lo: number, hi: number): number {
  return value < lo ? lo : value > hi ? hi : value;
}

function distance(a: PrizeSlot, b: PrizeSlot): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/** Recompute every neighbour count and exposure class from current positions. */
function classify(prizes: PrizeSlot[]): void {
  for (const prize of prizes) {
    let count = 0;
    for (const other of prizes) {
      if (other === prize) continue;
      if (distance(prize, other) < CLAW_R_OVERLAP) count += 1;
    }
    prize.neighbours = count;
    prize.exposure = prize.forcedClear ? 'clear' : clawExposureFor(count);
  }
}

/** Keep a prize's whole grip footprint on the felt. */
function clampSlot(prize: PrizeSlot): void {
  prize.x = clamp(prize.x, -CLAW_PLACE_X, CLAW_PLACE_X);
  prize.z = clamp(prize.z, CLAW_PLACE_Z0, CLAW_PLACE_Z1);
}

/**
 * Build the bed for a cabinet from its PUBLIC bed seed. Pure, deterministic,
 * total: the same (bedSeed, cabinet) always yields the same bed, on the server
 * and in the browser alike.
 *
 * The last step enforces the REROLL-PROOF INVARIANT: every tier the cabinet
 * stocks has at least one `clear` instance. Without it, a player could open
 * and forfeit sessions until the jackpot happened to land clear — the session
 * route has no per-user cadence limit today and a session with no recorded
 * choice refunds in full, so that loop would be free. With it, rerolling buys
 * nothing.
 */
export function generatePrizeBed(
  bedSeed: number,
  cabinet: ClawCabinetId,
): PrizeBed {
  const spec = CLAW_CABINETS[cabinet];
  const count = spec.tiers.length;
  const cellCount = CLAW_GRID_COLS * CLAW_GRID_ROWS;

  // 1. Which grid cells are occupied. Shuffled so the empty cells move around,
  //    then sorted back to row-major order so prize indices read left-to-right,
  //    front-to-back.
  const cells = clawShuffle(
    Array.from({ length: cellCount }, (_, i) => i),
    clawBedSubSeed(bedSeed, 1),
  )
    .slice(0, count)
    .sort((a, b) => a - b);

  // 2. Jittered placement + cosmetic variation.
  const rng = clawRng(clawBedSubSeed(bedSeed, 2));
  const prizes: PrizeSlot[] = cells.map((cell, index) => {
    const col = cell % CLAW_GRID_COLS;
    const row = Math.floor(cell / CLAW_GRID_COLS);
    const baseX = (col - (CLAW_GRID_COLS - 1) / 2) * CLAW_CELL_X;
    const baseZ = BED_MID_Z + (row - (CLAW_GRID_ROWS - 1) / 2) * CLAW_CELL_Z;
    const slot: PrizeSlot = {
      index,
      // Overwritten in step 3; the multiset never leaves the cabinet spec.
      tier: spec.tiers[0]!,
      x: baseX + (rng() * 2 - 1) * CLAW_JITTER,
      z: baseZ + (rng() * 2 - 1) * CLAW_JITTER,
      neighbours: 0,
      exposure: 'clear',
      yaw: (rng() * 2 - 1) * 0.55,
      variant: Math.floor(rng() * 4),
      forcedClear: false,
    };
    clampSlot(slot);
    return slot;
  });

  // 3. Tiers. The single best prize is biased to the deepest cell so the
  //    marquee prize genuinely reads as top shelf; everything else is shuffled.
  const pool = [...spec.tiers].sort(
    (a, b) => CLAW_TIER_RANK[b] - CLAW_TIER_RANK[a],
  );
  let deepest = 0;
  for (let i = 1; i < prizes.length; i += 1) {
    if (prizes[i]!.z > prizes[deepest]!.z) deepest = i;
  }
  prizes[deepest]!.tier = pool[0]!;
  const rest = clawShuffle(pool.slice(1), clawBedSubSeed(bedSeed, 3));
  let cursor = 0;
  for (const prize of prizes) {
    if (prize.index === prizes[deepest]!.index) continue;
    prize.tier = rest[cursor]!;
    cursor += 1;
  }

  // 4. Separation pass — nothing may interpenetrate. Deterministic and
  //    bounded; pairs are visited in a fixed order.
  for (let pass = 0; pass < 6; pass += 1) {
    let moved = false;
    for (let i = 0; i < prizes.length; i += 1) {
      for (let j = i + 1; j < prizes.length; j += 1) {
        const a = prizes[i]!;
        const b = prizes[j]!;
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const d = Math.hypot(dx, dz);
        if (d >= CLAW_MIN_SEPARATION) continue;
        moved = true;
        // Degenerate overlap: split along a fixed per-pair angle rather than
        // dividing by zero.
        const angle = d > 1e-6 ? Math.atan2(dz, dx) : (i * 7 + j) * 2.39996;
        const push = (CLAW_MIN_SEPARATION - d) / 2 + 0.005;
        a.x -= Math.cos(angle) * push;
        a.z -= Math.sin(angle) * push;
        b.x += Math.cos(angle) * push;
        b.z += Math.sin(angle) * push;
        clampSlot(a);
        clampSlot(b);
      }
    }
    if (!moved) break;
  }

  classify(prizes);

  // 5. Reroll-proof invariant.
  const stocked = clawCabinetTiers(cabinet);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    let repaired = false;
    for (const tier of stocked) {
      const instances = prizes.filter((p) => p.tier === tier);
      if (instances.some((p) => p.exposure === 'clear')) continue;
      repaired = true;
      // The least-crowded instance is the cheapest one to free.
      let best = instances[0]!;
      for (const candidate of instances) {
        if (candidate.neighbours < best.neighbours) best = candidate;
      }
      nudgeClear(prizes, best);
      classify(prizes);
    }
    if (!repaired) break;
  }

  // 6. Last resort. Geometry could not free the prize inside the bed, so the
  //    invariant is asserted directly. Recorded on the slot and reported by
  //    the RTP gate rather than hidden.
  for (const tier of stocked) {
    const instances = prizes.filter((p) => p.tier === tier);
    if (instances.some((p) => p.exposure === 'clear')) continue;
    let best = instances[0]!;
    for (const candidate of instances) {
      if (candidate.neighbours < best.neighbours) best = candidate;
    }
    best.forcedClear = true;
    best.exposure = 'clear';
  }

  return { cabinet, bedSeed, prizes };
}

/** Walk one prize away from whatever is crowding it, in fixed 0.06 steps. */
function nudgeClear(prizes: PrizeSlot[], target: PrizeSlot): void {
  for (let step = 0; step < 12; step += 1) {
    let cx = 0;
    let cz = 0;
    let crowders = 0;
    for (const other of prizes) {
      if (other === target) continue;
      if (distance(target, other) >= CLAW_R_OVERLAP) continue;
      cx += other.x;
      cz += other.z;
      crowders += 1;
    }
    if (crowders === 0) return;
    const dx = target.x - cx / crowders;
    const dz = target.z - cz / crowders;
    const len = Math.hypot(dx, dz);
    const angle = len > 1e-6 ? Math.atan2(dz, dx) : target.index * 2.39996;
    const beforeX = target.x;
    const beforeZ = target.z;
    target.x += Math.cos(angle) * 0.06;
    target.z += Math.sin(angle) * 0.06;
    clampSlot(target);
    // Pinned against the glass and still crowded — further steps cannot help.
    if (target.x === beforeX && target.z === beforeZ) return;
  }
}

/* ── Aiming ── */

/** Clamp a client-supplied commit point onto the bed. Non-finite → dead centre. */
export function clampToBed(x: unknown, z: unknown): { x: number; z: number } {
  const rawX = typeof x === 'number' && Number.isFinite(x) ? x : 0;
  const rawZ =
    typeof z === 'number' && Number.isFinite(z) ? z : (CLAW_BED_Z0 + CLAW_BED_Z1) / 2;
  return {
    x: clamp(rawX, -CLAW_BED_X, CLAW_BED_X),
    z: clamp(rawZ, CLAW_BED_Z0, CLAW_BED_Z1),
  };
}

export type ClawTarget = {
  prize: PrizeSlot;
  /** Distance from the commit point to the grip cross, in world units. */
  distance: number;
  /** Normalised aim error, 0 dead-centre → 1 at the footprint edge. */
  aimError: number;
};

/**
 * The prize the claw closes on: the nearest grip cross within CLAW_R_GRIP.
 * Null means the fingers close on bare felt.
 */
export function clawTargetAt(
  bed: PrizeBed,
  x: number,
  z: number,
): ClawTarget | null {
  let best: ClawTarget | null = null;
  for (const prize of bed.prizes) {
    const d = Math.hypot(prize.x - x, prize.z - z);
    if (d > CLAW_R_GRIP) continue;
    if (best && d >= best.distance) continue;
    best = { prize, distance: d, aimError: Math.min(1, d / CLAW_R_GRIP) };
  }
  return best;
}

/**
 * Forgiving near the centre, unforgiving at the rim: 6.5 cm off the cross is
 * still 93.75% of the maximum, the footprint edge is zero.
 */
export function clawGripCurve(aimError: number): number {
  const e = clamp(aimError, 0, 1);
  return 1 - e * e;
}

/** pGrabMax(tier) × exposureMult(exposure) × gripCurve(e). */
export function clawGrabChance(prize: PrizeSlot, aimError: number): number {
  return (
    CLAW_TIERS[prize.tier].grabChanceMax *
    CLAW_EXPOSURE_MULT[prize.exposure] *
    clawGripCurve(aimError)
  );
}

export type ClawAim = {
  target: ClawTarget | null;
  /** Live grab probability for the current claw position, 0 over bare felt. */
  grip: number;
  /** Hold chance for the targeted tier, 0 over bare felt. */
  holdChance: number;
  /** Payout multiplier if the prize is carried, 0 over bare felt. */
  multiplier: number;
  /** grip × holdChance — the honest chance this drop pays. */
  winChance: number;
};

/**
 * The single readout both the browser and the server compute. The client shows
 * it live on the Drop key before commit; the server recomputes it from the
 * clamped coordinates and never trusts the client's copy.
 */
export function clawAimAt(bed: PrizeBed, x: number, z: number): ClawAim {
  const target = clawTargetAt(bed, x, z);
  if (!target) {
    return { target: null, grip: 0, holdChance: 0, multiplier: 0, winChance: 0 };
  }
  const tier = CLAW_TIERS[target.prize.tier];
  const grip = clawGrabChance(target.prize, target.aimError);
  return {
    target,
    grip,
    holdChance: tier.holdChance,
    multiplier: tier.multiplier,
    winChance: grip * tier.holdChance,
  };
}

/** Where the claw parks between rounds — front-left, clear of the prizes. */
export const CLAW_HOME = { x: -0.9, z: 0.62 } as const;

/**
 * The chute mouth. Deliberately in FRONT of the bed's near edge rather than in
 * a corner of the felt: a hole inside the placement box could sit under a
 * generated prize, and the bed generator has no business knowing about scene
 * furniture. The claw only travels here on a win, and never aims here.
 */
export const CLAW_CHUTE = { x: -0.9, z: 0.15 } as const;
