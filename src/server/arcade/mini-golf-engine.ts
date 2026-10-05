/**
 * Mini golf: the pure, deterministic putting engine. One engine for both
 * sides: the client steps it live at the fixed step and draws the ball
 * between steps; the score route replays every recorded putt through the
 * same steps. The same putt from the same spot rolls the same way, to the
 * same resting point, on every machine and at any display rate.
 *
 * The model (MINI_GOLF.md, "Physics"):
 *
 *  - The course is a 2.5D surface: the ball moves in the plane (x across,
 *    y up the screen toward the cup) and its height is a function of where
 *    it is. A hole is a set of 1 m cells. Each cell is flat at a level or a
 *    ramp between two levels, and mounds and bowls add smooth polynomial
 *    bumps on top. The ball never leaves the surface.
 *  - A rolling solid sphere feels 5/7 of the slope's pull (I = 2/5 m r^2),
 *    so on a slope of gradient m the ball accelerates by
 *    (5/7) g m / (1 + m^2) along the plane.
 *  - Rolling resistance on felt is a deceleration that grows as the ball
 *    slows (Hubbard and Alaways 1999 measured the same on real greens): it
 *    makes the last half metre decisive instead of a long glide.
 *  - Rails are segments with restitution, posts are circles, the windmill
 *    is a building with a tunnel whose blade closes the tunnel mouth on a
 *    timer, a loop is a vertical circle the ball rides in one dimension.
 *  - The cup: a ball whose centre passes over the hole drops while it
 *    crosses. It is captured if it drops a ball radius before it reaches
 *    the far rim (the same criterion that gives Holmes' 1.6 m/s for a real
 *    ball and cup). Otherwise it lips out, slowed and turned by how far it
 *    dropped and how far off centre it was. A ball rolling past the rim is
 *    pulled in a little, so a near miss curls.
 *
 * Determinism: a fixed 240 Hz step of + - * / and Math.sqrt over IEEE
 * doubles. No Math.sin, cos, atan2, exp, pow or hypot at run time (their
 * last bit can differ between JavaScript engines); the loop uses a fixed
 * polynomial for sine and cosine. No Date.now(), no Math.random(), no I/O.
 * A putt's direction is sent as a vector, never an angle, so the replay
 * needs no trigonometry.
 */

// ---------------------------------------------------------------------------
// Constants (exported so the course builder, the client and tools agree)
// ---------------------------------------------------------------------------

/** Bumped whenever the physics, the course or the scoring changes.
 *  2: the world runs at the pace its ball's size implies (MG_PACE). */
export const MG_RULES_VERSION = 2;

/** Fixed integrator step (seconds). */
export const MG_DT = 1 / 240;
export const MG_STEP_MS = 1000 / 240;
/** Game pace. The ball is drawn and simulated at about 2.8 times a real
 *  one, so at real gravity and real felt the whole hole plays in slow motion
 *  (a model at scale L runs sqrt(L) slow: Froude scaling). Every speed is a
 *  real-ball value times MG_PACE and every acceleration a real value times
 *  MG_PACE^2: the same paths as a real-size course, rolled 1.67 times
 *  quicker. */
export const MG_PACE = 1.6733200530681511; // sqrt(2.8)
const PACE2 = 2.8;
/** Gravity, m/s^2, at game pace. */
export const MG_G = 9.8 * PACE2;
/** A rolling solid sphere feels 5/7 of a force along the surface. */
const ROLL_K = 5 / 7;

/** The ball and the cup, in metres. The ball is drawn and simulated at
 *  about twice a real one (4.3 cm) so it reads on a phone; the cup keeps
 *  close to the real ratio of cup to ball (2.5). */
export const MG_BALL_R = 0.06;
export const MG_CUP_R = 0.12;
/** One cell of a hole, in metres. */
export const MG_CELL = 1;
/** One level of a raised green, in metres. A ramp climbs one level. */
export const MG_LEVEL_STEP = 0.22;

/** Launch speed range (m/s): the softest tap and a full drag. */
export const MG_MIN_SPEED = 0.25 * MG_PACE;
export const MG_MAX_SPEED = 4.4 * MG_PACE;
/** Smallest power a putt can have (a share of the range). */
export const MG_MIN_POWER = 0.02;

/** Rolling resistance on felt: A + B * V / (V + v), m/s^2. */
export const MG_ROLL_A = 0.42 * PACE2;
export const MG_ROLL_B = 0.62 * PACE2;
export const MG_ROLL_V = 0.32 * MG_PACE;
/** A ball slower than this, on a slope whose pull is under the static
 *  threshold, has stopped. */
const STOP_SPEED = 0.02 * MG_PACE;
/** Slope pull (m/s^2) the felt holds a still ball against: the felt's
 *  grip at rest, so a ball the felt can't move is at rest, and one it can
 *  is not. */
export const MG_STATIC_PULL = MG_ROLL_A + MG_ROLL_B;

/** Restitution and tangential keep, rails and posts. */
export const MG_RAIL_BOUNCE = 0.7;
export const MG_RAIL_KEEP = 0.95;
export const MG_POST_BOUNCE = 0.78;
export const MG_BLADE_BOUNCE = 0.45;
/** A knock slower than this along the normal makes no sound. */
const KNOCK_MIN = 0.12 * MG_PACE;

/** The cup's lip: within this of the rim, the ball is pulled toward the
 *  hole (m/s^2 at the rim, falling to 0). */
const LIP_REACH = MG_BALL_R * 0.7;
const LIP_PULL = 1.2 * PACE2;
/** Capture: the ball must drop this far (a ball radius) before it reaches
 *  the far rim. */
const CAPTURE_DROP = 2 * MG_BALL_R;

/** Longest a single putt may roll before it is called at rest (steps). */
export const MG_MAX_PUTT_STEPS = 240 * 25;

/** Strokes a hole allows. After the last one, a ball not in scores
 *  MG_MAX_STROKES + 1. */
export const MG_MAX_STROKES = 6;
export const MG_PICKUP_SCORE = MG_MAX_STROKES + 1;
export const MG_HOLES = 9;

/** The shortest a player can take between putts (ms after the last one
 *  came to rest). The client can't putt while the ball rolls. */
export const MG_MIN_AIM_MS = 120;

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

export type MgDir = 'n' | 's' | 'e' | 'w';

export interface MgSeg {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** What it is, for sound and drawing. */
  kind: 'rail' | 'mill' | 'tube';
}

export interface MgPost {
  x: number;
  y: number;
  r: number;
}

/** A smooth bump: height a * (1 - d^2/r^2)^2 inside radius r. Negative a
 *  is a bowl. */
export interface MgMound {
  x: number;
  y: number;
  r: number;
  a: number;
}

/** The windmill: a building across a north-south lane with a tunnel down
 *  its middle. The blade closes the tunnel mouth (the line y = gateY,
 *  |x - x| < halfGap) for part of each quarter turn. */
export interface MgWindmill {
  x: number;
  /** The tunnel mouth (the building's front face). */
  gateY: number;
  /** The building's back face. */
  backY: number;
  halfGap: number;
  halfWidth: number;
  /** One full turn of the sails, ms. */
  periodMs: number;
  /** Turn at t = 0, as a share of a full turn. */
  phase: number;
  /** Share of each quarter turn the blade blocks the mouth. */
  closed: number;
}

/** A loop: a vertical circle across a lane. The ball enters at (x, y)
 *  moving along (ux, uy), one of the four axis directions, inside the
 *  channel (within halfW of the axis), and leaves `advance` further on. */
export interface MgLoop {
  x: number;
  y: number;
  ux: number;
  uy: number;
  advance: number;
  halfW: number;
  radius: number;
}

export interface MgCell {
  col: number;
  row: number;
  /** Level at the cell's low edge (flat cells: their level). */
  level: number;
  /** A ramp rising toward this side, or null for flat. */
  ramp: MgDir | null;
  /** A bank: this corner's half of the cell is cut off by a diagonal rail
   *  (geometry only; the rail is in `walls`). */
  bank?: 'nw' | 'ne' | 'sw' | 'se';
}

export interface MgHole {
  /** Name shown on the scorecard ("the windmill"). */
  name: string;
  par: number;
  cols: number;
  rows: number;
  /** cellAt[row * cols + col] is an index into cells, or -1. */
  cellAt: Int16Array;
  cells: MgCell[];
  tee: { x: number; y: number };
  cup: { x: number; y: number };
  walls: MgSeg[];
  posts: MgPost[];
  mounds: MgMound[];
  windmills: MgWindmill[];
  loops: MgLoop[];
}

/** The cell under a point, or null off the course. */
export function mgCellAt(hole: MgHole, x: number, y: number): MgCell | null {
  const col = Math.floor(x / MG_CELL);
  const row = Math.floor(y / MG_CELL);
  if (col < 0 || row < 0 || col >= hole.cols || row >= hole.rows) return null;
  const index = hole.cellAt[row * hole.cols + col];
  return index >= 0 ? hole.cells[index] : null;
}

/** A cell's surface height and gradient (no mounds). */
function cellSurface(cell: MgCell, x: number, y: number, out: { h: number; gx: number; gy: number }): void {
  const base = cell.level * MG_LEVEL_STEP;
  if (!cell.ramp) {
    out.h = base;
    out.gx = 0;
    out.gy = 0;
    return;
  }
  const u0x = cell.col * MG_CELL;
  const u0y = cell.row * MG_CELL;
  const slope = MG_LEVEL_STEP / MG_CELL;
  // Share of the way up the ramp.
  if (cell.ramp === 'n') {
    out.h = base + (y - u0y) * slope;
    out.gx = 0;
    out.gy = slope;
  } else if (cell.ramp === 's') {
    out.h = base + (u0y + MG_CELL - y) * slope;
    out.gx = 0;
    out.gy = -slope;
  } else if (cell.ramp === 'e') {
    out.h = base + (x - u0x) * slope;
    out.gx = slope;
    out.gy = 0;
  } else {
    out.h = base + (u0x + MG_CELL - x) * slope;
    out.gx = -slope;
    out.gy = 0;
  }
}

const SURF = { h: 0, gx: 0, gy: 0 };

/** Surface height and gradient at a point: the cell plus every mound.
 *  Writes into `out` (allocation-free). Off the course: height 0, flat. */
export function mgSurface(hole: MgHole, x: number, y: number, out: { h: number; gx: number; gy: number }): void {
  const cell = mgCellAt(hole, x, y);
  if (cell) cellSurface(cell, x, y, out);
  else {
    out.h = 0;
    out.gx = 0;
    out.gy = 0;
  }
  for (const m of hole.mounds) {
    const dx = x - m.x;
    const dy = y - m.y;
    const r2 = m.r * m.r;
    const d2 = dx * dx + dy * dy;
    if (d2 >= r2) continue;
    const k = 1 - d2 / r2;
    out.h += m.a * k * k;
    // d/dx of a * k^2 = a * 2k * (-2 dx / r^2)
    const f = (-4 * m.a * k) / r2;
    out.gx += f * dx;
    out.gy += f * dy;
  }
}

/** Surface height at a point (for the scene builder). */
export function mgHeight(hole: MgHole, x: number, y: number): number {
  mgSurface(hole, x, y, SURF);
  return SURF.h;
}

/** Is the windmill's tunnel mouth blocked at sim time tMs? */
export function mgMillClosed(mill: MgWindmill, tMs: number): boolean {
  // Four sails: the pattern repeats every quarter turn. f is the share of
  // the current quarter turn; a sail points straight down at f = 0.
  const turns = tMs / mill.periodMs + mill.phase;
  const q = turns * 4;
  const f = q - Math.floor(q);
  const half = mill.closed / 2;
  return f < half || f > 1 - half;
}

/** The sails' turn (share of a full turn) at sim time tMs, for drawing. */
export function mgMillTurn(mill: MgWindmill, tMs: number): number {
  const turns = tMs / mill.periodMs + mill.phase;
  return turns - Math.floor(turns);
}

// ---------------------------------------------------------------------------
// Fixed-polynomial sine and cosine for the loop (|a| <= pi)
// ---------------------------------------------------------------------------

const PI = 3.141592653589793;
const TWO_PI = 6.283185307179586;
const HALF_PI = 1.5707963267948966;

function polySinHalf(a: number): number {
  // |a| <= pi/2: Taylor to a^13, error under 1e-9.
  const a2 = a * a;
  return (
    a *
    (1 -
      (a2 / 6) *
        (1 - (a2 / 20) * (1 - (a2 / 42) * (1 - (a2 / 72) * (1 - (a2 / 110) * (1 - a2 / 156))))))
  );
}

/** sin(a) for 0 <= a <= 2 pi, by symmetry onto |a| <= pi/2. */
export function mgSin(a: number): number {
  let x = a;
  if (x > PI) x -= TWO_PI; // now -pi..pi
  if (x > HALF_PI) x = PI - x;
  else if (x < -HALF_PI) x = -PI - x;
  return polySinHalf(x);
}

/** cos(a) for 0 <= a <= 2 pi. */
export function mgCos(a: number): number {
  let x = a + HALF_PI;
  if (x > TWO_PI) x -= TWO_PI;
  return mgSin(x);
}

// ---------------------------------------------------------------------------
// The ball
// ---------------------------------------------------------------------------

export type MgMode =
  /** Rolling on the course. */
  | 'roll'
  /** Riding a loop. */
  | 'loop'
  /** Dropped in the cup. The sim has stopped. */
  | 'holed'
  /** At rest. The sim has stopped. */
  | 'rest';

export type MgEvent =
  | { kind: 'rail'; speed: number; x: number; y: number }
  | { kind: 'post'; speed: number; x: number; y: number }
  | { kind: 'blade'; speed: number; x: number; y: number }
  | { kind: 'mill'; speed: number }
  | { kind: 'loopIn'; speed: number }
  | { kind: 'loopOut'; made: boolean; speed: number }
  | { kind: 'lip'; speed: number; drop: number }
  | { kind: 'cup'; speed: number }
  | { kind: 'rest' };

export interface MgBall {
  mode: MgMode;
  steps: number;
  /** Sim time at the putt (ms since the hole began). */
  t0: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Over the cup: the drop so far is tracked from entry. */
  overCup: boolean;
  cupChord: number;
  cupEntrySpeed: number;
  cupOffset: number;
  cupSteps: number;
  /** Loop: which loop, arc length and speed along it. */
  loop: number;
  s: number;
  vs: number;
  /** Highest point the ball reached in the loop (m above its floor). */
  loopTop: number;
}

/** Sim time (ms since the hole began) of a ball. */
export function mgBallTime(ball: MgBall): number {
  return ball.t0 + ball.steps * MG_STEP_MS;
}

/** Launch speed for a power share (0 to 1, clamped). */
export function mgPowerToSpeed(power: number): number {
  const p = power < MG_MIN_POWER ? MG_MIN_POWER : power > 1 ? 1 : power;
  return MG_MIN_SPEED + p * (MG_MAX_SPEED - MG_MIN_SPEED);
}

/**
 * A ball struck from (x, y) toward (dx, dy) at the given power share, at
 * sim time t (ms since the hole began). Returns null for a putt that
 * can't be struck (no direction, non-finite input).
 */
export function mgStartPutt(
  x: number,
  y: number,
  dx: number,
  dy: number,
  power: number,
  t: number,
): MgBall | null {
  if (![x, y, dx, dy, power, t].every(Number.isFinite)) return null;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1e-6) return null;
  const v = mgPowerToSpeed(power);
  return {
    mode: 'roll',
    steps: 0,
    t0: t,
    x,
    y,
    vx: (dx / len) * v,
    vy: (dy / len) * v,
    overCup: false,
    cupChord: 0,
    cupEntrySpeed: 0,
    cupOffset: 0,
    cupSteps: 0,
    loop: -1,
    s: 0,
    vs: 0,
    loopTop: 0,
  };
}

/** Rails within reach of each cell, in the hole's own order, built once
 *  per hole. Reach covers the ball, a step's travel and a push-out. */
const WALL_REACH = MG_BALL_R + 0.15;
const nearCache = new WeakMap<MgHole, MgSeg[][]>();
const NO_WALLS: MgSeg[] = [];

function nearWalls(hole: MgHole, x: number, y: number): MgSeg[] {
  let grid = nearCache.get(hole);
  if (!grid) {
    grid = [];
    for (let row = 0; row < hole.rows; row += 1) {
      for (let col = 0; col < hole.cols; col += 1) {
        const x0 = col * MG_CELL - WALL_REACH;
        const x1 = (col + 1) * MG_CELL + WALL_REACH;
        const y0 = row * MG_CELL - WALL_REACH;
        const y1 = (row + 1) * MG_CELL + WALL_REACH;
        grid.push(
          hole.walls.filter(
            (s) =>
              Math.max(s.x1, s.x2) >= x0 &&
              Math.min(s.x1, s.x2) <= x1 &&
              Math.max(s.y1, s.y2) >= y0 &&
              Math.min(s.y1, s.y2) <= y1,
          ),
        );
      }
    }
    nearCache.set(hole, grid);
  }
  const col = Math.floor(x / MG_CELL);
  const row = Math.floor(y / MG_CELL);
  if (col < 0 || row < 0 || col >= hole.cols || row >= hole.rows) return hole.walls.length ? hole.walls : NO_WALLS;
  return grid[row * hole.cols + col];
}

function rollDecel(speed: number): number {
  return MG_ROLL_A + (MG_ROLL_B * MG_ROLL_V) / (MG_ROLL_V + speed);
}

/** Push the ball off one segment; returns the normal impact speed or -1. */
function collideSeg(ball: MgBall, s: MgSeg, bounce: number): number {
  const ex = s.x2 - s.x1;
  const ey = s.y2 - s.y1;
  const len2 = ex * ex + ey * ey;
  let u = len2 > 0 ? ((ball.x - s.x1) * ex + (ball.y - s.y1) * ey) / len2 : 0;
  if (u < 0) u = 0;
  else if (u > 1) u = 1;
  const cx = s.x1 + ex * u;
  const cy = s.y1 + ey * u;
  const dx = ball.x - cx;
  const dy = ball.y - cy;
  const d2 = dx * dx + dy * dy;
  if (d2 >= MG_BALL_R * MG_BALL_R) return -1;
  const d = Math.sqrt(d2);
  let nx: number;
  let ny: number;
  if (d > 1e-9) {
    nx = dx / d;
    ny = dy / d;
  } else {
    // Dead on the line: push along the segment's left normal.
    const l = Math.sqrt(len2);
    nx = -ey / l;
    ny = ex / l;
  }
  const depth = MG_BALL_R - d;
  ball.x += nx * depth;
  ball.y += ny * depth;
  const vn = ball.vx * nx + ball.vy * ny;
  if (vn >= 0) return 0;
  // Reflect the normal part, keep most of the tangential part.
  const tx = ball.vx - vn * nx;
  const ty = ball.vy - vn * ny;
  ball.vx = tx * MG_RAIL_KEEP - vn * bounce * nx;
  ball.vy = ty * MG_RAIL_KEEP - vn * bounce * ny;
  return -vn;
}

function collidePost(ball: MgBall, p: MgPost): number {
  const dx = ball.x - p.x;
  const dy = ball.y - p.y;
  const reach = p.r + MG_BALL_R;
  const d2 = dx * dx + dy * dy;
  if (d2 >= reach * reach) return -1;
  const d = Math.sqrt(d2);
  const nx = d > 1e-9 ? dx / d : 0;
  const ny = d > 1e-9 ? dy / d : 1;
  const depth = reach - d;
  ball.x += nx * depth;
  ball.y += ny * depth;
  const vn = ball.vx * nx + ball.vy * ny;
  if (vn >= 0) return 0;
  const tx = ball.vx - vn * nx;
  const ty = ball.vy - vn * ny;
  ball.vx = tx * MG_RAIL_KEEP - vn * MG_POST_BOUNCE * nx;
  ball.vy = ty * MG_RAIL_KEEP - vn * MG_POST_BOUNCE * ny;
  return -vn;
}

/**
 * Advance one fixed step. Mutates `ball`; pushes what happened into
 * `events` when given. Pure otherwise.
 */
export function mgStep(hole: MgHole, ball: MgBall, events?: MgEvent[]): void {
  if (ball.mode === 'holed' || ball.mode === 'rest') return;
  const dt = MG_DT;
  const push = (event: MgEvent) => {
    if (events) events.push(event);
  };
  ball.steps += 1;

  // ── The loop: one dimension along a vertical circle ──
  if (ball.mode === 'loop') {
    const loop = hole.loops[ball.loop];
    const r = loop.radius;
    const phi = ball.s / r;
    const sn = mgSin(phi < 0 ? 0 : phi > TWO_PI ? TWO_PI : phi);
    const cs = mgCos(phi < 0 ? 0 : phi > TWO_PI ? TWO_PI : phi);
    const dir = ball.vs >= 0 ? 1 : -1;
    // Gravity along the track (5/7, rolling) and rolling resistance.
    ball.vs -= (ROLL_K * MG_G * sn + dir * rollDecel(ball.vs * dir)) * dt;
    ball.s += ball.vs * dt;
    const height = r * (1 - cs);
    if (height > ball.loopTop) ball.loopTop = height;
    // Still pressed to the track? N/m = v^2/r + g cos(phi) (phi = 0 at the bottom).
    const pressed = (ball.vs * ball.vs) / r + MG_G * cs;
    if (ball.s >= TWO_PI * r) {
      // Round: out the far side, moving on along the axis.
      const speed = ball.vs;
      ball.mode = 'roll';
      ball.x = loop.x + loop.ux * loop.advance;
      ball.y = loop.y + loop.uy * loop.advance;
      ball.vx = loop.ux * speed;
      ball.vy = loop.uy * speed;
      ball.loop = -1;
      push({ kind: 'loopOut', made: true, speed });
      return;
    }
    if (pressed < 0 || ball.vs <= 0 || ball.steps >= MG_MAX_PUTT_STEPS) {
      // Fell off near the top, or ran out of pace and turned back: back
      // out the mouth, moving south, at the speed the way down gives it
      // (less for a fall, which lands hard).
      const drop = Math.sqrt((10 / 7) * MG_G * (ball.loopTop > 0 ? ball.loopTop : 0));
      const back = (pressed < 0 ? 0.55 : 0.8) * drop;
      const out = back > 0.05 * MG_PACE ? back : 0.05 * MG_PACE;
      ball.mode = 'roll';
      ball.x = loop.x - loop.ux * MG_BALL_R * 0.5;
      ball.y = loop.y - loop.uy * MG_BALL_R * 0.5;
      ball.vx = -loop.ux * out;
      ball.vy = -loop.uy * out;
      ball.loop = -1;
      push({ kind: 'loopOut', made: false, speed: back });
    }
    return;
  }

  // ── Rolling ──
  mgSurface(hole, ball.x, ball.y, SURF);
  const m2 = SURF.gx * SURF.gx + SURF.gy * SURF.gy;
  // Slope pull, horizontal: (5/7) g m / (1 + m^2), down the gradient.
  const pullK = (ROLL_K * MG_G) / (1 + m2);
  let ax = -pullK * SURF.gx;
  let ay = -pullK * SURF.gy;

  // The cup's lip pulls a passing ball toward the hole.
  const cdx = hole.cup.x - ball.x;
  const cdy = hole.cup.y - ball.y;
  const cd2 = cdx * cdx + cdy * cdy;
  const lipOuter = MG_CUP_R + LIP_REACH;
  if (!ball.overCup && cd2 < lipOuter * lipOuter && cd2 > MG_CUP_R * MG_CUP_R) {
    const cd = Math.sqrt(cd2);
    const k = (lipOuter - cd) / LIP_REACH;
    ax += (cdx / cd) * LIP_PULL * k;
    ay += (cdy / cd) * LIP_PULL * k;
  }

  const speed = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy);
  const pull2 = ax * ax + ay * ay;
  const decel = rollDecel(speed);
  if (speed < STOP_SPEED && pull2 <= MG_STATIC_PULL * MG_STATIC_PULL && !ball.overCup) {
    // Nearly still, and the felt holds it against the slope: at rest.
    ball.vx = 0;
    ball.vy = 0;
    ball.mode = 'rest';
    push({ kind: 'rest' });
    return;
  }
  // Integrate: slope and lip, then the felt against the motion.
  ball.vx += ax * dt;
  ball.vy += ay * dt;
  const sp = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy);
  if (sp > 0) {
    const drop = decel * dt;
    if (sp <= drop) {
      ball.vx = 0;
      ball.vy = 0;
    } else {
      const keep = (sp - drop) / sp;
      ball.vx *= keep;
      ball.vy *= keep;
    }
  }
  ball.x += ball.vx * dt;
  ball.y += ball.vy * dt;

  // ── The windmill: the blade closes the tunnel mouth ──
  const tNow = mgBallTime(ball);
  for (const mill of hole.windmills) {
    const inMouth = ball.x > mill.x - mill.halfGap && ball.x < mill.x + mill.halfGap;
    if (!inMouth) continue;
    const dy = ball.y - mill.gateY;
    if (dy > -MG_BALL_R && dy < MG_BALL_R * 0.5 && mgMillClosed(mill, tNow)) {
      // The sail is down across the mouth: the ball knocks off it.
      const vn = ball.vy;
      ball.y = mill.gateY - MG_BALL_R;
      if (vn > 0) {
        ball.vy = -vn * MG_BLADE_BOUNCE;
        ball.vx *= MG_RAIL_KEEP;
        if (vn > KNOCK_MIN) push({ kind: 'blade', speed: vn, x: ball.x, y: ball.y });
      }
    }
  }

  // ── Rails and posts (two passes settle corners). Only the rails near the
  //    ball's cell are tried; the rest can't touch it this step. ──
  const near = nearWalls(hole, ball.x, ball.y);
  for (let pass = 0; pass < 2; pass += 1) {
    for (const seg of near) {
      const hit = collideSeg(ball, seg, MG_RAIL_BOUNCE);
      if (hit > KNOCK_MIN && pass === 0) {
        push(
          seg.kind === 'mill'
            ? { kind: 'mill', speed: hit }
            : { kind: 'rail', speed: hit, x: ball.x, y: ball.y },
        );
      }
    }
    for (const post of hole.posts) {
      const hit = collidePost(ball, post);
      if (hit > KNOCK_MIN && pass === 0) push({ kind: 'post', speed: hit, x: ball.x, y: ball.y });
    }
  }

  // ── Loops: a ball crossing the mouth along the loop's way rides it ──
  for (let i = 0; i < hole.loops.length; i += 1) {
    const loop = hole.loops[i];
    const along = ball.vx * loop.ux + ball.vy * loop.uy;
    if (along <= 0) continue;
    const rx = ball.x - loop.x;
    const ry = ball.y - loop.y;
    // Lateral offset from the axis, and position along it.
    const off = rx * loop.uy - ry * loop.ux;
    if (off <= -loop.halfW || off >= loop.halfW) continue;
    const u = rx * loop.ux + ry * loop.uy;
    const uPrev = u - along * dt;
    if (uPrev < 0 && u >= 0) {
      const v = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy);
      ball.mode = 'loop';
      ball.loop = i;
      ball.s = 0;
      ball.vs = v;
      ball.loopTop = 0;
      ball.x = loop.x;
      ball.y = loop.y;
      push({ kind: 'loopIn', speed: v });
      return;
    }
  }

  // ── The cup ──
  const ex = ball.x - hole.cup.x;
  const ey = ball.y - hole.cup.y;
  const e2 = ex * ex + ey * ey;
  if (e2 < MG_CUP_R * MG_CUP_R) {
    const v = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy);
    if (!ball.overCup) {
      ball.overCup = true;
      ball.cupSteps = 0;
      ball.cupEntrySpeed = v;
      // Distance of the cup's centre from the ball's line of travel.
      const off = v > 1e-9 ? (ex * ball.vy - ey * ball.vx) / v : 0;
      const p = off < 0 ? -off : off;
      ball.cupOffset = p;
      const half2 = MG_CUP_R * MG_CUP_R - p * p;
      ball.cupChord = half2 > 0 ? 2 * Math.sqrt(half2) : 0;
    }
    ball.cupSteps += 1;
    // Unsupported over the hole: it has fallen g t^2 / 2 so far.
    const tOver = ball.cupSteps * dt;
    const drop = 0.5 * MG_G * tOver * tOver;
    if (drop >= CAPTURE_DROP || v < 1e-6) {
      ball.mode = 'holed';
      push({ kind: 'cup', speed: ball.cupEntrySpeed });
      return;
    }
  } else if (ball.overCup) {
    // It crossed without dropping far enough: the far rim knocks it up and
    // turns it. Deeper drops lose more and turn more.
    const tOver = ball.cupSteps * dt;
    const drop = 0.5 * MG_G * tOver * tOver;
    const depth = drop / CAPTURE_DROP; // 0..1
    const keep = 1 - 0.55 * depth;
    // Turn away from the cup's centre, by how far off centre it was.
    const side = ex * ball.vy - ey * ball.vx >= 0 ? 1 : -1;
    const turn = 0.9 * depth * (ball.cupOffset / MG_CUP_R) + 0.15 * depth;
    // Rotate by a small angle without trig: (c, s) from the turn, normalised.
    const c = 1;
    const s = -side * turn;
    const n = Math.sqrt(c * c + s * s);
    const vx = ball.vx * keep;
    const vy = ball.vy * keep;
    ball.vx = (vx * c - vy * s) / n;
    ball.vy = (vx * s + vy * c) / n;
    ball.overCup = false;
    ball.cupSteps = 0;
    push({ kind: 'lip', speed: Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy), drop: depth });
  }

  if (ball.steps >= MG_MAX_PUTT_STEPS && ball.mode === 'roll') {
    ball.vx = 0;
    ball.vy = 0;
    ball.mode = 'rest';
    push({ kind: 'rest' });
  }
}

export interface MgPuttResult {
  holed: boolean;
  /** Where it stopped (the cup's centre when holed). */
  x: number;
  y: number;
  steps: number;
  /** Sim time the putt took, ms. */
  durationMs: number;
}

/** Run one putt to rest or the cup. Pure and deterministic. */
export function mgSimulatePutt(
  hole: MgHole,
  from: { x: number; y: number },
  dx: number,
  dy: number,
  power: number,
  t: number,
  events?: MgEvent[],
): MgPuttResult | null {
  const ball = mgStartPutt(from.x, from.y, dx, dy, power, t);
  if (!ball) return null;
  while (ball.mode === 'roll' || ball.mode === 'loop') mgStep(hole, ball, events);
  const holed = ball.mode === 'holed';
  return {
    holed,
    x: holed ? hole.cup.x : ball.x,
    y: holed ? hole.cup.y : ball.y,
    steps: ball.steps,
    durationMs: ball.steps * MG_STEP_MS,
  };
}

// ---------------------------------------------------------------------------
// Holes and rounds: the state machine the client and the validator both run
// ---------------------------------------------------------------------------

export interface MgPutt {
  /** ms since the hole began (the client's hole clock at release). */
  t: number;
  dx: number;
  dy: number;
  power: number;
}

export interface MgHoleResult {
  /** Strokes taken (1 to MG_MAX_STROKES). */
  strokes: number;
  holed: boolean;
  /** The hole's score: strokes when holed, MG_PICKUP_SCORE when not. */
  score: number;
  /** 'ok', or why the putts stopped counting. */
  stop: 'holed' | 'pickup' | 'bounds' | 'short';
  /** Each putt's resting point, for drawing a resume. */
  rests: Array<{ x: number; y: number }>;
}

/** Round a putt the way the client sends it. */
export function mgQuantizePutt(putt: MgPutt): MgPutt {
  return {
    t: Math.round(putt.t),
    dx: Math.round(putt.dx * 10000) / 10000,
    dy: Math.round(putt.dy * 10000) / 10000,
    power: Math.round(putt.power * 1000) / 1000,
  };
}

/**
 * Replay one hole's putts. Pure and never throws: bad input stops the hole
 * with stop 'bounds'. 'short' means the putts ran out before the ball was
 * in and before the stroke limit (an unfinished hole).
 */
export function mgReplayHole(hole: MgHole, putts: readonly MgPutt[]): MgHoleResult {
  let x = hole.tee.x;
  let y = hole.tee.y;
  let readyAt = 0;
  const rests: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < putts.length; i += 1) {
    if (i >= MG_MAX_STROKES) return { strokes: i, holed: false, score: MG_PICKUP_SCORE, stop: 'bounds', rests };
    const p = putts[i];
    if (
      !p ||
      typeof p.t !== 'number' ||
      typeof p.dx !== 'number' ||
      typeof p.dy !== 'number' ||
      typeof p.power !== 'number' ||
      !Number.isFinite(p.t) ||
      p.t < readyAt ||
      p.t > 3_600_000 ||
      p.power < 0 ||
      p.power > 1
    ) {
      return { strokes: i, holed: false, score: MG_PICKUP_SCORE, stop: 'bounds', rests };
    }
    const result = mgSimulatePutt(hole, { x, y }, p.dx, p.dy, p.power, p.t);
    if (!result) return { strokes: i, holed: false, score: MG_PICKUP_SCORE, stop: 'bounds', rests };
    x = result.x;
    y = result.y;
    rests.push({ x, y });
    readyAt = p.t + result.durationMs + MG_MIN_AIM_MS;
    if (result.holed) {
      if (i !== putts.length - 1) {
        // Putts after the ball is in.
        return { strokes: i + 1, holed: true, score: i + 1, stop: 'bounds', rests };
      }
      return { strokes: i + 1, holed: true, score: i + 1, stop: 'holed', rests };
    }
  }
  if (putts.length >= MG_MAX_STROKES) {
    return { strokes: MG_MAX_STROKES, holed: false, score: MG_PICKUP_SCORE, stop: 'pickup', rests };
  }
  return { strokes: putts.length, holed: false, score: MG_PICKUP_SCORE, stop: 'short', rests };
}

/** Points a hole is worth toward tickets: MG_PICKUP_SCORE minus its score,
 *  so a hole in one is 6 and a pickup 0. */
export function mgHolePoints(score: number): number {
  const p = MG_PICKUP_SCORE - score;
  return p < 0 ? 0 : p;
}
