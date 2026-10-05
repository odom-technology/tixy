/* One trick shot through the 8-ball engine. The client animates exactly
   this, and the server replays exactly this to decide the result. Nothing
   here changes 8-ball's rules or physics: it only reads simulateShot. */

import {
  BALL_DIAMETER,
  POCKETS,
  simulateShot,
  type Ball,
  type ShotInput,
  type ShotResult,
} from '@/features/arcade/lib/pool-physics';

import { isClear, trickShotScore, type TrickShotOutcome } from './rules';

export type TrickShotBall = { id: number; x: number; y: number };

export type TrickShotInput = {
  /** Radians, 0 = right, PI/2 = down, in table space. */
  angle: number;
  /** 0.05 to 1, the power bar. */
  power: number;
  /** Cue tip offset, -1 to 1 each, inside the unit circle. */
  spinX: number;
  spinY: number;
};

/** Below this the 8-ball client cancels the shot instead of firing. */
export const TRICK_SHOT_MIN_POWER = 0.05;

/** The grids every shot is played on, client and server: aim in 0.01
 *  degree steps, power in whole percent, spin in hundredths. */
export const TRICK_SHOT_ANGLE_STEP = (0.01 * Math.PI) / 180;
export const TRICK_SHOT_POWER_STEP = 0.01;
export const TRICK_SHOT_SPIN_STEP = 0.01;

export const snapAngle = (angle: number) => {
  let a = angle % (Math.PI * 2);
  if (a > Math.PI) a -= Math.PI * 2;
  if (a <= -Math.PI) a += Math.PI * 2;
  return Math.round(a / TRICK_SHOT_ANGLE_STEP) * TRICK_SHOT_ANGLE_STEP;
};
export const snapPower = (power: number) =>
  Math.max(TRICK_SHOT_MIN_POWER, Math.min(1, Math.round(power / TRICK_SHOT_POWER_STEP) / 100));
export const snapSpin = (spin: number) => Math.round(spin / TRICK_SHOT_SPIN_STEP) / 100;

/** A shot on the grids. Every shot the client fires goes through this. */
export const snapTrickShot = (input: TrickShotInput): TrickShotInput => ({
  angle: snapAngle(input.angle),
  power: snapPower(input.power),
  spinX: snapSpin(input.spinX),
  spinY: snapSpin(input.spinY),
});

export type TrickShotNearMiss = {
  ballId: number;
  pocket: number;
  /** 'jaws': it hit the pocket's jaws and stayed up. 'short': it stopped
   *  within a ball and a half of the pocket. */
  kind: 'jaws' | 'short';
  /** Simulation frame when it happened (60 a second). */
  frame: number;
};

export type TrickShotPlay = TrickShotOutcome & {
  result: ShotResult;
  pottedIds: number[];
  clear: boolean;
  score: number;
  nearMisses: TrickShotNearMiss[];
};

export function toEngineBalls(balls: readonly TrickShotBall[]): Ball[] {
  return balls.map((b) => ({ id: b.id, pos: { x: b.x, y: b.y }, vel: { x: 0, y: 0 }, pocketed: false }));
}

/**
 * The shot as the server reads it: finite numbers only, inside the ranges
 * the controls allow, then put on the grids. Null for anything an honest
 * client can't send.
 */
export function normalizeTrickShotInput(raw: unknown): TrickShotInput | null {
  if (!raw || typeof raw !== 'object') return null;
  const { angle, power, spinX = 0, spinY = 0 } = raw as Record<string, unknown>;
  if (typeof angle !== 'number' || !Number.isFinite(angle) || Math.abs(angle) > 1e4) return null;
  if (typeof power !== 'number' || !Number.isFinite(power)) return null;
  if (power < TRICK_SHOT_MIN_POWER || power > 1) return null;
  if (typeof spinX !== 'number' || typeof spinY !== 'number') return null;
  if (!Number.isFinite(spinX) || !Number.isFinite(spinY)) return null;
  if (Math.abs(spinX) > 1 || Math.abs(spinY) > 1) return null;
  if (spinX * spinX + spinY * spinY > 1.0001) return null;
  return snapTrickShot({ angle, power, spinX, spinY });
}

export function toShotInput(input: TrickShotInput): ShotInput {
  return { angle: input.angle, power: input.power, cuePosition: null, spinX: input.spinX, spinY: input.spinY };
}

const JAW_RADIUS = BALL_DIAMETER * 1.65;
const SHORT_RADIUS = BALL_DIAMETER * 1.5;

function nearestPocket(x: number, y: number): { index: number; distance: number } {
  let index = 0;
  let distance = Infinity;
  POCKETS.forEach((p, i) => {
    const d = Math.hypot(p.x - x, p.y - y);
    if (d < distance) {
      distance = d;
      index = i;
    }
  });
  return { index, distance };
}

/** Plays the shot on the day's table. Same balls and input, same result. */
export function playTrickShot(balls: readonly TrickShotBall[], input: TrickShotInput): TrickShotPlay {
  const result = simulateShot(toEngineBalls(balls), toShotInput(input));
  const ballCount = balls.filter((b) => b.id !== 0).length;
  const pottedIds = result.pocketedBallIds.filter((id) => id !== 0);
  const outcome: TrickShotOutcome = { pots: pottedIds.length, ballCount, scratch: result.scratch };

  // The moments that nearly went: a jaw rattle, or a ball that died at the
  // pocket. Presentation and stats only; the score never reads them.
  const nearMisses: TrickShotNearMiss[] = [];
  const potted = new Set(result.pocketedBallIds);
  const seen = new Set<number>();
  for (const event of result.events) {
    if (event.type !== 'cushionHit') continue;
    const id = event.ballIds[0];
    if (id === undefined || id === 0 || potted.has(id) || seen.has(id)) continue;
    const frame = result.frames[Math.min(event.frame + 1, result.frames.length - 1)];
    const at = frame?.find((b) => b.id === id);
    if (!at) continue;
    const near = nearestPocket(at.x, at.y);
    if (near.distance <= JAW_RADIUS) {
      seen.add(id);
      nearMisses.push({ ballId: id, pocket: near.index, kind: 'jaws', frame: event.frame });
    }
  }
  for (const ball of result.finalBalls) {
    if (ball.id === 0 || ball.pocketed || seen.has(ball.id)) continue;
    const near = nearestPocket(ball.pos.x, ball.pos.y);
    if (near.distance <= SHORT_RADIUS) {
      nearMisses.push({ ballId: ball.id, pocket: near.index, kind: 'short', frame: result.totalFrames - 1 });
    }
  }

  return {
    ...outcome,
    result,
    pottedIds,
    clear: isClear(outcome),
    score: trickShotScore(outcome),
    nearMisses,
  };
}
