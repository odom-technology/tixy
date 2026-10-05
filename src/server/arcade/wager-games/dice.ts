// ---------------------------------------------------------------------------
// Arcade — Dice game logic
// ---------------------------------------------------------------------------

import {
  DICE_MIN_TARGET,
  DICE_MAX_TARGET,
  DICE_RANGE,
  getDiceExactMultiplier,
  getDiceMultiplier,
  getDiceWinChance,
  type DiceDirection,
} from '../arcade-constants';
import { roundArcadePayout } from '../arcade-payout';
import { mulberry32 } from '../arcade-rng';

export type DiceConfig = {
  target: number;
  direction: DiceDirection;
};

export type DiceResult = {
  roll: number;
  target: number;
  direction: DiceDirection;
  won: boolean;
  multiplier: number;
  winChance: number;
};

/** Validate dice configuration from client. */
export function validateDiceConfig(config: unknown): DiceConfig | null {
  if (!config || typeof config !== 'object') return null;
  const c = config as Record<string, unknown>;

  const target = c.target;
  if (
    typeof target !== 'number' ||
    !Number.isInteger(target) ||
    target < DICE_MIN_TARGET ||
    target > DICE_MAX_TARGET
  ) {
    return null;
  }

  const direction = c.direction;
  if (direction !== 'over' && direction !== 'under') return null;

  return { target, direction };
}

/** Resolve the dice outcome from a seed. Roll is 1..100. */
export function resolveDice(
  seed: number,
  target: number,
  direction: DiceDirection,
): DiceResult {
  const rng = mulberry32(seed);
  // Roll 1..100
  const roll = Math.floor(rng() * DICE_RANGE) + 1;

  const won =
    direction === 'under' ? roll < target : roll > target;

  const multiplier = won ? getDiceMultiplier(target, direction) : 0;
  const winChance = getDiceWinChance(target, direction);

  return { roll, target, direction, won, multiplier, winChance };
}

/** Compute dice payout. */
export function computeDicePayout(
  wager: number,
  result: DiceResult,
  seed: number,
): number {
  if (!result.won || result.multiplier <= 0) return 0;
  const exactMultiplier = getDiceExactMultiplier(result.target, result.direction);
  return roundArcadePayout(
    wager * exactMultiplier,
    seed,
    `dice:${result.direction}:${result.target}`,
  );
}
