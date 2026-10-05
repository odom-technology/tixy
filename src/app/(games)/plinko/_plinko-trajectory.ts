/* ---------------------------------------------------------------------------
   Plinko drop trajectory — deterministic kinematic playback.

   The server picks the outcome (path + slot) from the session seed; this
   module only turns that discrete peg walk into a continuous, physical-looking
   arc: an accelerating spawn fall, per-peg deflection hops with a bounce arc,
   and a final fall into the server-selected slot with a small settle bounce.

   Everything is a pure function of (path, rows, rng). The rng stream is
   derived from the same revealed seed, so one seed always replays the exact
   same motion — the animation visualizes the server result, it never
   influences it. Coordinates are percent of the board box (0..100).
   ------------------------------------------------------------------------- */

import { FEEL, squashAt } from '@/features/arcade/lib/game-feel';

export type Direction = 'L' | 'R';

export type PlinkoPoint = { x: number; y: number };

export type PlinkoSegment = {
  /** ms after animation start when the segment begins. */
  start: number;
  duration: number;
  from: PlinkoPoint;
  to: PlinkoPoint;
  /** Bounce-arc peak height (% of board height). 0 = straight fall. */
  arc: number;
};

export type PegImpact = {
  /** ms after animation start when the ball strikes this peg. */
  time: number;
  row: number;
  col: number;
};

export type PlinkoTrajectory = {
  segments: PlinkoSegment[];
  impacts: PegImpact[];
  /** ms when the ball first touches the slot mouth. */
  landTime: number;
  /** ms when the settle bounce has fully decayed. */
  restTime: number;
  /** Final resting position (slot mouth). */
  rest: PlinkoPoint;
};

export type PlinkoSample = {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
};

/** Peg centers, identical indexing to the discrete bounce model: the ball at
    (row, col) sits exactly on peg `col` of row `row`. */
export function pegPosition(row: number, col: number, rows: number): PlinkoPoint {
  return {
    x: (((rows - row) / 2 + col + 0.5) / (rows + 1)) * 100,
    y: ((row + 0.5) / (rows + 0.5)) * 100,
  };
}

/** Slot mouth at the board's bottom edge — matches the slot chip centers. */
export function slotPosition(slotIndex: number, rows: number): PlinkoPoint {
  return { x: ((slotIndex + 0.5) / (rows + 1)) * 100, y: 99 };
}

/* Timing tuning (ms). Hops speed up slightly as the ball gathers momentum. */
const SPAWN_MS = 250;
const HOP_START_MS = 178;
const HOP_MIN_MS = 128;
const HOP_ACCEL_PER_ROW = 3.4;
const SLOT_FALL_MS = 380;
const SETTLE_MS = 340;
const SQUASH_MS = 120;

/** Where the ball enters from — above the first peg it will strike. */
export function spawnPoint(firstCol: number, rows: number): PlinkoPoint {
  return { x: pegPosition(0, firstCol, rows).x, y: -9 };
}

export function buildPlinkoTrajectory(
  path: Direction[],
  rows: number,
  rng: () => number,
): PlinkoTrajectory {
  // Discrete peg walk — the same L/R sequence the server resolved.
  const cols: number[] = [];
  let col = 0;
  for (const dir of path) {
    if (dir === 'R') col += 1;
    cols.push(col);
  }
  const slotIndex = cols[cols.length - 1] ?? 0;

  const jitter = () => 0.92 + rng() * 0.16;

  const segments: PlinkoSegment[] = [];
  const impacts: PegImpact[] = [];
  let clock = 0;

  const push = (to: PlinkoPoint, duration: number, arc: number) => {
    const from =
      segments.length === 0
        ? spawnPoint(cols[0] ?? 0, rows)
        : segments[segments.length - 1].to;
    segments.push({ start: clock, duration, from, to, arc });
    clock += duration;
  };

  // 1. Spawn fall onto the first peg (straight, accelerating — arc 0).
  push(pegPosition(0, cols[0] ?? 0, rows), SPAWN_MS * jitter(), 0);
  impacts.push({ time: clock, row: 0, col: cols[0] ?? 0 });

  // 2. Peg-to-peg deflection hops with a bounce arc.
  for (let row = 1; row < rows; row++) {
    const from = pegPosition(row - 1, cols[row - 1] ?? 0, rows);
    const to = pegPosition(row, cols[row] ?? 0, rows);
    const base = Math.max(HOP_MIN_MS, HOP_START_MS - row * HOP_ACCEL_PER_ROW);
    push(to, base * jitter(), (to.y - from.y) * 0.55);
    impacts.push({ time: clock, row, col: cols[row] ?? 0 });
  }

  // 3. Final fall off the last peg into the slot.
  const lastPeg = pegPosition(rows - 1, cols[rows - 1] ?? 0, rows);
  const rest = slotPosition(slotIndex, rows);
  push(rest, SLOT_FALL_MS * jitter(), (rest.y - lastPeg.y) * 0.1);

  const landTime = clock;
  return {
    segments,
    impacts,
    landTime,
    restTime: landTime + SETTLE_MS,
    rest,
  };
}

function easeOutQuad(u: number): number {
  return 1 - (1 - u) * (1 - u);
}

/** Position + squash at t ms after animation start. */
export function samplePlinkoTrajectory(
  traj: PlinkoTrajectory,
  t: number,
): PlinkoSample {
  let x = traj.rest.x;
  let y = traj.rest.y;

  const seg = traj.segments.find(
    (s) => t < s.start + s.duration,
  );
  if (seg) {
    const u = Math.min(1, Math.max(0, (t - seg.start) / seg.duration));
    const dx = seg.to.x - seg.from.x;
    const dy = seg.to.y - seg.from.y;
    if (seg.arc > 0) {
      // Deflection hop: constant-ish horizontal drift decelerating into the
      // next peg; vertical follows a bounce arc that leaves the peg upward
      // and accelerates down onto the next one.
      x = seg.from.x + dx * easeOutQuad(u);
      y = seg.from.y + dy * u - 4 * seg.arc * u * (1 - u);
    } else {
      // Straight spawn fall: gravity ease-in, no horizontal drift.
      x = seg.from.x + dx * u;
      y = seg.from.y + dy * u * u;
    }
  } else {
    // Settle: one damped secondary bounce after touching the slot.
    const s = t - traj.landTime;
    if (s > 0 && s < traj.restTime - traj.landTime) {
      const span = traj.restTime - traj.landTime;
      y -= 1.5 * Math.sin((Math.PI * s) / span) * (1 - s / span);
    }
  }

  // Landing: the feel kit's squash, springing back with a small overshoot.
  // Reduced motion never plays a trajectory, so it is not checked here.
  const landDt = t - traj.landTime;
  if (landDt >= 0 && landDt < FEEL.squashMs) {
    const land = squashAt(landDt, { reduced: false });
    return { x, y, scaleX: land.scaleX, scaleY: land.scaleY };
  }

  // Squash & stretch on every peg strike.
  let squash = 0;
  for (const impact of traj.impacts) {
    const dt = t - impact.time;
    if (dt >= 0 && dt < SQUASH_MS) {
      squash = Math.max(squash, 1 - dt / SQUASH_MS);
    }
  }
  return {
    x,
    y,
    scaleX: 1 + 0.24 * squash,
    scaleY: 1 - 0.18 * squash,
  };
}
