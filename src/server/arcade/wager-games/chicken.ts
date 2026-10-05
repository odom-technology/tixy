// ---------------------------------------------------------------------------
// tixy — Chicken (Crossy Road) game logic
// ---------------------------------------------------------------------------

import {
  CHICKEN_DEATH_PROB,
  CHICKEN_DIFFICULTIES,
  CHICKEN_LANE_COUNTS,
  getChickenExactMultiplier,
  getChickenMultiplier,
  type ChickenDifficulty,
} from '../arcade-constants';
import { roundArcadePayout } from '../arcade-payout';
import { deriveSubSeed, mulberry32 } from '../arcade-rng';

export type ChickenConfig = {
  difficulty: ChickenDifficulty;
};

/** Validate chicken configuration from client. */
export function validateChickenConfig(config: unknown): ChickenConfig | null {
  if (!config || typeof config !== 'object') return null;
  const d = (config as { difficulty?: unknown }).difficulty;
  if (
    typeof d !== 'string' ||
    !(CHICKEN_DIFFICULTIES as readonly string[]).includes(d)
  ) {
    return null;
  }
  return { difficulty: d as ChickenDifficulty };
}

/**
 * Pre-compute the full 24-lane outcome from a seed. A `true` value means
 * the chicken dies on that lane. Deterministic + provably fair: same seed
 * + same difficulty always yields the same lane pattern.
 */
export function generateChickenLanes(
  seed: number,
  difficulty: ChickenDifficulty,
): boolean[] {
  const deathProb = CHICKEN_DEATH_PROB[difficulty];
  const rng = mulberry32(deriveSubSeed(seed, 'chicken-lanes'));
  const lanes: boolean[] = [];
  for (let i = 0; i < CHICKEN_LANE_COUNTS[difficulty]; i++) {
    lanes.push(rng() < deathProb);
  }
  return lanes;
}

/**
 * Resolve a single advance action. `lanesAlreadyCrossed` is the number of
 * successful crossings so far; the new lane being attempted is at index
 * `lanesAlreadyCrossed`.
 */
export function advanceChickenLane(
  lanes: readonly boolean[],
  lanesAlreadyCrossed: number,
  difficulty: ChickenDifficulty,
): {
  alive: boolean;
  laneIndex: number;
  lanesCrossed: number;
  currentMultiplier: number;
  allLanesCrossed: boolean;
} {
  if (lanesAlreadyCrossed < 0 || lanesAlreadyCrossed >= CHICKEN_LANE_COUNTS[difficulty]) {
    throw new Error('Invalid lane index.');
  }
  const laneIndex = lanesAlreadyCrossed;
  const isDead = lanes[laneIndex] === true;
  const lanesCrossed = isDead ? lanesAlreadyCrossed : lanesAlreadyCrossed + 1;
  const currentMultiplier = isDead
    ? 0
    : getChickenMultiplier(lanesCrossed, difficulty);
  return {
    alive: !isDead,
    laneIndex,
    lanesCrossed,
    currentMultiplier,
    allLanesCrossed: !isDead && lanesCrossed >= CHICKEN_LANE_COUNTS[difficulty],
  };
}

/** Compute chicken payout for a cashout at the current state. */
export function computeChickenPayout(
  wager: number,
  lanesCrossed: number,
  difficulty: ChickenDifficulty,
  seed: number,
): number {
  if (lanesCrossed <= 0) return 0;
  const multiplier = getChickenExactMultiplier(lanesCrossed, difficulty);
  return roundArcadePayout(
    wager * multiplier,
    seed,
    `chicken:${difficulty}:${lanesCrossed}`,
  );
}
