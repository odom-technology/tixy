/**
 * Tin Duck Gallery — pure, deterministic 3D popup-range schedule + shot scorer +
 * run validator.
 *
 * This module is the single source of truth for BOTH the client (which renders
 * the range in three.js so the player can shoot it) and the server score route
 * (which re-derives the exact same schedule to validate the submitted shots).
 * Same `seed` ⇒ identical target pops on both sides, so the client can never
 * invent easier targets or move one under the crosshair.
 *
 * Mechanic: a western-carnival POPUP shooting range in 3D. Five terraced berms
 * recede into the booth; tin duck targets pop up from behind them at seeded
 * times/slots and drop back down after a seeded window. Deeper tiers are
 * smaller on screen and pay more; short pop windows pay a bonus. GLOWING
 * bonus stars pop briefly anywhere on the range and pay the most. The last
 * TIN_DUCK_FRENZY_SEC seconds are a
 * "frenzy finale": pops come thick and fast and ammo is unlimited — all still
 * fully deterministic.
 *
 * THE 3D MODEL IS PURE MATH. Shots stay normalized 2-D `{x, y, t}` events in
 * the same canonical play-space as before: the shared `tinDuckProject`
 * pinhole projection (fixed camera; hardcoded literal sin/cos/f constants —
 * NO runtime trig, so client and server agree bit-for-bit) maps every
 * target's 3-D position to a screen-space circle, and hit tests compare
 * SQUARED distances against the projected radius, nearest tier first. The
 * client's three.js camera is configured to the same constants so what the
 * player sees under the 2-D crosshair is exactly what the server scores.
 *
 * SCORING (implemented once in createTinDuckScorer, used verbatim by the client
 * for live feedback and by validateTinDuckRun for the authoritative recompute):
 *   - Each shot resolves the NEAREST active target whose projected circle
 *     contains (x, y) at time t — glow stars win ties at the same depth.
 *     Popup targets are one-shot per pop event. A miss costs a shot,
 *     nothing else.
 *   - Ammo rhythm (unchanged from the audited v1): magazine of
 *     TIN_DUCK_MAG_SIZE; emptying it starts a TIN_DUCK_RELOAD_MS reload during
 *     which trigger-pulls are DEAD events on both sides; a cadence floor
 *     (TIN_DUCK_MIN_SHOT_INTERVAL_MS) caps the fire rate; the frenzy lifts the
 *     magazine gate but keeps the cadence floor.
 *
 * Anti-cheat model (single-POST, mirrors Gopher / Knife Booth): the
 * authoritative score is recomputed by replaying the submitted shot log through
 * the SAME scorer the client ran; the round is bounded by the SERVER clock.
 *
 * Everything here is pure: no Date.now(), no Math.random(), no runtime trig.
 */

// ---------------------------------------------------------------------------
// Tunable constants (exported so the route + client agree on the same bounds)
// ---------------------------------------------------------------------------

/** Canonical play-space. Shots + projected target math live in this
 *  resolution-independent space; the client maps the pointer into it. */
export const TIN_DUCK_PLAY_W = 1000;
export const TIN_DUCK_PLAY_H = 640;

/** Fixed round length in seconds / ms. */
export const TIN_DUCK_ROUND_SEC = 75;
export const TIN_DUCK_ROUND_MS = TIN_DUCK_ROUND_SEC * 1000;

/** Frenzy finale: the last N seconds. Dense pops + unlimited ammo. */
export const TIN_DUCK_FRENZY_SEC = 10;
export const TIN_DUCK_FRENZY_START_MS =
  (TIN_DUCK_ROUND_SEC - TIN_DUCK_FRENZY_SEC) * 1000;

/** Hard upper bound for accepting a shot's client timestamp `t` (ms). */
export const TIN_DUCK_MAX_SHOT_T_MS = TIN_DUCK_ROUND_MS + 3_000;

/** Ammo rhythm (unchanged from the audited v1 — do not retune casually). */
export const TIN_DUCK_MAG_SIZE = 6;
export const TIN_DUCK_RELOAD_MS = 1_200;
export const TIN_DUCK_MIN_SHOT_INTERVAL_MS = 120;

/** Point value of a glowing bonus star (the top prize). */
export const TIN_DUCK_GOLDEN_VALUE = 12;

/** Absolute ceiling on how many shots we will ever inspect for one run. */
export const TIN_DUCK_MAX_SHOTS = 1_000;

/** Generous ceiling on a single run's score (coarse plausibility bound; the
 *  measured optimal bot sits far below — see the route + game-session bound). */
export const TIN_DUCK_MAX_RUN_SCORE = 12_000;

// ---------------------------------------------------------------------------
// Shared pinhole projection — the ONE camera both sides use.
//
// Camera at (0, CAM_H, 0), looking down −z, pitched DOWN by ~11.5°. All
// constants are hardcoded literals (no runtime trig ⇒ bit-identical across
// engines). The client's three.js PerspectiveCamera mirrors these exactly:
//   fov = TIN_DUCK_CAM_FOV_DEG, aspect = PLAY_W / PLAY_H,
//   position.y = TIN_DUCK_CAM_H, rotation.x = −TIN_DUCK_CAM_PITCH_RAD.
// ---------------------------------------------------------------------------

export const TIN_DUCK_CAM_H = 3.1;
export const TIN_DUCK_CAM_FOV_DEG = 55;
export const TIN_DUCK_CAM_PITCH_RAD = 0.2007; // ≈11.5°, for the client camera
const PITCH_SIN = 0.19937; // sin(11.5°) — literal, no runtime trig
const PITCH_COS = 0.97992; // cos(11.5°)
const PROJ_F = 1.921; // 1 / tan(55° / 2) — vertical focal factor
const PROJ_FX = PROJ_F / (TIN_DUCK_PLAY_W / TIN_DUCK_PLAY_H); // horizontal

export interface TinProjected {
  /** Canonical screen-space centre. */
  sx: number;
  sy: number;
  /** Projected radius in canonical pixels for a world radius `r`. */
  sr: number;
  /** View-space depth (bigger = further). <= 0 means behind the camera. */
  depth: number;
}

/** Project a world-space sphere (centre x/y/z, radius r) to canonical screen
 *  space. Pure +,−,×,÷ only. z is negative in front of the camera. */
export function tinDuckProject(
  x: number,
  y: number,
  z: number,
  r: number,
): TinProjected {
  const dy = y - TIN_DUCK_CAM_H;
  const yv = dy * PITCH_COS - z * PITCH_SIN;
  const depth = -(dy * PITCH_SIN + z * PITCH_COS);
  if (depth <= 0.01) return { sx: -9999, sy: -9999, sr: 0, depth };
  const ndcX = (x / depth) * PROJ_FX;
  const ndcY = (yv / depth) * PROJ_F;
  return {
    sx: (ndcX + 1) * (TIN_DUCK_PLAY_W / 2),
    sy: (1 - ndcY) * (TIN_DUCK_PLAY_H / 2),
    sr: ((r * PROJ_F) / depth) * (TIN_DUCK_PLAY_H / 2),
    depth,
  };
}

// ---------------------------------------------------------------------------
// Range geometry — five popup tiers. World units.
//
// The deepest tier REPLACED the original sliding back-rail conveyor: constant
// motion made "park the crosshair and wait for a duck to slide through" the
// dominant strategy, undercutting the popup design. Every row now pops.
// ---------------------------------------------------------------------------

export interface TinTierSpec {
  /** Berm plane depth (negative z, camera looks down −z). */
  z: number;
  /** Number of popup slots across the tier. */
  slots: number;
  /** Base point value of a standard pop on this tier. */
  value: number;
  /** Usable half-width for slot placement at this depth. */
  spread: number;
}

/** Near → far. Deeper tiers project smaller and pay more. */
export const TIN_DUCK_TIERS: readonly TinTierSpec[] = [
  { z: -4.6, slots: 5, value: 1, spread: 2.85 },
  { z: -7.2, slots: 6, value: 2, spread: 4.45 },
  { z: -10.4, slots: 7, value: 3, spread: 6.4 },
  { z: -14.2, slots: 8, value: 5, spread: 8.8 },
  { z: -17.5, slots: 9, value: 6, spread: 10.8 },
];

/** World radius of a standard popup target / a glow star. */
export const TIN_DUCK_TARGET_R = 0.5;
export const TIN_DUCK_GLOW_R = 0.55;

/** World y of target centres (they sit just above the berm lip). */
export const TIN_DUCK_TARGET_Y = 0.62;
export const TIN_DUCK_GLOW_Y = 0.7;

/** A short pop window pays +1 (it's harder to catch). */
const FAST_POP_MS = 950;

// ── Pop scheduling (per tier) ──
const POP_FIRST_MIN_MS = 500;
const POP_FIRST_TIER_STEP_MS = 300;
const POP_UP_MIN_MS = 800;
const POP_UP_MAX_MS = 1_500;
const POP_GAP_MIN_MS = 550;
const POP_GAP_MAX_MS = 1_300;
const POP_FRENZY_UP_MS = 700;
const POP_FRENZY_GAP_MIN_MS = 200;
const POP_FRENZY_GAP_MAX_MS = 500;
const POP_MAX_PER_TIER = 220;

// ── Glow star scheduling ──
const GLOW_FIRST_MS = 3_200;
const GLOW_GAP_MIN_MS = 2_600;
const GLOW_GAP_MAX_MS = 4_200;
const GLOW_UP_MIN_MS = 700;
const GLOW_UP_MAX_MS = 1_000;
const GLOW_FRENZY_GAP_MIN_MS = 900;
const GLOW_FRENZY_GAP_MAX_MS = 1_500;
const GLOW_FRENZY_UP_MS = 650;
const GLOW_MAX = 64;

// ---------------------------------------------------------------------------
// PRNG — mulberry32. Byte-identical to the repo's seededRandom.
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable per-stream RNG from (seed, lane, salt). */
function rngFor(seed: number, lane: number, salt: number): () => number {
  let mixed =
    (seed ^ Math.imul(lane + 1, 0x9e3779b1) ^ Math.imul(salt + 1, 0x85ebca77)) | 0;
  mixed = (mixed + 0x6d2b79f5) | 0;
  return mulberry32(mixed);
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

// ---------------------------------------------------------------------------
// Schedule generation
// ---------------------------------------------------------------------------

/** One popup event: a target that rises at a slot for a seeded window. */
export interface TinPopTarget {
  /** Unique id across the whole schedule (index into the pops array). */
  id: number;
  kind: 'standard' | 'glow';
  /** Tier index 0..3 (glow stars also live on a tier for depth/occlusion). */
  tier: number;
  /** World-space centre. */
  x: number;
  y: number;
  z: number;
  r: number;
  upStart: number;
  upEnd: number;
  /** Points for shooting it (tier value, +1 fast-pop bonus; glow = 12). */
  value: number;
  /** True if the up-window is short (paid the +1 bonus). */
  fast: boolean;
}

export interface TinDuckSchedule {
  /** All popup events (standard + glow), sorted nearest-tier-first then
   *  glow-first — the exact hit-resolution order. */
  pops: TinPopTarget[];
}

function buildTierPops(seed: number, tier: number, startId: number): TinPopTarget[] {
  const spec = TIN_DUCK_TIERS[tier]!;
  const rng = rngFor(seed, tier, 11);
  const pops: TinPopTarget[] = [];
  let cursor = POP_FIRST_MIN_MS + tier * POP_FIRST_TIER_STEP_MS + rng() * 400;
  let lastSlot = -1;
  let id = startId;

  while (cursor < TIN_DUCK_ROUND_MS && pops.length < POP_MAX_PER_TIER) {
    const frenzy = cursor >= TIN_DUCK_FRENZY_START_MS;
    // Draw order per pop is FIXED (slot, up, gap) so the sides never diverge.
    let slot = Math.floor(rng() * spec.slots);
    if (slot >= spec.slots) slot = spec.slots - 1;
    if (slot === lastSlot) slot = (slot + 1) % spec.slots; // no double-dip slot
    lastSlot = slot;
    const upMs = frenzy ? POP_FRENZY_UP_MS : lerp(POP_UP_MIN_MS, POP_UP_MAX_MS, rng());
    const fast = upMs < FAST_POP_MS;
    const frac = spec.slots > 1 ? slot / (spec.slots - 1) : 0.5;
    const x = lerp(-spec.spread, spec.spread, frac);
    const upStart = Math.round(cursor);
    const upEnd = Math.min(TIN_DUCK_MAX_SHOT_T_MS, Math.round(cursor + upMs));
    pops.push({
      id,
      kind: 'standard',
      tier,
      x,
      y: TIN_DUCK_TARGET_Y,
      z: spec.z,
      r: TIN_DUCK_TARGET_R,
      upStart,
      upEnd,
      value: spec.value + (fast ? 1 : 0),
      fast,
    });
    id += 1;
    const gap = frenzy
      ? lerp(POP_FRENZY_GAP_MIN_MS, POP_FRENZY_GAP_MAX_MS, rng())
      : lerp(POP_GAP_MIN_MS, POP_GAP_MAX_MS, rng());
    cursor += upMs + gap;
  }
  return pops;
}

function buildGlows(seed: number, startId: number): TinPopTarget[] {
  const rng = rngFor(seed, 777, 5);
  const pops: TinPopTarget[] = [];
  let cursor = GLOW_FIRST_MS;
  let id = startId;

  while (cursor < TIN_DUCK_ROUND_MS && pops.length < GLOW_MAX) {
    const frenzy = cursor >= TIN_DUCK_FRENZY_START_MS;
    // Draw order per glow is FIXED: tier roll, x, up, gap.
    const roll = rng();
    // Weighted toward the deeper tiers (harder to hit = fair for 12 points).
    const tier = roll < 0.12 ? 0 : roll < 0.28 ? 1 : roll < 0.5 ? 2 : roll < 0.75 ? 3 : 4;
    const spec = TIN_DUCK_TIERS[tier]!;
    const x = lerp(-spec.spread * 0.9, spec.spread * 0.9, rng());
    const upMs = frenzy ? GLOW_FRENZY_UP_MS : lerp(GLOW_UP_MIN_MS, GLOW_UP_MAX_MS, rng());
    const upStart = Math.round(cursor);
    const upEnd = Math.min(TIN_DUCK_MAX_SHOT_T_MS, Math.round(cursor + upMs));
    pops.push({
      id,
      kind: 'glow',
      tier,
      x,
      y: TIN_DUCK_GLOW_Y,
      z: spec.z,
      r: TIN_DUCK_GLOW_R,
      upStart,
      upEnd,
      value: TIN_DUCK_GOLDEN_VALUE,
      fast: true,
    });
    id += 1;
    const gap = frenzy
      ? lerp(GLOW_FRENZY_GAP_MIN_MS, GLOW_FRENZY_GAP_MAX_MS, rng())
      : lerp(GLOW_GAP_MIN_MS, GLOW_GAP_MAX_MS, rng());
    cursor += gap;
  }
  return pops;
}

/**
 * Pure, deterministic schedule for a seed — identical on client and server.
 * Pops are pre-sorted into hit-resolution order: nearest tier first (tier 0 has
 * the LEAST negative z), glow before standard within a tier.
 */
export function deriveTinDuckSchedule(seed: number): TinDuckSchedule {
  const safeSeed = seed | 0;
  let pops: TinPopTarget[] = [];
  for (let tier = 0; tier < TIN_DUCK_TIERS.length; tier += 1) {
    pops = pops.concat(buildTierPops(safeSeed, tier, pops.length));
  }
  pops = pops.concat(buildGlows(safeSeed, pops.length));
  pops.sort((a, b) =>
    a.tier !== b.tier
      ? a.tier - b.tier
      : a.kind !== b.kind
        ? a.kind === 'glow'
          ? -1
          : 1
        : a.id - b.id,
  );
  return { pops };
}

/** Popup rise/sink easing — SHARED by the render and the scorer so the circle
 *  the server scores is exactly the circle the player sees at every ms of the
 *  window (codex-review fix: previously the scorer tested the fully-risen
 *  centre for the whole window while the mesh was still rising). Pure math. */
export const TIN_DUCK_POP_RISE_MS = 160;
export const TIN_DUCK_POP_SINK_MS = 140;
/** How far a target hides behind its berm at frac 0 (in target radii). */
export const TIN_DUCK_POP_HIDE_FACTOR = 1.35;

export function tinPopRiseFrac(pop: TinPopTarget, t: number): number {
  const rise = clamp01((t - pop.upStart) / TIN_DUCK_POP_RISE_MS);
  const sink = clamp01((pop.upEnd - t) / TIN_DUCK_POP_SINK_MS);
  return rise < sink ? rise : sink;
}

/** World-space centre y of a pop at time t (rises from behind the berm). */
export function tinPopCenterY(pop: TinPopTarget, t: number): number {
  return pop.y - (1 - tinPopRiseFrac(pop, t)) * TIN_DUCK_POP_HIDE_FACTOR * pop.r;
}

// ---------------------------------------------------------------------------
// Shared shot state machine — the ONE sim both the client and validator run.
// ---------------------------------------------------------------------------

export type TinShotOutcome =
  | { type: 'reload-dead' }
  | { type: 'ignored' }
  | { type: 'miss'; ammo: number; reloading: boolean }
  | {
      type: 'hit';
      /** 'golden' = a glow star; 'duck' = a standard popup target. */
      kind: 'golden' | 'duck';
      value: number;
      /** Pop event id. */
      targetIndex: number;
      /** Tier 0..4 (deepest tier pays most). */
      tier: number;
      /** Projected canonical screen centre of the target (render juice). */
      x: number;
      y: number;
      /** World-space centre (3-D render juice: knockdown physics origin). */
      wx: number;
      wy: number;
      wz: number;
      ammo: number;
      reloading: boolean;
    };

export interface TinDuckScorer {
  shoot(x: number, y: number, t: number): TinShotOutcome;
  /** Whether a pop event has been claimed (render helper). */
  isPopUsed(id: number): boolean;
  displayAmmo(t: number): number;
  reloadFraction(t: number): number;
  isFrenzy(t: number): boolean;
  readonly score: number;
  readonly shotsFired: number;
  readonly hits: number;
}

export function createTinDuckScorer(schedule: TinDuckSchedule): TinDuckScorer {
  const { pops } = schedule;

  let score = 0;
  let shotsFired = 0;
  let hits = 0;
  let ammo = TIN_DUCK_MAG_SIZE;
  let reloadUntil = -1;
  let lastLiveShotT = -Infinity;
  const popUsed = new Set<number>();

  const isFrenzy = (t: number) => t >= TIN_DUCK_FRENZY_START_MS;

  const resolve = (
    x: number,
    y: number,
    t: number,
  ):
    | {
        kind: 'golden' | 'duck';
        value: number;
        targetIndex: number;
        tier: number;
        sx: number;
        sy: number;
        wx: number;
        wy: number;
        wz: number;
      }
    | null => {
    // Pops in precomputed nearest-first / glow-first order. The centre tracks
    // the rise/sink easing so the scored circle IS the rendered circle.
    for (const p of pops) {
      if (t < p.upStart || t > p.upEnd) continue;
      if (popUsed.has(p.id)) continue;
      const proj = tinDuckProject(p.x, tinPopCenterY(p, t), p.z, p.r);
      const dx = x - proj.sx;
      const dy = y - proj.sy;
      if (dx * dx + dy * dy <= proj.sr * proj.sr) {
        return {
          kind: p.kind === 'glow' ? 'golden' : 'duck',
          value: p.value,
          targetIndex: p.id,
          tier: p.tier,
          sx: proj.sx,
          sy: proj.sy,
          wx: p.x,
          wy: p.y,
          wz: p.z,
        };
      }
    }

    return null;
  };

  const shoot = (x: number, y: number, t: number): TinShotOutcome => {
    // The round is over at TIN_DUCK_ROUND_MS: later trigger-pulls are dead on
    // BOTH sides (codex-review fix: the submit-window grace used to let a
    // synthetic log keep scoring rail/late-pop hits for up to 3 extra seconds;
    // a legit client stops firing at the round end, so parity is unaffected).
    if (t > TIN_DUCK_ROUND_MS) {
      return { type: 'ignored' };
    }
    const frenzy = isFrenzy(t);

    if (!frenzy) {
      if (reloadUntil >= 0) {
        if (t < reloadUntil) {
          return { type: 'reload-dead' };
        }
        ammo = TIN_DUCK_MAG_SIZE;
        reloadUntil = -1;
      }
    }

    if (
      lastLiveShotT !== -Infinity &&
      t - lastLiveShotT < TIN_DUCK_MIN_SHOT_INTERVAL_MS
    ) {
      return { type: 'ignored' };
    }

    lastLiveShotT = t;
    shotsFired += 1;
    if (!frenzy) {
      ammo -= 1;
      if (ammo <= 0) {
        ammo = 0;
        reloadUntil = t + TIN_DUCK_RELOAD_MS;
      }
    }

    const target = resolve(x, y, t);
    if (!target) {
      return { type: 'miss', ammo, reloading: reloadUntil >= 0 };
    }

    score += target.value;
    hits += 1;
    popUsed.add(target.targetIndex);
    return {
      type: 'hit',
      kind: target.kind,
      value: target.value,
      targetIndex: target.targetIndex,
      tier: target.tier,
      x: target.sx,
      y: target.sy,
      wx: target.wx,
      wy: target.wy,
      wz: target.wz,
      ammo,
      reloading: reloadUntil >= 0,
    };
  };

  const displayAmmo = (t: number): number => {
    if (isFrenzy(t)) return TIN_DUCK_MAG_SIZE;
    if (reloadUntil >= 0) return t >= reloadUntil ? TIN_DUCK_MAG_SIZE : 0;
    return ammo;
  };

  const reloadFraction = (t: number): number => {
    if (isFrenzy(t) || reloadUntil < 0) return 0;
    const remaining = reloadUntil - t;
    if (remaining <= 0) return 0;
    return clamp01(1 - remaining / TIN_DUCK_RELOAD_MS);
  };

  return {
    shoot,
    isPopUsed: (id) => popUsed.has(id),
    displayAmmo,
    reloadFraction,
    isFrenzy,
    get score() {
      return score;
    },
    get shotsFired() {
      return shotsFired;
    },
    get hits() {
      return hits;
    },
  };
}

// ---------------------------------------------------------------------------
// Run validation (server-authoritative scoring)
// ---------------------------------------------------------------------------

/** One submitted shot from the client. `x`, `y` are canonical play-space coords;
 *  `t` = ms since the round started (the authoritative elapsed time is the
 *  server session durationMs). */
export interface TinDuckShot {
  x: number;
  y: number;
  t: number;
}

export interface TinDuckRunResult {
  score: number;
  hits: number;
  shotsFired: number;
  dropped: number;
}

const isFiniteNum = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v);

/**
 * Re-derive the authoritative score from a submitted shot list by replaying
 * every shot through the same `createTinDuckScorer` machine the client ran.
 * Pure and never throws — malformed or out-of-window entries are dropped.
 */
export function validateTinDuckRun(
  seed: number,
  shots: readonly TinDuckShot[],
  durationMs: number,
): TinDuckRunResult {
  if (!Array.isArray(shots) || shots.length === 0) {
    return { score: 0, hits: 0, shotsFired: 0, dropped: 0 };
  }

  const schedule = deriveTinDuckSchedule(seed);
  const scorer = createTinDuckScorer(schedule);

  const serverWindowMs =
    Number.isFinite(durationMs) && durationMs > 0
      ? Math.min(TIN_DUCK_MAX_SHOT_T_MS, durationMs + 1_500)
      : TIN_DUCK_MAX_SHOT_T_MS;

  // Enforce the documented inspection ceiling INSIDE the shared validator too
  // (the route pre-rejects oversized payloads; this is defence-in-depth for
  // any future caller — codex-review fix).
  const clean = shots
    .slice(0, TIN_DUCK_MAX_SHOTS)
    .filter(
      (s): s is TinDuckShot =>
        !!s && isFiniteNum(s.x) && isFiniteNum(s.y) && isFiniteNum(s.t),
    )
    .sort((a, b) => a.t - b.t);

  let dropped = shots.length - clean.length;

  for (const shot of clean) {
    const t = Math.floor(shot.t);
    if (t < 0 || t > serverWindowMs) {
      dropped += 1;
      continue;
    }
    if (
      shot.x < -80 ||
      shot.x > TIN_DUCK_PLAY_W + 80 ||
      shot.y < -80 ||
      shot.y > TIN_DUCK_PLAY_H + 80
    ) {
      dropped += 1;
      continue;
    }
    scorer.shoot(shot.x, shot.y, t);
  }

  return {
    score: scorer.score,
    hits: scorer.hits,
    shotsFired: scorer.shotsFired,
    dropped,
  };
}
