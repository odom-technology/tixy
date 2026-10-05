// ---------------------------------------------------------------------------
// Arcade — Stoplight ("Lucky Wheel") game logic
// ---------------------------------------------------------------------------

import {
  STOPLIGHT_ZONES,
  STOPLIGHT_TOTAL_WEIGHT,
  type StoplightZone,
} from '../arcade-constants';
import { roundArcadePayout } from '../arcade-payout';
import { mulberry32 } from '../arcade-rng';

export type StoplightResult = {
  /** Index of the zone the wheel landed on. */
  zoneIndex: number;
  /** The zone details. */
  zone: StoplightZone;
  /** Payout multiplier. */
  multiplier: number;
  /** Raw spin value (0..1) for client animation. */
  spinValue: number;
};

/** Resolve the stoplight/wheel outcome from a seed. */
export function resolveStoplight(seed: number): StoplightResult {
  const rng = mulberry32(seed);
  const spinValue = rng();
  const target = spinValue * STOPLIGHT_TOTAL_WEIGHT;

  let cumulative = 0;
  for (let i = 0; i < STOPLIGHT_ZONES.length; i++) {
    cumulative += STOPLIGHT_ZONES[i]!.weight;
    if (target < cumulative) {
      return {
        zoneIndex: i,
        zone: STOPLIGHT_ZONES[i]!,
        multiplier: STOPLIGHT_ZONES[i]!.multiplier,
        spinValue,
      };
    }
  }

  // Fallback to last zone (shouldn't happen due to float precision)
  const last = STOPLIGHT_ZONES[STOPLIGHT_ZONES.length - 1]!;
  return {
    zoneIndex: STOPLIGHT_ZONES.length - 1,
    zone: last,
    multiplier: last.multiplier,
    spinValue,
  };
}

/** Compute stoplight payout amount. */
export function computeStoplightPayout(
  wager: number,
  multiplier: number,
  seed: number,
): number {
  if (multiplier <= 0) return 0;
  return roundArcadePayout(
    wager * multiplier,
    seed,
    `stoplight:${multiplier}`,
  );
}
