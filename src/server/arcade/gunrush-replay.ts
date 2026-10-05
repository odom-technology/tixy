// ──────────────────────────────────────────────────────────────────────────
// GUNRUSH — server-side authoritative TRACK generation + run verifier.
//
// This is a PURE module (no DB, no IO, no Date.now/Math.random). The CLIENT
// imports the very same functions to build its track, resolve its gates and
// score its waves, so client and server agree bit-for-bit by construction.
//
// Game model (single-POST, seed-deterministic, endless squad runner):
//   • You command a SQUAD of gunners that auto-runs down a straight track and
//     auto-fires forward. The only input is steering left/right.
//   • The track is a sequence of ROWS. Row r sits at r * ROW_SPACING units.
//       – every WAVE_EVERY-th row is a HORDE WAVE (an arena fight),
//       – every other row is a GATE ROW: a pair of gates, left and right.
//   • A gate row is resolved by a PICK: lane 0 = took the left gate, lane 2 =
//     took the right gate, lane 1 = threaded the divider and took NEITHER.
//     Threading is always legal, so no row can ever force a wipe — the "safe
//     out" is what makes an aggressive seed fair.
//   • Gates mutate run state: squad count (+N / ×N / −N / ÷N), weapon tier
//     (EVOLVE / DEVOLVE), damage and fire-rate multipliers, and the squad cap.
//   • A wave is resolved deterministically from the squad's DPS: the fight
//     takes waveHp / dps seconds (bounded by WAVE_TIMEOUT_S) and costs
//     ceil(fightSeconds * threat(row)) gunners. Run over when count hits 0.
//   • SCORE accrues per row survived (waves pay far more than gate rows), so it
//     is a clean integer and is a pure function of (seed, picks, endRow).
//
// AUTHORITATIVE score = replay the reported pick stream against the seeded
// track and total the row payouts. The run is accepted only when ALL hold:
//   1. every gate row in 1..endRow has exactly one pick, in ascending row order,
//      with a lane in {0,1,2}, and no pick lands on a wave row,
//   2. the simulation is ALIVE through every row before endRow and DEAD exactly
//      at endRow — a client cannot under-report the damage it took (the sim,
//      not the client, decides when the squad wipes) nor claim rows past its
//      own death,
//   3. timing is physically possible: the squad cannot reach row r sooner than
//      the seeded speed schedule allows (with generous grace for honest client
//      jitter), and every pick lands inside the bounded server session window.
// The score route compares the client-claimed score to this total and rejects
// on mismatch.
//
// Threat model note: the seed is handed to the client (it must render the
// track), so a determined cheat could solve the optimal pick sequence offline.
// That is bounded on purpose — the wave HP curve grows super-linearly while the
// squad cap, tier ceiling and stat clamps cap DPS, so even a perfect line dies
// (see GUNRUSH_SCORE_CAP and the tuning notes on threatForRow). This mirrors
// sky-climber, whose platform layout is likewise derivable client-side.
// ──────────────────────────────────────────────────────────────────────────

// ── Track geometry (the client mirrors these for rendering) ────────────────

/** World units between two consecutive rows. */
export const ROW_SPACING = 74;

/** Track half-width. The squad anchor x is clamped to ±TRACK_HALF_WIDTH. */
export const TRACK_HALF_WIDTH = 5.2;

/** Every Nth row is a horde wave instead of a gate pair. */
export const WAVE_EVERY = 5;

/** Rows at or below this are always plain, gentle gate rows (the warm-up). */
export const WARMUP_ROWS = 2;

// ── Run speed schedule (pure function of row — used for the timing bound) ──

/** Forward speed at row 0, world units per second. */
export const BASE_RUN_SPEED = 19;

/** Speed added per row cleared. */
export const RUN_SPEED_GAIN = 0.26;

/** Hard ceiling on forward speed. */
export const MAX_RUN_SPEED = 40;

/** Forward speed while approaching `row`. Pure + identical client/server. */
export const speedForRow = (row: number): number =>
  Math.min(MAX_RUN_SPEED, BASE_RUN_SPEED + Math.max(0, row) * RUN_SPEED_GAIN);

// ── Squad limits ───────────────────────────────────────────────────────────

/** Gunners the squad starts a run with. */
export const START_COUNT = 6;

/** Squad cap at the start of a run (CAP gates raise it). */
export const START_MAX_COUNT = 40;

/** Absolute squad cap — CAP gates can never push past this. */
export const HARD_MAX_COUNT = 90;

/** Damage / fire-rate multipliers are clamped to this band. */
export const MIN_STAT_MULT = 0.4;
export const MAX_STAT_MULT = 3;

// ── Weapons — 10 tiers, one canonical DPS number per tier ──────────────────
// The client renders each tier with its own model, fire rate and tracer colour;
// `dps` is the single value the sim (and therefore the score) is derived from,
// so cosmetic fire-rate choices can never drift client vs server.

export type GunrushWeapon = {
  tier: number;
  name: string;
  /** Damage per second for ONE gunner at this tier, before stat multipliers. */
  dps: number;
  /** Shots per second — cosmetic (drives muzzle flashes / tracer cadence). */
  fireRate: number;
  /** Projectiles per shot — cosmetic (shotgun spread, dual pistols). */
  bullets: number;
  /** Effective range in world units — cosmetic (targeting distance). */
  range: number;
};

export const GUNRUSH_WEAPONS: readonly GunrushWeapon[] = [
  { tier: 1, name: 'Rusty Pistol', dps: 30, fireRate: 2.4, bullets: 1, range: 26 },
  { tier: 2, name: 'Dual Pistols', dps: 52, fireRate: 3.0, bullets: 2, range: 28 },
  { tier: 3, name: 'SMG', dps: 74, fireRate: 8.0, bullets: 1, range: 30 },
  { tier: 4, name: 'Assault Rifle', dps: 104, fireRate: 6.0, bullets: 1, range: 34 },
  { tier: 5, name: 'Combat Shotgun', dps: 146, fireRate: 2.0, bullets: 6, range: 24 },
  { tier: 6, name: 'Heavy LMG', dps: 200, fireRate: 9.0, bullets: 1, range: 36 },
  { tier: 7, name: 'Minigun', dps: 276, fireRate: 16.0, bullets: 1, range: 38 },
  { tier: 8, name: 'Rocket Pod', dps: 376, fireRate: 1.8, bullets: 1, range: 40 },
  { tier: 9, name: 'Railgun', dps: 502, fireRate: 1.5, bullets: 1, range: 48 },
  { tier: 10, name: 'Plasma Annihilator', dps: 664, fireRate: 7.0, bullets: 1, range: 44 },
];

export const MAX_TIER = GUNRUSH_WEAPONS.length;

/** Weapon definition for a tier, clamped into range. Pure + total. */
export const weaponForTier = (tier: number): GunrushWeapon => {
  const index = Math.min(MAX_TIER, Math.max(1, Math.floor(tier))) - 1;
  return GUNRUSH_WEAPONS[index]!;
};

// ── Wave tuning ────────────────────────────────────────────────────────────
// waveHp grows as a power law TIMES a slow exponential, so it eventually
// outruns the hard DPS ceiling (HARD_MAX_COUNT × tier-10 dps × MAX_STAT_MULT²)
// no matter how perfectly the gates are picked — the run is always finite.

/** A wave fight is cut off here; anything slower is a losing fight. */
export const WAVE_TIMEOUT_S = 14;

/** Total enemy hit points in the wave at `row`. Pure + seedless (the jitter is
 *  seeded separately in waveForRow so the curve stays legible). */
export const waveBaseHpForRow = (row: number): number =>
  150 * Math.pow(Math.max(1, row), 1.55) * Math.pow(1.014, Math.max(0, row));

/** Gunners lost per second of fighting at `row`. The quadratic term is what
 *  eventually ends even a maxed-out squad. */
export const threatForRow = (row: number): number =>
  0.3 + row * 0.055 + row * row * 0.0009;

/** Enemies in the wave at `row` — drives kill counters and arena spawn counts. */
export const waveEnemyCountForRow = (row: number): number =>
  6 + Math.floor(row * 1.1);

/** Enemies in the track pack guarding the gate row at `row` (cosmetic + kills). */
export const packSizeForRow = (row: number): number =>
  3 + Math.floor(row * 0.32);

/** Hard ceiling on an accepted score (defense in depth alongside the route cap). */
export const GUNRUSH_SCORE_CAP = 400_000;

/** A run can never legitimately reach this row — bounds the payload and the
 *  replay loop. Perfect play dies far short of it (see the module header). */
export const GUNRUSH_MAX_ROWS = 400;

// ── Seeded RNG — identical mulberry32 to the client + the other replays ─────

const createSeededRng = (seed: number) => {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/**
 * Derive a stable per-row RNG from (seed, row). Mixing the row into the seed
 * keeps row lookups O(1) and pure: no need to walk from row 0 to reach row N,
 * and no cross-row state that could drift between client and server. Mirrors
 * the swerve / sky-climber rngForRow trick.
 */
const rngForRow = (seed: number, row: number): (() => number) => {
  let mixed = (seed ^ Math.imul(row + 1, 0x9e3779b1)) | 0;
  mixed = (mixed + 0x6d2b79f5) | 0;
  return createSeededRng(mixed >>> 0);
};

// ── Rows: gate rows vs wave rows ───────────────────────────────────────────

/** True when `row` is a horde wave instead of a gate pair. */
export const isWaveRow = (row: number): boolean =>
  row > 0 && row % WAVE_EVERY === 0;

/** True when `row` is a gate pair the player must resolve with a pick. */
export const isGateRow = (row: number): boolean => row > 0 && !isWaveRow(row);

// ── Gates ──────────────────────────────────────────────────────────────────

export type GunrushGateKind =
  | 'add' // +N gunners
  | 'mul' // ×N gunners
  | 'sub' // −N gunners
  | 'div' // ÷N gunners (floored, never below 1)
  | 'evolve' // +N weapon tiers
  | 'devolve' // −1 weapon tier
  | 'damage' // ×N damage multiplier
  | 'rate' // ×N fire-rate multiplier
  | 'cap'; // +N squad cap

export type GunrushGate = {
  kind: GunrushGateKind;
  /** Magnitude. Additive for add/sub/evolve/devolve/cap, factor for mul/div/stat. */
  value: number;
  /** Label the client prints on the panel (e.g. "+7", "×3", "EVOLVE"). */
  label: string;
  /** True when taking this gate is a net positive — drives the blue/red paint. */
  good: boolean;
};

/** How fast gate magnitudes grow with depth. */
const magnitudeScale = (row: number): number => 1 + row * 0.09;

const addGate = (row: number, roll: number): GunrushGate => {
  const value = Math.max(
    2,
    Math.min(34, Math.round((2 + roll * 3) * magnitudeScale(row))),
  );
  return { kind: 'add', value, label: `+${value}`, good: true };
};

const subGate = (row: number, roll: number): GunrushGate => {
  const value = Math.max(
    2,
    Math.min(30, Math.round((2 + roll * 3) * magnitudeScale(row) * 0.85)),
  );
  return { kind: 'sub', value, label: `−${value}`, good: false };
};

const mulGate = (row: number, roll: number): GunrushGate => {
  // ×3 only shows up once the run has depth, so it always feels like a jackpot.
  const value = row >= 6 && roll < 0.35 ? 3 : 2;
  return { kind: 'mul', value, label: `×${value}`, good: true };
};

const divGate = (): GunrushGate => ({
  kind: 'div',
  value: 2,
  label: '÷2',
  good: false,
});

const evolveGate = (row: number, roll: number): GunrushGate => {
  // A double evolve is a rare deep-run treat.
  const value = row >= 18 && roll < 0.12 ? 2 : 1;
  return {
    kind: 'evolve',
    value,
    label: value === 2 ? 'EVOLVE ×2' : 'EVOLVE',
    good: true,
  };
};

const devolveGate = (): GunrushGate => ({
  kind: 'devolve',
  value: 1,
  label: 'DEVOLVE',
  good: false,
});

const damageGate = (roll: number): GunrushGate => {
  const value = 1.2 + Math.round(roll * 3) * 0.05; // 1.20 … 1.35
  return {
    kind: 'damage',
    value,
    label: `+${Math.round((value - 1) * 100)}% DMG`,
    good: true,
  };
};

const rateGate = (roll: number): GunrushGate => {
  const value = 1.12 + Math.round(roll * 3) * 0.04; // 1.12 … 1.24
  return {
    kind: 'rate',
    value,
    label: `+${Math.round((value - 1) * 100)}% RATE`,
    good: true,
  };
};

const capGate = (): GunrushGate => ({
  kind: 'cap',
  value: 6,
  label: 'CAP +6',
  good: true,
});

/** The two gates standing at `row`, left first. Pure, O(1), seed-only — it never
 *  reads run state, so the client can build the track far ahead of the squad and
 *  still match the server exactly. */
export const gatesForRow = (
  seed: number,
  row: number,
): readonly [GunrushGate, GunrushGate] => {
  const rng = rngForRow(seed, row);

  // Warm-up rows are always a plain "take the bigger one" choice so a fresh run
  // never opens on a trap.
  if (row <= WARMUP_ROWS) {
    const left = addGate(row, rng());
    const right = addGate(row, rng());
    return [left, right] as const;
  }

  // Every third row guarantees a weapon gate on one side, so the arsenal keeps
  // moving even on an unlucky seed.
  if (row % 3 === 0) {
    const evolve = evolveGate(row, rng());
    const otherRoll = rng();
    const other: GunrushGate =
      otherRoll < 0.45
        ? mulGate(row, rng())
        : otherRoll < 0.8
          ? addGate(row, rng())
          : devolveGate();
    return rng() < 0.5
      ? ([evolve, other] as const)
      : ([other, evolve] as const);
  }

  const archetype = rng();

  // 40% — the classic: one clear win, one clear loss.
  if (archetype < 0.4) {
    const good = rng() < 0.28 ? mulGate(row, rng()) : addGate(row, rng());
    const bad = rng() < 0.3 ? divGate() : subGate(row, rng());
    return rng() < 0.5 ? ([good, bad] as const) : ([bad, good] as const);
  }

  // 28% — tradeoff: two upsides in different currencies.
  if (archetype < 0.68) {
    const roll = rng();
    const a: GunrushGate =
      roll < 0.34 ? damageGate(rng()) : roll < 0.68 ? rateGate(rng()) : capGate();
    const b = rng() < 0.5 ? mulGate(row, rng()) : addGate(row, rng());
    return rng() < 0.5 ? ([a, b] as const) : ([b, a] as const);
  }

  // 15% — small sure thing vs a big one (the big one is the guarded lane; the
  // client parks the heavy obstacle in front of it).
  if (archetype < 0.83) {
    const small = addGate(row, rng() * 0.3);
    const big = addGate(row, 0.7 + rng() * 0.3);
    return rng() < 0.5 ? ([small, big] as const) : ([big, small] as const);
  }

  // 10% — lesser evil: both hurt, threading is a real option.
  if (archetype < 0.93) {
    const a = subGate(row, rng() * 0.4);
    const b = rng() < 0.5 ? divGate() : devolveGate();
    return rng() < 0.5 ? ([a, b] as const) : ([b, a] as const);
  }

  // 7% — jackpot risk.
  const jackpot = mulGate(row, rng() * 0.3);
  const bust = divGate();
  return rng() < 0.5 ? ([jackpot, bust] as const) : ([bust, jackpot] as const);
};

// ── Waves ──────────────────────────────────────────────────────────────────

export type GunrushWave = {
  row: number;
  /** Enemies in the wave (kills + arena spawn count). */
  enemies: number;
  /** Total hit points the squad must chew through to clear it. */
  hp: number;
  /** Gunners lost per second of fighting. */
  threat: number;
};

/** The horde wave standing at `row`. Pure + O(1). */
export const waveForRow = (seed: number, row: number): GunrushWave => {
  const rng = rngForRow(seed, row + 977);
  const jitter = 0.9 + rng() * 0.2;
  return {
    row,
    enemies: waveEnemyCountForRow(row),
    hp: waveBaseHpForRow(row) * jitter,
    threat: threatForRow(row),
  };
};

// ── Run state ──────────────────────────────────────────────────────────────

export type GunrushRunState = {
  count: number;
  maxCount: number;
  tier: number;
  damageMult: number;
  rateMult: number;
  score: number;
  kills: number;
};

/** A fresh run. Pure — callers must not mutate the returned object in place if
 *  they want to keep it (the sim helpers below all return new state). */
export const initialRunState = (): GunrushRunState => ({
  count: START_COUNT,
  maxCount: START_MAX_COUNT,
  tier: 1,
  damageMult: 1,
  rateMult: 1,
  score: 0,
  kills: 0,
});

const clamp = (value: number, min: number, max: number): number =>
  value < min ? min : value > max ? max : value;

/** Total squad damage per second for `state`. The one number waves resolve on. */
export const squadDps = (state: GunrushRunState): number =>
  Math.max(0, state.count) *
  weaponForTier(state.tier).dps *
  state.damageMult *
  state.rateMult;

/** Apply a gate to run state, returning NEW state. Count can legitimately land
 *  at 0 here — that is a gate wipe, and the caller ends the run. */
export const applyGate = (
  state: GunrushRunState,
  gate: GunrushGate,
): GunrushRunState => {
  const next: GunrushRunState = { ...state };
  switch (gate.kind) {
    case 'add':
      next.count = Math.min(next.maxCount, next.count + gate.value);
      break;
    case 'sub':
      next.count = Math.max(0, next.count - gate.value);
      break;
    case 'mul':
      next.count = Math.min(next.maxCount, Math.floor(next.count * gate.value));
      break;
    case 'div':
      // Division never wipes — it always leaves a last gunner standing.
      next.count = Math.max(1, Math.floor(next.count / gate.value));
      break;
    case 'evolve':
      next.tier = Math.min(MAX_TIER, next.tier + gate.value);
      break;
    case 'devolve':
      next.tier = Math.max(1, next.tier - gate.value);
      break;
    case 'damage':
      next.damageMult = clamp(
        next.damageMult * gate.value,
        MIN_STAT_MULT,
        MAX_STAT_MULT,
      );
      break;
    case 'rate':
      next.rateMult = clamp(
        next.rateMult * gate.value,
        MIN_STAT_MULT,
        MAX_STAT_MULT,
      );
      break;
    case 'cap':
      next.maxCount = Math.min(HARD_MAX_COUNT, next.maxCount + gate.value);
      break;
  }
  return next;
};

export type GunrushWaveOutcome = {
  /** Seconds the fight took (bounded by WAVE_TIMEOUT_S). */
  fightSeconds: number;
  /** Gunners lost holding the ring. */
  losses: number;
  /** False when the horde could not be cleared inside the timeout. */
  cleared: boolean;
};

/** Resolve a wave against the squad's DPS. Pure — the client animates the
 *  arena for exactly `fightSeconds` and kills exactly `losses` gunners, so what
 *  the player watches is what the server scores. */
export const resolveWave = (
  state: GunrushRunState,
  wave: GunrushWave,
): GunrushWaveOutcome => {
  const dps = squadDps(state);
  const rawSeconds = dps > 0 ? wave.hp / dps : Number.POSITIVE_INFINITY;
  const fightSeconds = Math.min(WAVE_TIMEOUT_S, rawSeconds);
  const losses = Math.max(1, Math.ceil(fightSeconds * wave.threat));
  return {
    fightSeconds,
    losses,
    cleared: rawSeconds <= WAVE_TIMEOUT_S && state.count - losses > 0,
  };
};

// ── Scoring ────────────────────────────────────────────────────────────────

/** Points banked for surviving the gate row at `row`. */
export const gateRowScore = (row: number): number => 10 + row * 4;

/**
 * Points banked for clearing the wave at `row`. Waves are where the build pays
 * off: the payout scales with the squad still standing and the tier it is
 * holding, so growing the horde and evolving the arsenal both show up in the
 * score rather than only in survival time.
 */
export const waveRowScore = (
  row: number,
  enemies: number,
  count: number,
  tier: number,
): number => 40 + row * 18 + enemies * 6 + Math.max(0, count) * 3 + tier * 20;

// ── Recorded event + result shapes ─────────────────────────────────────────

/** One recorded gate decision: at gate row `row` the squad went through
 *  `lane` (0 = left gate, 1 = threaded the divider, 2 = right gate) at `t` ms
 *  since the run began. */
export type GunrushPick = {
  row: number;
  lane: number;
  t: number;
};

export type GunrushReplayResult = {
  /** Authoritative score = total row payouts through the validated run. */
  score: number;
  /** Rows survived (the run ended AT endRow, which pays nothing). */
  rows: number;
  /** Enemies killed — returned for logging / stats, never persisted as score. */
  kills: number;
  /** Highest weapon tier reached, for the reject log's forensics. */
  tier: number;
  /** How many picks were validated. */
  counted: number;
  /** True if the log was rejected as implausible (score is then 0). */
  rejected: boolean;
  /** Human-readable reason when rejected (embedded in the route reject log). */
  reason: string | null;
};

const isNonNegFinite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

const isRowIndex = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1;

const isLane = (value: unknown): value is number =>
  value === 0 || value === 1 || value === 2;

/**
 * Earliest wall-clock time (ms since run start) at which the squad could
 * legitimately be standing at `row`, given the seeded speed schedule plus the
 * minimum time each wave fight must take. Scaled by TIMING_GRACE so honest
 * client jitter, frame hitches and a slow first paint never false-reject.
 */
const TIMING_GRACE = 0.55;

/** Fastest a wave can possibly be resolved client-side (the arena still has to
 *  play its intro/outro), in seconds. */
const MIN_WAVE_SECONDS = 0.9;

const earliestArrivalMs = (row: number): number => {
  let seconds = 0;
  for (let r = 1; r <= row; r += 1) {
    seconds += ROW_SPACING / speedForRow(r - 1);
    if (isWaveRow(r) && r < row) seconds += MIN_WAVE_SECONDS;
  }
  return seconds * 1000 * TIMING_GRACE;
};

/**
 * Verify a recorded Gunrush run and return the authoritative score.
 *
 * The picks must cover every gate row from 1 to `endRow` exactly once, in
 * ascending order, and the simulation they drive must be alive through every
 * earlier row and dead exactly at `endRow`. Pure + never throws on bad input:
 * any structural, physical or timing violation rejects the whole run (a cheat
 * signal, mirroring swerve and sky-climber).
 *
 * @param picks      recorded gate decisions ({ row, lane, t })
 * @param endRow     the row the run ended on (the squad wiped here)
 * @param durationMs the bounded server session/replay duration in ms
 * @param seed       the server `gunrushSeed` for this session
 */
export const replayGunrushSession = (
  picks: GunrushPick[],
  endRow: number,
  durationMs: number,
  seed: number,
): GunrushReplayResult => {
  const reject = (reason: string): GunrushReplayResult => ({
    score: 0,
    rows: 0,
    kills: 0,
    tier: 1,
    counted: 0,
    rejected: true,
    reason,
  });

  if (!Array.isArray(picks)) return reject('Picks payload missing');

  if (!Number.isInteger(endRow) || endRow < 1) {
    // A run that never cleared row 1 scores nothing — not a cheat, just a
    // wipe on the opening gate. Accept it as a legitimate zero.
    return { score: 0, rows: 0, kills: 0, tier: 1, counted: 0, rejected: false, reason: null };
  }

  if (endRow > GUNRUSH_MAX_ROWS) {
    return reject(`End row beyond the reachable track (${endRow})`);
  }

  if (picks.length > GUNRUSH_MAX_ROWS) {
    return reject(`Pick payload too large (${picks.length})`);
  }

  // Index the picks by row. Duplicates and malformed entries are hard rejects:
  // unlike a landing stream there is exactly one decision per gate row, so any
  // deviation is a tampered log rather than jitter.
  const byRow = new Map<number, GunrushPick>();
  for (const pick of picks) {
    if (pick == null || !isRowIndex(pick.row) || !isLane(pick.lane) || !isNonNegFinite(pick.t)) {
      return reject('Malformed pick entry');
    }
    if (pick.row > endRow) {
      return reject(`Pick at row ${pick.row} past the run's end row (${endRow})`);
    }
    if (!isGateRow(pick.row)) {
      return reject(`Pick recorded on wave row ${pick.row}`);
    }
    if (byRow.has(pick.row)) {
      return reject(`Duplicate pick for row ${pick.row}`);
    }
    byRow.set(pick.row, pick);
  }

  // The bounded upper edge for any pick timestamp: the server-measured elapsed
  // plus a little grace for the final row / network skew. The client clock is
  // only sanity-checked; the server session duration is the real elapsed.
  const serverWindowMs =
    Number.isFinite(durationMs) && durationMs > 0
      ? durationMs + 1_500
      : Number.POSITIVE_INFINITY;

  let state = initialRunState();
  let counted = 0;
  let previousT = -Infinity;
  let died = false;

  for (let row = 1; row <= endRow; row += 1) {
    if (isWaveRow(row)) {
      const wave = waveForRow(seed, row);
      const outcome = resolveWave(state, wave);
      state = { ...state, count: Math.max(0, state.count - outcome.losses) };
      if (!outcome.cleared || state.count <= 0) {
        state.count = 0;
        died = true;
        if (row !== endRow) {
          return reject(
            `Squad wiped at wave row ${row} but the run claims to end at ${endRow}`,
          );
        }
        break;
      }
      state.kills += wave.enemies;
      state.score += waveRowScore(row, wave.enemies, state.count, state.tier);
      continue;
    }

    const pick = byRow.get(row);
    if (!pick) return reject(`Missing pick for gate row ${row}`);

    // Timing: ascending, physically reachable, inside the session window.
    if (pick.t < previousT) {
      return reject(`Pick for row ${row} arrives before row ${row - 1}`);
    }
    const earliest = earliestArrivalMs(row);
    if (pick.t + 250 < earliest) {
      return reject(
        `Row ${row} reached too fast (t=${Math.round(pick.t)}ms < ${Math.round(earliest)}ms)`,
      );
    }
    if (pick.t > serverWindowMs) {
      return reject(
        `Row ${row} pick outside session window ` +
          `(t=${Math.round(pick.t)}ms > ${Math.round(serverWindowMs)}ms)`,
      );
    }
    previousT = pick.t;
    counted += 1;

    if (pick.lane !== 1) {
      const gates = gatesForRow(seed, row);
      state = applyGate(state, gates[pick.lane === 0 ? 0 : 1]);
    }

    if (state.count <= 0) {
      state.count = 0;
      died = true;
      if (row !== endRow) {
        return reject(
          `Squad wiped at gate row ${row} but the run claims to end at ${endRow}`,
        );
      }
      break;
    }

    state.kills += packSizeForRow(row);
    state.score += gateRowScore(row);

    if (state.score >= GUNRUSH_SCORE_CAP) {
      state.score = GUNRUSH_SCORE_CAP;
      break;
    }
  }

  if (!died && state.score < GUNRUSH_SCORE_CAP) {
    return reject(
      `Run claims to end at row ${endRow} with ${state.count} gunners still standing`,
    );
  }

  return {
    score: Math.min(GUNRUSH_SCORE_CAP, Math.floor(state.score)),
    rows: Math.max(0, endRow - 1),
    kills: state.kills,
    tier: state.tier,
    counted,
    rejected: false,
    reason: null,
  };
};

/** Alias kept to match the `validate*Run` naming used by the other replays. */
export const validateGunrushRun = replayGunrushSession;
