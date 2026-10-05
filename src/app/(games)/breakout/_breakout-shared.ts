// ──────────────────────────────────────────────────────────────────────────
// BREAKOUT — shared deterministic layout + scoring constants.
//
// This module is the CLIENT mirror of src/server/arcade/breakout-replay.ts.
// generateBreakoutLevel / ROW_POINTS / levelClearBonus MUST stay byte-identical
// to that file so the seed-derived brick layout + per-row points + level
// bonuses agree on both sides. (The server file is the authority; this copy
// exists only so the client can render the grid from the same seed.)
// ──────────────────────────────────────────────────────────────────────────

export const BRICK_COLS = 10;
export const BRICK_ROWS = 6;

// Per-row point values (top row worth most), index 0 = top row.
export const ROW_POINTS = [70, 60, 50, 40, 30, 20] as const;

// Deterministic level-clear bonus for clearing level N (1-indexed).
export const levelClearBonus = (level: number): number => 100 * level;

// Seeded RNG — identical mulberry32 to the server.
export const createSeededRng = (seed: number) => {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/**
 * Deterministically generate the brick layout for a (seed, level) pair.
 * Returns a ROWS×COLS boolean grid (true = brick present). MUST match the
 * server's generateBreakoutLevel exactly.
 */
export const generateBreakoutLevel = (
  seed: number,
  level: number,
): boolean[][] => {
  const rng = createSeededRng((seed + level * 0x9e3779b1) >>> 0);
  const fill = Math.min(0.96, 0.62 + (level - 1) * 0.07);
  const grid: boolean[][] = [];
  for (let r = 0; r < BRICK_ROWS; r += 1) {
    const row: boolean[] = [];
    for (let c = 0; c < BRICK_COLS; c += 1) {
      row.push(rng() < fill);
    }
    grid.push(row);
  }
  return grid;
};
