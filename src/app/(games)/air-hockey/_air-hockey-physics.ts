// ─────────────────────────────────────────────────────────────────────────
// Air Hockey — pure deterministic physics (no DOM, no React).
//
// A single fixed step advances the puck against two walls (with goal mouths)
// and two mallets. The puck is SUB-STEPPED so that no micro-advance is longer
// than MAX_SUBSTEP_DIST (< half the puck radius): at the puck's max speed it
// therefore can never skip past a thin mallet or the wall between frames. Each
// micro-step does discrete wall + circle/circle resolution, so the puck is
// effectively swept and tunneling is impossible.
//
// Mallets are integrated by the caller (input / AI) and passed in with their
// CURRENT position plus the velocity they moved at this step; the puck inherits
// a fraction of that velocity on contact, which is what makes a flick "shoot".
// ─────────────────────────────────────────────────────────────────────────

import {
  BASE_W,
  BASE_H,
  WALL,
  PUCK_R,
  MALLET_R,
  PUCK_FRICTION,
  WALL_RESTITUTION,
  PUCK_MAX_SPEED,
  MALLET_PUSH,
  MALLET_POP,
  MAX_SUBSTEP_DIST,
  GOAL_X_MIN,
  GOAL_X_MAX,
} from './_air-hockey-constants';

export type Vec = { x: number; y: number };

export type Puck = { x: number; y: number; vx: number; vy: number };

/** A mallet as the physics needs it: where it is, and how fast it's moving
 *  (px/s) this step so the puck can pick up momentum. `side` gates which goal
 *  the puck scores in but isn't used by collision. */
export type MalletBody = { x: number; y: number; vx: number; vy: number };

/** Hit events surfaced for sound/juice. Positions are in table-space. */
export type StepEvents = {
  wallHit: boolean;
  malletHit: boolean;
  /** 'top' | 'bottom' if a goal was scored this step (puck entered that net). */
  goal: 'top' | 'bottom' | null;
};

function clampSpeed(p: Puck): void {
  const sp = Math.hypot(p.vx, p.vy);
  if (sp > PUCK_MAX_SPEED) {
    const k = PUCK_MAX_SPEED / sp;
    p.vx *= k;
    p.vy *= k;
  }
}

/** Resolve the puck against ONE mallet (circle/circle). Mutates the puck.
 *  Returns true if they were overlapping (a hit). */
function resolveMallet(p: Puck, m: MalletBody): boolean {
  const dx = p.x - m.x;
  const dy = p.y - m.y;
  const minDist = PUCK_R + MALLET_R;
  let dist = Math.hypot(dx, dy);
  if (dist >= minDist) return false;

  // Contact normal (from mallet center to puck center). Guard the degenerate
  // exactly-concentric case with a deterministic fallback normal.
  let nx: number;
  let ny: number;
  if (dist > 1e-6) {
    nx = dx / dist;
    ny = dy / dist;
  } else {
    nx = 0;
    ny = p.y < BASE_H / 2 ? -1 : 1; // push toward the nearer wall
    dist = 0;
  }

  // 1) Positional correction — pop the puck to the mallet surface so it can
  //    never sit inside / pass through the mallet.
  const overlap = minDist - dist;
  p.x += nx * overlap;
  p.y += ny * overlap;

  // 2) Reflect the puck's velocity component along the normal (only the part
  //    moving INTO the mallet), then add the mallet's push along the normal.
  const vDotN = p.vx * nx + p.vy * ny;
  if (vDotN < 0) {
    p.vx -= 2 * vDotN * nx;
    p.vy -= 2 * vDotN * ny;
  }
  // Mallet momentum transfer: the puck inherits the mallet's velocity
  // projected onto the normal (a moving mallet shoves; a still one only pops).
  const mDotN = m.vx * nx + m.vy * ny;
  if (mDotN > 0) {
    p.vx += nx * mDotN * MALLET_PUSH;
    p.vy += ny * mDotN * MALLET_PUSH;
  }
  // Always give a small outward pop so the puck separates cleanly.
  p.vx += nx * MALLET_POP;
  p.vy += ny * MALLET_POP;

  clampSpeed(p);
  return true;
}

/** Reflect off the four walls, EXCEPT the goal mouths on the top/bottom short
 *  walls. Mutates the puck. Returns true if a wall was hit. */
function resolveWalls(p: Puck): boolean {
  let hit = false;
  const left = WALL + PUCK_R;
  const right = BASE_W - WALL - PUCK_R;
  const top = WALL + PUCK_R;
  const bottom = BASE_H - WALL - PUCK_R;

  // Left / right side walls (full height — no openings).
  if (p.x < left) {
    p.x = left;
    p.vx = Math.abs(p.vx) * WALL_RESTITUTION;
    hit = true;
  } else if (p.x > right) {
    p.x = right;
    p.vx = -Math.abs(p.vx) * WALL_RESTITUTION;
    hit = true;
  }

  const inGoalSpan = p.x > GOAL_X_MIN && p.x < GOAL_X_MAX;

  // Top wall — solid except across the goal mouth.
  if (p.y < top && !inGoalSpan) {
    p.y = top;
    p.vy = Math.abs(p.vy) * WALL_RESTITUTION;
    hit = true;
  }
  // Bottom wall — solid except across the goal mouth.
  if (p.y > bottom && !inGoalSpan) {
    p.y = bottom;
    p.vy = -Math.abs(p.vy) * WALL_RESTITUTION;
    hit = true;
  }
  return hit;
}

/** Has the puck entered a net? We require the puck CENTER to clear the goal
 *  line so the visual fully crosses, and only within the goal-mouth x-span. */
function checkGoal(p: Puck): 'top' | 'bottom' | null {
  const inGoalSpan = p.x > GOAL_X_MIN && p.x < GOAL_X_MAX;
  if (!inGoalSpan) return null;
  if (p.y < WALL - PUCK_R) return 'top';
  if (p.y > BASE_H - WALL + PUCK_R) return 'bottom';
  return null;
}

/**
 * Advance the puck by ONE fixed step `dt` (seconds) against the two mallets.
 *
 * Tunnel-proofing: the displacement this step is split into N micro-steps so
 * each is at most MAX_SUBSTEP_DIST long; collisions are resolved after every
 * micro-step. Goal detection runs each micro-step too, so a puck rocketing
 * into the net is caught at the exact crossing, never overshot.
 *
 * Mutates `puck`. Returns the events that occurred during the step.
 */
export function stepPuck(
  puck: Puck,
  malletA: MalletBody,
  malletB: MalletBody,
  dt: number,
): StepEvents {
  const events: StepEvents = { wallHit: false, malletHit: false, goal: null };

  // Apply friction once per fixed step (frame-rate independent decay).
  const decay = Math.pow(PUCK_FRICTION, dt);
  puck.vx *= decay;
  puck.vy *= decay;

  // How far would we move this whole step?
  const stepDist = Math.hypot(puck.vx, puck.vy) * dt;
  // Number of micro-steps so each advance ≤ MAX_SUBSTEP_DIST.
  const sub = Math.max(1, Math.ceil(stepDist / MAX_SUBSTEP_DIST));
  const subDt = dt / sub;

  for (let i = 0; i < sub; i += 1) {
    puck.x += puck.vx * subDt;
    puck.y += puck.vy * subDt;

    // Goal check FIRST: if it's in the net, stop resolving (let the caller
    // reset). Checking before wall-resolve means a puck crossing the mouth is
    // never bounced back out by the short wall.
    const g = checkGoal(puck);
    if (g) {
      events.goal = g;
      return events;
    }

    if (resolveWalls(puck)) events.wallHit = true;
    if (resolveMallet(puck, malletA)) events.malletHit = true;
    if (resolveMallet(puck, malletB)) events.malletHit = true;
  }

  return events;
}

/** Clamp a mallet center to its OWN half + the rink interior. `side` is which
 *  goal it defends: 'top' mallets stay in the upper half, 'bottom' in the
 *  lower. A small overlap past the center line lets it strike a puck on the
 *  line. Returns the clamped point (does not mutate input). */
export function clampMallet(
  x: number,
  y: number,
  side: 'top' | 'bottom',
  centerOverlap: number,
): Vec {
  const minX = WALL + MALLET_R;
  const maxX = BASE_W - WALL - MALLET_R;
  const cx = Math.max(minX, Math.min(maxX, x));

  const mid = BASE_H / 2;
  let cy: number;
  if (side === 'top') {
    const minY = WALL + MALLET_R;
    const maxY = mid - MALLET_R + centerOverlap;
    cy = Math.max(minY, Math.min(maxY, y));
  } else {
    const minY = mid + MALLET_R - centerOverlap;
    const maxY = BASE_H - WALL - MALLET_R;
    cy = Math.max(minY, Math.min(maxY, y));
  }
  return { x: cx, y: cy };
}
