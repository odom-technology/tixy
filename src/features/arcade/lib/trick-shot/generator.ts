/* The day's table, built from the date by simulation.

   How a table is built (deterministic from the date, no clock, no
   Math.random):
   1. The cue ball goes down, then the first object ball a few ball widths
      away, and the first shot is aimed by the ghost ball so that ball runs
      into a pocket with a real cut, so the cue ball comes off it at an angle.
   2. The shot is simulated on the 8-ball engine. Along the cue ball's path
      after its last contact, the next ball is placed one ball width short of
      a pocket line from where the cue ball passes, so the cue ball, arriving
      there, sends it into that pocket. The shot is simulated again with the
      new ball; if every ball still drops and the cue ball stays up, it stays.
   3. Repeat until the day's count of balls is on the table.
   4. The clearing window is measured: how far the aim can move either side
      at the same power and spin and still clear. The aim is moved to the
      middle of that window, and the power window is measured there.
   5. Candidates are tried in a fixed order until one fits the weekday's
      band; otherwise the widest one wins. Monday is easy, Sunday is hard.

   Every table is therefore clearable by construction, with a known shot,
   and the verifier replays that shot for every day it checks. */

import {
  BALL_DIAMETER,
  BALL_RADIUS,
  CUSHION_WIDTH,
  POCKETS,
  ROLLING_DECEL,
  TABLE_HEIGHT,
  TABLE_WIDTH,
} from '@/features/arcade/lib/pool-physics';

import { hashString, mulberry32, shuffled } from './rng';
import { gradeTrickShot, trickShotWeekday, type TrickShotDifficulty } from './rules';
import {
  playTrickShot,
  TRICK_SHOT_ANGLE_STEP,
  TRICK_SHOT_POWER_STEP,
  type TrickShotBall,
  type TrickShotInput,
} from './shot';

export const TRICK_SHOT_GENERATOR_VERSION = 1;

export type TrickShotPosition = {
  dateKey: string;
  version: number;
  /** Cue ball first (id 0), then the object balls. Table units. */
  balls: TrickShotBall[];
  ballCount: number;
  difficulty: TrickShotDifficulty;
  /** A shot that clears the table, kept on the server. */
  solution: TrickShotInput;
  /** Degrees of aim either side summed, and percent of power, that clear. */
  window: { angleDeg: number; powerPct: number };
};

/** What the client is sent: never the solution. */
export type TrickShotTable = Omit<TrickShotPosition, 'solution' | 'window'>;

export const publicTable = (position: TrickShotPosition): TrickShotTable => ({
  dateKey: position.dateKey,
  version: position.version,
  balls: position.balls,
  ballCount: position.ballCount,
  difficulty: position.difficulty,
});

export type Tier = {
  balls: number;
  /** The band the window should fall in, degrees. */
  minWindow: number;
  maxWindow: number;
  /** Cue ball to the first ball, in ball widths. */
  firstGap: [number, number];
  /** Farthest a ball may sit from its pocket, in ball widths. */
  potReach: number;
  /** How far along the cue ball's path the next ball may sit, in frames. */
  pathReach: number;
  /** And how far from the last contact, in ball widths of travel. */
  pathGap: [number, number];
  spins: ReadonlyArray<[number, number]>;
  /** Least power window, in whole percent, that still clears. */
  minPower: number;
  /** May the cue ball come off a cushion between two balls. */
  rails: boolean;
};

const STUN: ReadonlyArray<[number, number]> = [[0, 0]];
const SPINS: ReadonlyArray<[number, number]> = [
  [0, 0],
  [0, 0],
  [0, 0.5],
  [0, -0.5],
  [0.4, 0],
  [-0.4, 0],
];

/** Monday to Sunday. Tuned by scripts/sim-trick-shot.ts: each band is
 *  one a candidate lands in often enough that every day finds one. Four
 *  balls in one shot never left a window a hand can find (0.01 to 0.02°),
 *  so three is the most. */
const THREE: Omit<Tier, 'minWindow' | 'maxWindow'> = {
  balls: 3,
  minPower: 5,
  rails: true,
  firstGap: [2, 7],
  potReach: 14,
  pathReach: 30,
  pathGap: [2, 10],
  spins: SPINS,
};

export const TRICK_SHOT_TIERS: readonly Tier[] = [
  { balls: 2, minWindow: 0.4, maxWindow: 3, minPower: 12, rails: false, firstGap: [2.5, 6], potReach: 10, pathReach: 30, pathGap: [2, 12], spins: STUN },
  { balls: 2, minWindow: 0.18, maxWindow: 0.4, minPower: 8, rails: true, firstGap: [3, 9], potReach: 14, pathReach: 45, pathGap: [2, 14], spins: SPINS },
  { ...THREE, minWindow: 0.4, maxWindow: 3 },
  { ...THREE, minWindow: 0.2, maxWindow: 0.4 },
  { ...THREE, minWindow: 0.1, maxWindow: 0.2 },
  { ...THREE, minWindow: 0.05, maxWindow: 0.1 },
  { ...THREE, minWindow: 0.05, maxWindow: 0.16, minPower: 4, firstGap: [3, 9], pathGap: [3, 14], pathReach: 45 },
];

/** Fixed work per day, so every machine builds the same table. */
const MAX_BUILDS = 4_000_000;
const MAX_CANDIDATES = 500;
/** Shots that roll longer than this make a dull wait. */
const MAX_SHOT_FRAMES = 660;

const D = BALL_DIAMETER;
const EDGE = BALL_RADIUS + 6;
const MIN_X = CUSHION_WIDTH + EDGE;
const MAX_X = TABLE_WIDTH - CUSHION_WIDTH - EDGE;
const MIN_Y = CUSHION_WIDTH + EDGE;
const MAX_Y = TABLE_HEIGHT - CUSHION_WIDTH - EDGE;
const DEG = Math.PI / 180;
const OBJECT_IDS = [1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13, 14, 15];

const tenth = (v: number) => Math.round(v * 10) / 10;

function spotIsFree(x: number, y: number, balls: readonly TrickShotBall[], cueRoom = false): boolean {
  const pad = cueRoom ? D * 1.2 : 0;
  if (x < MIN_X + pad || x > MAX_X - pad || y < MIN_Y + pad || y > MAX_Y - pad) return false;
  for (const p of POCKETS) if (Math.hypot(p.x - x, p.y - y) < D * 2.6) return false;
  for (const b of balls) if (Math.hypot(b.x - x, b.y - y) < D * 1.3) return false;
  return true;
}

type Built = { balls: TrickShotBall[]; shot: TrickShotInput };

function clears(balls: readonly TrickShotBall[], shot: TrickShotInput) {
  const play = playTrickShot(balls, shot);
  return { ok: play.clear && play.result.totalFrames <= MAX_SHOT_FRAMES, play };
}

export function buildOnce(rng: () => number, tier: Tier): Built | null {
  const cue: TrickShotBall = {
    id: 0,
    x: tenth(MIN_X + rng() * (MAX_X - MIN_X)),
    y: tenth(MIN_Y + rng() * (MAX_Y - MIN_Y)),
  };
  if (!spotIsFree(cue.x, cue.y, [], true)) return null;
  const ids = shuffled(OBJECT_IDS, rng);

  const heading = rng() * Math.PI * 2;
  const gap = D * (tier.firstGap[0] + rng() * (tier.firstGap[1] - tier.firstGap[0]));
  const first: TrickShotBall = {
    id: ids[0]!,
    x: tenth(cue.x + Math.cos(heading) * gap),
    y: tenth(cue.y + Math.sin(heading) * gap),
  };
  if (!spotIsFree(first.x, first.y, [cue])) return null;

  const [spinX, spinY] = tier.spins[Math.floor(rng() * tier.spins.length)]!;
  const power = Math.round((0.45 + rng() * 0.45) * 100) / 100;
  let shot: TrickShotInput | null = null;
  for (const pocketIndex of shuffled([0, 1, 2, 3, 4, 5], rng)) {
    const pocket = POCKETS[pocketIndex]!;
    const nx = pocket.x - first.x;
    const ny = pocket.y - first.y;
    const reach = Math.hypot(nx, ny);
    if (reach > D * tier.potReach) continue;
    const ghostX = first.x - (nx / reach) * D;
    const ghostY = first.y - (ny / reach) * D;
    const vx = ghostX - cue.x;
    const vy = ghostY - cue.y;
    const run = Math.hypot(vx, vy);
    const cut = Math.acos(Math.max(-1, Math.min(1, (vx * nx + vy * ny) / (run * reach))));
    if (cut > 55 * DEG) continue;
    if (tier.balls > 1 && cut < 14 * DEG) continue;
    shot = { angle: Math.atan2(vy, vx), power, spinX, spinY };
    break;
  }
  if (!shot) return null;

  let balls: TrickShotBall[] = [cue, first];
  let check = clears(balls, shot);
  if (!check.ok) return null;

  for (let step = 1; step < tier.balls; step += 1) {
    const { frames, events } = check.play.result;
    let lastHit = 0;
    for (const e of events) if (e.type === 'ballCollision' && e.ballIds.includes(0)) lastHit = e.frame;
    let railAt = Infinity;
    if (!tier.rails) {
      for (const e of events) {
        if (e.type === 'cushionHit' && e.ballIds[0] === 0 && e.frame > lastHit) {
          railAt = e.frame;
          break;
        }
      }
    }
    const path: Array<{ x: number; y: number; vx: number; vy: number }> = [];
    let travelled = 0;
    for (let f = lastHit + 1; f < frames.length - 1 && f < railAt - 1 && path.length < tier.pathReach; f += 1) {
      const a = frames[f]!.find((b) => b.id === 0);
      const b = frames[f + 1]!.find((b2) => b2.id === 0);
      if (!a || !b) break;
      const vx = b.x - a.x;
      const vy = b.y - a.y;
      const speed = Math.hypot(vx, vy);
      if (speed < 3) break;
      travelled += speed;
      if (travelled > D * tier.pathGap[1]) break;
      if (travelled >= D * tier.pathGap[0]) path.push({ x: a.x, y: a.y, vx, vy });
    }
    if (path.length < 4) return null;

    let placed = false;
    for (let attempt = 0; attempt < 16 && !placed; attempt += 1) {
      const at = path[Math.floor(rng() * path.length)]!;
      const speed = Math.hypot(at.vx, at.vy);
      for (const pocketIndex of shuffled([0, 1, 2, 3, 4, 5], rng)) {
        const pocket = POCKETS[pocketIndex]!;
        const dx = pocket.x - at.x;
        const dy = pocket.y - at.y;
        const reach = Math.hypot(dx, dy);
        if (reach > D * (tier.potReach + 1)) continue;
        const nx = dx / reach;
        const ny = dy / reach;
        const cosCut = (at.vx * nx + at.vy * ny) / speed;
        if (cosCut < Math.cos(58 * DEG)) continue;
        // Every ball but the last must turn the cue ball onward.
        if (step < tier.balls - 1 && cosCut > Math.cos(14 * DEG)) continue;
        const x = tenth(at.x + nx * D);
        const y = tenth(at.y + ny * D);
        if (!spotIsFree(x, y, balls)) continue;
        // It has to have the pace to reach the pocket.
        const launch = speed * cosCut * 0.98;
        if ((launch * launch) / (2 * ROLLING_DECEL) < reach + D * 0.5) continue;
        const next = [...balls, { id: ids[step]!, x, y }];
        const nextCheck = clears(next, shot);
        if (nextCheck.ok) {
          balls = next;
          check = nextCheck;
          placed = true;
          break;
        }
      }
    }
    if (!placed) return null;
  }
  return { balls, shot };
}

/** Contiguous steps either side of `centre` that still clear. */
function contiguous(
  balls: readonly TrickShotBall[],
  at: (k: number) => TrickShotInput | null,
  limit: number,
): [number, number] {
  let lo = 0;
  let hi = 0;
  for (let k = 1; k <= limit; k += 1) {
    const s = at(-k);
    if (s && clears(balls, s).ok) lo = k;
    else break;
  }
  for (let k = 1; k <= limit; k += 1) {
    const s = at(k);
    if (s && clears(balls, s).ok) hi = k;
    else break;
  }
  return [lo, hi];
}

const onAngleGrid = (angle: number) => Math.round(angle / TRICK_SHOT_ANGLE_STEP);
const onPowerGrid = (power: number) => Math.round(power / TRICK_SHOT_POWER_STEP);
const gridShot = (shot: TrickShotInput, a: number, p: number): TrickShotInput => ({
  ...shot,
  angle: a * TRICK_SHOT_ANGLE_STEP,
  power: p / 100,
});

/** The clearing window around a built shot, on the shooting grids, and
 *  the shot in its middle. Null if no grid shot next to it clears. */
export function measureWindow(balls: readonly TrickShotBall[], shot: TrickShotInput) {
  let a0 = onAngleGrid(shot.angle);
  const p0 = onPowerGrid(shot.power);
  let found = false;
  for (const da of [0, -1, 1, -2, 2]) {
    if (clears(balls, gridShot(shot, a0 + da, p0)).ok) {
      a0 += da;
      found = true;
      break;
    }
  }
  if (!found) return null;
  const [lo, hi] = contiguous(balls, (k) => gridShot(shot, a0 + k, p0), 120);
  const a1 = a0 + Math.round((hi - lo) / 2);
  const [plo, phi] = contiguous(
    balls,
    (k) => (p0 + k >= 10 && p0 + k <= 100 ? gridShot(shot, a1, p0 + k) : null),
    40,
  );
  const p1 = p0 + Math.round((phi - plo) / 2);
  const solution = clears(balls, gridShot(shot, a1, p1)).ok ? gridShot(shot, a1, p1) : gridShot(shot, a1, p0);
  if (!clears(balls, solution).ok) return null;
  return {
    solution,
    angleDeg: Math.round((lo + hi + 1) * 100 * 0.01) / 100,
    powerPct: plo + phi + 1,
  };
}

/** The table for a UTC date key. Deterministic: same key, same table. */
export function generateTrickShotPosition(dateKey: string): TrickShotPosition {
  const weekday = trickShotWeekday(dateKey);
  const rng = mulberry32(hashString(`trick-shot:v${TRICK_SHOT_GENERATOR_VERSION}:${dateKey}`));
  const tiers = [TRICK_SHOT_TIERS[weekday]!];
  // A day that finds nothing at its count drops a ball, never to zero.
  for (let n = tiers[0]!.balls - 1; n >= 2; n -= 1) tiers.push({ ...tiers[0]!, balls: n });

  for (const tier of tiers) {
    let best: (Built & { window: NonNullable<ReturnType<typeof measureWindow>> }) | null = null;
    let candidates = 0;
    for (let build = 0; build < MAX_BUILDS && candidates < MAX_CANDIDATES; build += 1) {
      const built = buildOnce(rng, tier);
      if (!built) continue;
      candidates += 1;
      const window = measureWindow(built.balls, built.shot);
      if (!window || window.powerPct < tier.minPower) continue;
      const scored = { ...built, window };
      if (window.angleDeg >= tier.minWindow && window.angleDeg <= tier.maxWindow) {
        best = scored;
        break;
      }
      // Outside the band: keep the one nearest to it.
      const distance = (w: number) =>
        w < tier.minWindow ? tier.minWindow - w : w > tier.maxWindow ? (w - tier.maxWindow) / 4 : 0;
      if (!best || distance(window.angleDeg) < distance(best.window.angleDeg)) best = scored;
    }
    if (best) {
      return {
        dateKey,
        version: TRICK_SHOT_GENERATOR_VERSION,
        balls: best.balls,
        ballCount: best.balls.length - 1,
        difficulty: gradeTrickShot(best.window.angleDeg),
        solution: best.window.solution,
        window: { angleDeg: best.window.angleDeg, powerPct: best.window.powerPct },
      };
    }
  }
  throw new Error(`trick shot: no table for ${dateKey}`);
}
