// ---------------------------------------------------------------------------
// Arcade — Darts game logic (single-action, like Stoplight)
// ---------------------------------------------------------------------------

import {
  DARTS_ZONES,
  DARTS_TOTAL_WEIGHT,
  type DartsZone,
} from '../arcade-constants';
import { roundArcadePayout } from '../arcade-payout';
import { mulberry32 } from '../arcade-rng';

export type DartsResult = {
  zoneIndex: number;
  zone: DartsZone;
  multiplier: number;
  /** Raw RNG float (0..1) — client uses this to position the dart angle. */
  throwValue: number;
};

/** No config needed for Darts. */
export function validateDartsConfig(_config: unknown): Record<string, never> {
  return {};
}

/** Weighted-pick the landing zone for a given seed. */
export function resolveDarts(seed: number): DartsResult {
  const rng = mulberry32(seed);
  const throwValue = rng();
  const target = throwValue * DARTS_TOTAL_WEIGHT;

  let cum = 0;
  for (let i = 0; i < DARTS_ZONES.length; i++) {
    const zone = DARTS_ZONES[i]!;
    cum += zone.weight;
    if (target < cum) {
      return { zoneIndex: i, zone, multiplier: zone.multiplier, throwValue };
    }
  }

  // Numerical tail — fall back to last zone (Miss).
  const last = DARTS_ZONES[DARTS_ZONES.length - 1]!;
  return {
    zoneIndex: DARTS_ZONES.length - 1,
    zone: last,
    multiplier: last.multiplier,
    throwValue,
  };
}

/** Compute integer payout for the landing zone. */
export function computeDartsPayout(
  wager: number,
  multiplier: number,
  seed: number,
): number {
  if (multiplier <= 0) return 0;
  return roundArcadePayout(wager * multiplier, seed, `darts:${multiplier}`);
}
