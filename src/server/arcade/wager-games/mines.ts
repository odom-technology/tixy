// ---------------------------------------------------------------------------
// Arcade — Mines game logic
// ---------------------------------------------------------------------------

import {
  MINES_GRID_SIZE,
  MINES_ALLOWED_COUNTS,
  capRoundPayout,
  getMinesExactMultiplier,
  getMinesMultiplier,
  type MineCount,
} from '../arcade-constants';
import { roundArcadePayout } from '../arcade-payout';
import { seededShuffle } from '../arcade-rng';

export type MinesConfig = {
  mineCount: MineCount;
};

export type MinesState = {
  minePositions: number[];
  revealed: number[];
  gameOver: boolean;
  hitMine: boolean;
  currentMultiplier: number;
};

/** Validate mines configuration from client. */
export function validateMinesConfig(config: unknown): MinesConfig | null {
  if (!config || typeof config !== 'object') return null;
  const c = config as Record<string, unknown>;
  const mineCount = c.mineCount;
  if (
    typeof mineCount !== 'number' ||
    !(MINES_ALLOWED_COUNTS as readonly number[]).includes(mineCount)
  ) {
    return null;
  }
  return { mineCount: mineCount as MineCount };
}

/** Generate mine positions from a seed. */
export function generateMinePositions(
  seed: number,
  mineCount: number,
): number[] {
  const allPositions = Array.from({ length: MINES_GRID_SIZE }, (_, i) => i);
  const shuffled = seededShuffle(allPositions, seed);
  return shuffled.slice(0, mineCount).sort((a, b) => a - b);
}

/** Check whether a tile is a mine. */
function isMine(minePositions: number[], tile: number): boolean {
  return minePositions.includes(tile);
}

/**
 * Process a tile reveal.
 * Returns the updated state and whether the game is over.
 */
export function revealTile(
  minePositions: number[],
  previouslyRevealed: number[],
  tile: number,
  mineCount: number,
): {
  safe: boolean;
  currentMultiplier: number;
  tilesRevealed: number;
  gameOver: boolean;
  allSafeRevealed: boolean;
} {
  if (tile < 0 || tile >= MINES_GRID_SIZE) {
    throw new Error('Invalid tile index');
  }
  if (previouslyRevealed.includes(tile)) {
    throw new Error('Tile already revealed');
  }

  const safe = !isMine(minePositions, tile);
  const newRevealed = [...previouslyRevealed, tile];
  const tilesRevealed = newRevealed.length;
  const safeTiles = MINES_GRID_SIZE - mineCount;
  const allSafeRevealed = tilesRevealed >= safeTiles;

  const currentMultiplier = safe
    ? getMinesMultiplier(tilesRevealed, mineCount)
    : 0;

  return {
    safe,
    currentMultiplier,
    tilesRevealed,
    gameOver: !safe || allSafeRevealed,
    allSafeRevealed: safe && allSafeRevealed,
  };
}

/**
 * Compute the payout for a cashout at the current state.
 * Returns 0 if no tiles revealed.
 */
export function computeMinesPayout(
  wager: number,
  tilesRevealed: number,
  mineCount: number,
  seed: number,
): number {
  if (tilesRevealed <= 0) return 0;
  const multiplier = getMinesExactMultiplier(tilesRevealed, mineCount);
  // A 10-gem clear with 15 mines pays 3.17 million times the bet; a big
  // enough bet would pass what the ticket columns hold, so a round pays at
  // most MAX_ROUND_PAYOUT (arcade-constants).
  return capRoundPayout(
    roundArcadePayout(wager * multiplier, seed, `mines:${mineCount}:${tilesRevealed}`),
  );
}
