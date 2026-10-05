// ─────────────────────────────────────────────────────────────────────────────
// Daily Featured Game.
//
// One credit-earning solo game is "featured" each UTC day (deterministically
// rotated from the seed of the date key, so it's the same for everyone and stable
// across reloads — no DB rotation table needed). Playing the featured game:
//   • earns DOUBLE credits (FEATURED_CREDIT_MULTIPLIER), and
//   • may earn a bit ABOVE the normal daily ticket cap (FEATURED_CAP_BONUS extra
//     headroom), to nudge players toward trying a different game each day.
//
// Pure: no Date.now()/Math.random()/IO. Callers pass the date key.
// ─────────────────────────────────────────────────────────────────────────────

import { isOnFloor } from '@/features/arcade/components/arcade-game-registry';
import { floorPoolsActive } from '@/server/arcade/floor-pools';

/** Featured-day reward boosts. */
export const FEATURED_CREDIT_MULTIPLIER = 2;
/** Extra ticket headroom (above the normal daily cap) earnable on the featured
 *  game only — "a little more than the cap" to reward playing the day's game.
 *  Scaled with the 2026-06 cap raise (150 → 300): featured-day ceiling is 375. */
export const FEATURED_CAP_BONUS = 75;

/**
 * The rotation pool from FLOOR_POOLS_FROM: the floor's solo skill games. Each
 * pick filters it with isOnFloor(), so a game that leaves the floor leaves the
 * rotation. Every entry must have a case in calculateGameRewardCredits
 * (wallet.ts).
 */
export const FEATURED_POOL: readonly string[] = [
  'snake',
  '2048',
  'stack',
  'skee-ball',
  'high-striker',
  'tin-duck',
  'ticket-stop',
  'flappy-bird',
  'ricochet',
  // Ring toss
  'ring-toss',
];

/** The rotation before FLOOR_POOLS_FROM. Delete once that Monday has passed. */
const LEGACY_FEATURED_POOL: readonly string[] = [
  'snake',
  'flappy-bird',
  '2048',
  'tetris',
  'typing-test',
  'breakout',
  'stack',
  'sequence',
  'tumbler',
  'gopher',
  'ricochet',
  'swerve',
  'sudoku',
  'math',
  'high-striker',
  'skee-ball',
  'gunrush',
];

/** The pool a date key picks from. */
export function getFeaturedPool(
  dateKey: string,
  onFloor: (slug: string) => boolean = isOnFloor,
): readonly string[] {
  return floorPoolsActive(dateKey) ? FEATURED_POOL.filter(onFloor) : LEGACY_FEATURED_POOL;
}

/** Stable non-negative hash of a 'YYYY-MM-DD' date key (matches the puzzle games). */
function dateToSeed(dateKey: string): number {
  let h = 0;
  for (let i = 0; i < dateKey.length; i += 1) {
    h = ((h << 5) - h + dateKey.charCodeAt(i)) | 0;
  }
  return Math.abs(h) || 1;
}

/** The featured game type for a UTC date key (deterministic daily rotation). */
export function getFeaturedGameType(
  dateKey: string,
  onFloor: (slug: string) => boolean = isOnFloor,
): string {
  const pool = getFeaturedPool(dateKey, onFloor);
  return pool[dateToSeed(dateKey) % pool.length]!;
}

/** Whether `gameType` is the featured game for `dateKey`. */
export function isFeaturedGame(gameType: string, dateKey: string): boolean {
  return getFeaturedGameType(dateKey) === gameType;
}
