/* ──────────────────────────────────────────────────────────────────────────
   Lucky Cage — cosmetic tumble solver.

   Twenty balls rattling inside a spinning brass drum. This is PRESENTATION
   ONLY: the money was decided server-side before a single frame rendered, and
   nothing this solver does can change which balls come out. It exists so the
   cage looks like it is actually full of loose balls rather than a looping
   texture — and so the five committed balls have believable positions to be
   plucked from when the gate opens.

   Deliberately NOT a physics engine:
     - fixed 1/120 s timestep with an accumulator, so the motion is identical
       at 30, 60 or 144 fps and identical between two runs of the same seed;
     - the drum is a cylinder; containment is a hard projection back inside
       the end caps and radial wall with restitution, not a solver iteration;
     - ball-ball response is a cheap symmetric positional push (20 balls = 190
       pairs, trivial), enough to stop stacking without pretending to conserve
       momentum;
     - the drum wall drags balls tangentially, which is what actually makes a
       bingo cage look like a bingo cage.

   Everything runs in CAGE-LOCAL space (the cage group carries the spin), so
   gravity has to be rotated into local space each step.
   ────────────────────────────────────────────────────────────────────────── */

export const TUMBLE_STEP = 1 / 120;
/** Never chase more than this much simulation after a stall/tab switch. */
const MAX_CATCHUP = 0.25;

export type TumbleBall = {
  /** Ball face number, 1..20. */
  n: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Free spin, purely visual. */
  rx: number;
  ry: number;
  rz: number;
  /**
   * Set once the choreography takes this ball over for the chute run. Held
   * balls are skipped entirely by the solver — the timeline owns them.
   */
  released: boolean;
};

export type TumbleState = {
  balls: TumbleBall[];
  /** Interior drum dimensions; BALL_RADIUS is deducted for centre bounds. */
  drumRadius: number;
  drumHalfLength: number;
  ballRadius: number;
  /** Accumulated sub-step remainder. */
  carry: number;
  /** Cage spin in rad/s about the X axis, driven by the timeline. */
  spin: number;
  /** Accumulated cage rotation, for rotating gravity into local space. */
  angle: number;
};

/** Small deterministic PRNG for the initial scatter (never touches money). */
function scatterRng(seed: number): () => number {
  let s = (seed | 0) ^ 0x5c1a9e;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Seat 20 balls in the bottom of the drum with a small deterministic scatter.
 * `seed` only shapes the pile, so an idle cabinet looks the same every visit.
 */
export function createTumbleState(
  count: number,
  drumRadius: number,
  drumHalfLength: number,
  ballRadius: number,
  seed = 0x1e55,
): TumbleState {
  const rng = scatterRng(seed);
  const balls: TumbleBall[] = [];
  const radialLimit = drumRadius - ballRadius;
  const axialLimit = drumHalfLength - ballRadius;
  for (let i = 0; i < count; i += 1) {
    // Spread across the drum width, piled low.
    const u = (i + 0.5) / count;
    const ring = Math.floor(i / 5);
    const theta = u * Math.PI * 2 * 1.618 + rng() * 0.4;
    const radial =
      radialLimit * (0.34 + 0.5 * ((ring % 3) / 3) + rng() * 0.12);
    balls.push({
      n: i + 1,
      x: (rng() - 0.5) * axialLimit * 1.05,
      y:
        -radialLimit * 0.52 +
        Math.sin(theta) * radial * 0.34 +
        rng() * 0.02,
      z: Math.cos(theta) * radial * 0.62,
      vx: (rng() - 0.5) * 0.2,
      vy: (rng() - 0.5) * 0.2,
      vz: (rng() - 0.5) * 0.2,
      rx: rng() * Math.PI * 2,
      ry: rng() * Math.PI * 2,
      rz: rng() * Math.PI * 2,
      released: false,
    });
  }
  return {
    balls,
    drumRadius,
    drumHalfLength,
    ballRadius,
    carry: 0,
    spin: 0,
    angle: 0,
  };
}

/** Park every ball back in the pile — used on reset and context loss. */
export function resetTumbleState(state: TumbleState, seed = 0x1e55): void {
  const fresh = createTumbleState(
    state.balls.length,
    state.drumRadius,
    state.drumHalfLength,
    state.ballRadius,
    seed,
  );
  for (let i = 0; i < state.balls.length; i += 1) {
    const a = state.balls[i]!;
    const b = fresh.balls[i]!;
    a.x = b.x;
    a.y = b.y;
    a.z = b.z;
    a.vx = b.vx;
    a.vy = b.vy;
    a.vz = b.vz;
    a.rx = b.rx;
    a.ry = b.ry;
    a.rz = b.rz;
    a.released = false;
  }
  state.carry = 0;
  state.spin = 0;
  state.angle = 0;
}

const GRAVITY = 6.4;
const RESTITUTION = 0.42;
const WALL_DRAG = 0.86;
const AIR_DRAG = 0.55;
/** How strongly the spinning wall drags a touching ball around with it. */
const WALL_COUPLING = 0.55;
const MAX_SPEED = 7.5;

/** One fixed sub-step. Allocation-free. */
function step(state: TumbleState, dt: number): void {
  const { balls, drumRadius, drumHalfLength, ballRadius } = state;
  const radialLimit = drumRadius - ballRadius;
  const radialLimit2 = radialLimit * radialLimit;
  const axialLimit = drumHalfLength - ballRadius;

  // Gravity points down in WORLD space; the cage spins about X, so in cage
  // space the down vector rotates the other way.
  const ca = Math.cos(-state.angle);
  const sa = Math.sin(-state.angle);
  const gy = -GRAVITY * ca;
  const gz = -GRAVITY * sa;

  const damp = Math.exp(-AIR_DRAG * dt);

  for (const b of balls) {
    if (b.released) continue;
    b.vy += gy * dt;
    b.vz += gz * dt;
    b.vx *= damp;
    b.vy *= damp;
    b.vz *= damp;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.z += b.vz * dt;
  }

  // Pairwise separation — cheap positional push, symmetric so it cannot inject
  // net drift.
  const minDist = ballRadius * 2;
  const minDist2 = minDist * minDist;
  for (let i = 0; i < balls.length; i += 1) {
    const a = balls[i]!;
    if (a.released) continue;
    for (let j = i + 1; j < balls.length; j += 1) {
      const c = balls[j]!;
      if (c.released) continue;
      const dx = c.x - a.x;
      const dy = c.y - a.y;
      const dz = c.z - a.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 >= minDist2 || d2 <= 1e-9) continue;
      const d = Math.sqrt(d2);
      const nx = dx / d;
      const ny = dy / d;
      const nz = dz / d;
      const push = (minDist - d) * 0.5;
      a.x -= nx * push;
      a.y -= ny * push;
      a.z -= nz * push;
      c.x += nx * push;
      c.y += ny * push;
      c.z += nz * push;
      // Exchange the normal component so contacts read as knocks, not slides.
      const rel = (c.vx - a.vx) * nx + (c.vy - a.vy) * ny + (c.vz - a.vz) * nz;
      if (rel < 0) {
        const imp = -rel * 0.5 * (1 + RESTITUTION);
        a.vx -= nx * imp;
        a.vy -= ny * imp;
        a.vz -= nz * imp;
        c.vx += nx * imp;
        c.vy += ny * imp;
        c.vz += nz * imp;
      }
    }
  }

  // Cylindrical drum boundary. A ball centre must satisfy
  // |x| <= halfLength - ballRadius and y² + z² <=
  // (drumRadius - ballRadius)².
  for (const b of balls) {
    if (b.released) continue;
    if (Math.abs(b.x) > axialLimit) {
      const nx = Math.sign(b.x);
      b.x = nx * axialLimit;
      const vn = b.vx * nx;
      if (vn > 0) b.vx -= nx * vn * (1 + RESTITUTION);
    }

    const d2 = b.y * b.y + b.z * b.z;
    if (d2 > radialLimit2 && d2 > 1e-9) {
      const d = Math.sqrt(d2);
      const ny = b.y / d;
      const nz = b.z / d;
      b.y = ny * radialLimit;
      b.z = nz * radialLimit;
      const vn = b.vy * ny + b.vz * nz;
      if (vn > 0) {
        b.vy -= ny * vn * (1 + RESTITUTION);
        b.vz -= nz * vn * (1 + RESTITUTION);
      }
      // Tangential drag from the spinning wall: the drum turns about X, so the
      // wall velocity at this contact is spin x r in the YZ plane.
      const wallVy = -state.spin * b.z;
      const wallVz = state.spin * b.y;
      b.vy += (wallVy - b.vy) * WALL_COUPLING * dt * 12;
      b.vz += (wallVz - b.vz) * WALL_COUPLING * dt * 12;
      b.vx *= WALL_DRAG;
      // Contact spin — visual only.
      b.rx += (wallVz - b.vz) * dt * 6;
      b.rz += (wallVy - b.vy) * dt * 6;
    }

    const speed2 = b.vx * b.vx + b.vy * b.vy + b.vz * b.vz;
    if (speed2 > MAX_SPEED * MAX_SPEED) {
      const k = MAX_SPEED / Math.sqrt(speed2);
      b.vx *= k;
      b.vy *= k;
      b.vz *= k;
    }

    b.rx += b.vz * dt * 4.2;
    b.ry += b.vx * dt * 3.1;
    b.rz -= b.vy * dt * 4.2;
  }
}

/**
 * Advance the tumble by `dt` real seconds at the fixed timestep. `spin` is the
 * cage's current angular velocity (rad/s) as decided by the choreography.
 * Returns the number of wall contacts that were hard enough to be worth a
 * rattle sound — the caller decides whether to actually play one.
 */
export function stepTumble(state: TumbleState, dt: number, spin: number): number {
  state.spin = spin;
  let budget = Math.min(dt, MAX_CATCHUP) + state.carry;
  let steps = 0;
  while (budget >= TUMBLE_STEP) {
    state.angle += spin * TUMBLE_STEP;
    step(state, TUMBLE_STEP);
    budget -= TUMBLE_STEP;
    steps += 1;
  }
  state.carry = budget;

  if (steps === 0) return 0;
  // Rattle intensity: how many free balls are currently riding the wall fast.
  let loud = 0;
  const radialLimit = state.drumRadius - state.ballRadius;
  const near = radialLimit * 0.9;
  for (const b of state.balls) {
    if (b.released) continue;
    const d2 = b.y * b.y + b.z * b.z;
    if (d2 < near * near) continue;
    const s2 = b.vx * b.vx + b.vy * b.vy + b.vz * b.vz;
    if (s2 > 4) loud += 1;
  }
  return loud;
}

/** Look up a ball by its face number. */
export function findTumbleBall(state: TumbleState, n: number): TumbleBall | null {
  for (const b of state.balls) if (b.n === n) return b;
  return null;
}

/**
 * Nudge the whole pile — used when the crank is turned by hand so the cabinet
 * answers a pointer/keyboard press even before a round starts.
 */
export function agitateTumble(state: TumbleState, strength: number): void {
  for (const b of state.balls) {
    if (b.released) continue;
    b.vy += strength * 0.6;
    b.vz += (b.z >= 0 ? 1 : -1) * strength * 0.4;
  }
}
