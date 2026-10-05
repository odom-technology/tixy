/**
 * Skee-Ball: the pure, deterministic alley-roller sim and the run validator.
 *
 * One engine for both sides. The client steps it live, at the fixed step,
 * and draws the ball between steps; the score route replays the recorded
 * release params through the same steps. Same (aim, power) gives the same
 * path and the same ring on both sides, at any display rate.
 *
 * Rules 3 (tixy rev. 2, tuned). A real alley roller, scaled so one unit is
 * 0.345 m (the ball is a 7.6 cm ball, radius 0.11):
 *
 *  1. LANE. The ball rolls 5.2 units (1.8 m) of flat lane, then a curved
 *     hump of radius 1.8 that turns it up to 38 degrees at the lip. A rolling
 *     solid sphere accelerates at 5/7 of the slope's pull, and loses speed to
 *     rolling resistance. Too slow, it stalls on the hump and rolls back.
 *  2. AIR. Off the lip it flies under full gravity (9.8 m/s^2, 28.4 units)
 *     over a gap. Falling into the gap is a dead ball.
 *  3. TARGET. An inclined ball box (20 degrees), set below the lip. Concentric ring walls (20,
 *     30, 40, and the 50 cup's collar) stand 0.13 tall with rounded tops; the 100s are flush.
 *     The ball bounces on landing, glances off any wall top it comes down
 *     on, rolls, rattles off the walls, and drops into the hole at the
 *     bottom of whichever ring holds it: 50 in the cup, 40, 30 and 20 at the
 *     bottom of their bands, 10 in the slot across the bottom of the box,
 *     100 in the two pockets in the top corners. A ball over the back wall
 *     is dead.
 *
 * Depth (seeded, replay-checked): each ball has one LIT ring from the
 * session seed; landing it pays x2 (x3 on a seeded share of late balls).
 * Each 100 pocket adds a bonus ball, at most 3, so a frame is 9 to 12 balls.
 *
 * Determinism: a fixed 240 Hz step of + - * / and Math.sqrt over IEEE
 * doubles. No Math.sin or Math.cos at runtime (their last bit can differ
 * between JavaScript engines): the hump's angle uses a fixed polynomial and
 * the board's angle is a literal. No Date.now(), no Math.random(), no I/O.
 *
 * Anti-cheat: the server trusts only the release params and their times.
 * Params are clamped inside the sim on both sides; under-cadence throws are
 * ignored on both sides; non-finite params or a bad timeline stop scoring.
 */

// ---------------------------------------------------------------------------
// Rules and constants (exported so the route, the client and tools agree)
// ---------------------------------------------------------------------------

/** Bumped when the physics or the scoring changes. */
export const SKEE_RULES_VERSION = 3;

/** Balls in a frame before any bonus ball. */
export const SKEE_BALLS_PER_SESSION = 9;
/** Bonus balls a frame can earn (one per 100 pocket). */
export const SKEE_MAX_BONUS_BALLS = 3;
/** The most balls a frame can have. */
export const SKEE_MAX_BALLS = SKEE_BALLS_PER_SESSION + SKEE_MAX_BONUS_BALLS;

/** Fixed integrator step (seconds). Client and server step identically. */
export const SKEE_SIM_DT = 1 / 240;

/** Metres per world unit: the 7.6 cm ball has radius 0.11. */
export const SKEE_UNIT_M = 0.345;
/** Gravity: 9.8 m/s^2 in world units. */
export const SKEE_GRAVITY = 28.4;
/** Ball radius (world units). */
export const SKEE_BALL_R = 0.11;
/** A rolling solid sphere feels 5/7 of a tangential force (I = 2/5 m r^2). */
const ROLL_K = 5 / 7;

// ── Lane: flat run, then a circular hump up to the lip ──

/** Lane half-width (to the inside of the rails). */
export const SKEE_LANE_HALF = 0.95;
/** Arc length of the flat run (the hump starts here). */
export const SKEE_S_FLAT = 5.2;
/** Radius of the hump. */
export const SKEE_HUMP_R = 1.8;
/** The lip's angle above horizontal (radians, about 38 degrees). */
export const SKEE_HUMP_ANGLE = 0.66;
/** Arc length at the lip. */
export const SKEE_S_LIP = SKEE_S_FLAT + SKEE_HUMP_R * SKEE_HUMP_ANGLE;
/** Rolling resistance coefficient (lacquered wood, hard ball). */
export const SKEE_ROLL_RESIST = 0.03;
/** Restitution off a lane rail. */
export const SKEE_RAIL_BOUNCE = 0.4;

/** sin and cos by fixed polynomials (|a| <= 0.7): identical everywhere. */
function polySin(a: number): number {
  const a2 = a * a;
  return a * (1 - (a2 / 6) * (1 - (a2 / 20) * (1 - (a2 / 42) * (1 - a2 / 72))));
}
function polyCos(a: number): number {
  const a2 = a * a;
  return 1 - (a2 / 2) * (1 - (a2 / 12) * (1 - (a2 / 30) * (1 - (a2 / 56) * (1 - a2 / 90))));
}

const LIP_SIN = polySin(SKEE_HUMP_ANGLE);
const LIP_COS = polyCos(SKEE_HUMP_ANGLE);
/** Lip height and down-lane position (of the surface). */
export const SKEE_Y_LIP = SKEE_HUMP_R * (1 - LIP_COS);
export const SKEE_Z_LIP = SKEE_S_FLAT + SKEE_HUMP_R * LIP_SIN;

/** Lane surface at arc length s: height, down-lane position, slope sin/cos. */
export function skeeLanePoint(s: number): { y: number; z: number; sin: number; cos: number } {
  if (s <= SKEE_S_FLAT) return { y: 0, z: s, sin: 0, cos: 1 };
  const a = Math.min(s, SKEE_S_LIP) - SKEE_S_FLAT;
  const ang = a / SKEE_HUMP_R;
  const sn = polySin(ang);
  const cs = polyCos(ang);
  return { y: SKEE_HUMP_R * (1 - cs), z: SKEE_S_FLAT + SKEE_HUMP_R * sn, sin: sn, cos: cs };
}
/** Kept for the scene builder: lane surface height at arc length s. */
export function skeeLaneHeight(s: number): number {
  return skeeLanePoint(s).y;
}
/** Kept for the scene builder: lane surface down-lane position at s. */
export function skeeLaneZ(s: number): number {
  return skeeLanePoint(s).z;
}

// ── The gap and the ball box (the inclined target board) ──

/** Down-lane gap from the lip to the bottom edge of the board. */
export const SKEE_FIELD_GAP = 0.35;
/** Floor of the gap (a ball below this is in the gutter). */
export const SKEE_GAP_FLOOR_Y = -0.25;
/** Board incline: 20 degrees, as literals. */
export const SKEE_BOARD_SIN = 0.3420201433256687;
export const SKEE_BOARD_COS = 0.9396926207859084;
/** Rise per unit down-lane, for the scene builder. */
export const SKEE_FIELD_SLOPE = SKEE_BOARD_SIN / SKEE_BOARD_COS;
/** Board bottom edge: down-lane position and height. */
export const SKEE_FIELD_Z0 = SKEE_Z_LIP + SKEE_FIELD_GAP;
export const SKEE_FIELD_Y0 = SKEE_Y_LIP - 0.3;
/** Board length up the slope, and its half-width. */
export const SKEE_FIELD_W_BACK = 2.9;
export const SKEE_BOARD_HALF = 1.3;
/** Wall heights above the board: rings, box sides, back wall. */
export const SKEE_RING_WALL_H = 0.13;
export const SKEE_SIDE_WALL_H = 0.7;
export const SKEE_BACK_WALL_H = 1.2;
/** Half the thickness of a ring wall. */
export const SKEE_RING_WALL_HALF = 0.015;

/** Ring centre (field coords: x across, w up the board). */
export const SKEE_W_CENTER = 1.45;
/** Ring wall radii, centre outward: the 50 cup's collar, then 40, 30, 20. */
export const SKEE_R50 = 0.2;
export const SKEE_R40 = 0.47;
export const SKEE_R30 = 0.74;
export const SKEE_R20 = 1.0;
/** Hole capture radii: the ball's centre must come within these. */
export const SKEE_HOLE50_CAPTURE = 0.145;
export const SKEE_HOLE_CAPTURE = 0.15;
/** Each band's hole sits at the bottom of the band. */
export const SKEE_HOLE40_W = SKEE_W_CENTER - (SKEE_R50 + SKEE_R40) / 2;
export const SKEE_HOLE30_W = SKEE_W_CENTER - (SKEE_R40 + SKEE_R30) / 2;
export const SKEE_HOLE20_W = SKEE_W_CENTER - (SKEE_R30 + SKEE_R20) / 2;
/** Below this, a rolling ball drops through the 10 slot. */
export const SKEE_SLOT10_W = 0.16;
/** Faster than this along the board, a ball skips across a hole. */
export const SKEE_CAPTURE_SPEED = 7;
/** The two 100 pockets in the top corners: flush holes (no collar, so
 *  nothing can wedge a ball beside them), drawn radius, and capture. */
export const SKEE_POCKET_X = 0.95;
export const SKEE_POCKET_W = 2.6;
export const SKEE_POCKET_R = 0.17;
export const SKEE_POCKET_CAPTURE = 0.13;

/** Restitution: landing on the board, off ring walls, off the box. */
export const SKEE_BOARD_BOUNCE = 0.32;
export const SKEE_WALL_BOUNCE = 0.45;
export const SKEE_BOX_BOUNCE = 0.4;
/** Restitution off the rounded top of a ring wall. */
export const SKEE_CROWN_BOUNCE = 0.1;
/** A landing slower than this (normal speed) stops bouncing and rolls. */
const SETTLE_SPEED = 0.35;
/** A ball still on the board after this long is scored by where it is. */
const MAX_BOARD_STEPS = 8 * 240;

/** Ring point values. */
export const SKEE_RING_VALUES = [10, 20, 30, 40, 50, 100] as const;
export type SkeeRing = (typeof SKEE_RING_VALUES)[number];

// ── Release params (client clamps to these; the sim re-clamps identically) ──

/** Launch speed range (units/s): 1.7 to 3.6 m/s off the hand. The slowest
 *  roll stalls on the hump; the hardest lands just past the 50 cup and drops
 *  back into the 40 or 30 band (rules 3; it was 4.5 to 12.5, and the top
 *  quarter flew the board and dribbled down to the 10). */
export const SKEE_MIN_POWER = 5.0;
export const SKEE_MAX_POWER = 10.4;
/** Strongest sideways speed (units/s), left or right. */
export const SKEE_MAX_AIM = 1.6;

// ── Lit-ring multiplier schedule (seeded) ──

export const SKEE_BONUS_MULT = 2;
export const SKEE_HOT_MIN_INDEX = 6;
export const SKEE_HOT_CHANCE = 0.3;
export const SKEE_HOT_MULT = 3;

// ── Cadence / ceilings ──

/** Minimum spacing between consecutive counted throws (ms). */
export const SKEE_MIN_THROW_INTERVAL_MS = 1_000;
/** A gap longer than this between throws ends the run (ms). */
export const SKEE_MAX_GAP_MS = 120_000;
/** Absolute ceiling on the throw payload (12 balls + headroom). */
export const SKEE_MAX_THROWS = SKEE_MAX_BALLS + 4;
/** Highest points a single throw can pay (a x3 lit 100 pocket). */
export const SKEE_MAX_POINTS_PER_THROW = 100 * SKEE_HOT_MULT;
/** Absolute ceiling on the score of one run. */
export const SKEE_MAX_SCORE = SKEE_MAX_BALLS * SKEE_MAX_POINTS_PER_THROW;

// ---------------------------------------------------------------------------
// PRNG: mulberry32, byte-identical to the repo's seededRandom.
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

function rngForIndex(seed: number, index: number): () => number {
  let mixed = (seed ^ Math.imul(index + 1, 0x9e3779b1)) | 0;
  mixed = (mixed + 0x6d2b79f5) | 0;
  return mulberry32(mixed);
}

export interface SkeeBonus {
  ring: SkeeRing;
  mult: number;
}

/** Deterministic lit-ring draw for a seed and ball index (draw order fixed). */
export function skeeBallBonusFor(seed: number, ballIndex: number): SkeeBonus {
  const safeSeed = seed | 0;
  const safeIndex = ballIndex < 0 ? 0 : Math.floor(ballIndex);
  const rng = rngForIndex(safeSeed, safeIndex);
  const ring = SKEE_RING_VALUES[
    Math.min(SKEE_RING_VALUES.length - 1, Math.floor(rng() * SKEE_RING_VALUES.length))
  ];
  const hot = safeIndex >= SKEE_HOT_MIN_INDEX && rng() < SKEE_HOT_CHANCE;
  return { ring, mult: hot ? SKEE_HOT_MULT : SKEE_BONUS_MULT };
}

/**
 * Today's target score: one number a day for everyone, from the UTC date
 * ('YYYY-MM-DD'), 350 to 550 in steps of 10. Rules 3's mean frame by
 * skill is 408 (first go) to 1010 (sharp), so the target sits between a
 * first-go frame and a casual one (507). It pays nothing extra.
 */
export function skeeDailyTarget(dateKey: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < dateKey.length; i += 1) {
    h ^= dateKey.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  const rng = mulberry32(h);
  return 350 + Math.floor(rng() * 21) * 10;
}

/** The UTC date key the daily target uses. */
export function skeeDateKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Board geometry helpers (shared by the sim and the scene builder)
// ---------------------------------------------------------------------------

/** Board plane height at down-lane position z (for z >= SKEE_FIELD_Z0). */
export function skeeFieldY(z: number): number {
  return SKEE_FIELD_Y0 + (z - SKEE_FIELD_Z0) * SKEE_FIELD_SLOPE;
}

/** Field coords (x across, w up the board, h above it) to world (y, z). */
export function skeeFieldToWorld(x: number, w: number, h = 0): { x: number; y: number; z: number } {
  return {
    x,
    y: SKEE_FIELD_Y0 + w * SKEE_BOARD_SIN + h * SKEE_BOARD_COS,
    z: SKEE_FIELD_Z0 + w * SKEE_BOARD_COS - h * SKEE_BOARD_SIN,
  };
}

/** Kept for the scene builder: the board's top edge, down-lane. */
export const SKEE_FIELD_Z_BACK = SKEE_FIELD_Z0 + SKEE_FIELD_W_BACK * SKEE_BOARD_COS;

/** Every circular wall on the board: centre, radius, the ring it bounds.
 *  Concentric, so no two walls ever pinch a ball between them. */
export const SKEE_BOARD_WALLS: ReadonlyArray<{ x: number; w: number; r: number; ring: SkeeRing }> = [
  { x: 0, w: SKEE_W_CENTER, r: SKEE_R50, ring: 50 },
  { x: 0, w: SKEE_W_CENTER, r: SKEE_R40, ring: 40 },
  { x: 0, w: SKEE_W_CENTER, r: SKEE_R30, ring: 30 },
  { x: 0, w: SKEE_W_CENTER, r: SKEE_R20, ring: 20 },
];

/**
 * Every scoring hole: centre, capture radius, and whether it is a cup (the
 * 50 and the 100s have no floor inside their collar, so any touchdown in
 * them drops) or a hole at the bottom of a band (a fast ball skips it).
 * The 10 is the slot across the bottom of the box.
 */
export const SKEE_BOARD_HOLES: ReadonlyArray<{ x: number; w: number; capture: number; cup: boolean; ring: SkeeRing }> = [
  { x: -SKEE_POCKET_X, w: SKEE_POCKET_W, capture: SKEE_POCKET_CAPTURE, cup: false, ring: 100 },
  { x: SKEE_POCKET_X, w: SKEE_POCKET_W, capture: SKEE_POCKET_CAPTURE, cup: false, ring: 100 },
  { x: 0, w: SKEE_W_CENTER, capture: SKEE_HOLE50_CAPTURE, cup: true, ring: 50 },
  { x: 0, w: SKEE_HOLE40_W, capture: SKEE_HOLE_CAPTURE, cup: false, ring: 40 },
  { x: 0, w: SKEE_HOLE30_W, capture: SKEE_HOLE_CAPTURE, cup: false, ring: 30 },
  { x: 0, w: SKEE_HOLE20_W, capture: SKEE_HOLE_CAPTURE, cup: false, ring: 20 },
];

/** The ring a point on the board belongs to (for the time-out only). */
function ringAt(x: number, w: number): SkeeRing {
  for (const pocketX of [-SKEE_POCKET_X, SKEE_POCKET_X]) {
    const dx = x - pocketX;
    const dw = w - SKEE_POCKET_W;
    if (dx * dx + dw * dw <= SKEE_POCKET_R * SKEE_POCKET_R) return 100;
  }
  const dw = w - SKEE_W_CENTER;
  const d = Math.sqrt(x * x + dw * dw);
  if (d <= SKEE_R50) return 50;
  if (d <= SKEE_R40) return 40;
  if (d <= SKEE_R30) return 30;
  if (d <= SKEE_R20) return 20;
  return 10;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

// ---------------------------------------------------------------------------
// The ball: a stepper the client runs live and the server runs to the end
// ---------------------------------------------------------------------------

export type SkeeOutcomeKind =
  /** Dropped into a ring (or a pocket): `ring` carries the value. */
  | 'ring'
  /** Stalled on the hump, or fell into the gap: dead ball. */
  | 'short'
  /** Cleared the back wall: dead ball. */
  | 'over';

export interface SkeeOutcome {
  kind: SkeeOutcomeKind;
  ring: SkeeRing | null;
  basePoints: number;
  /** First touchdown on the board (field coords), or null. */
  landing: { x: number; w: number } | null;
}

export type SkeePhase =
  /** Rolling up the lane and the hump. */
  | 'lane'
  /** Stalled on the hump and rolling back toward the hand. */
  | 'rollback'
  /** Off the lip, over the gap. */
  | 'air'
  /** Over or on the ball box (airborne or rolling, in field coords). */
  | 'board'
  /** Fell into the gap. */
  | 'gutter'
  /** Decided. The sim has stopped. */
  | 'done';

/** Things a step can report, for sound and motion on the client. */
export type SkeeStepEvent =
  | { kind: 'lip'; speed: number }
  | { kind: 'land'; speed: number }
  | { kind: 'bounce'; speed: number }
  | { kind: 'wall'; speed: number; ring: SkeeRing }
  | { kind: 'box'; speed: number }
  | { kind: 'rail'; speed: number }
  | { kind: 'decided'; outcome: SkeeOutcome };

export interface SkeeBallState {
  phase: SkeePhase;
  steps: number;
  /** Lane: arc length and speed along it. */
  s: number;
  vs: number;
  /** World position of the ball's centre, and its velocity. */
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Board: field coords, height above the board, and their velocities. */
  w: number;
  h: number;
  vw: number;
  vh: number;
  /** True while the ball is touching a surface (it rolls, not flies). */
  contact: boolean;
  boardSteps: number;
  landing: { x: number; w: number } | null;
  outcome: SkeeOutcome | null;
}

/** A ball at the hand, released with the given params (clamped inside). */
export function skeeStartThrow(aim: number, power: number): SkeeBallState {
  const vx = clamp(Number.isFinite(aim) ? aim : 0, -SKEE_MAX_AIM, SKEE_MAX_AIM);
  const vs = clamp(Number.isFinite(power) ? power : 0, SKEE_MIN_POWER, SKEE_MAX_POWER);
  return {
    phase: 'lane',
    steps: 0,
    s: 0,
    vs,
    x: 0,
    y: SKEE_BALL_R,
    z: 0,
    vx,
    vy: 0,
    vz: vs,
    w: 0,
    h: 0,
    vw: 0,
    vh: 0,
    contact: true,
    boardSteps: 0,
    landing: null,
    outcome: null,
  };
}

function decide(state: SkeeBallState, kind: SkeeOutcomeKind, ring: SkeeRing | null): SkeeStepEvent {
  const outcome: SkeeOutcome = {
    kind,
    ring,
    basePoints: ring ?? 0,
    landing: state.landing,
  };
  state.outcome = outcome;
  return { kind: 'decided', outcome };
}

/** Field coords to the world position of the ball's centre. */
function syncBoardWorld(state: SkeeBallState): void {
  const r = SKEE_BALL_R + state.h;
  state.y = SKEE_FIELD_Y0 + state.w * SKEE_BOARD_SIN + r * SKEE_BOARD_COS;
  state.z = SKEE_FIELD_Z0 + state.w * SKEE_BOARD_COS - r * SKEE_BOARD_SIN;
  state.vy = state.vw * SKEE_BOARD_SIN + state.vh * SKEE_BOARD_COS;
  state.vz = state.vw * SKEE_BOARD_COS - state.vh * SKEE_BOARD_SIN;
}

function syncLaneWorld(state: SkeeBallState): void {
  const p = skeeLanePoint(state.s);
  // The centre sits one radius along the surface normal.
  state.y = p.y + SKEE_BALL_R * p.cos;
  state.z = p.z - SKEE_BALL_R * p.sin;
  state.vy = state.vs * p.sin;
  state.vz = state.vs * p.cos;
}

/**
 * Advance one fixed step. Mutates `state` and returns what happened, or
 * null. Pure otherwise: the same state steps the same way everywhere.
 */
export function skeeStep(state: SkeeBallState, events?: SkeeStepEvent[]): void {
  if (state.phase === 'done') return;
  const dt = SKEE_SIM_DT;
  const g = SKEE_GRAVITY;
  const push = (event: SkeeStepEvent) => {
    if (events) events.push(event);
  };
  state.steps += 1;

  if (state.phase === 'lane' || state.phase === 'rollback') {
    const p = skeeLanePoint(state.s);
    const dir = state.vs >= 0 ? 1 : -1;
    // Slope pull and rolling resistance, both felt at 5/7 by a rolling ball.
    state.vs -= ROLL_K * g * (p.sin + dir * SKEE_ROLL_RESIST * p.cos) * dt;
    if (state.phase === 'lane' && state.vs <= 0) {
      state.phase = 'rollback';
      push(decide(state, 'short', null));
    }
    state.s += state.vs * dt;
    state.x += state.vx * dt;
    const rail = SKEE_LANE_HALF - SKEE_BALL_R;
    if (state.x > rail || state.x < -rail) {
      state.x = state.x > 0 ? rail : -rail;
      push({ kind: 'rail', speed: Math.abs(state.vx) });
      state.vx = -state.vx * SKEE_RAIL_BOUNCE;
    }
    if (state.phase === 'rollback') {
      // Off the hump: the client rolls it the rest of the way home.
      if (state.s <= SKEE_S_FLAT - 0.4) {
        state.s = SKEE_S_FLAT - 0.4;
        state.phase = 'done';
      }
      syncLaneWorld(state);
      return;
    }
    if (state.s >= SKEE_S_LIP) {
      // Off the lip.
      state.s = SKEE_S_LIP;
      syncLaneWorld(state);
      state.phase = 'air';
      state.contact = false;
      push({ kind: 'lip', speed: state.vs });
      return;
    }
    syncLaneWorld(state);
    return;
  }

  if (state.phase === 'air' || state.phase === 'gutter') {
    state.vy -= g * dt;
    state.x += state.vx * dt;
    state.y += state.vy * dt;
    state.z += state.vz * dt;
    const side = SKEE_BOARD_HALF - SKEE_BALL_R;
    if (state.x > side || state.x < -side) {
      state.x = state.x > 0 ? side : -side;
      push({ kind: 'box', speed: Math.abs(state.vx) });
      state.vx = -state.vx * SKEE_BOX_BOUNCE;
    }
    if (state.phase === 'gutter') {
      if (state.y <= SKEE_GAP_FLOOR_Y + SKEE_BALL_R) {
        state.y = SKEE_GAP_FLOOR_Y + SKEE_BALL_R;
        state.phase = 'done';
      }
      return;
    }
    if (state.z >= SKEE_FIELD_Z0) {
      // Over the box: switch to field coords.
      const dy = state.y - SKEE_FIELD_Y0;
      const dz = state.z - SKEE_FIELD_Z0;
      const w = dy * SKEE_BOARD_SIN + dz * SKEE_BOARD_COS;
      const n = dy * SKEE_BOARD_COS - dz * SKEE_BOARD_SIN;
      if (n < SKEE_BALL_R) {
        // Met the board's front edge: it drops into the gap.
        state.vz = -state.vz * 0.3;
        state.phase = 'gutter';
        push({ kind: 'box', speed: Math.abs(state.vz) });
        push(decide(state, 'short', null));
        return;
      }
      state.w = w;
      state.h = n - SKEE_BALL_R;
      state.vw = state.vy * SKEE_BOARD_SIN + state.vz * SKEE_BOARD_COS;
      state.vh = state.vy * SKEE_BOARD_COS - state.vz * SKEE_BOARD_SIN;
      state.phase = 'board';
      return;
    }
    if (state.y <= SKEE_FIELD_Y0) {
      // Below the lip before the box: into the gap.
      state.phase = 'gutter';
      push(decide(state, 'short', null));
    }
    return;
  }

  // ── Board: field coords (x, w, h) ──
  state.boardSteps += 1;
  if (state.contact) {
    // Rolling: 5/7 of the slope, and rolling resistance against the motion.
    const speed = Math.sqrt(state.vx * state.vx + state.vw * state.vw);
    const resist = ROLL_K * SKEE_ROLL_RESIST * g * SKEE_BOARD_COS * dt;
    if (speed > resist) {
      state.vx -= (state.vx / speed) * resist;
      state.vw -= (state.vw / speed) * resist;
    } else {
      state.vx = 0;
      state.vw = 0;
    }
    state.vw -= ROLL_K * g * SKEE_BOARD_SIN * dt;
    state.vh = 0;
  } else {
    state.vw -= g * SKEE_BOARD_SIN * dt;
    state.vh -= g * SKEE_BOARD_COS * dt;
  }
  state.x += state.vx * dt;
  state.w += state.vw * dt;
  state.h += state.vh * dt;

  if (state.h <= 0 && !state.contact) {
    state.h = 0;
    const impact = -state.vh;
    if (!state.landing) {
      state.landing = { x: state.x, w: state.w };
      push({ kind: 'land', speed: impact });
    } else if (impact > SETTLE_SPEED) {
      push({ kind: 'bounce', speed: impact });
    }
    if (impact > SETTLE_SPEED) {
      state.vh = impact * SKEE_BOARD_BOUNCE;
      // A bounce scrubs a little of the speed along the board.
      state.vx *= 0.94;
      state.vw *= 0.94;
    } else {
      state.vh = 0;
      state.contact = true;
    }
  }

  // Box: sides and back wall.
  const side = SKEE_BOARD_HALF - SKEE_BALL_R;
  if ((state.x > side || state.x < -side) && state.h < SKEE_SIDE_WALL_H) {
    state.x = state.x > 0 ? side : -side;
    push({ kind: 'box', speed: Math.abs(state.vx) });
    state.vx = -state.vx * SKEE_BOX_BOUNCE;
  }
  const back = SKEE_FIELD_W_BACK - SKEE_BALL_R;
  if (state.w > back) {
    if (state.h >= SKEE_BACK_WALL_H) {
      state.phase = 'done';
      syncBoardWorld(state);
      push(decide(state, 'over', null));
      return;
    }
    state.w = back;
    if (state.vw > 0) {
      push({ kind: 'box', speed: state.vw });
      state.vw = -state.vw * SKEE_BOX_BOUNCE;
    }
  }

  // Ring walls, while the ball is low enough to meet them. A wall is a thin
  // band 0.13 tall with a rounded top (radius: half its thickness). Below
  // the top the ball meets the face and the push is across the board;
  // higher, it meets the rounded top, so the push leans up and a ball coming
  // down on a wall glances off it instead of being shoved sideways in one
  // step.
  if (state.h < SKEE_RING_WALL_H) {
    // Ball centre above the centre of the wall's rounded top.
    const above = state.h + SKEE_BALL_R - (SKEE_RING_WALL_H - SKEE_RING_WALL_HALF);
    const reach = SKEE_BALL_R + SKEE_RING_WALL_HALF;
    for (const wall of SKEE_BOARD_WALLS) {
      const dx = state.x - wall.x;
      const dw = state.w - wall.w;
      const d = Math.sqrt(dx * dx + dw * dw);
      if (d < 1e-9) continue;
      const outside = d > wall.r;
      const across = outside ? d - wall.r : wall.r - d;
      const gap = above > 0 ? Math.sqrt(across * across + above * above) : across;
      if (gap >= reach) continue;
      // The contact normal: across the board, leaning up over the top.
      const na = above > 0 && gap > 1e-9 ? across / gap : 1;
      const nh = above > 0 && gap > 1e-9 ? above / gap : 0;
      const nx = ((outside ? dx : -dx) / d) * na;
      const nw = ((outside ? dw : -dw) / d) * na;
      const depth = reach - gap;
      state.x += nx * depth;
      state.w += nw * depth;
      state.h += nh * depth;
      const vn = state.vx * nx + state.vw * nw + state.vh * nh;
      if (vn < 0) {
        const e = nh > 0 ? SKEE_CROWN_BOUNCE : SKEE_WALL_BOUNCE;
        state.vx -= (1 + e) * vn * nx;
        state.vw -= (1 + e) * vn * nw;
        state.vh -= (1 + e) * vn * nh;
        if (-vn > 0.3) {
          push({ kind: 'wall', speed: -vn, ring: wall.ring });
          // A real knock scrubs a little speed along the wall too.
          state.vx *= 0.92;
          state.vw *= 0.92;
        }
      }
      if (nh > 0) state.contact = false;
      // Resting dead on top of a wall's crown is a balance no real ball
      // holds: tip it off, always to the same side.
      if (
        state.contact &&
        nx < 0.1 &&
        nx > -0.1 &&
        state.vx * state.vx + state.vw * state.vw < 0.04
      ) {
        state.vx += state.x >= wall.x ? 0.2 : -0.2;
      }
    }
  }

  // Holes: a ball touching the board, slow enough not to skip across,
  // drops into the first hole it reaches.
  const boardSpeed2 = state.vx * state.vx + state.vw * state.vw;
  if (state.h <= 0) {
    const slow = boardSpeed2 < SKEE_CAPTURE_SPEED * SKEE_CAPTURE_SPEED;
    for (const hole of SKEE_BOARD_HOLES) {
      if (!hole.cup && !slow) continue;
      const dx = state.x - hole.x;
      const dw = state.w - hole.w;
      if (dx * dx + dw * dw <= hole.capture * hole.capture) {
        state.phase = 'done';
        syncBoardWorld(state);
        push(decide(state, 'ring', hole.ring));
        return;
      }
    }
  }
  if (state.h <= 0) {
    if (state.w <= SKEE_SLOT10_W) {
      state.phase = 'done';
      syncBoardWorld(state);
      push(decide(state, 'ring', 10));
      return;
    }
  }
  if (state.w < -SKEE_BALL_R) {
    // Bounced back off the front of the box, into the gap.
    state.phase = 'gutter';
    syncBoardWorld(state);
    push(decide(state, 'short', null));
    return;
  }
  if (state.boardSteps >= MAX_BOARD_STEPS) {
    state.phase = 'done';
    syncBoardWorld(state);
    push(decide(state, 'ring', ringAt(state.x, state.w)));
    return;
  }
  syncBoardWorld(state);
}

export interface SkeeThrowSim {
  outcome: SkeeOutcome;
  /** Steps until the outcome was decided, and until the sim stopped. */
  decidedSteps: number;
  steps: number;
  /** Sim time to the outcome (ms). */
  durationMs: number;
}

/** Hard cap on steps for one throw (the board time-out ends it sooner). */
const MAX_THROW_STEPS = 16 * 240;

/** Run one throw to its outcome. Pure and deterministic. */
export function skeeSimulateThrow(aim: number, power: number): SkeeThrowSim {
  const state = skeeStartThrow(aim, power);
  const events: SkeeStepEvent[] = [];
  let decidedSteps = -1;
  while (state.outcome === null && state.steps < MAX_THROW_STEPS) {
    skeeStep(state, events);
    if (state.outcome !== null && decidedSteps < 0) decidedSteps = state.steps;
  }
  const outcome: SkeeOutcome = state.outcome ?? { kind: 'short', ring: null, basePoints: 0, landing: null };
  return {
    outcome,
    decidedSteps: decidedSteps < 0 ? state.steps : decidedSteps,
    steps: state.steps,
    durationMs: (decidedSteps < 0 ? state.steps : decidedSteps) * SKEE_SIM_DT * 1000,
  };
}

// ---------------------------------------------------------------------------
// The frame: the one state machine the client and the validator both run
// ---------------------------------------------------------------------------

export interface SkeeSimState {
  /** Balls thrown so far (also the index of the current ball). */
  balls: number;
  /** Balls this frame has: 9, plus one per 100 pocket, at most 12. */
  ballsAllowed: number;
  score: number;
  lastCountedAbs: number;
}

export function skeeInitialState(): SkeeSimState {
  return { balls: 0, ballsAllowed: SKEE_BALLS_PER_SESSION, score: 0, lastCountedAbs: -Infinity };
}

export type SkeeThrowEvent =
  | { type: 'ignored' }
  | { type: 'bounds' }
  | {
      type: 'thrown';
      ballIndex: number;
      outcome: SkeeOutcome;
      bonus: SkeeBonus;
      lit: boolean;
      points: number;
      /** True when this throw earned a bonus ball. */
      bonusBall: boolean;
    };

/**
 * Apply one throw to the frame. Pure: a new state plus what happened. Runs
 * on the client per release and on the server per recorded throw.
 */
export function skeeApplyThrow(
  seed: number,
  state: SkeeSimState,
  t: number,
  aim: number,
  power: number,
): { state: SkeeSimState; event: SkeeThrowEvent } {
  if (
    !Number.isFinite(t) ||
    t < 0 ||
    (state.lastCountedAbs !== -Infinity && t - state.lastCountedAbs > SKEE_MAX_GAP_MS)
  ) {
    return { state, event: { type: 'bounds' } };
  }
  if (state.lastCountedAbs !== -Infinity && t - state.lastCountedAbs < SKEE_MIN_THROW_INTERVAL_MS) {
    return { state, event: { type: 'ignored' } };
  }
  if (state.balls >= state.ballsAllowed) {
    return { state, event: { type: 'ignored' } };
  }

  const ballIndex = state.balls;
  const sim = skeeSimulateThrow(aim, power);
  const bonus = skeeBallBonusFor(seed | 0, ballIndex);
  const lit = sim.outcome.kind === 'ring' && sim.outcome.ring === bonus.ring;
  const points = lit ? sim.outcome.basePoints * bonus.mult : sim.outcome.basePoints;
  const bonusBall = sim.outcome.ring === 100 && state.ballsAllowed < SKEE_MAX_BALLS;

  return {
    state: {
      balls: state.balls + 1,
      ballsAllowed: state.ballsAllowed + (bonusBall ? 1 : 0),
      score: state.score + points,
      lastCountedAbs: t,
    },
    event: { type: 'thrown', ballIndex, outcome: sim.outcome, bonus, lit, points, bonusBall },
  };
}

// ---------------------------------------------------------------------------
// Run validation (server-authoritative scoring)
// ---------------------------------------------------------------------------

export interface SkeeThrow {
  t: number;
  aim: number;
  power: number;
}

export interface SkeeRunResult {
  score: number;
  balls: number;
  /** Balls the frame had by the end (9 plus bonus balls). */
  ballsAllowed: number;
  inspected: number;
  /** 'complete' (every ball the frame had was thrown), 'bounds' (a bad
   *  throw or timeline stopped scoring), or 'end' (ran out of throws). */
  stop: 'complete' | 'bounds' | 'end';
  throwTimesAbs: number[];
}

/**
 * Re-derive the authoritative run from a submitted throw list. Pure and
 * never throws: bad input stops scoring.
 */
export function validateSkeeRun(seed: number, throws: readonly SkeeThrow[]): SkeeRunResult {
  if (!Array.isArray(throws) || throws.length === 0) {
    return { score: 0, balls: 0, ballsAllowed: SKEE_BALLS_PER_SESSION, inspected: 0, stop: 'end', throwTimesAbs: [] };
  }
  let state = skeeInitialState();
  let inspected = 0;
  const throwTimesAbs: number[] = [];
  const result = (stop: SkeeRunResult['stop']): SkeeRunResult => ({
    score: state.score,
    balls: state.balls,
    ballsAllowed: state.ballsAllowed,
    inspected,
    stop,
    throwTimesAbs,
  });

  for (let i = 0; i < throws.length && i < SKEE_MAX_THROWS; i += 1) {
    if (state.balls >= state.ballsAllowed) return result('complete');
    inspected = i + 1;
    const thrown = throws[i];
    const t = typeof thrown?.t === 'number' ? thrown.t : NaN;
    const aim = typeof thrown?.aim === 'number' ? thrown.aim : NaN;
    const power = typeof thrown?.power === 'number' ? thrown.power : NaN;
    if (!Number.isFinite(aim) || !Number.isFinite(power)) return result('bounds');
    const applied = skeeApplyThrow(seed, state, t, aim, power);
    if (applied.event.type === 'bounds') return result('bounds');
    if (applied.event.type === 'thrown') throwTimesAbs.push(t);
    state = applied.state;
  }
  return result(state.balls >= state.ballsAllowed ? 'complete' : 'end');
}
