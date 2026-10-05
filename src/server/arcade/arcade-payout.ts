import { deriveSubSeed, mulberry32 } from './arcade-rng';

/**
 * Convert an exact fractional-credit payout into an integer Ticket amount
 * without biasing the expected value downward. The extra Ticket is awarded
 * with probability equal to the fractional remainder, using a deterministic
 * seed-derived roll so the result is reproducible after reveal.
 */
export function roundArcadePayout(
  exactPayout: number,
  seed: number,
  label: string,
): number {
  if (!Number.isFinite(exactPayout) || exactPayout <= 0) return 0;

  const integerPart = Math.floor(exactPayout);
  const fractionalPart = exactPayout - integerPart;
  if (fractionalPart <= 0) return integerPart;

  const rng = mulberry32(deriveSubSeed(seed, `arcade-payout:${label}`));
  return integerPart + (rng() < fractionalPart ? 1 : 0);
}
