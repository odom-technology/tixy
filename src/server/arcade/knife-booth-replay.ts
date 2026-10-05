/**
 * Knife Booth — pure, deterministic rotation schedule + run validator.
 *
 * This module is the single source of truth for BOTH the client (which renders
 * the spinning target + lodged knives for instant feedback) and the server
 * score route (which re-derives every throw to validate the submitted taps).
 * The same `(seed, stage, t)` ⇒ identical target rotation, obstacle layout,
 * fruit layout, and knife-count on both sides, so the client can never choose an
 * easier board.
 *
 * Mechanic: a wooden target spins in front of a carnival booth. The player taps
 * to hurl a knife; it lodges into the target at whatever angle the target
 * presents to the fixed throwing lane at the instant of the tap. Landing a knife
 * on top of an already-lodged knife (or one of the stage's pre-placed obstacle
 * knives) shatters the blade and ends the run. Clear the stage's knife quota to
 * advance; every 5th stage is a faster, more crowded BOSS target. Seeded bonus
 * fruit pinned to the target is sliced (bonus points) when a knife lands on it.
 *
 * Rotation is a PURE function of (seed, stage, t): a seed-derived sequence of
 * constant-velocity segments (speed escalates per stage; direction reverses on
 * deeper stages). `knifeAngleAt(seed, stage, t)` integrates that piecewise
 * schedule; the client renders from the same function so the two can never
 * disagree on where a knife lands.
 *
 * Anti-cheat model (single-POST, no WebSocket — mirrors Tumbler / Math Sprint):
 *  - The authoritative score is recomputed by replaying the recorded taps
 *    through the same pure state machine the client ran (`knifeApplyThrow`).
 *    For each tap we reconstruct the target angle from ONLY the tap's `t`
 *    (ms since the current stage began) and the deterministic schedule, then
 *    check the landing angle against the obstacles + already-lodged knives. The
 *    first throw that collides (or whose `t` is out of bounds) ends the run;
 *    everything after it is ignored.
 *  - We trust ONLY the tap timestamp — never a client-supplied angle. A minimum
 *    interval between counted throws caps how fast a precomputing cheater could
 *    fire; under-cadence taps are deterministically IGNORED on both sides (they
 *    neither score nor end the run), so an accidental double-tap can never
 *    desync the client from the validator.
 *
 * Everything here is pure: no Date.now(), no Math.random(), no I/O.
 */

const TAU = Math.PI * 2;

// ---------------------------------------------------------------------------
// Tunable constants (exported so the route + client agree on the same bounds)
// ---------------------------------------------------------------------------

/** World-space angle of the throwing lane. A knife thrown at time `t` lodges at
 *  the target-relative angle `normalize(THROW_ANGLE - rotation(t))`. Points to
 *  the bottom of the target (canvas y-down, so +π/2 is "down"), i.e. the lane
 *  the player throws up from. Pure offset — parity is unaffected by its value. */
export const KNIFE_THROW_ANGLE = Math.PI / 2;

/** Base angular speed of the target at stage 0, rad/s (~0.28 rev/s). */
export const KNIFE_BASE_SPEED = 1.7;
/** Added to the stage's base speed per stage cleared. */
export const KNIFE_SPEED_STEP = 0.12;
/** Hard ceiling on a stage's base angular speed (rad/s). */
export const KNIFE_MAX_SPEED = 5.0;

/** A rotation SEGMENT lasts a seeded [min, min+range] ms at a constant velocity. */
export const KNIFE_SEG_MIN_MS = 900;
export const KNIFE_SEG_RANGE_MS = 1500;
/** Per-segment speed jitter: the stage speed is scaled by [1-J, 1+J]. */
export const KNIFE_SEG_SPEED_JITTER = 0.18;

/** Reversals (direction flips between segments) only begin at this stage... */
export const KNIFE_REVERSAL_MIN_STAGE = 3;
/** ...and even then only flip with this per-segment chance. */
export const KNIFE_REVERSAL_CHANCE = 0.34;

/** Two knives collide (shatter) if their target-relative centers are closer than
 *  this many radians. ~9.7°, so ~41 knives fill the full target. */
export const KNIFE_COLLIDE_ANGLE = 0.17;

/** A thrown knife slices an un-sliced fruit if it lands within this tolerance of
 *  the fruit's target-relative center (the blade passes through it). */
export const KNIFE_FRUIT_SLICE_ANGLE = 0.16;

/** Points. Each landed knife pays a flat point; sliced fruit a bonus; clearing a
 *  stage pays a depth-scaled bonus (deeper stages are worth more, so score
 *  rewards how far you push, not just raw throws), doubled on boss stages. */
export const KNIFE_POINTS_PER_KNIFE = 1;
export const KNIFE_POINTS_PER_FRUIT = 5;
export const KNIFE_STAGE_CLEAR_BASE = 5;
/** The stage-clear bonus grows with the stage index but stops growing here. */
export const KNIFE_STAGE_CLEAR_CAP_STAGE = 40;
export const KNIFE_BOSS_CLEAR_MULT = 2;

/** Depth-scaled stage-clear bonus for clearing `stage` (0-based). */
export function knifeStageClearBonus(stage: number): number {
  const s = stage < 0 ? 0 : Math.floor(stage);
  const base = KNIFE_STAGE_CLEAR_BASE + Math.min(s, KNIFE_STAGE_CLEAR_CAP_STAGE);
  return base * (knifeIsBoss(s) ? KNIFE_BOSS_CLEAR_MULT : 1);
}

/** Every Nth stage (1-based) is a BOSS: faster, more crowded, bigger clear bonus. */
export const KNIFE_BOSS_EVERY = 5;
/** Boss target speed multiplier and extra obstacle count. */
export const KNIFE_BOSS_SPEED_MULT = 1.35;
export const KNIFE_BOSS_EXTRA_OBSTACLES = 3;

/** Minimum spacing between consecutive COUNTED throws (ms). A human cannot make
 *  two distinct, aimed throws faster than this; tighter taps are IGNORED (not
 *  counted, not fatal) on both sides, which protects the time-bounded ceiling. */
export const KNIFE_MIN_THROW_INTERVAL_MS = 120;

/** A single stage cannot legitimately take longer than this to clear (ms). Past
 *  it the target has spun for a full minute; we treat the tap's `t` as
 *  out-of-bounds and end the run. Generous so slow-but-honest play is fine. */
export const KNIFE_MAX_STAGE_T_MS = 60_000;

/** Absolute ceiling on how many stages we will ever score for one run. */
export const KNIFE_MAX_STAGES = 200;

/** Absolute ceiling on how many knives a single stage can ever demand. */
export const KNIFE_MAX_KNIVES_PER_STAGE = 24;

/** Highest points a single stage can pay (all knives + fruit cap + deepest boss
 *  clear bonus). Board fruit is capped at 3, so 3× fruit is the real max. */
export const KNIFE_MAX_POINTS_PER_STAGE =
  KNIFE_MAX_KNIVES_PER_STAGE * KNIFE_POINTS_PER_KNIFE +
  3 * KNIFE_POINTS_PER_FRUIT +
  (KNIFE_STAGE_CLEAR_BASE + KNIFE_STAGE_CLEAR_CAP_STAGE) * KNIFE_BOSS_CLEAR_MULT;

/** Absolute ceiling on the score of one run (coarse plausibility bound). */
export const KNIFE_MAX_SCORE = KNIFE_MAX_STAGES * KNIFE_MAX_POINTS_PER_STAGE;

/** Absolute ceiling on the tap payload (every knife of every stage + headroom). */
export const KNIFE_MAX_TAPS = KNIFE_MAX_STAGES * KNIFE_MAX_KNIVES_PER_STAGE + 16;

// ---------------------------------------------------------------------------
// PRNG — mulberry32. Byte-identical to the repo's seededRandom (tumbler,
// math-sprint, typing-words). Returns a function producing floats in [0, 1).
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

/**
 * Derive a stable per-(stage, stream) RNG from (seed, stage, salt). Mixing the
 * stage + a stream salt into the seed keeps every derivation O(1) and pure — no
 * cross-stage state can drift between client and server. The two 32-bit mixes
 * spread adjacent stages apart so consecutive stages don't correlate.
 */
function rngFor(seed: number, stage: number, salt: number): () => number {
  let mixed = (seed ^ Math.imul(stage + 1, 0x9e3779b1) ^ Math.imul(salt + 1, 0x85ebca77)) | 0;
  mixed = (mixed + 0x6d2b79f5) | 0;
  return mulberry32(mixed);
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

/** Normalize any angle into [0, TAU). */
export function knifeNorm(angle: number): number {
  let a = angle % TAU;
  if (a < 0) a += TAU;
  return a;
}

/** Smallest absolute angular distance between two angles, in [0, PI]. */
export function knifeAngularDelta(a: number, b: number): number {
  const d = Math.abs(knifeNorm(a) - knifeNorm(b));
  return d > Math.PI ? TAU - d : d;
}

// ---------------------------------------------------------------------------
// Stage descriptors (deterministic difficulty ramp)
// ---------------------------------------------------------------------------

/** 1-based boss check for a 0-based stage index. */
export function knifeIsBoss(stage: number): boolean {
  const s = stage < 0 ? 0 : Math.floor(stage);
  return (s + 1) % KNIFE_BOSS_EVERY === 0;
}

/** Base angular speed magnitude (rad/s) for a stage (ramps, boss-boosted, clamped). */
export function knifeStageSpeed(stage: number): number {
  const s = stage < 0 ? 0 : Math.floor(stage);
  const base = KNIFE_BASE_SPEED + s * KNIFE_SPEED_STEP;
  const boosted = knifeIsBoss(s) ? base * KNIFE_BOSS_SPEED_MULT : base;
  return Math.min(KNIFE_MAX_SPEED, boosted);
}

/** How many knives must be landed to clear a stage (ramps slowly, boss-boosted). */
export function knifeStageQuota(stage: number): number {
  const s = stage < 0 ? 0 : Math.floor(stage);
  const base = Math.min(12, 5 + Math.floor(s / 3));
  const quota = base + (knifeIsBoss(s) ? 3 : 0);
  return Math.min(KNIFE_MAX_KNIVES_PER_STAGE, quota);
}

/** How many pre-placed obstacle knives crowd the target at stage start. */
export function knifeObstacleCount(stage: number): number {
  const s = stage < 0 ? 0 : Math.floor(stage);
  const base = Math.min(8, 1 + Math.floor(s / 2));
  return base + (knifeIsBoss(s) ? KNIFE_BOSS_EXTRA_OBSTACLES : 0);
}

// ---------------------------------------------------------------------------
// Rotation schedule — piecewise constant-velocity segments, pure per stage.
// ---------------------------------------------------------------------------

export interface KnifeSegment {
  /** ms since the stage began where this segment starts. */
  tStart: number;
  /** ms since the stage began where this segment ends. */
  tEnd: number;
  /** Signed angular velocity for the segment (rad/s; sign = direction). */
  w: number;
  /** Target angle (rad, normalized) at tStart. */
  aStart: number;
}

/**
 * Build the deterministic rotation schedule for a stage, covering
 * [0, KNIFE_MAX_STAGE_T_MS]. Identical on the client and server for the same
 * (seed, stage). Segment count is bounded (~KNIFE_MAX_STAGE_T_MS / min segment),
 * so this is cheap to build per stage and cache.
 *
 * RNG draw order is FIXED (duration, speed jitter, reversal) — never reorder or
 * skip draws, or the client and server schedules diverge.
 */
export function knifeStageSchedule(seed: number, stage: number): KnifeSegment[] {
  const safeSeed = seed | 0;
  const s = stage < 0 ? 0 : Math.floor(stage);
  const rng = rngFor(safeSeed, s, 0);
  const speed = knifeStageSpeed(s);

  const segments: KnifeSegment[] = [];
  let t = 0;
  let angle = 0; // every stage starts with the target at angle 0
  // The first segment's direction is seeded (draw once up-front so the reversal
  // draws below stay aligned between client and server).
  let dir: 1 | -1 = rng() < 0.5 ? 1 : -1;

  let guard = 0;
  while (t < KNIFE_MAX_STAGE_T_MS && guard < 512) {
    guard += 1;
    const dur = KNIFE_SEG_MIN_MS + rng() * KNIFE_SEG_RANGE_MS;
    const jitter = 1 + (rng() * 2 - 1) * KNIFE_SEG_SPEED_JITTER;
    const flip = rng() < KNIFE_REVERSAL_CHANCE;
    if (segments.length > 0 && s >= KNIFE_REVERSAL_MIN_STAGE && flip) {
      dir = dir === 1 ? -1 : 1;
    }
    const w = dir * speed * jitter;
    const tEnd = Math.min(KNIFE_MAX_STAGE_T_MS, t + dur);
    segments.push({ tStart: t, tEnd, w, aStart: angle });
    angle = knifeNorm(angle + w * ((tEnd - t) / 1000));
    t = tEnd;
  }
  // Guarantee coverage to the ceiling (the guard should never trip first).
  if (segments.length === 0) {
    segments.push({ tStart: 0, tEnd: KNIFE_MAX_STAGE_T_MS, w: speed, aStart: 0 });
  }
  return segments;
}

/**
 * Target rotation angle (rad, normalized) at time `t` ms since the stage began,
 * for a prebuilt schedule. Pure mirror of the client's per-frame render.
 */
export function knifeAngleFromSchedule(schedule: KnifeSegment[], tMs: number): number {
  const t = tMs > 0 ? tMs : 0;
  // Segments are contiguous and ordered; a linear scan is fine (bounded count),
  // but we early-out on the containing segment.
  for (let i = 0; i < schedule.length; i += 1) {
    const seg = schedule[i]!;
    if (t <= seg.tEnd || i === schedule.length - 1) {
      const dt = (Math.min(t, seg.tEnd) - seg.tStart) / 1000;
      return knifeNorm(seg.aStart + seg.w * dt);
    }
  }
  return 0;
}

/** Convenience: rotation angle at (seed, stage, t) — builds + samples. Client may
 *  prefer to cache the schedule and call knifeAngleFromSchedule directly. */
export function knifeAngleAt(seed: number, stage: number, tMs: number): number {
  return knifeAngleFromSchedule(knifeStageSchedule(seed, stage), tMs);
}

/** The target-relative angle a knife thrown at time `t` lodges into. */
export function knifeLandingAngle(schedule: KnifeSegment[], tMs: number): number {
  return knifeNorm(KNIFE_THROW_ANGLE - knifeAngleFromSchedule(schedule, tMs));
}

// ---------------------------------------------------------------------------
// Stage board — pre-placed obstacle knives + bonus fruit, pure per stage.
// ---------------------------------------------------------------------------

export interface KnifeStageBoard {
  stage: number;
  isBoss: boolean;
  quota: number;
  /** Target-relative angles of the pre-lodged obstacle knives. */
  obstacles: number[];
  /** Target-relative angles of the (un-sliced) bonus fruit. */
  fruits: number[];
}

/**
 * Deterministic board for a stage: obstacle knives are spread evenly around the
 * target with a seeded jitter (so they never self-collide and always leave
 * hittable gaps), and fruit is placed at seeded angles that don't overlap an
 * obstacle. Identical output on the client and server.
 */
export function knifeStageBoard(seed: number, stage: number): KnifeStageBoard {
  const safeSeed = seed | 0;
  const s = stage < 0 ? 0 : Math.floor(stage);
  const isBoss = knifeIsBoss(s);
  const quota = knifeStageQuota(s);

  const obsCount = knifeObstacleCount(s);
  const obstacles: number[] = [];
  if (obsCount > 0) {
    const rng = rngFor(safeSeed, s, 1);
    const slot = TAU / obsCount;
    // Keep the jitter strictly inside the slot so adjacent obstacles never come
    // within KNIFE_COLLIDE_ANGLE of each other (slot - jitterSpan > collide).
    const maxJitter = Math.max(0, (slot - KNIFE_COLLIDE_ANGLE * 2.2) / 2);
    for (let i = 0; i < obsCount; i += 1) {
      const jitter = (rng() * 2 - 1) * maxJitter;
      obstacles.push(knifeNorm(i * slot + jitter));
    }
  }

  const fruits: number[] = [];
  // Fruit count: 1 baseline, +1 on boss stages, plus a seeded chance of a second.
  const frng = rngFor(safeSeed, s, 2);
  let fruitCount = 1 + (isBoss ? 1 : 0);
  if (frng() < 0.4) fruitCount += 1;
  for (let i = 0; i < fruitCount; i += 1) {
    const angle = knifeNorm(frng() * TAU);
    // Skip fruit that would sit on top of an obstacle (keeps it slice-able).
    const clash = obstacles.some(
      (o) => knifeAngularDelta(o, angle) < KNIFE_COLLIDE_ANGLE,
    );
    if (!clash) fruits.push(angle);
  }

  return { stage: s, isBoss, quota, obstacles, fruits };
}

// ---------------------------------------------------------------------------
// Shared throw state machine — the ONE sim both the client and validator run.
// ---------------------------------------------------------------------------

export interface KnifeSimState {
  /** 0-based index of the stage in progress. */
  stage: number;
  /** Knives landed in the CURRENT stage so far. */
  landed: number;
  /** Target-relative angles of the knives landed this stage. */
  landedAngles: number[];
  /** Which of the current stage's fruits have been sliced (by fruit index). */
  slicedFruit: boolean[];
  /** Stages fully cleared so far. */
  stagesCleared: number;
  /** Authoritative score (points). */
  score: number;
  /** Sum of the final `t` of every COMPLETED stage — the absolute-timeline anchor. */
  timeline: number;
  /** Absolute timeline of the last counted throw (cadence floor), -Infinity if none. */
  lastCountedAbs: number;
}

export function knifeInitialState(seed: number): KnifeSimState {
  const board = knifeStageBoard(seed, 0);
  return {
    stage: 0,
    landed: 0,
    landedAngles: [],
    slicedFruit: board.fruits.map(() => false),
    stagesCleared: 0,
    score: 0,
    timeline: 0,
    lastCountedAbs: -Infinity,
  };
}

export type KnifeThrowEvent =
  /** Tap arrived under the cadence floor — deterministically a no-op. */
  | { type: 'ignored' }
  /** Tap `t` was malformed / past the per-stage ceiling — run ends (bounds). */
  | { type: 'bounds' }
  /** Knife shattered on an obstacle or a lodged knife — run ends. */
  | { type: 'shatter'; angle: number; hitAngle: number }
  /** Knife lodged. */
  | {
      type: 'stick';
      /** Target-relative angle the knife lodged at. */
      angle: number;
      /** Points paid by THIS throw (knife + any fruit bonus + any stage bonus). */
      points: number;
      /** Fruit index sliced by this throw, or -1. */
      slicedFruit: number;
      /** True when this throw cleared the stage (advance to the next). */
      stageCleared: boolean;
      /** True when the cleared stage was a boss. */
      bossCleared: boolean;
      /** Knives landed in the (now current) stage after this throw. */
      landed: number;
    };

/**
 * Apply one throw (t = ms since the CURRENT stage began) to a sim state. Pure:
 * returns a NEW state plus the event describing what happened. This exact
 * function runs on the client per real tap and on the server per recorded tap,
 * so the two can never disagree. `schedule`/`board` are passed in so the caller
 * can cache them per stage; both MUST be for `state.stage`.
 */
export function knifeApplyThrow(
  seed: number,
  state: KnifeSimState,
  t: number,
  schedule: KnifeSegment[],
  board: KnifeStageBoard,
): { state: KnifeSimState; event: KnifeThrowEvent } {
  if (!Number.isFinite(t) || t < 0 || t > KNIFE_MAX_STAGE_T_MS) {
    return { state, event: { type: 'bounds' } };
  }

  const absT = state.timeline + t;

  // Cadence floor: too-soon taps are ignored on BOTH sides (never fatal, never
  // scoring) so accidental double-taps cannot desync client from validator.
  if (
    state.lastCountedAbs !== -Infinity &&
    absT - state.lastCountedAbs < KNIFE_MIN_THROW_INTERVAL_MS
  ) {
    return { state, event: { type: 'ignored' } };
  }

  const angle = knifeLandingAngle(schedule, t);

  // Collision against pre-placed obstacles + knives already lodged this stage.
  for (const o of board.obstacles) {
    if (knifeAngularDelta(o, angle) < KNIFE_COLLIDE_ANGLE) {
      return { state, event: { type: 'shatter', angle, hitAngle: o } };
    }
  }
  for (const la of state.landedAngles) {
    if (knifeAngularDelta(la, angle) < KNIFE_COLLIDE_ANGLE) {
      return { state, event: { type: 'shatter', angle, hitAngle: la } };
    }
  }

  // Fruit slice (bonus; the knife still lodges). First matching un-sliced fruit.
  let slicedFruit = -1;
  let points = KNIFE_POINTS_PER_KNIFE;
  for (let i = 0; i < board.fruits.length; i += 1) {
    if (
      !state.slicedFruit[i] &&
      knifeAngularDelta(board.fruits[i]!, angle) < KNIFE_FRUIT_SLICE_ANGLE
    ) {
      slicedFruit = i;
      points += KNIFE_POINTS_PER_FRUIT;
      break;
    }
  }

  const landed = state.landed + 1;
  const nextSliced =
    slicedFruit >= 0
      ? state.slicedFruit.map((v, i) => (i === slicedFruit ? true : v))
      : state.slicedFruit;

  // Stage clear?
  if (landed >= board.quota) {
    const bossCleared = board.isBoss;
    points += knifeStageClearBonus(state.stage);
    const nextStage = state.stage + 1;
    const nextBoard = knifeStageBoard(seed, nextStage);
    return {
      state: {
        stage: nextStage,
        landed: 0,
        landedAngles: [],
        slicedFruit: nextBoard.fruits.map(() => false),
        stagesCleared: state.stagesCleared + 1,
        score: state.score + points,
        timeline: absT, // the new stage's clock starts at this instant
        lastCountedAbs: absT,
      },
      event: {
        type: 'stick',
        angle,
        points,
        slicedFruit,
        stageCleared: true,
        bossCleared,
        landed: 0,
      },
    };
  }

  // Knife lodged, stage continues.
  return {
    state: {
      ...state,
      landed,
      landedAngles: [...state.landedAngles, angle],
      slicedFruit: nextSliced,
      score: state.score + points,
      lastCountedAbs: absT,
    },
    event: {
      type: 'stick',
      angle,
      points,
      slicedFruit,
      stageCleared: false,
      bossCleared: false,
      landed,
    },
  };
}

// ---------------------------------------------------------------------------
// Run validation (server-authoritative scoring)
// ---------------------------------------------------------------------------

/** One recorded throw from the client. `t` = ms since the CURRENT stage began
 *  (client clock — used to reconstruct the target angle and to enforce the
 *  cadence floor). The client never sends an angle; the server derives it. */
export interface KnifeThrow {
  /** ms since the current stage began. */
  t: number;
}

export interface KnifeRunResult {
  /** Authoritative score (points) before the first fatal throw. */
  score: number;
  /** Stages fully cleared before the first fatal throw. */
  stagesCleared: number;
  /** Stage index reached (0-based). */
  stageReached: number;
  /** How many throws were inspected before scoring stopped. */
  inspected: number;
  /** Why scoring stopped: 'shatter' (a knife hit another), 'bounds' (a throw's
   *  `t` was non-finite/negative/over the ceiling), 'cap' (hit KNIFE_MAX_STAGES),
   *  or 'end' (ran out of throws with no shatter). */
  stop: 'shatter' | 'bounds' | 'cap' | 'end';
  /** Absolute-timeline ms of every COUNTED throw, for anti-cheat action streams. */
  throwTimesAbs: number[];
}

/**
 * Re-derive the authoritative run from a submitted throw list by replaying every
 * throw through the same `knifeApplyThrow` state machine the client ran. The
 * FIRST fatal throw (shatter / bounds) ends the run; under-cadence taps are
 * skipped exactly as the client skips them. Pure and never throws — bad input
 * simply stops scoring. Schedules + boards are cached per stage.
 */
export function validateKnifeRun(
  seed: number,
  throws: readonly KnifeThrow[],
): KnifeRunResult {
  if (!Array.isArray(throws) || throws.length === 0) {
    return { score: 0, stagesCleared: 0, stageReached: 0, inspected: 0, stop: 'end', throwTimesAbs: [] };
  }

  const safeSeed = seed | 0;
  let state = knifeInitialState(safeSeed);
  let inspected = 0;
  const throwTimesAbs: number[] = [];

  // Cache the current stage's schedule + board so we don't rebuild per throw.
  let cachedStage = state.stage;
  let schedule = knifeStageSchedule(safeSeed, cachedStage);
  let board = knifeStageBoard(safeSeed, cachedStage);

  for (let i = 0; i < throws.length && i < KNIFE_MAX_TAPS; i += 1) {
    if (state.stage >= KNIFE_MAX_STAGES) {
      return {
        score: state.score,
        stagesCleared: state.stagesCleared,
        stageReached: state.stage,
        inspected,
        stop: 'cap',
        throwTimesAbs,
      };
    }
    inspected = i + 1;

    if (state.stage !== cachedStage) {
      cachedStage = state.stage;
      schedule = knifeStageSchedule(safeSeed, cachedStage);
      board = knifeStageBoard(safeSeed, cachedStage);
    }

    const th = throws[i];
    const t = typeof th?.t === 'number' ? th.t : NaN;
    const applied = knifeApplyThrow(safeSeed, state, t, schedule, board);

    if (applied.event.type === 'bounds') {
      return {
        score: state.score,
        stagesCleared: state.stagesCleared,
        stageReached: state.stage,
        inspected,
        stop: 'bounds',
        throwTimesAbs,
      };
    }
    if (applied.event.type === 'shatter') {
      return {
        score: state.score,
        stagesCleared: state.stagesCleared,
        stageReached: state.stage,
        inspected,
        stop: 'shatter',
        throwTimesAbs,
      };
    }
    if (applied.event.type === 'stick') {
      throwTimesAbs.push(applied.state.lastCountedAbs);
    }
    state = applied.state;
  }

  return {
    score: state.score,
    stagesCleared: state.stagesCleared,
    stageReached: state.stage,
    inspected,
    stop: 'end',
    throwTimesAbs,
  };
}
