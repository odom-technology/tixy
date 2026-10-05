// fallow-ignore-file unused-file — actively used via re-exports in index.ts
// ---------------------------------------------------------------------------
// 8-Ball Pool Physics Engine — Rewritten from Research
//
// Key improvements over previous version:
// 1. Constant (linear) deceleration friction instead of exponential damping
// 2. Proper coefficient of restitution for ball-ball (0.95) and cushion (0.75)
// 3. Tangential velocity preserved during collisions (only normal affected)
// 4. Substeps per frame to prevent tunneling on fast shots
// 5. Configurable cushion restitution
// 6. Pocket radius varies by type (corner vs side)
//
// Deterministic: same input → same output.
// Pure TypeScript — runs in Node.js and browser identically.
// ---------------------------------------------------------------------------

import type {
  Ball,
  BallFrame,
  ShotInput,
  ShotResult,
  SoundEvent,
  Vec2,
} from './types';
import {
  isInThroat,
  isInPocketZone,
  isInPocketMouth,
  resolveJawCollision,
  getPocketGeometries,
  getPocketIndex,
} from './pockets';
import {
  BALL_DIAMETER,
  BALL_RADIUS,
  BALL_BALL_COR,
  BALL_SEPARATION_EPSILON,
  BALL_CUSHION_COR,
  CUSHION_SPEED_COR_FACTOR,
  CUSHION_TANGENTIAL_DAMPING,
  CUSHION_WIDTH,
  MIN_BALL_CUSHION_COR,
  ROLLING_DECEL,
  MAX_POWER,
  BREAK_SHOT_POWER_THRESHOLD,
  BREAK_SHOT_SPEED_MULTIPLIER,
  BREAK_CLUSTER_MIN_OBJECT_BALLS,
  BREAK_CLUSTER_RADIUS,
  BREAK_SPREAD_IMPULSE,
  POWER_CURVE_EXPONENT,
  POWER_HIGH_END_BOOST,
  POWER_HIGH_END_BOOST_EXPONENT,
  MIN_SHOT_SPEED,
  MAX_SIM_FRAMES,
  MIN_VELOCITY,
  SNAPSHOT_INTERVAL,
  SUBSTEPS,
  TABLE_HEIGHT,
  TABLE_WIDTH,
  FOOT_SPOT,
  SPIN_STRENGTH,
  TOPSPIN_TRANSFER,
  BACKSPIN_TRANSFER,
  SIDESPIN_CUSHION_FACTOR,
  SPIN_RETAIN_BALL,
  SPIN_RETAIN_CUSHION,
  THROW_FACTOR,
  SPIN_CUSHION_SPEED_FACTOR,
  SPIN_DECAY_RATE,
  MIN_SPIN,
} from './constants';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function vLen(v: Vec2): number {
  return Math.sqrt(v.x * v.x + v.y * v.y);
}

function powerToShotSpeedUnclamped(power: number): number {
  const baseSpeed =
    MIN_SHOT_SPEED +
    Math.pow(power, POWER_CURVE_EXPONENT) * (MAX_POWER - MIN_SHOT_SPEED);
  const boostMultiplier =
    1 + POWER_HIGH_END_BOOST * Math.pow(power, POWER_HIGH_END_BOOST_EXPONENT);
  return baseSpeed * boostMultiplier;
}

// fallow-ignore-next-line unused-export
export const powerToShotSpeed = (power: number): number => {
  const clampedPower = Math.max(0, Math.min(1, power));
  return powerToShotSpeedUnclamped(clampedPower);
};

export function shotSpeedToPower(speed: number): number {
  const minSpeed = powerToShotSpeedUnclamped(0);
  if (speed <= minSpeed) return 0;

  const maxSpeed = powerToShotSpeedUnclamped(1);
  if (speed >= maxSpeed) return 1;

  // Invert the boosted non-linear mapping with a monotonic binary search.
  let low = 0;
  let high = 1;
  for (let i = 0; i < 26; i += 1) {
    const mid = (low + high) / 2;
    const midSpeed = powerToShotSpeedUnclamped(mid);
    if (midSpeed < speed) {
      low = mid;
    } else {
      high = mid;
    }
  }
  return (low + high) / 2;
}

function isLikelyOpeningBreak(
  balls: Ball[],
  input: ShotInput,
  cueStartX: number,
): boolean {
  if (input.power < BREAK_SHOT_POWER_THRESHOLD) return false;
  // Opening breaks originate from the head side.
  if (cueStartX > TABLE_WIDTH * 0.42) return false;

  const objectBalls = balls.filter((b) => !b.pocketed && b.id !== 0);
  if (objectBalls.length < BREAK_CLUSTER_MIN_OBJECT_BALLS) return false;

  const maxDistSq = BREAK_CLUSTER_RADIUS * BREAK_CLUSTER_RADIUS;
  let clusteredCount = 0;
  for (const ball of objectBalls) {
    const dx = ball.pos.x - FOOT_SPOT.x;
    const dy = ball.pos.y - FOOT_SPOT.y;
    if (dx * dx + dy * dy <= maxDistSq) clusteredCount += 1;
  }
  return clusteredCount >= BREAK_CLUSTER_MIN_OBJECT_BALLS;
}

function applyBreakSpreadImpulse(activeBalls: Ball[]): void {
  const maxDistSq = BREAK_CLUSTER_RADIUS * BREAK_CLUSTER_RADIUS;

  for (const ball of activeBalls) {
    if (ball.id === 0 || ball.pocketed) continue;

    const dx = ball.pos.x - FOOT_SPOT.x;
    const dy = ball.pos.y - FOOT_SPOT.y;
    const distSq = dx * dx + dy * dy;
    if (distSq > maxDistSq) continue;

    let dirX = dx;
    let dirY = dy;
    let dist = Math.sqrt(distSq);

    // Stable fallback for near-center balls to keep client/server deterministic.
    if (dist < 1e-6) {
      dirX = 1;
      dirY = 0;
      dist = 1;
    }

    dirX /= dist;
    dirY /= dist;

    const edgeFactor = 1 - Math.min(1, dist / BREAK_CLUSTER_RADIUS);
    const boost = BREAK_SPREAD_IMPULSE * (0.6 + edgeFactor * 0.4);
    ball.vel.x += dirX * boost;
    ball.vel.y += dirY * boost;
  }
}

function cloneBalls(balls: Ball[]): Ball[] {
  return balls.map((b) => ({
    id: b.id,
    pos: { x: b.pos.x, y: b.pos.y },
    vel: { x: b.vel.x, y: b.vel.y },
    pocketed: b.pocketed,
    spinX: b.spinX ?? 0,
    spinY: b.spinY ?? 0,
  }));
}

function snapshotFrame(balls: Ball[]): BallFrame[] {
  return balls
    .filter((b) => !b.pocketed)
    .map((b) => ({
      id: b.id,
      x: b.pos.x,
      y: b.pos.y,
    }));
}

// ---------------------------------------------------------------------------
// Friction — constant (linear) deceleration, NOT exponential damping
// ---------------------------------------------------------------------------

function applyFriction(b: Ball): void {
  const speed = vLen(b.vel);
  if (speed <= MIN_VELOCITY) {
    b.vel.x = 0;
    b.vel.y = 0;
    return;
  }
  const newSpeed = Math.max(0, speed - ROLLING_DECEL);
  if (newSpeed === 0) {
    b.vel.x = 0;
    b.vel.y = 0;
    return;
  }
  const scale = newSpeed / speed;
  b.vel.x *= scale;
  b.vel.y *= scale;
}

function applySpinDecay(b: Ball): void {
  const sx = b.spinX ?? 0;
  const sy = b.spinY ?? 0;
  if (sx !== 0) {
    const newSx =
      sx > 0
        ? Math.max(0, sx - SPIN_DECAY_RATE)
        : Math.min(0, sx + SPIN_DECAY_RATE);
    b.spinX = Math.abs(newSx) < MIN_SPIN ? 0 : newSx;
  }
  if (sy !== 0) {
    const newSy =
      sy > 0
        ? Math.max(0, sy - SPIN_DECAY_RATE)
        : Math.min(0, sy + SPIN_DECAY_RATE);
    b.spinY = Math.abs(newSy) < MIN_SPIN ? 0 : newSy;
  }
}

// ---------------------------------------------------------------------------
// Ball-ball collision — proper CoR, tangent preserved
// ---------------------------------------------------------------------------

function resolveBallBall(a: Ball, b: Ball): boolean {
  const dx = b.pos.x - a.pos.x;
  const dy = b.pos.y - a.pos.y;
  const dist = Math.sqrt(dx * dx + dy * dy);

  if (dist > BALL_DIAMETER || dist === 0) return false;

  const stepAx = a.vel.x / SUBSTEPS;
  const stepAy = a.vel.y / SUBSTEPS;
  const stepBx = b.vel.x / SUBSTEPS;
  const stepBy = b.vel.y / SUBSTEPS;
  const relStepX = stepBx - stepAx;
  const relStepY = stepBy - stepAy;

  // Rewind from the overlapped state to the exact first-touch point inside
  // this substep. Using the overlap normal suppresses transfer on glancing
  // hits because the normal has already drifted away from the true contact
  // geometry by the time we resolve the impulse.
  let contactAx = a.pos.x;
  let contactAy = a.pos.y;
  let contactBx = b.pos.x;
  let contactBy = b.pos.y;
  let rewind = 0;

  const aCoeff = relStepX * relStepX + relStepY * relStepY;
  if (aCoeff > 1e-10) {
    const bCoeff = -2 * (dx * relStepX + dy * relStepY);
    const cCoeff = dx * dx + dy * dy - BALL_DIAMETER * BALL_DIAMETER;
    const disc = bCoeff * bCoeff - 4 * aCoeff * cCoeff;
    if (disc >= 0) {
      const sqrtDisc = Math.sqrt(disc);
      const roots = [
        (-bCoeff - sqrtDisc) / (2 * aCoeff),
        (-bCoeff + sqrtDisc) / (2 * aCoeff),
      ];
      const rewindRoot = roots
        .filter((root) => root >= 0 && root <= 1)
        .reduce<
          number | null
        >((best, root) => (best === null || root < best ? root : best), null);
      if (rewindRoot !== null) {
        rewind = rewindRoot;
        contactAx -= stepAx * rewind;
        contactAy -= stepAy * rewind;
        contactBx -= stepBx * rewind;
        contactBy -= stepBy * rewind;
      }
    }
  }

  const contactDx = contactBx - contactAx;
  const contactDy = contactBy - contactAy;
  const contactDist = Math.sqrt(contactDx * contactDx + contactDy * contactDy);
  if (contactDist === 0) return false;

  // Collision normal (from a to b) at the exact time of impact
  const nx = contactDx / contactDist;
  const ny = contactDy / contactDist;

  // Relative velocity along normal
  const dvx = a.vel.x - b.vel.x;
  const dvy = a.vel.y - b.vel.y;
  const dvn = dvx * nx + dvy * ny;

  // Don't resolve if separating
  if (dvn <= 0) return false;

  // Impulse (equal mass, with CoR)
  const j = ((1 + BALL_BALL_COR) * dvn) / 2;

  // Resolve at contact, not in the overlapped end-of-step position
  a.pos.x = contactAx;
  a.pos.y = contactAy;
  b.pos.x = contactBx;
  b.pos.y = contactBy;

  // Apply impulse — only affects normal component, tangent preserved
  a.vel.x -= j * nx;
  a.vel.y -= j * ny;
  b.vel.x += j * nx;
  b.vel.y += j * ny;

  // Advance the remaining portion of this substep with post-collision velocities
  if (rewind > 0) {
    a.pos.x += (a.vel.x / SUBSTEPS) * rewind;
    a.pos.y += (a.vel.y / SUBSTEPS) * rewind;
    b.pos.x += (b.vel.x / SUBSTEPS) * rewind;
    b.pos.y += (b.vel.y / SUBSTEPS) * rewind;
  }

  // Final separation epsilon to avoid sticky re-collisions from rounding
  const finalDx = b.pos.x - a.pos.x;
  const finalDy = b.pos.y - a.pos.y;
  const finalDist = Math.sqrt(finalDx * finalDx + finalDy * finalDy);
  if (finalDist > 0) {
    const overlap = BALL_DIAMETER - finalDist;
    if (overlap > 0) {
      const sepNx = finalDx / finalDist;
      const sepNy = finalDy / finalDist;
      const sep = overlap / 2 + BALL_SEPARATION_EPSILON;
      a.pos.x -= sep * sepNx;
      a.pos.y -= sep * sepNy;
      b.pos.x += sep * sepNx;
      b.pos.y += sep * sepNy;
    }
  }

  return true;
}

// ---------------------------------------------------------------------------
// Ball-cushion collision
// ---------------------------------------------------------------------------

function resolveCushion(ball: Ball): boolean {
  let hit = false;
  const r = BALL_RADIUS;
  const minX = CUSHION_WIDTH + r;
  const maxX = TABLE_WIDTH - CUSHION_WIDTH - r;
  const minY = CUSHION_WIDTH + r;
  const maxY = TABLE_HEIGHT - CUSHION_WIDTH - r;

  // Cushion restitution is configured via constants so rail response can be
  // tuned without hiding extra friction in the collision path.
  const speed = vLen(ball.vel);
  const e = Math.max(
    MIN_BALL_CUSHION_COR,
    BALL_CUSHION_COR - speed * CUSHION_SPEED_COR_FACTOR,
  );

  if (ball.pos.x < minX) {
    ball.pos.x = minX;
    ball.vel.x = Math.abs(ball.vel.x) * e;
    ball.vel.y *= CUSHION_TANGENTIAL_DAMPING;
    hit = true;
  } else if (ball.pos.x > maxX) {
    ball.pos.x = maxX;
    ball.vel.x = -Math.abs(ball.vel.x) * e;
    ball.vel.y *= CUSHION_TANGENTIAL_DAMPING;
    hit = true;
  }

  if (ball.pos.y < minY) {
    ball.pos.y = minY;
    ball.vel.y = Math.abs(ball.vel.y) * e;
    ball.vel.x *= CUSHION_TANGENTIAL_DAMPING;
    hit = true;
  } else if (ball.pos.y > maxY) {
    ball.pos.y = maxY;
    ball.vel.y = -Math.abs(ball.vel.y) * e;
    ball.vel.x *= CUSHION_TANGENTIAL_DAMPING;
    hit = true;
  }

  return hit;
}

// ---------------------------------------------------------------------------
// Pocket detection — per-pocket radius (corners tighter than sides)
// ---------------------------------------------------------------------------

// Backward compat
function _isInPocket(pos: Vec2): boolean {
  return isInThroat(pos);
}

function getEarliestCueCushionTime(cue: Ball): number | null {
  const stepX = cue.vel.x / SUBSTEPS;
  const stepY = cue.vel.y / SUBSTEPS;
  const minX = CUSHION_WIDTH + BALL_RADIUS;
  const maxX = TABLE_WIDTH - CUSHION_WIDTH - BALL_RADIUS;
  const minY = CUSHION_WIDTH + BALL_RADIUS;
  const maxY = TABLE_HEIGHT - CUSHION_WIDTH - BALL_RADIUS;

  let earliest: number | null = null;

  if (stepX < 0) {
    const t = (minX - cue.pos.x) / stepX;
    if (t >= 0 && t <= 1) earliest = t;
  } else if (stepX > 0) {
    const t = (maxX - cue.pos.x) / stepX;
    if (t >= 0 && t <= 1) earliest = t;
  }

  if (stepY < 0) {
    const t = (minY - cue.pos.y) / stepY;
    if (t >= 0 && t <= 1 && (earliest === null || t < earliest)) earliest = t;
  } else if (stepY > 0) {
    const t = (maxY - cue.pos.y) / stepY;
    if (t >= 0 && t <= 1 && (earliest === null || t < earliest)) earliest = t;
  }

  return earliest;
}

function findEarliestCueContact(active: Ball[]): number | null {
  const cue = active.find((ball) => ball.id === 0);
  if (!cue) return null;

  const cueRailTime = getEarliestCueCushionTime(cue);
  const stepVel = {
    x: cue.vel.x / SUBSTEPS,
    y: cue.vel.y / SUBSTEPS,
  };
  let earliestT = Infinity;
  let firstBallId: number | null = null;

  for (const ball of active) {
    if (ball.id === 0) continue;

    const relPosX = cue.pos.x - ball.pos.x;
    const relPosY = cue.pos.y - ball.pos.y;
    const relVelX = stepVel.x - ball.vel.x / SUBSTEPS;
    const relVelY = stepVel.y - ball.vel.y / SUBSTEPS;
    const a = relVelX * relVelX + relVelY * relVelY;
    const b = 2 * (relPosX * relVelX + relPosY * relVelY);
    const c =
      relPosX * relPosX + relPosY * relPosY - BALL_DIAMETER * BALL_DIAMETER;

    if (c <= 0) {
      // Balls are already touching/overlapping — only count as first contact
      // if the cue ball is actually moving TOWARD this ball (b < 0 means approaching).
      // This prevents frozen/touching balls from being falsely flagged when the
      // shot direction is away from them.
      if (b < 0) return ball.id;
      continue;
    }

    if (a <= 1e-8) continue;

    const disc = b * b - 4 * a * c;
    if (disc < 0) continue;

    const sqrtDisc = Math.sqrt(disc);
    const roots = [(-b - sqrtDisc) / (2 * a), (-b + sqrtDisc) / (2 * a)];

    for (const t of roots) {
      if (t < 0 || t > 1) continue;
      if (cueRailTime !== null && cueRailTime < t) continue;
      if (t < earliestT) {
        earliestT = t;
        firstBallId = ball.id;
      }
    }
  }

  return firstBallId;
}

// ---------------------------------------------------------------------------
// Single physics substep
// ---------------------------------------------------------------------------

function substep(
  balls: Ball[],
  pocketedBallIds: number[],
  state: {
    scratch: boolean;
    firstContactBallId: number | null;
    cueContactedBall: boolean;
    railContacts: number;
    ballsToRail: Set<number>;
    isLikelyBreak: boolean;
    breakSpreadApplied: boolean;
    pocketMap: Map<number, number>;
  },
  events: SoundEvent[],
  frameNum: number,
): void {
  const active = balls.filter((b) => !b.pocketed);

  if (!state.cueContactedBall) {
    const predictedFirstContact = findEarliestCueContact(active);
    if (predictedFirstContact !== null) {
      state.firstContactBallId = predictedFirstContact;
      state.cueContactedBall = true;
    }
  }

  // NOTE: Friction is NOT applied here — it's applied once per visible
  // frame in the main loop, not per substep. Substeps only handle
  // movement and collision resolution at higher granularity.

  // 1. Move balls (position divided by substeps for fine-grained collision)
  for (const b of active) {
    b.pos.x += b.vel.x / SUBSTEPS;
    b.pos.y += b.vel.y / SUBSTEPS;
  }

  // 3. Ball-cushion + jaw collisions
  for (const b of active) {
    // Skip all collision for balls already in a pocket throat (about to be pocketed)
    if (isInThroat(b.pos)) continue;

    // Try jaw collision first if near a pocket
    let handled = false;
    if (isInPocketZone(b.pos)) {
      const jawHit = resolveJawCollision(b);
      if (jawHit) {
        if (state.cueContactedBall) {
          state.railContacts++;
          if (b.id >= 1 && b.id <= 15) state.ballsToRail.add(b.id);
        }
        const postSpeed = vLen(b.vel);
        if (postSpeed > 0.3) {
          events.push({
            frame: frameNum,
            type: 'cushionHit',
            ballIds: [b.id],
            speed: postSpeed,
          });
        }
        handled = true;
      }
    }

    // Fall through to regular cushion if jaw didn't handle it —
    // UNLESS the ball is in a pocket mouth heading toward the pocket.
    // A ball running along the rail (parallel to the pocket opening)
    // should still bounce off the cushion, not fall in.
    let inMouth = !handled && isInPocketMouth(b.pos);
    if (inMouth) {
      // Check if the ball is actually heading toward the pocket center.
      // If it's moving mostly parallel to the rail (small velocity component
      // toward the pocket), it's a rail runner and should hit the cushion.
      for (const pg of getPocketGeometries()) {
        if (pg.type !== 'side') continue;
        const dx = pg.center.x - b.pos.x;
        const dy = pg.center.y - b.pos.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < pg.zoneRadius && dist > pg.throatRadius) {
          // Ball is in this side pocket's zone — check velocity direction
          const towardPocket = (b.vel.x * dx + b.vel.y * dy) / (dist || 1);
          const speed = vLen(b.vel);
          // If less than 30% of velocity is aimed at the pocket, it's a rail runner
          if (speed > 0.5 && towardPocket / speed < 0.3) {
            inMouth = false;
          }
          break;
        }
      }
    }
    if (!handled && !inMouth) {
      const preSpeed = vLen(b.vel);
      const preVx = b.vel.x;
      const preVy = b.vel.y;
      const hit = resolveCushion(b);
      if (hit) {
        if (state.cueContactedBall) {
          state.railContacts++;
          if (b.id >= 1 && b.id <= 15) state.ballsToRail.add(b.id);
        }
        if (preSpeed > 0.3) {
          events.push({
            frame: frameNum,
            type: 'cushionHit',
            ballIds: [b.id],
            speed: preSpeed,
          });
        }
        // Spin effects on cue ball cushion bounce
        if (b.id === 0 && preSpeed > 0.1) {
          const sx = b.spinX ?? 0;
          const sy = b.spinY ?? 0;
          if (sx !== 0) {
            const xFlipped =
              Math.sign(b.vel.x) !== Math.sign(preVx) && Math.abs(preVx) > 0.1;
            const yFlipped =
              Math.sign(b.vel.y) !== Math.sign(preVy) && Math.abs(preVy) > 0.1;
            if (xFlipped) b.vel.y += sx * SIDESPIN_CUSHION_FACTOR * preSpeed;
            if (yFlipped) b.vel.x += sx * SIDESPIN_CUSHION_FACTOR * preSpeed;
            b.spinX = sx * SPIN_RETAIN_CUSHION;
          }
          if (sy !== 0) {
            const postSpeed = vLen(b.vel);
            if (postSpeed > 0.1) {
              const rdx = b.vel.x / postSpeed;
              const rdy = b.vel.y / postSpeed;
              const boost = sy * SPIN_CUSHION_SPEED_FACTOR * preSpeed;
              b.vel.x += rdx * boost;
              b.vel.y += rdy * boost;
            }
            b.spinY = sy * SPIN_RETAIN_CUSHION;
          }
        }
      }
    }
  }

  // 4. Ball-ball collisions
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      // Pre-collision state for sound + spin
      const dx = active[j].pos.x - active[i].pos.x;
      const dy = active[j].pos.y - active[i].pos.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      let approachSpeed = 0;
      if (dist > 0) {
        const dvx = active[i].vel.x - active[j].vel.x;
        const dvy = active[i].vel.y - active[j].vel.y;
        approachSpeed = (dvx * dx + dvy * dy) / dist;
      }

      // Save cue ball pre-collision velocity for spin application
      const isCueI = active[i].id === 0;
      const isCueJ = active[j].id === 0;
      const cue = isCueI ? active[i] : isCueJ ? active[j] : null;
      const obj = isCueI ? active[j] : isCueJ ? active[i] : null;
      const preVx = cue ? cue.vel.x : 0;
      const preVy = cue ? cue.vel.y : 0;
      const preSpeed = cue ? vLen(cue.vel) : 0;

      const collided = resolveBallBall(active[i], active[j]);
      if (collided) {
        const cueObjectCollision =
          (isCueI && active[j].id !== 0) || (isCueJ && active[i].id !== 0);
        if (state.firstContactBallId === null) {
          if (isCueI && active[j].id !== 0) {
            state.firstContactBallId = active[j].id;
            state.cueContactedBall = true;
          } else if (isCueJ && active[i].id !== 0) {
            state.firstContactBallId = active[i].id;
            state.cueContactedBall = true;
          }
        }

        if (
          cueObjectCollision &&
          state.isLikelyBreak &&
          !state.breakSpreadApplied
        ) {
          applyBreakSpreadImpulse(active);
          state.breakSpreadApplied = true;
        }

        if (approachSpeed > 0.5) {
          events.push({
            frame: frameNum,
            type: 'ballCollision',
            ballIds: [active[i].id, active[j].id],
            speed: approachSpeed,
          });
        }

        // Spin effects on cue ball after ball-ball collision
        if (cue && obj && preSpeed > 0.1) {
          const sy = cue.spinY ?? 0;
          const sx = cue.spinX ?? 0;

          // Topspin / backspin: add velocity along pre-collision travel direction.
          // Energy-bounded: cue ball post-spin speed cannot exceed pre-collision speed.
          if (sy !== 0) {
            const dirX = preVx / preSpeed;
            const dirY = preVy / preSpeed;
            const factor = sy > 0 ? TOPSPIN_TRANSFER : BACKSPIN_TRANSFER;
            const boost = sy * factor * preSpeed;
            cue.vel.x += dirX * boost;
            cue.vel.y += dirY * boost;
            // Cap speed to prevent energy injection
            const postSpeed = vLen(cue.vel);
            if (postSpeed > preSpeed) {
              const scale = preSpeed / postSpeed;
              cue.vel.x *= scale;
              cue.vel.y *= scale;
            }
            cue.spinY = sy * SPIN_RETAIN_BALL;
          }

          // Throw: sidespin deflects the object ball slightly along contact tangent
          if (sx !== 0 && dist > 0) {
            const nx = dx / dist;
            const ny = dy / dist;
            const tx = -ny;
            const ty = nx;
            const throwBoost = sx * THROW_FACTOR * preSpeed;
            obj.vel.x += tx * throwBoost;
            obj.vel.y += ty * throwBoost;
          }
        }
      }
    }
  }

  // 5. Pocket detection — ball must enter the smaller throat zone (past jaws)
  for (const b of active) {
    if (isInThroat(b.pos)) {
      const speed = vLen(b.vel);
      const pIdx = getPocketIndex(b.pos);
      b.pocketed = true;
      b.vel.x = 0;
      b.vel.y = 0;
      if (!pocketedBallIds.includes(b.id)) {
        pocketedBallIds.push(b.id);
        if (pIdx >= 0) state.pocketMap.set(b.id, pIdx);
        if (b.id === 0) state.scratch = true;
        events.push({
          frame: frameNum,
          type: 'pocketed',
          ballIds: [b.id],
          speed,
        });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Main simulation
// ---------------------------------------------------------------------------

export function simulateShot(inputBalls: Ball[], input: ShotInput): ShotResult {
  const balls = cloneBalls(inputBalls);
  let likelyOpeningBreak = false;
  const frames: BallFrame[][] = [];
  const pocketedBallIds: number[] = [];
  const events: SoundEvent[] = [];
  const state = {
    scratch: false,
    firstContactBallId: null as number | null,
    cueContactedBall: false,
    railContacts: 0,
    ballsToRail: new Set<number>(),
    isLikelyBreak: false,
    breakSpreadApplied: false,
    pocketMap: new Map<number, number>(), // ballId → pocketIndex (0-5)
  };

  // Place cue ball
  const cue = balls.find((b) => b.id === 0);
  if (cue) {
    if (cue.pocketed) cue.pocketed = false;
    if (input.cuePosition) {
      cue.pos.x = input.cuePosition.x;
      cue.pos.y = input.cuePosition.y;
    }
    likelyOpeningBreak = isLikelyOpeningBreak(balls, input, cue.pos.x);
    state.isLikelyBreak = likelyOpeningBreak;

    const speed =
      powerToShotSpeed(input.power) *
      (likelyOpeningBreak ? BREAK_SHOT_SPEED_MULTIPLIER : 1);
    cue.vel.x = Math.cos(input.angle) * speed;
    cue.vel.y = Math.sin(input.angle) * speed;
    // Apply spin from cue strike offset — magnitude scales with power
    const powerNorm = Math.min(1, speed / MAX_POWER);
    cue.spinX = (input.spinX ?? 0) * SPIN_STRENGTH * powerNorm;
    cue.spinY = (input.spinY ?? 0) * SPIN_STRENGTH * powerNorm;
  }

  // Initial frame
  frames.push(snapshotFrame(balls));

  // Simulation loop with substeps
  for (let frame = 0; frame < MAX_SIM_FRAMES; frame++) {
    // Run SUBSTEPS collision checks per visible frame
    for (let s = 0; s < SUBSTEPS; s++) {
      substep(balls, pocketedBallIds, state, events, frame);
    }

    // Apply friction + spin decay ONCE per visible frame (not per substep!)
    const active = balls.filter((b) => !b.pocketed);
    for (const b of active) {
      applyFriction(b);
      applySpinDecay(b);
    }

    // Record frame for animation
    if ((frame + 1) % SNAPSHOT_INTERVAL === 0) {
      frames.push(snapshotFrame(balls));
    }

    // Check if all at rest
    let allRest = true;
    for (const b of balls) {
      if (!b.pocketed && vLen(b.vel) >= MIN_VELOCITY) {
        allRest = false;
        break;
      }
    }
    if (allRest) {
      frames.push(snapshotFrame(balls));
      break;
    }
  }

  // Snap remaining to rest
  for (const b of balls) {
    if (!b.pocketed && vLen(b.vel) < MIN_VELOCITY) {
      b.vel.x = 0;
      b.vel.y = 0;
    }
  }

  return {
    frames,
    finalBalls: balls,
    pocketedBallIds,
    pocketMap: state.pocketMap,
    scratch: state.scratch,
    firstContactBallId: state.firstContactBallId,
    railContacts: state.railContacts,
    ballsToRail: state.ballsToRail,
    totalFrames: frames.length,
    events,
  };
}

// ---------------------------------------------------------------------------
// Aiming preview
// ---------------------------------------------------------------------------

export function simulatePreview(
  inputBalls: Ball[],
  input: ShotInput,
  maxFrames = 120,
): {
  cuePath: Vec2[];
  firstContactPos: Vec2 | null;
  firstContactBallId: number | null;
  targetDirection: Vec2 | null;
  /** Predicted cue ball deflection direction after first contact (for position play). */
  cueDeflection: Vec2 | null;
} {
  const balls = cloneBalls(inputBalls);
  const cuePath: Vec2[] = [];
  let firstContactPos: Vec2 | null = null;
  let firstContactBallId: number | null = null;
  let targetDirection: Vec2 | null = null;
  let cueDeflection: Vec2 | null = null;

  const cue = balls.find((b) => b.id === 0);
  if (!cue)
    return {
      cuePath,
      firstContactPos,
      firstContactBallId,
      targetDirection,
      cueDeflection,
    };

  if (input.cuePosition) {
    cue.pos.x = input.cuePosition.x;
    cue.pos.y = input.cuePosition.y;
  }
  cue.pocketed = false;
  const speed = powerToShotSpeed(input.power);
  cue.vel.x = Math.cos(input.angle) * speed;
  cue.vel.y = Math.sin(input.angle) * speed;
  cue.spinX = input.spinX ?? 0;
  cue.spinY = input.spinY ?? 0;

  cuePath.push({ x: cue.pos.x, y: cue.pos.y });

  for (let f = 0; f < maxFrames; f++) {
    // Use substeps matching the real simulation so first-contact detection
    // is consistent. Without substeps the preview overshoots thin cuts and
    // the ghost ball / target line "pops" at marginal collision boundaries.
    let cuePocketed = false;
    for (let s = 0; s < SUBSTEPS; s++) {
      cue.pos.x += cue.vel.x / SUBSTEPS;
      cue.pos.y += cue.vel.y / SUBSTEPS;

      // If the cue enters a pocket throat, it's pocketed — stop tracing
      if (isInThroat(cue.pos)) {
        cuePocketed = true;
        break;
      }

      const inZone = isInPocketZone(cue.pos);
      const jawHit = inZone ? resolveJawCollision(cue) : false;
      if (!jawHit && !isInPocketMouth(cue.pos)) resolveCushion(cue);

      // Analytic ray-sphere first-contact check (same math as findEarliestCueContact).
      // Uses the cue's substep velocity to find the exact collision point,
      // eliminating the step-based overshoot that caused preview/sim disagreement.
      if (!firstContactBallId) {
        const stepVx = cue.vel.x / SUBSTEPS;
        const stepVy = cue.vel.y / SUBSTEPS;
        let bestT = Infinity;
        let bestBallId: number | null = null;
        for (const b of balls) {
          if (b.id === 0 || b.pocketed) continue;
          const rpx = cue.pos.x - b.pos.x;
          const rpy = cue.pos.y - b.pos.y;
          const distSq = rpx * rpx + rpy * rpy;
          // Already overlapping — count if approaching
          if (distSq <= BALL_DIAMETER * BALL_DIAMETER) {
            const approach = rpx * stepVx + rpy * stepVy;
            if (approach < 0) {
              bestBallId = b.id;
              bestT = 0;
              break;
            }
            continue;
          }
          const a = stepVx * stepVx + stepVy * stepVy;
          if (a < 1e-10) continue;
          const bCoeff = 2 * (rpx * stepVx + rpy * stepVy);
          const c = distSq - BALL_DIAMETER * BALL_DIAMETER;
          const disc = bCoeff * bCoeff - 4 * a * c;
          if (disc < 0) continue;
          const t = (-bCoeff - Math.sqrt(disc)) / (2 * a);
          if (t >= 0 && t <= 1 && t < bestT) {
            bestT = t;
            bestBallId = b.id;
          }
        }
        if (bestBallId !== null) {
          const hitBall = balls.find((b) => b.id === bestBallId)!;
          cue.pos.x += stepVx * bestT;
          cue.pos.y += stepVy * bestT;
          firstContactBallId = bestBallId;
          firstContactPos = { x: cue.pos.x, y: cue.pos.y };
          const dx = cue.pos.x - hitBall.pos.x;
          const dy = cue.pos.y - hitBall.pos.y;
          const d = Math.sqrt(dx * dx + dy * dy);
          targetDirection = d > 0 ? { x: -dx / d, y: -dy / d } : null;

          const hasEnglish =
            Math.abs(input.spinX ?? 0) > 0.01 ||
            Math.abs(input.spinY ?? 0) > 0.01;
          if (d > 0 && !hasEnglish) {
            const nx = dx / d;
            const ny = dy / d;
            const vTangX =
              cue.vel.x - (cue.vel.x * -nx + cue.vel.y * -ny) * -nx;
            const vTangY =
              cue.vel.y - (cue.vel.x * -nx + cue.vel.y * -ny) * -ny;
            const tLen = Math.sqrt(vTangX * vTangX + vTangY * vTangY);
            if (tLen > 0.1) {
              cueDeflection = { x: vTangX / tLen, y: vTangY / tLen };
            }
          }
          break;
        }
      }
      if (firstContactBallId) break;
    } // end substep loop

    if (cuePocketed) break; // cue entered a pocket — stop tracing

    applyFriction(cue);

    if (f % 2 === 0) {
      cuePath.push({ x: cue.pos.x, y: cue.pos.y });
    }

    if (firstContactBallId) break;
    if (vLen(cue.vel) < MIN_VELOCITY) break;
  }

  return {
    cuePath,
    firstContactPos,
    firstContactBallId,
    targetDirection,
    cueDeflection,
  };
}
