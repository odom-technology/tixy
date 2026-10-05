// ---------------------------------------------------------------------------
// Core types for the 8-ball pool physics engine.
// Pure TypeScript — no DOM or Node dependencies.
// ---------------------------------------------------------------------------

/** 2D vector. */
export type Vec2 = { x: number; y: number };

/** A single ball on the table. */
export type Ball = {
  /** 0 = cue, 1-7 = solids, 8 = eight ball, 9-15 = stripes */
  id: number;
  pos: Vec2;
  vel: Vec2;
  pocketed: boolean;
  /** Sidespin (english). Negative = left, positive = right. Affects cushion bounce. */
  spinX?: number;
  /** Topspin / backspin. Positive = topspin (follow), negative = backspin (draw). */
  spinY?: number;
};

/** Ball group assignment. */
export type BallGroup = 'solids' | 'stripes';

/** A line segment forming part of a cushion rail. */
export type CushionSegment = {
  a: Vec2;
  b: Vec2;
  /** Inward-facing unit normal. */
  normal: Vec2;
};

/** A pocket on the table. */
export type Pocket = {
  pos: Vec2;
  radius: number;
};

/** Input from the player for a single shot. */
export type ShotInput = {
  /** Aim direction in radians (0 = right, PI/2 = down). */
  angle: number;
  /** Power from 0 to 1 (mapped to max velocity internally). */
  power: number;
  /** Cue ball position override for ball-in-hand. Null = use current. */
  cuePosition: Vec2 | null;
  /** Sidespin offset -1 to +1. Left english = negative. */
  spinX?: number;
  /** Topspin/backspin offset -1 to +1. Topspin (follow) = positive. */
  spinY?: number;
};

/** Per-frame snapshot of all ball positions for client animation. */
export type BallFrame = {
  id: number;
  x: number;
  y: number;
};

/** A physics event recorded during simulation for sound playback. */
export type SoundEvent = {
  /** Simulation frame index when the event occurred. */
  frame: number;
  /** Event type. */
  type: 'ballCollision' | 'cushionHit' | 'pocketed';
  /** IDs of balls involved. */
  ballIds: number[];
  /** Relevant speed for volume scaling. */
  speed: number;
};

/** Complete result of a simulated shot. */
export type ShotResult = {
  /** Frame-by-frame snapshots for animation (60fps). */
  frames: BallFrame[][];
  /** Final resting positions of all balls. */
  finalBalls: Ball[];
  /** IDs of balls pocketed during this shot. */
  pocketedBallIds: number[];
  /** Map of ballId → pocketIndex (0-5) for each pocketed ball. */
  pocketMap: Map<number, number>;
  /** Whether the cue ball was pocketed (scratch). */
  scratch: boolean;
  /** ID of the first object ball contacted by the cue ball, or null. */
  firstContactBallId: number | null;
  /** Number of times any ball contacted a rail after the initial cue-ball hit. */
  railContacts: number;
  /** Set of unique object-ball IDs (1-15) that contacted at least one rail. */
  ballsToRail: Set<number>;
  /** Total frames simulated. */
  totalFrames: number;
  /** Physics events for client-side sound playback. */
  events: SoundEvent[];
};

/** Standard ball colors for rendering. */
export const BALL_COLORS: Record<number, { fill: string; stripe: boolean }> = {
  0: { fill: '#ffffff', stripe: false }, // cue ball
  1: { fill: '#f6c700', stripe: false }, // yellow
  2: { fill: '#003da5', stripe: false }, // blue
  3: { fill: '#d32f2f', stripe: false }, // red
  4: { fill: '#4a148c', stripe: false }, // purple
  5: { fill: '#e65100', stripe: false }, // orange
  6: { fill: '#2e7d32', stripe: false }, // green
  7: { fill: '#6d1b1b', stripe: false }, // maroon
  8: { fill: '#111111', stripe: false }, // 8-ball (black)
  9: { fill: '#f6c700', stripe: true }, // yellow stripe
  10: { fill: '#003da5', stripe: true }, // blue stripe
  11: { fill: '#d32f2f', stripe: true }, // red stripe
  12: { fill: '#4a148c', stripe: true }, // purple stripe
  13: { fill: '#e65100', stripe: true }, // orange stripe
  14: { fill: '#2e7d32', stripe: true }, // green stripe
  15: { fill: '#6d1b1b', stripe: true }, // maroon stripe
};

/** Returns true if ball ID is a solid (1-7). */
export const isSolid = (id: number) => id >= 1 && id <= 7;

/** Returns true if ball ID is a stripe (9-15). */
export const isStripe = (id: number) => id >= 9 && id <= 15;

/** Returns the group a ball belongs to, or null for cue/8-ball. */
export const ballGroup = (id: number): BallGroup | null => {
  if (isSolid(id)) return 'solids';
  if (isStripe(id)) return 'stripes';
  return null;
};
