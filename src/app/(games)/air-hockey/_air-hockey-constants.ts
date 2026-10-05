// ─────────────────────────────────────────────────────────────────────────
// Air Hockey — shared constants (pure data, no DOM).
//
// All gameplay lives in a fixed "table-space" coordinate system. The canvas
// is sized + dpr-scaled to fill the wide stage; every draw and pointer maps
// back into this BASE_W × BASE_H space so the sim is display-independent.
//
// The rink is portrait-ish (taller than wide) so both half-courts are roomy:
// player A defends the TOP goal, player B (or you, vs-AI) defends the BOTTOM.
// ─────────────────────────────────────────────────────────────────────────

/** Logical table width (table-space px). */
export const BASE_W = 520;
/** Logical table height (table-space px). */
export const BASE_H = 760;

/** Wall thickness — the lacquered wood frame inset where the puck bounces. */
export const WALL = 18;

/** Half-width of each goal mouth (centered on each short wall). */
export const GOAL_HALF = 96;

/** Puck radius (table-space px). */
export const PUCK_R = 17;
/** Mallet (paddle) radius. */
export const MALLET_R = 30;

/** First-to-this wins the match. */
export const WIN_SCORE = 7;

// ── Puck dynamics ──────────────────────────────────────────────────────────
/** Per-second velocity retention (light air-table friction). Applied as
 *  v *= FRICTION^dt so the puck glides but slowly bleeds speed. */
export const PUCK_FRICTION = 0.62;
/** Wall bounce energy retention. */
export const WALL_RESTITUTION = 0.92;
/** Hard ceiling on puck speed (table px / second) — keeps it controllable
 *  and bounds the worst-case sub-step distance for tunnel safety. */
export const PUCK_MAX_SPEED = 1750;
/** Minimum speed (px/s): below this the puck is treated as resting-ish but we
 *  never fully stop it mid-rally (it's the game). */
export const PUCK_MIN_SPEED = 6;
/** Speed (px/s) at which the puck is served after a goal / kickoff. */
export const SERVE_SPEED = 360;

// ── Mallet dynamics ─────────────────────────────────────────────────────────
/** How hard a mallet shoves the puck on contact: the puck inherits this
 *  fraction of the mallet's instantaneous velocity, added to the reflected
 *  component. Tuned so a fast flick sends a real shot. */
export const MALLET_PUSH = 1.15;
/** Extra outward "pop" (px/s) applied along the contact normal on every
 *  mallet hit, so even a stationary mallet deflects the puck cleanly instead
 *  of letting it rest against the face. */
export const MALLET_POP = 130;
/** A mallet may not cross the center line into the opponent's half (minus a
 *  small overlap so you can still strike a puck sitting on the line). */
export const MALLET_CENTER_OVERLAP = MALLET_R * 0.55;

// ── Fixed-timestep + sub-stepping (tunnel prevention) ──────────────────────
/** Physics integrates at a fixed 240 Hz base step. The accumulator decouples
 *  the sim from the render rAF so fast PCs and slow phones share identical
 *  physics (no variable-dt tunneling). */
export const PHYSICS_HZ = 240;
export const FIXED_DT = 1 / PHYSICS_HZ; // seconds
export const FIXED_DT_MS = 1000 / PHYSICS_HZ;
/** Max physics steps per rendered frame — caps catch-up after a tab-switch so
 *  we never spiral. Leftover accumulated time is dropped. */
export const MAX_STEPS_PER_FRAME = 12;

/** Within ONE fixed step, the puck is further sub-stepped so that no single
 *  integration advance exceeds this distance (table px). At PUCK_MAX_SPEED a
 *  240Hz step would move the puck ~7.3px; we cap each micro-move well under
 *  the puck radius so it can never skip past a mallet/wall (swept-safe). */
export const MAX_SUBSTEP_DIST = PUCK_R * 0.5;

// ── Serve direction ─────────────────────────────────────────────────────────
/** After a goal the puck is served toward the player who was scored ON
 *  (the conceding side gets possession), at a shallow random angle. */
export const SERVE_SPREAD = 0.5; // radians of horizontal jitter on the serve

// ── Difficulty profiles for the AI (top mallet in vs-AI mode) ───────────────
export type Difficulty = 'easy' | 'medium' | 'hard';

export type AiProfile = {
  /** Fraction of the gap to its target the AI closes per second (higher =
   *  snappier tracking). Modeled as an exponential approach. */
  speed: number;
  /** Max mallet speed the AI can move at (px/s) — a hard cap so it feels
   *  physical, not teleporting. */
  maxSpeed: number;
  /** Reaction latency (seconds): the AI steers toward where the puck WAS this
   *  many seconds ago, so it can be beaten by a quick redirect. */
  reaction: number;
  /** Random aim error added to its chosen target (table px stddev-ish). */
  jitter: number;
  /** How far in front of the puck it leads when attacking (0 = just chase). */
  anticipation: number;
  /** Defensive line as a fraction of its half-height from its own goal — the
   *  resting "home" depth it guards from when the puck is far. */
  guardDepth: number;
};

export const AI_PROFILES: Record<Difficulty, AiProfile> = {
  easy: {
    speed: 6.5,
    maxSpeed: 520,
    reaction: 0.16,
    jitter: 34,
    anticipation: 0.0,
    guardDepth: 0.30,
  },
  medium: {
    speed: 10,
    maxSpeed: 760,
    reaction: 0.09,
    jitter: 18,
    anticipation: 0.10,
    guardDepth: 0.34,
  },
  hard: {
    speed: 15,
    maxSpeed: 1040,
    reaction: 0.045,
    jitter: 7,
    anticipation: 0.18,
    guardDepth: 0.40,
  },
};

// ── Modes ───────────────────────────────────────────────────────────────────
export type GameMode = 'local' | 'ai';

// ── Derived play bounds (the area the PUCK CENTER may occupy) ────────────────
export const FIELD_LEFT = WALL + PUCK_R;
export const FIELD_RIGHT = BASE_W - WALL - PUCK_R;
export const FIELD_TOP = WALL + PUCK_R;
export const FIELD_BOTTOM = BASE_H - WALL - PUCK_R;
/** Goal mouth x-extent (centered). */
export const GOAL_X_MIN = BASE_W / 2 - GOAL_HALF;
export const GOAL_X_MAX = BASE_W / 2 + GOAL_HALF;
/** A goal is counted once the puck CENTER passes fully beyond the goal line
 *  (its leading edge is inside the net). */
export const GOAL_LINE_TOP = WALL - PUCK_R; // center y above this = top goal
export const GOAL_LINE_BOTTOM = BASE_H - WALL + PUCK_R; // below this = bottom goal
