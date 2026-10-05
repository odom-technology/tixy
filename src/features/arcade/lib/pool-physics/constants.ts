// ---------------------------------------------------------------------------
// Physics and table constants for 8-ball pool.
//
// All values calibrated from research on real pool physics:
// - Dr. Dave Pool (drdavepoolinfo.com/faq/physics)
// - Evan Kiefl Pooltool theory (ekiefl.github.io)
// - WPA rules/equipment specifications
// - Mathavan et al. cushion impact analysis
// ---------------------------------------------------------------------------

import type { Vec2 } from './types';

// ── Table dimensions (internal coordinate system) ─────────────────────────
// We model a WPA 9-foot table:
// - Playing surface (nose-to-nose): 100" x 50" (2:1)
// - Ball diameter: 2.25"
// Internal units are pixels.
export const TABLE_WIDTH = 1500;
export const CUSHION_WIDTH = 57;
export const PLAYING_SURFACE_WIDTH = TABLE_WIDTH - CUSHION_WIDTH * 2;
const PLAYING_SURFACE_HEIGHT = PLAYING_SURFACE_WIDTH / 2;
export const TABLE_HEIGHT = PLAYING_SURFACE_HEIGHT + CUSHION_WIDTH * 2;

// ── Ball geometry ─────────────────────────────────────────────────────────
const OFFICIAL_PLAYING_SURFACE_WIDTH_IN = 100;
const OFFICIAL_BALL_DIAMETER_IN = 2.25;
export const BALL_DIAMETER =
  PLAYING_SURFACE_WIDTH *
  (OFFICIAL_BALL_DIAMETER_IN / OFFICIAL_PLAYING_SURFACE_WIDTH_IN);
export const BALL_RADIUS = BALL_DIAMETER / 2;

// ── Pocket geometry ───────────────────────────────────────────────────────
// Corner/side pocket trigger zones (side pockets slightly larger).
const CORNER_POCKET_RADIUS = BALL_DIAMETER * 1.16;
const SIDE_POCKET_RADIUS = BALL_DIAMETER * 1.26;
// Backward compat
// fallow-ignore-next-line unused-export
export const POCKET_RADIUS = CORNER_POCKET_RADIUS;

const CORNER_POCKET_CENTER_OFFSET = CUSHION_WIDTH + BALL_DIAMETER * 0.13;
const SIDE_POCKET_CENTER_Y = CUSHION_WIDTH - BALL_DIAMETER * 0.76;

/** Six pocket positions: 4 corners + 2 side midpoints. */
export const POCKETS: Array<Vec2 & { radius: number }> = [
  {
    x: CORNER_POCKET_CENTER_OFFSET,
    y: CORNER_POCKET_CENTER_OFFSET,
    radius: CORNER_POCKET_RADIUS,
  },
  { x: TABLE_WIDTH / 2, y: SIDE_POCKET_CENTER_Y, radius: SIDE_POCKET_RADIUS },
  {
    x: TABLE_WIDTH - CORNER_POCKET_CENTER_OFFSET,
    y: CORNER_POCKET_CENTER_OFFSET,
    radius: CORNER_POCKET_RADIUS,
  },
  {
    x: CORNER_POCKET_CENTER_OFFSET,
    y: TABLE_HEIGHT - CORNER_POCKET_CENTER_OFFSET,
    radius: CORNER_POCKET_RADIUS,
  },
  {
    x: TABLE_WIDTH / 2,
    y: TABLE_HEIGHT - SIDE_POCKET_CENTER_Y,
    radius: SIDE_POCKET_RADIUS,
  },
  {
    x: TABLE_WIDTH - CORNER_POCKET_CENTER_OFFSET,
    y: TABLE_HEIGHT - CORNER_POCKET_CENTER_OFFSET,
    radius: CORNER_POCKET_RADIUS,
  },
];

// ── Physics constants ─────────────────────────────────────────────────────

/** Ball-ball coefficient of restitution. */
export const BALL_BALL_COR = 0.96;

/** Ball-cushion coefficient of restitution. */
export const BALL_CUSHION_COR = 0.76;

/** Minimum cushion restitution used by the current speed-scaled rail response. */
export const MIN_BALL_CUSHION_COR = BALL_CUSHION_COR;

/** Rail restitution loses this much per px/frame of incoming speed. */
export const CUSHION_SPEED_COR_FACTOR = 0;

/** Tangential velocity multiplier applied on cushion impact. */
export const CUSHION_TANGENTIAL_DAMPING = 1;

/**
 * Rolling friction deceleration in px/frame.
 *
 * Applied ONCE per visible frame (not per substep).
 * This is CONSTANT deceleration (not proportional damping).
 * speed_new = max(0, speed_old - ROLLING_DECEL)
 *
 * Calibrated for a visibly linear slowdown with a broad cue-speed range.
 */
export const ROLLING_DECEL = 0.06;

/**
 * Speed below which a ball snaps to rest (px/frame).
 * Low enough that the final snap is visually subtle.
 */
export const MIN_VELOCITY = 0.002;

/** Power-curve exponent used to map 0-1 cue input to launch speed. */
export const POWER_CURVE_EXPONENT = 0.94;

/**
 * Extra top-end multiplier applied to near-max shots.
 *
 * Effective speed multiplier:
 *   1 + POWER_HIGH_END_BOOST * power^POWER_HIGH_END_BOOST_EXPONENT
 *
 * This keeps low-power touch shots feeling the same while making full-power
 * breaks more rewarding.
 */
export const POWER_HIGH_END_BOOST = 0.16;

/** Controls how late the top-end boost ramps in. Higher = later ramp. */
export const POWER_HIGH_END_BOOST_EXPONENT = 4;

/**
 * Maximum cue ball speed (at power = 1) in px/frame.
 * Minimum cue ball speed (at low-but-valid power) in px/frame.
 *
 * The power curve is:
 *   baseSpeed = MIN_SHOT_SPEED + power^POWER_CURVE_EXPONENT * (MAX_POWER - MIN_SHOT_SPEED)
 *   speed = baseSpeed * (1 + POWER_HIGH_END_BOOST * power^POWER_HIGH_END_BOOST_EXPONENT)
 */
export const MAX_POWER = 35;

/**
 * Opening-break tuning.
 *
 * Break shots are intentionally a bit more explosive than normal shots so a
 * full-power opening break feels satisfying and actually opens the rack.
 */
export const BREAK_SHOT_POWER_THRESHOLD = 0.82;
export const BREAK_SHOT_SPEED_MULTIPLIER = 1.12;
export const BREAK_CLUSTER_MIN_OBJECT_BALLS = 12;
export const BREAK_CLUSTER_RADIUS = BALL_DIAMETER * 4.9;
export const BREAK_SPREAD_IMPULSE = 1.9;

/** Minimum shot speed — ensures even the softest tap moves the ball visibly. */
export const MIN_SHOT_SPEED = 0.5;

/** Extra positional separation applied after resolving overlapping balls. */
export const BALL_SEPARATION_EPSILON = 0.1;

/** Physics substeps per simulation frame. More = more accurate collisions. */
export const SUBSTEPS = 3;

/** Maximum simulation frames before forced stop (~15 seconds at 60fps). */
export const MAX_SIM_FRAMES = 900;

/** Record a snapshot every N simulation frames for client animation. */
export const SNAPSHOT_INTERVAL = 1;

// ── Spin / English constants ─────────────────────────────────────────────

/** How much cue offset (0-1) translates to initial spin magnitude. */
export const SPIN_STRENGTH = 0.8;

/** How strongly topspin adds follow-through velocity after ball-ball collision. */
export const TOPSPIN_TRANSFER = 0.6;

/** How strongly backspin adds draw-back velocity after ball-ball collision. */
export const BACKSPIN_TRANSFER = 0.7;

/** How strongly sidespin deflects cushion bounce angle (tangential boost). */
export const SIDESPIN_CUSHION_FACTOR = 0.4;

/** How much spin remains on the cue ball after a ball-ball collision (0-1). */
export const SPIN_RETAIN_BALL = 0.3;

/** How much spin remains on the cue ball after a cushion collision (0-1). */
export const SPIN_RETAIN_CUSHION = 0.5;

/** How much sidespin deflects an object ball on contact ("throw"). Very subtle. */
export const THROW_FACTOR = 0.03;

/** How much topspin/backspin affects cushion bounce speed. */
export const SPIN_CUSHION_SPEED_FACTOR = 0.3;

/**
 * Constant spin decay per visible frame (linear, same model as rolling friction).
 *
 * Calibrated so backspin/topspin survives ~30-40% of table width at medium
 * power, matching real pool where draw/follow works from several feet away.
 * Previous value (0.04) killed spin in ~170px (~10% of table), making
 * draw/follow/english almost useless at typical game distances.
 */
export const SPIN_DECAY_RATE = 0.013;

/** Below this absolute value, spin snaps to zero. */
export const MIN_SPIN = 0.01;

// Backward compat exports
const _FRICTION = 0.018; // unused by new engine, kept for imports
const _COLLISION_LOSS = 0.018; // unused by new engine

// ── Table positions ───────────────────────────────────────────────────────
export const HEAD_STRING_X = CUSHION_WIDTH + PLAYING_SURFACE_WIDTH * 0.25;
export const FOOT_SPOT: Vec2 = {
  x: CUSHION_WIDTH + PLAYING_SURFACE_WIDTH * 0.75,
  y: TABLE_HEIGHT / 2,
};
// fallow-ignore-next-line unused-export
export const HEAD_SPOT: Vec2 = { x: HEAD_STRING_X, y: TABLE_HEIGHT / 2 };
export const CUE_BALL_START: Vec2 = { ...HEAD_SPOT };
// 8-ball location inside a legal rack (center ball of row 3).
const _EIGHT_BALL_POS: Vec2 = {
  x: FOOT_SPOT.x + BALL_DIAMETER * Math.sqrt(3),
  y: TABLE_HEIGHT / 2,
};
