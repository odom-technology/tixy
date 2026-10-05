// ─────────────────────────────────────────────────────────────────────────
// Air Hockey — AI mallet controller (top mallet in vs-AI mode). Pure logic.
//
// The AI does three things, blended by where the puck is:
//   1) DEFEND — when the puck is on its side (or heading toward its goal), it
//      slides along a defensive line to put its body between the puck and the
//      net (intercepting the puck's projected x at its guard depth).
//   2) ATTACK — when the puck is slow and on its half, it lines up BEHIND the
//      puck (goal-side) and drives through it toward the opponent's goal.
//   3) RECOVER — otherwise it eases back toward a central home position at its
//      guard depth, ready to react.
//
// Difficulty changes tracking speed, max mallet speed, reaction latency (it
// aims at a slightly stale puck), aim jitter, and how far it leads the puck.
// A higher difficulty therefore defends tighter and shoots straighter, while
// 'easy' is laggy and imprecise (and beatable with a quick redirect).
// ─────────────────────────────────────────────────────────────────────────

import {
  BASE_W,
  BASE_H,
  WALL,
  MALLET_R,
  PUCK_R,
  type AiProfile,
} from './_air-hockey-constants';
import type { Puck } from './_air-hockey-physics';

/** A short ring buffer of recent puck samples so the AI can act on a stale
 *  position (reaction latency) without per-call allocation. */
export type PuckHistory = {
  xs: Float32Array;
  ys: Float32Array;
  ts: Float32Array;
  head: number;
  count: number;
};

export function createPuckHistory(size = 64): PuckHistory {
  return {
    xs: new Float32Array(size),
    ys: new Float32Array(size),
    ts: new Float32Array(size),
    head: 0,
    count: 0,
  };
}

export function recordPuck(h: PuckHistory, p: Puck, nowSec: number): void {
  const n = h.xs.length;
  h.xs[h.head] = p.x;
  h.ys[h.head] = p.y;
  h.ts[h.head] = nowSec;
  h.head = (h.head + 1) % n;
  if (h.count < n) h.count += 1;
}

/** Return the puck position as it was `latency` seconds ago (clamped to the
 *  buffer). Falls back to the live puck if history is empty. */
function sampleDelayed(
  h: PuckHistory,
  nowSec: number,
  latency: number,
  live: Puck,
): { x: number; y: number } {
  if (h.count === 0) return { x: live.x, y: live.y };
  const target = nowSec - latency;
  const n = h.xs.length;
  // Walk backwards from the most recent sample to find the first at/just
  // before `target`.
  for (let i = 0; i < h.count; i += 1) {
    const idx = (h.head - 1 - i + n * 2) % n;
    if (h.ts[idx]! <= target) {
      return { x: h.xs[idx]!, y: h.ys[idx]! };
    }
  }
  // Older than the whole buffer — use the oldest we have.
  const oldest = (h.head - h.count + n * 2) % n;
  return { x: h.xs[oldest]!, y: h.ys[oldest]! };
}

/**
 * Compute the AI mallet's desired target point this frame. The AI defends the
 * TOP goal, so it lives in the upper half. Returns a table-space point; the
 * caller moves the mallet toward it (rate-limited by the profile) and clamps
 * it to the top half.
 *
 * `seedFn` is the game's seeded/Math.random source for deterministic-ish aim
 * jitter; pass `Math.random` if you don't care.
 */
export function computeAiTarget(
  puck: Puck,
  profile: AiProfile,
  history: PuckHistory,
  nowSec: number,
  rand: () => number,
): { x: number; y: number } {
  const mid = BASE_H / 2;
  const goalY = WALL; // top goal line
  const homeY = WALL + MALLET_R + (mid - WALL - MALLET_R) * profile.guardDepth;
  const centerX = BASE_W / 2;

  // React to a slightly stale puck so quick redirects can beat the AI.
  const seen = sampleDelayed(history, nowSec, profile.reaction, puck);

  const puckOnAiSide = seen.y < mid;
  const puckMovingToAiGoal = puck.vy < -8; // heading up toward top goal

  let tx: number;
  let ty: number;

  if (puckMovingToAiGoal || puckOnAiSide) {
    // ── DEFEND / INTERCEPT ──
    // Project where the puck will cross the AI's defensive line (homeY band).
    // Use velocity to lead it; if it's barely moving, just mirror its x.
    const guardY = Math.max(goalY + MALLET_R + 2, homeY * 0.85);
    let projX = seen.x;
    if (puck.vy < -2) {
      const dt = (guardY - seen.y) / puck.vy; // time to reach guard line
      if (dt > 0 && dt < 1.2) {
        projX = seen.x + puck.vx * dt;
        // Account for a single side-wall bounce in the projection.
        const left = WALL + PUCK_R;
        const right = BASE_W - WALL - PUCK_R;
        if (projX < left) projX = left + (left - projX);
        else if (projX > right) projX = right - (projX - right);
      }
    }
    tx = projX;
    ty = guardY;

    // If the puck is on the AI's side AND slow enough, step up to attack it.
    const speed = Math.hypot(puck.vx, puck.vy);
    if (puckOnAiSide && speed < 520 && seen.y > goalY + MALLET_R * 2) {
      // Aim a point just goal-SIDE (above) the puck so driving down through it
      // sends it toward the opponent's (bottom) goal, biased to center.
      const aimBiasX = (centerX - seen.x) * profile.anticipation;
      tx = seen.x + aimBiasX;
      ty = seen.y - (PUCK_R + MALLET_R) * 0.85;
    }
  } else {
    // ── RECOVER ── ease home, gently shadowing the puck's x so it isn't
    // caught flat-footed when the puck returns.
    tx = centerX + (seen.x - centerX) * 0.45;
    ty = homeY;
  }

  // Aim jitter (difficulty-scaled, symmetric).
  if (profile.jitter > 0) {
    tx += (rand() - 0.5) * 2 * profile.jitter;
    ty += (rand() - 0.5) * profile.jitter * 0.5;
  }

  // Soft-clamp into the top half interior (the physics clamp is authoritative;
  // this just keeps the target sane).
  const minX = WALL + MALLET_R;
  const maxX = BASE_W - WALL - MALLET_R;
  tx = Math.max(minX, Math.min(maxX, tx));
  ty = Math.max(WALL + MALLET_R, Math.min(mid - MALLET_R, ty));

  return { x: tx, y: ty };
}

/**
 * Move a mallet from its current position toward `target` using an exponential
 * approach capped by `maxSpeed`, over `dt` seconds. Returns the new center and
 * the velocity actually used (px/s) so the puck can pick up momentum on a hit.
 */
export function moveMalletToward(
  curX: number,
  curY: number,
  targetX: number,
  targetY: number,
  profile: AiProfile,
  dt: number,
): { x: number; y: number; vx: number; vy: number } {
  // Exponential smoothing toward target.
  const k = 1 - Math.exp(-profile.speed * dt);
  let nx = curX + (targetX - curX) * k;
  let ny = curY + (targetY - curY) * k;

  // Cap the per-step distance to maxSpeed.
  const dx = nx - curX;
  const dy = ny - curY;
  const dist = Math.hypot(dx, dy);
  const maxDist = profile.maxSpeed * dt;
  if (dist > maxDist && dist > 1e-6) {
    const s = maxDist / dist;
    nx = curX + dx * s;
    ny = curY + dy * s;
  }

  return {
    x: nx,
    y: ny,
    vx: dt > 0 ? (nx - curX) / dt : 0,
    vy: dt > 0 ? (ny - curY) / dt : 0,
  };
}
