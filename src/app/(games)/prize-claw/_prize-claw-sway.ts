/* ──────────────────────────────────────────────────────────────────────────
   PRIZE CLAW — sway and shift, the springs behind the picture.

   Everything here is presentation. The server decides the outcome and whether
   a prize slips; this module only makes the claw hang, swing and settle the
   way a real one does. It never reads a roll and nothing in it feeds a result.

   Time-based and continuous: each step takes the real frame time, runs in
   fixed substeps so a slow frame can't blow the spring up, and ends at rest.
   Pure: no three.js, no DOM, no clock of its own.
   ────────────────────────────────────────────────────────────────────────── */

const SUBSTEP = 1 / 240;

/** A hanging body's tilt about each horizontal axis, in radians. */
export type Swing = {
  /** About the x axis: leans toward -z when positive. */
  rx: number;
  rxVel: number;
  /** About the z axis: leans toward +x when positive. */
  rz: number;
  rzVel: number;
};

export type SwingParams = {
  /** Natural frequency, rad/s. */
  omega: number;
  /** Damping ratio: 0 swings for ever, 1 settles without overshoot. */
  zeta: number;
  /** Tilt per unit of pivot acceleration, in rad per (unit/s^2). */
  gain: number;
  /** The tilt never passes this. */
  limit: number;
};

/** The claw head on its short cable: about 1.2 Hz, a few swings to rest. */
export const CLAW_HEAD_SWAY: SwingParams = {
  omega: 7.5,
  zeta: 0.16,
  gain: 0.28,
  limit: 0.3,
};

/** A prize hanging in the fingers: slower and longer, so you see it swing. */
export const CLAW_PRIZE_SWING: SwingParams = {
  omega: 9.5,
  zeta: 0.09,
  gain: 0.34,
  limit: 0.5,
};

export function makeSwing(): Swing {
  return { rx: 0, rxVel: 0, rz: 0, rzVel: 0 };
}

export function resetSwing(s: Swing): void {
  s.rx = 0;
  s.rxVel = 0;
  s.rz = 0;
  s.rzVel = 0;
}

/**
 * Advance a swing by `dt` seconds. `ax` and `az` are the pivot's acceleration
 * in world units per second squared; `zeta` can be overridden per call so the
 * claw can be damped down before it closes on a prize.
 */
export function stepSwing(
  s: Swing,
  ax: number,
  az: number,
  dt: number,
  params: SwingParams,
  zeta: number = params.zeta,
): void {
  let left = Math.min(0.1, Math.max(0, dt));
  const { omega, gain, limit } = params;
  const k = omega * omega;
  const c = 2 * zeta * omega;
  while (left > 1e-9) {
    const h = Math.min(SUBSTEP, left);
    left -= h;
    const dz = -k * s.rz - c * s.rzVel - gain * ax;
    const dx = -k * s.rx - c * s.rxVel + gain * az;
    s.rzVel += dz * h;
    s.rxVel += dx * h;
    s.rz += s.rzVel * h;
    s.rx += s.rxVel * h;
    if (s.rz > limit) {
      s.rz = limit;
      s.rzVel = Math.min(0, s.rzVel);
    } else if (s.rz < -limit) {
      s.rz = -limit;
      s.rzVel = Math.max(0, s.rzVel);
    }
    if (s.rx > limit) {
      s.rx = limit;
      s.rxVel = Math.min(0, s.rxVel);
    } else if (s.rx < -limit) {
      s.rx = -limit;
      s.rxVel = Math.max(0, s.rxVel);
    }
  }
}

/** A direct push, in rad/s, for a jolt: the lift taking up a prize's weight. */
export function kickSwing(s: Swing, rxVel: number, rzVel: number): void {
  s.rxVel += rxVel;
  s.rzVel += rzVel;
}

/** A prize in the pile: how far it has been shoved and how far it leans. */
export type PileSpring = {
  x: number;
  z: number;
  xVel: number;
  zVel: number;
  /** Extra lean about x and z on top of its resting lean. */
  tx: number;
  tz: number;
  txVel: number;
  tzVel: number;
};

export function makePileSpring(): PileSpring {
  return { x: 0, z: 0, xVel: 0, zVel: 0, tx: 0, tz: 0, txVel: 0, tzVel: 0 };
}

export function resetPileSpring(p: PileSpring): void {
  p.x = p.z = p.xVel = p.zVel = p.tx = p.tz = p.txVel = p.tzVel = 0;
}

/** Shove a prize: `push` is a velocity in world units per second along (dx, dz). */
export function shovePile(p: PileSpring, dx: number, dz: number, push: number): void {
  const len = Math.hypot(dx, dz) || 1;
  const ux = dx / len;
  const uz = dz / len;
  p.xVel += ux * push;
  p.zVel += uz * push;
  // It tips the way it is pushed: toward +z about x, toward -x about z.
  p.txVel += uz * push * 2.5;
  p.tzVel -= ux * push * 2.5;
}

const PILE_K = 70;
const PILE_C = 9;

/** Settle a shoved prize back to where it sits. */
export function stepPileSpring(p: PileSpring, dt: number): void {
  let left = Math.min(0.1, Math.max(0, dt));
  while (left > 1e-9) {
    const h = Math.min(SUBSTEP, left);
    left -= h;
    p.xVel += (-PILE_K * p.x - PILE_C * p.xVel) * h;
    p.zVel += (-PILE_K * p.z - PILE_C * p.zVel) * h;
    p.txVel += (-PILE_K * p.tx - PILE_C * p.txVel) * h;
    p.tzVel += (-PILE_K * p.tz - PILE_C * p.tzVel) * h;
    p.x += p.xVel * h;
    p.z += p.zVel * h;
    p.tx += p.txVel * h;
    p.tz += p.tzVel * h;
  }
}

/** True once a spring has settled, so the loop can park. */
export function pileAtRest(p: PileSpring): boolean {
  return (
    Math.abs(p.x) + Math.abs(p.z) + Math.abs(p.tx) + Math.abs(p.tz) < 1e-4 &&
    Math.abs(p.xVel) + Math.abs(p.zVel) + Math.abs(p.txVel) + Math.abs(p.tzVel) < 1e-3
  );
}

export function swingAtRest(s: Swing): boolean {
  return (
    Math.abs(s.rx) + Math.abs(s.rz) < 2e-3 &&
    Math.abs(s.rxVel) + Math.abs(s.rzVel) < 2e-2
  );
}
