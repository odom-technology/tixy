/**
 * Melon Chop — pure, deterministic ballistic spawn schedule + swipe-slice
 * verifier.
 *
 * This module is the single source of truth for BOTH the client (which renders
 * the fruit flying in seeded ballistic arcs and previews slices for instant
 * feedback) and the server score route (which re-derives the exact same schedule
 * and recomputes the authoritative score from the recorded swipe polylines).
 * Same `seed` ⇒ identical fruit schedule + identical intersection math on both
 * sides, so the client can never invent fruit, move a bomb, or claim a slice
 * that did not geometrically happen.
 *
 * Mechanic: over a 60-second blitz, fruit (and the occasional BOMB) are lobbed
 * up from the bottom of a fixed 1000×1000 normalized play-space in seeded
 * ballistic arcs. The player swipes to slice; the swipe is recorded as a
 * polyline of `{x, y, t}` points in that normalized space. Slicing several fruit
 * with one continuous stroke is a COMBO (score multiplier). Slicing a bomb ends
 * the run; otherwise the run ends at 60s. Missed fruit just falls.
 *
 * ── DETERMINISM MODEL ──────────────────────────────────────────────────────
 * The simulation is a fixed-timestep (120 Hz) integer-tick model. A fruit's
 * position is a PURE function of the tick index since it spawned:
 *     x(dt) = x0 + vx·dt
 *     y(dt) = SPAWN_Y + vy·dt + ½·GRAV·dt²          (canvas y-down)
 * with dt = tick − spawnTick. The client renders every fruit from this exact
 * function (sampled at the frame's elapsed-ms → tick), so what the player sees
 * and swipes through is byte-identical to what the server re-simulates.
 *
 * ── SWIPE-SLICE INTERSECTION (the geometric verifier) ──────────────────────
 * A recorded swipe is a polyline `{points:[{x,y,t}…]}` (normalized coords, t =
 * ms since run start). The server walks each swipe SEGMENT (between consecutive
 * points) and TIME-SLICES it into sub-steps small enough in both time and space
 * that the blade can never tunnel past a fruit's hit-circle. For each sub-step
 * it tests the blade micro-segment against every candidate fruit AT ITS
 * SIMULATED POSITION for that sub-step's time. A fruit is sliced the first
 * moment a blade micro-segment comes within MELON_HIT_RADIUS of its center.
 *
 * Scoring is done ONCE, in `scoreSwipe`, used verbatim by the client (per
 * finger-up, for live score + juice) and by `validateMelonRun` (per recorded
 * swipe, for the authoritative recompute). Because both sides run the same
 * function over the swipes in the same order, the client's live score and the
 * server's authoritative score are equal by construction — the route rejects
 * any mismatch.
 *
 * ── ANTI-CHEAT ─────────────────────────────────────────────────────────────
 * The seed is exposed in the session response, but knowing it buys nothing: the
 * maximum obtainable score is bounded by the SCHEDULE (a finite set of fruit,
 * each worth at most FRUIT_BASE×3 with a maxed combo) — see
 * `melonScoreCeiling`. A cheater cannot claim a slice that does not intersect a
 * real seeded fruit (the server recomputes all geometry), cannot re-slice a
 * fruit (each fruit is claimed once, globally), and cannot exceed the per-run
 * caps on swipe count / points-per-swipe. The run window is bounded by the
 * SERVER clock (session durationMs), so a stalled/replayed stream is rejected.
 *
 * Everything here is pure: no Date.now(), no Math.random(), no I/O.
 */

// ---------------------------------------------------------------------------
// Fixed-timestep + play-space constants (client mirrors ALL of these)
// ---------------------------------------------------------------------------

/** Simulation tick rate. Positions are a pure function of the integer tick. */
export const MELON_TICK_HZ = 120;
/** Milliseconds per tick. */
export const MELON_TICK_MS = 1000 / MELON_TICK_HZ;

/** The canonical square play-space. All viewports map INTO this space, so the
 *  swipe coordinates are resolution-independent. */
export const MELON_PLAY_SIZE = 1000;

/** Blitz length (ms) and in ticks. Mirrors the session modeSec concept. */
export const MELON_RUN_MS = 60_000;
export const MELON_RUN_TICKS = Math.round(MELON_RUN_MS / MELON_TICK_MS);

/** Grace added to the run window for the final swipe / network + clock skew. */
export const MELON_GRACE_MS = 1_500;

// ── Ballistics (units are play-space units; velocities per TICK) ────────────

/** Fruit spawn just below the bottom edge and are launched upward. */
export const MELON_SPAWN_Y = 1_040;
/** A fruit has fully fallen away (despawns / unsliceable) past this y. */
export const MELON_DESPAWN_Y = 1_120;
/** Gravity, play-space units per tick². Positive = downward (canvas y-down). */
export const MELON_GRAV = 0.16;
/** Launch vy range (per tick, negative = upward). Chosen so the apex lands in
 *  the upper play-space (≈ y 120–340) — high enough to read, low enough to stay
 *  on-screen for a sliceable ≈1.8 s. */
const MELON_VY_HI = -17.2; // highest launch (apex nearest the top)
const MELON_VY_LO = -15.0; // gentlest launch
/** Max horizontal launch speed (per tick); fruit is biased to arc toward the
 *  center so volleys cross where a single stroke can combo them. */
const MELON_VX_MAX = 2.4;
/** Horizontal spawn margin (keeps launches off the extreme edges). */
const MELON_X_MARGIN = 140;

// ── Render-only fruit variety (deterministic; scoring is variant-agnostic) ──
export const MELON_FRUIT_VARIANTS = 5;

// ── Slice geometry ──────────────────────────────────────────────────────────

/** A blade micro-segment slices a fruit when it passes within this distance of
 *  the fruit center (fruit render radius ≈ 42 + blade tolerance). */
export const MELON_HIT_RADIUS = 58;
/** Time granularity of the blade march (ms). */
const MELON_SLICE_STEP_MS = 6;
/** Space granularity of the blade march (units). Strictly < MELON_HIT_RADIUS so
 *  the blade cannot tunnel across a fruit between sub-steps. */
const MELON_SLICE_SPACE_STEP = 34;
/** Hard cap on sub-steps per swipe segment (defensive; bounds validator work). */
const MELON_MAX_SUBSTEPS = 128;

// ── Scoring ──────────────────────────────────────────────────────────────────

/** Base points for one sliced fruit (before the combo multiplier). */
export const MELON_FRUIT_BASE = 10;
/** The maximum combo multiplier is ×3 (see melonComboMultiplierX2), so a single
 *  fruit is worth at most this many points — the basis for the exact ceiling. */
export const MELON_MAX_POINTS_PER_FRUIT = MELON_FRUIT_BASE * 3;

// ── Payload / run caps (defense-in-depth; the schedule ceiling is the real cap) ─

/** Absolute cap on scheduled fruit (the time window bounds it well under this). */
export const MELON_MAX_FRUIT = 400;
/** Absolute cap on swipes we will ever inspect for one run. */
export const MELON_MAX_SWIPES = 1_500;
/** Cap on points in a single swipe polyline. */
export const MELON_MAX_SWIPE_POINTS = 96;
/** A single continuous stroke cannot legitimately last longer than this (ms);
 *  longer "swipes" (a finger dragged for seconds to snake through everything)
 *  are dropped so combos reflect real strokes. */
export const MELON_MAX_SWIPE_MS = 1_500;

/** Absolute upper bound on a run's score (every scheduled fruit, all maxed
 *  combos). A coarse plausibility cap; the exact ceiling per seed is
 *  `melonScoreCeiling`. */
export const MELON_ABS_MAX_SCORE =
  MELON_MAX_FRUIT * MELON_MAX_POINTS_PER_FRUIT;

// ---------------------------------------------------------------------------
// PRNG — mulberry32. Byte-identical to the repo's seededRandom (gopher,
// tumbler, math-sprint, knife-booth). Returns a function producing [0, 1).
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

function lerp(a: number, b: number, tNorm: number): number {
  return a + (b - a) * tNorm;
}

// ---------------------------------------------------------------------------
// Spawn schedule (seeded ballistic volleys)
// ---------------------------------------------------------------------------

/** First fruit appears after this delay (ms). */
const MELON_FIRST_SPAWN_MS = 700;
/** Gap between volleys ramps from START (slow warm-up) to END (fast finish). */
const MELON_GAP_START_MS = 780;
const MELON_GAP_END_MS = 300;
const MELON_GAP_JITTER_MS = 140;
/** Bomb probability per fruit ramps up modestly with the pace. Kept low enough
 *  that a careful player who only swipes safe clusters can survive the full 60 s
 *  — bombs punish greedy slicing, they are not an unavoidable time limit. */
const MELON_BOMB_CHANCE_START = 0.035;
const MELON_BOMB_CHANCE_END = 0.09;
/** Per-fruit time offset spread within a volley (ms). */
const MELON_BURST_SPREAD_MS = 90;

export interface MelonFruit {
  /** 0-based position in the deterministic stream. */
  index: number;
  /** Tick the fruit emerges (sliceable from here). */
  spawnTick: number;
  /** Tick the fruit has fallen past MELON_DESPAWN_Y (unsliceable after). */
  despawnTick: number;
  /** Launch x (play-space units). */
  x0: number;
  /** Horizontal velocity (units/tick). */
  vx: number;
  /** Vertical launch velocity (units/tick, negative = upward). */
  vy: number;
  /** Render-only spin (rad/tick). */
  spin: number;
  /** Render-only fruit variant [0, MELON_FRUIT_VARIANTS). */
  variant: number;
  /** True ⇒ a bomb (slicing it ends the run). */
  isBomb: boolean;
}

/** Ticks a fruit stays on-screen: the positive root of the despawn quadratic. */
function flightTicks(vy: number): number {
  // ½g·dt² + vy·dt + (SPAWN_Y − DESPAWN_Y) = 0
  const a = 0.5 * MELON_GRAV;
  const b = vy;
  const c = MELON_SPAWN_Y - MELON_DESPAWN_Y; // negative (spawn above despawn line)
  const disc = b * b - 4 * a * c;
  const dt = (-b + Math.sqrt(disc)) / (2 * a);
  return Math.ceil(dt);
}

/**
 * Pure, deterministic ballistic spawn schedule for a seed. Identical output on
 * client + server. Fruit are launched in ramping volleys; each fruit's draw
 * order is FIXED (offset, x0, vy, vx, spin, variant, bomb) so the stream never
 * shifts regardless of branching. The returned array is ordered by stream index
 * (monotonic non-decreasing spawnTick).
 */
export function deriveMelonSchedule(seed: number): MelonFruit[] {
  const rng = mulberry32(seed | 0);
  const fruits: MelonFruit[] = [];

  let cursor = MELON_FIRST_SPAWN_MS;
  let index = 0;

  while (cursor < MELON_RUN_MS && fruits.length < MELON_MAX_FRUIT) {
    const progress = Math.max(0, Math.min(1, cursor / MELON_RUN_MS));
    // Volley size ramps 1..(2..4).
    const maxBurst = 1 + Math.round(lerp(1, 3, progress));
    const burst = 1 + Math.floor(rng() * maxBurst);
    const bombChance = lerp(
      MELON_BOMB_CHANCE_START,
      MELON_BOMB_CHANCE_END,
      progress,
    );

    for (let i = 0; i < burst && fruits.length < MELON_MAX_FRUIT; i += 1) {
      // Fixed draw order (never reorder / skip, or client + server diverge).
      const offset = rng() * MELON_BURST_SPREAD_MS;
      const x0 =
        MELON_X_MARGIN + rng() * (MELON_PLAY_SIZE - 2 * MELON_X_MARGIN);
      const vy = lerp(MELON_VY_HI, MELON_VY_LO, rng());
      const sign = x0 < MELON_PLAY_SIZE / 2 ? 1 : -1;
      const vx = sign * rng() * MELON_VX_MAX;
      const spin = (rng() - 0.5) * 0.24;
      const variant = Math.floor(rng() * MELON_FRUIT_VARIANTS);
      const isBomb = rng() < bombChance;

      const spawnTick = Math.round((cursor + offset) / MELON_TICK_MS);
      const despawnTick = spawnTick + flightTicks(vy);
      fruits.push({
        index,
        spawnTick,
        despawnTick,
        x0,
        vx,
        vy,
        spin,
        variant,
        isBomb,
      });
      index += 1;
    }

    const gapBase = lerp(MELON_GAP_START_MS, MELON_GAP_END_MS, progress);
    const gap = gapBase + (rng() - 0.5) * 2 * MELON_GAP_JITTER_MS;
    cursor += Math.max(140, gap);
  }

  return fruits;
}

/** The exact score ceiling for a seed: every scheduled fruit sliced with a
 *  maxed (×3) combo. An exact upper bound (bombs can't score, so this is
 *  generous), used by the route for a coarse claimed-score sanity cap. */
export function melonScoreCeiling(seed: number): number {
  return deriveMelonSchedule(seed).length * MELON_MAX_POINTS_PER_FRUIT;
}

// ---------------------------------------------------------------------------
// Fruit position (pure function of time) — render + slice both call this
// ---------------------------------------------------------------------------

export interface MelonPoint {
  x: number;
  y: number;
}

/**
 * Fruit center at `tMs` (ms since run start), or `null` if the fruit is not
 * on-screen (before spawn / after despawn) at that time. Pure; the client
 * renders from this exact function so a slice the player sees is the slice the
 * server recomputes.
 */
export function melonFruitPosAtMs(
  fruit: MelonFruit,
  tMs: number,
): MelonPoint | null {
  const tick = tMs / MELON_TICK_MS;
  if (tick < fruit.spawnTick || tick > fruit.despawnTick) return null;
  const dt = tick - fruit.spawnTick;
  return {
    x: fruit.x0 + fruit.vx * dt,
    y: MELON_SPAWN_Y + fruit.vy * dt + 0.5 * MELON_GRAV * dt * dt,
  };
}

// ---------------------------------------------------------------------------
// Swipe geometry
// ---------------------------------------------------------------------------

/** One recorded swipe point: normalized play-space coords + ms since run start. */
export interface MelonSwipePoint {
  x: number;
  y: number;
  t: number;
}

/** One recorded swipe stroke (finger-down → finger-up). */
export interface MelonSwipe {
  points: MelonSwipePoint[];
}

/** One intersection of a swipe with a target, at simulated time `tMs`. */
export interface MelonSliceEvent {
  id: number;
  tMs: number;
  x: number;
  y: number;
  isBomb: boolean;
}

const isFiniteNum = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v);

/** Squared distance from point (px,py) to segment (ax,ay)-(bx,by). */
function segPointDist2(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  px: number,
  py: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let tproj = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  if (tproj < 0) tproj = 0;
  else if (tproj > 1) tproj = 1;
  const cx = ax + dx * tproj;
  const cy = ay + dy * tproj;
  const ex = px - cx;
  const ey = py - cy;
  return ex * ex + ey * ey;
}

/** Clean + order a raw swipe's points; returns null if it can't slice
 *  (fewer than 2 valid points, or the stroke is implausibly long). */
function sanitizeSwipe(swipe: MelonSwipe | null | undefined): MelonSwipePoint[] | null {
  if (!swipe || !Array.isArray(swipe.points)) return null;
  const pts = swipe.points
    .filter(
      (p): p is MelonSwipePoint =>
        !!p && isFiniteNum(p.x) && isFiniteNum(p.y) && isFiniteNum(p.t) && p.t >= 0,
    )
    .slice(0, MELON_MAX_SWIPE_POINTS)
    .sort((a, b) => a.t - b.t);
  if (pts.length < 2) return null;
  if (pts[pts.length - 1]!.t - pts[0]!.t > MELON_MAX_SWIPE_MS) return null;
  return pts;
}

/**
 * March one swipe's blade against the schedule and return every intersection
 * event (fruit + bombs), in time order. Targets already in `slicedIds` are
 * skipped (a fruit can be sliced once, globally); within this swipe each target
 * is recorded at most once, at the earliest sub-step it is touched. Pure.
 */
function marchSwipe(
  schedule: readonly MelonFruit[],
  points: MelonSwipePoint[],
  slicedIds: Set<number>,
): MelonSliceEvent[] {
  const firstT = points[0]!.t;
  const lastT = points[points.length - 1]!.t;

  // Only fruit whose on-screen window overlaps the swipe can be touched.
  const candidates = schedule.filter((f) => {
    if (slicedIds.has(f.index)) return false;
    const upStart = f.spawnTick * MELON_TICK_MS;
    const upEnd = f.despawnTick * MELON_TICK_MS;
    return upStart <= lastT && upEnd >= firstT;
  });
  if (candidates.length === 0) return [];

  const localHit = new Set<number>();
  const events: MelonSliceEvent[] = [];
  const hitR2 = MELON_HIT_RADIUS * MELON_HIT_RADIUS;

  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i]!;
    const b = points[i + 1]!;
    const dtMs = b.t - a.t;
    if (dtMs <= 0) continue;
    const segLen = Math.hypot(b.x - a.x, b.y - a.y);
    const subs = Math.max(
      1,
      Math.min(
        MELON_MAX_SUBSTEPS,
        Math.max(
          Math.ceil(dtMs / MELON_SLICE_STEP_MS),
          Math.ceil(segLen / MELON_SLICE_SPACE_STEP),
        ),
      ),
    );
    for (let k = 1; k <= subs; k += 1) {
      const f0 = (k - 1) / subs;
      const f1 = k / subs;
      const bx0 = a.x + (b.x - a.x) * f0;
      const by0 = a.y + (b.y - a.y) * f0;
      const bx1 = a.x + (b.x - a.x) * f1;
      const by1 = a.y + (b.y - a.y) * f1;
      const tMid = a.t + dtMs * ((f0 + f1) / 2);
      for (let c = 0; c < candidates.length; c += 1) {
        const fruit = candidates[c]!;
        if (localHit.has(fruit.index)) continue;
        const pos = melonFruitPosAtMs(fruit, tMid);
        if (!pos) continue;
        if (segPointDist2(bx0, by0, bx1, by1, pos.x, pos.y) <= hitR2) {
          localHit.add(fruit.index);
          events.push({
            id: fruit.index,
            tMs: tMid,
            x: pos.x,
            y: pos.y,
            isBomb: fruit.isBomb,
          });
        }
      }
    }
  }

  events.sort((p, q) => p.tMs - q.tMs || p.id - q.id);
  return events;
}

/** Combo multiplier ×2 (integer half-steps): 1 fruit ⇒ ×1 … 5+ ⇒ ×3. */
export function melonComboMultiplierX2(comboCount: number): number {
  if (comboCount >= 5) return 6;
  if (comboCount === 4) return 5;
  if (comboCount === 3) return 4;
  if (comboCount === 2) return 3;
  return 2;
}

/** Points for a swipe that slices `comboCount` fruit. Pure integer math ⇒
 *  bit-identical on client + server. */
export function melonComboPoints(comboCount: number): number {
  if (comboCount <= 0) return 0;
  return Math.floor(
    (comboCount * MELON_FRUIT_BASE * melonComboMultiplierX2(comboCount)) / 2,
  );
}

export interface MelonSwipeResult {
  /** Points awarded by this swipe (combo-multiplied). */
  points: number;
  /** Fruit sliced by this swipe (before any bomb). */
  comboCount: number;
  /** The counted events, in time order: the pre-bomb fruit, then the bomb (if
   *  any). The client animates these; the caller has already marked the fruit
   *  ids into `slicedIds`. */
  events: MelonSliceEvent[];
  /** True if this swipe struck a bomb (the run ends at `bombMs`). */
  bomb: boolean;
  bombMs: number | null;
}

/**
 * Score ONE swipe against the run. Mutates `slicedIds` (adds the fruit this
 * swipe claims). This is THE scoring primitive — the client calls it per
 * finger-up for the live score + juice, and `validateMelonRun` calls it per
 * recorded swipe for the authoritative recompute, so the two are equal by
 * construction.
 *
 * `windowMs` is the upper time bound (events past it are ignored — the run is
 * already over). A bomb ends the run: fruit sliced by this same stroke STRICTLY
 * before the bomb still count (a final combo); everything at/after the bomb is
 * dropped.
 */
export function scoreSwipe(
  schedule: readonly MelonFruit[],
  swipe: MelonSwipe,
  slicedIds: Set<number>,
  windowMs: number,
): MelonSwipeResult {
  const points = sanitizeSwipe(swipe);
  if (!points) {
    return { points: 0, comboCount: 0, events: [], bomb: false, bombMs: null };
  }

  const raw = marchSwipe(schedule, points, slicedIds);
  const counted: MelonSliceEvent[] = [];
  let comboCount = 0;
  let bomb = false;
  let bombMs: number | null = null;

  for (const ev of raw) {
    if (ev.tMs > windowMs) continue; // run already ended (time)
    if (ev.isBomb) {
      bomb = true;
      bombMs = ev.tMs;
      counted.push(ev);
      break; // the run ends here; nothing after this stroke's bomb counts
    }
    slicedIds.add(ev.id);
    comboCount += 1;
    counted.push(ev);
  }

  return {
    points: melonComboPoints(comboCount),
    comboCount,
    events: counted,
    bomb,
    bombMs,
  };
}

// ---------------------------------------------------------------------------
// Run validation (server-authoritative scoring)
// ---------------------------------------------------------------------------

export interface MelonRunResult {
  /** Authoritative score = Σ combo points of the validated swipes. */
  score: number;
  /** Total fruit sliced across the run. */
  sliced: number;
  /** Largest single-swipe combo of the run. */
  bestCombo: number;
  /** True if a bomb was sliced (the run stops counting there). */
  bombHit: boolean;
  /** ms at which the run ended (bomb time, or null if it ran to time). */
  endMs: number | null;
  /** How many swipes were inspected before scoring stopped. */
  inspectedSwipes: number;
  /** Why scoring stopped. */
  stop: 'bomb' | 'end' | 'cap';
  /** Absolute-time ms of every counted slice, for the anti-cheat action stream. */
  sliceTimesMs: number[];
}

/**
 * Re-derive the authoritative run from a submitted swipe list by replaying every
 * swipe through the SAME `scoreSwipe` primitive the client ran, in the same
 * order. The first swipe that strikes a bomb ends the run; fruit are claimed
 * once globally; out-of-window events are ignored. Pure and never throws on bad
 * input — malformed swipes simply score nothing.
 *
 * @param seed        the server `melonChopSeed` for this session
 * @param swipes      recorded swipe polylines (client order = stroke order)
 * @param durationMs  the bounded server session/replay duration (ms)
 */
export function validateMelonRun(
  seed: number,
  swipes: readonly MelonSwipe[],
  durationMs: number,
): MelonRunResult {
  const empty: MelonRunResult = {
    score: 0,
    sliced: 0,
    bestCombo: 0,
    bombHit: false,
    endMs: null,
    inspectedSwipes: 0,
    stop: 'end',
    sliceTimesMs: [],
  };
  if (!Array.isArray(swipes) || swipes.length === 0) return empty;

  const schedule = deriveMelonSchedule(seed);
  const ceiling = schedule.length * MELON_MAX_POINTS_PER_FRUIT;

  // Upper bound for an acceptable event time: the smaller of the hard run window
  // + grace and the server-measured elapsed + grace.
  const hardWindow = MELON_RUN_MS + MELON_GRACE_MS;
  const windowMs =
    Number.isFinite(durationMs) && durationMs > 0
      ? Math.min(hardWindow, durationMs + MELON_GRACE_MS)
      : hardWindow;

  const slicedIds = new Set<number>();
  const sliceTimesMs: number[] = [];
  let score = 0;
  let sliced = 0;
  let bestCombo = 0;
  let bombHit = false;
  let endMs: number | null = null;
  let inspected = 0;
  let stop: MelonRunResult['stop'] = 'end';

  const limit = Math.min(swipes.length, MELON_MAX_SWIPES);
  for (let i = 0; i < limit; i += 1) {
    inspected = i + 1;
    const result = scoreSwipe(schedule, swipes[i]!, slicedIds, windowMs);
    score += result.points;
    sliced += result.comboCount;
    if (result.comboCount > bestCombo) bestCombo = result.comboCount;
    for (const ev of result.events) {
      if (!ev.isBomb) sliceTimesMs.push(Math.max(0, Math.floor(ev.tMs)));
    }
    if (result.bomb) {
      bombHit = true;
      endMs = result.bombMs;
      stop = 'bomb';
      break;
    }
    if (score >= ceiling) {
      stop = 'cap';
      break;
    }
  }

  return {
    score: Math.min(ceiling, score),
    sliced,
    bestCombo,
    bombHit,
    endMs,
    inspectedSwipes: inspected,
    stop,
    sliceTimesMs,
  };
}
