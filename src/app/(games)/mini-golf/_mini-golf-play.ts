/* Mini golf playback and aim: pure, no three.js, no DOM.

   Playback: the client steps the shared engine live at its fixed 240 Hz
   from the display's frame times and draws the ball between the last two
   steps. Nothing is pre-recorded or stretched, so the ball rolls the same
   at 30, 60, 120 or 144 Hz and stops where the server's replay stops.

   Aim: the line drawn from the ball is a ray cast against the rails and
   posts, with one bounce, so the player sees where a straight putt meets
   the first rail. It ignores slopes on purpose: reading the break is the
   player's job. */

import {
  MG_BALL_R,
  MG_PACE,
  MG_STEP_MS,
  mgStartPutt,
  mgStep,
  type MgBall,
  type MgEvent,
  type MgHole,
} from '@/server/arcade/mini-golf-engine';

export type MgSample = { x: number; y: number; vx: number; vy: number; mode: MgBall['mode']; s: number; loop: number };

export type MgPlayback = {
  readonly ball: MgBall;
  /** Advance by `ms` of effect time; returns what happened in the steps run. */
  advance(ms: number): MgEvent[];
  /** The ball drawn between the last two steps. */
  sample(out: MgSample): void;
  /** Sim time now (ms since the hole began), interpolated. */
  time(): number;
};

/** Live playback of one putt. Null when the putt can't be struck. */
export function createMgPlayback(
  hole: MgHole,
  from: { x: number; y: number },
  dx: number,
  dy: number,
  power: number,
  t: number,
): MgPlayback | null {
  const ball = mgStartPutt(from.x, from.y, dx, dy, power, t);
  if (!ball) return null;
  const prev = { x: ball.x, y: ball.y, vx: ball.vx, vy: ball.vy, s: ball.s, mode: ball.mode, loop: ball.loop };
  let acc = 0;
  const live = () => ball.mode === 'roll' || ball.mode === 'loop';
  return {
    ball,
    advance(ms) {
      const events: MgEvent[] = [];
      // A long stall (a background tab) never runs more than a quarter second.
      acc += Math.min(250, Math.max(0, ms));
      while (acc >= MG_STEP_MS) {
        if (!live()) {
          acc = 0;
          break;
        }
        acc -= MG_STEP_MS;
        prev.x = ball.x;
        prev.y = ball.y;
        prev.vx = ball.vx;
        prev.vy = ball.vy;
        prev.s = ball.s;
        prev.mode = ball.mode;
        prev.loop = ball.loop;
        mgStep(hole, ball, events);
      }
      return events;
    },
    sample(out) {
      const k = live() ? acc / MG_STEP_MS : 1;
      // A mode change between the two steps (into or out of a loop) draws
      // the newer step: there is nothing to blend between.
      if (prev.mode !== ball.mode) {
        out.x = ball.x;
        out.y = ball.y;
        out.vx = ball.vx;
        out.vy = ball.vy;
        out.s = ball.s;
        out.mode = ball.mode;
        out.loop = ball.loop;
        return;
      }
      out.x = prev.x + (ball.x - prev.x) * k;
      out.y = prev.y + (ball.y - prev.y) * k;
      out.vx = prev.vx + (ball.vx - prev.vx) * k;
      out.vy = prev.vy + (ball.vy - prev.vy) * k;
      out.s = prev.s + (ball.s - prev.s) * k;
      out.mode = ball.mode;
      out.loop = ball.loop;
    },
    time() {
      return ball.t0 + (ball.steps + (live() ? acc / MG_STEP_MS : 0)) * MG_STEP_MS;
    },
  };
}

/** Run a putt ahead to its end, for the roll rumble: speed while it rolls,
 *  0 in the loop's upper half. Samples every `every` steps. */
export function mgSpeedTrack(
  hole: MgHole,
  from: { x: number; y: number },
  dx: number,
  dy: number,
  power: number,
  t: number,
  every = 4,
): { speeds: number[]; seconds: number } {
  const ball = mgStartPutt(from.x, from.y, dx, dy, power, t);
  const speeds: number[] = [];
  if (!ball) return { speeds, seconds: 0 };
  while (ball.mode === 'roll' || ball.mode === 'loop') {
    mgStep(hole, ball);
    if (ball.steps % every === 0) {
      const v =
        ball.mode === 'loop' ? Math.abs(ball.vs) * 0.6 : Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy);
      speeds.push(Math.min(1, v / (3.2 * MG_PACE)));
    }
  }
  return { speeds, seconds: (speeds.length * every * MG_STEP_MS) / 1000 };
}

// ── Aim ray ──

export type AimPath = { points: Array<{ x: number; y: number }>; bounced: boolean };

function raySeg(
  ox: number,
  oy: number,
  dx: number,
  dy: number,
  s: { x1: number; y1: number; x2: number; y2: number },
  r: number,
): { t: number; nx: number; ny: number } | null {
  // The ball (radius r) against the segment: offset the segment toward the
  // ray's origin by r along its normal.
  const ex = s.x2 - s.x1;
  const ey = s.y2 - s.y1;
  const len = Math.sqrt(ex * ex + ey * ey);
  if (len < 1e-9) return null;
  let nx = -ey / len;
  let ny = ex / len;
  if ((ox - s.x1) * nx + (oy - s.y1) * ny < 0) {
    nx = -nx;
    ny = -ny;
  }
  const ax = s.x1 + nx * r;
  const ay = s.y1 + ny * r;
  const den = dx * ey - dy * ex;
  if (Math.abs(den) < 1e-12) return null;
  const t = ((ax - ox) * ey - (ay - oy) * ex) / den;
  const u = ((ax - ox) * dy - (ay - oy) * dx) / den;
  if (t <= 1e-4 || u < -0.02 || u > 1.02) return null;
  return { t, nx, ny };
}

function rayCircle(ox: number, oy: number, dx: number, dy: number, cx: number, cy: number, r: number) {
  const fx = ox - cx;
  const fy = oy - cy;
  const b = fx * dx + fy * dy;
  const c = fx * fx + fy * fy - r * r;
  const disc = b * b - c;
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  if (t <= 1e-4) return null;
  const hx = ox + dx * t;
  const hy = oy + dy * t;
  const l = Math.sqrt((hx - cx) ** 2 + (hy - cy) ** 2) || 1;
  return { t, nx: (hx - cx) / l, ny: (hy - cy) / l };
}

/** The aim line: `length` metres from the ball, bending once off the first
 *  rail or post it meets. */
export function mgAimPath(hole: MgHole, from: { x: number; y: number }, dx: number, dy: number, length: number): AimPath {
  const points = [{ x: from.x, y: from.y }];
  let ox = from.x;
  let oy = from.y;
  let left = length;
  let bounced = false;
  for (let leg = 0; leg < 2 && left > 0; leg += 1) {
    let best: { t: number; nx: number; ny: number } | null = null;
    for (const s of hole.walls) {
      const hit = raySeg(ox, oy, dx, dy, s, MG_BALL_R);
      if (hit && (!best || hit.t < best.t)) best = hit;
    }
    for (const p of hole.posts) {
      const hit = rayCircle(ox, oy, dx, dy, p.x, p.y, p.r + MG_BALL_R);
      if (hit && (!best || hit.t < best.t)) best = hit;
    }
    if (!best || best.t >= left || leg === 1) {
      const t = best ? Math.min(best.t, left) : left;
      points.push({ x: ox + dx * t, y: oy + dy * t });
      break;
    }
    ox += dx * best.t;
    oy += dy * best.t;
    points.push({ x: ox, y: oy });
    left -= best.t;
    const vn = dx * best.nx + dy * best.ny;
    dx -= 2 * vn * best.nx;
    dy -= 2 * vn * best.ny;
    // The bounce leg is drawn shorter, as a hint.
    left *= 0.55;
    bounced = true;
  }
  return { points, bounced };
}
