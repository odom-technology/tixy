// ---------------------------------------------------------------------------
// Arcade — Dragon Tower game logic
// ---------------------------------------------------------------------------
//
// A 9-row tower. Each row has N tiles, K of which are safe (the rest hide a
// dragon egg). The player picks ONE tile per row from the bottom up. A safe
// pick climbs and compounds the multiplier; an egg busts the round. The player
// may cash out at any time. Clearing all 9 rows is a terminal win.
//
// Provably fair: every row's safe-tile layout is derived deterministically
// from the session seed (never sent to the client until the round ends). State
// is reconstructed by replaying the append-only `choices` log against the seed
// — there is no mutable round object.
//
// RTP (3% house edge) is applied ONCE to the product of the raw per-row fair
// factors (N/K), never per row — matching the Lightspeed / Hi-Lo pattern.
// ---------------------------------------------------------------------------

import { ARCADE_RTP } from '../arcade-constants';
import { roundArcadePayout } from '../arcade-payout';
import { deriveSubSeed, mulberry32 } from '../arcade-rng';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export type DragonDifficulty = 'easy' | 'medium' | 'hard' | 'expert';

export const DRAGON_DIFFICULTIES: readonly DragonDifficulty[] = [
  'easy',
  'medium',
  'hard',
  'expert',
];

/** Number of rows in the tower. The player climbs from row 0 upward. */
export const DRAGON_ROWS = 9;

/** Hard ceiling on any single Dragon Tower multiplier (matches sibling games). */
export const DRAGON_MAX_MULTIPLIER = 500;

/**
 * Per-difficulty tower shape:
 *   tiles  = N (tiles per row)
 *   safe   = K (safe tiles per row; the remaining N-K hide dragon eggs)
 *   fairMult = N / K  (1 / P(pick safe); RTP applied once at payout)
 *
 *   easy:   4 tiles / 3 safe  → ×1.333 per row → cleared ~×7.5
 *   medium: 3 tiles / 2 safe  → ×1.5   per row → cleared ~×38
 *   hard:   2 tiles / 1 safe  → ×2     per row → capped at ×500
 *   expert: 4 tiles / 1 safe  → ×4     per row → capped at ×500 (very early)
 */
export type DragonDifficultyConfig = {
  tiles: number;
  safe: number;
  fairMult: number;
};

export const DRAGON_DIFFICULTY_CONFIG: Record<
  DragonDifficulty,
  DragonDifficultyConfig
> = {
  easy: { tiles: 4, safe: 3, fairMult: 4 / 3 },
  medium: { tiles: 3, safe: 2, fairMult: 3 / 2 },
  hard: { tiles: 2, safe: 1, fairMult: 2 / 1 },
  expert: { tiles: 4, safe: 1, fairMult: 4 / 1 },
};

export type DragonConfig = {
  difficulty: DragonDifficulty;
};

/**
 * The per-row record stored in the session `choices` log. `fairMult` is the
 * raw fair factor for the row (stored so cashout replay never re-derives it,
 * mirroring the Lightspeed choice shape).
 */
export type DragonChoice = {
  tile: number;
  result: 'alive' | 'dead';
  fairMult: number;
};

export type DragonRoundState = {
  fairStepMultipliers: number[];
  rowsClimbed: number;
  cumulativeMultiplier: number;
  alive: boolean;
};

// ---------------------------------------------------------------------------
// Config validation
// ---------------------------------------------------------------------------

/** Validate Dragon Tower configuration from the client. */
export function validateDragonConfig(config: unknown): DragonConfig | null {
  if (!config || typeof config !== 'object') return null;
  const c = config as Record<string, unknown>;
  const difficulty = c.difficulty;
  if (
    typeof difficulty !== 'string' ||
    !(DRAGON_DIFFICULTIES as readonly string[]).includes(difficulty)
  ) {
    return null;
  }
  return { difficulty: difficulty as DragonDifficulty };
}

// ---------------------------------------------------------------------------
// Multiplier helpers (RTP applied ONCE to the product)
// ---------------------------------------------------------------------------

function floorToTwoDecimals(value: number): number {
  return Math.floor(value * 100) / 100;
}

/**
 * EXACT cumulative multiplier for a sequence of climbed rows. Product of the
 * raw fair per-row factors × RTP, capped at DRAGON_MAX_MULTIPLIER. Used for
 * payout math (no 2dp rounding). Returns 0 if no rows climbed.
 */
export function getDragonExactCumulativeMultiplier(
  fairStepMults: readonly number[],
): number {
  if (fairStepMults.length === 0) return 0;
  let product = 1;
  for (const m of fairStepMults) {
    if (m <= 0) return 0;
    product *= m;
  }
  return Math.min(DRAGON_MAX_MULTIPLIER, product * ARCADE_RTP['arcade-dragon']);
}

/** DISPLAY cumulative multiplier (floored to 2dp) for the UI. */
export function getDragonCumulativeMultiplier(
  fairStepMults: readonly number[],
): number {
  return floorToTwoDecimals(getDragonExactCumulativeMultiplier(fairStepMults));
}

// ---------------------------------------------------------------------------
// Deterministic tower generation
// ---------------------------------------------------------------------------

/**
 * Choose `safe` distinct safe-tile column indices out of `tiles` columns for a
 * single row, using a seeded partial Fisher-Yates shuffle. Returned sorted so
 * the layout is stable for display.
 */
function pickSafeTiles(seed: number, tiles: number, safe: number): number[] {
  const columns = Array.from({ length: tiles }, (_, i) => i);
  const rng = mulberry32(seed);
  // Partial Fisher-Yates: only the first `safe` slots need to be finalized.
  for (let i = 0; i < safe && i < columns.length - 1; i++) {
    const j = i + Math.floor(rng() * (columns.length - i));
    [columns[i], columns[j]] = [columns[j]!, columns[i]!];
  }
  return columns.slice(0, safe).sort((a, b) => a - b);
}

/**
 * Pre-compute the safe-tile layout for every row of the tower. Each row gets an
 * independent sub-seed so the outcome is deterministic and provably fair.
 * Returns one sorted array of safe column indices per row (length DRAGON_ROWS).
 */
export function generateDragonRows(
  seed: number,
  difficulty: DragonDifficulty,
): number[][] {
  const { tiles, safe } = DRAGON_DIFFICULTY_CONFIG[difficulty];
  const rows: number[][] = [];
  for (let row = 0; row < DRAGON_ROWS; row++) {
    const subSeed = deriveSubSeed(seed, `dragon:${difficulty}:${row}`);
    rows.push(pickSafeTiles(subSeed, tiles, safe));
  }
  return rows;
}

/** Whether a given column is a safe tile in a row's layout. */
function isSafeTile(rowSafeTiles: readonly number[], tile: number): boolean {
  return rowSafeTiles.includes(tile);
}

// ---------------------------------------------------------------------------
// Advance a single row
// ---------------------------------------------------------------------------

export function advanceDragonStep(
  rows: readonly number[][],
  rowIndex: number,
  tile: number,
  difficulty: DragonDifficulty,
  previousFairMults: readonly number[],
): {
  alive: boolean;
  rowIndex: number;
  rowsClimbed: number;
  currentMultiplier: number;
  allRowsCompleted: boolean;
  fairMult: number;
} {
  if (rowIndex < 0 || rowIndex >= DRAGON_ROWS) {
    throw new Error('Dragon row index out of range.');
  }
  const { tiles, fairMult } = DRAGON_DIFFICULTY_CONFIG[difficulty];
  if (tile < 0 || tile >= tiles) {
    throw new Error('Dragon tile index out of range.');
  }

  const survived = isSafeTile(rows[rowIndex]!, tile);

  if (!survived) {
    return {
      alive: false,
      rowIndex,
      rowsClimbed: rowIndex, // did not complete this row
      currentMultiplier: 0,
      allRowsCompleted: false,
      fairMult,
    };
  }

  const rowsClimbed = rowIndex + 1;
  const allFairMults = [...previousFairMults, fairMult];
  const currentMultiplier = getDragonCumulativeMultiplier(allFairMults);
  const allRowsCompleted = rowsClimbed >= DRAGON_ROWS;

  return {
    alive: true,
    rowIndex,
    rowsClimbed,
    currentMultiplier,
    allRowsCompleted,
    fairMult,
  };
}

// ---------------------------------------------------------------------------
// Replay a round from recorded choices (cashout + defensive guard)
// ---------------------------------------------------------------------------

export function replayDragonRound(
  seed: number,
  choices: readonly DragonChoice[],
  difficulty: DragonDifficulty,
): DragonRoundState {
  const rows = generateDragonRows(seed, difficulty);
  const fairStepMultipliers: number[] = [];
  let alive = true;

  for (let i = 0; i < choices.length && i < DRAGON_ROWS; i++) {
    const choice = choices[i]!;
    const survived = isSafeTile(rows[i]!, choice.tile);
    if (!survived) {
      alive = false;
      break;
    }
    fairStepMultipliers.push(DRAGON_DIFFICULTY_CONFIG[difficulty].fairMult);
  }

  return {
    fairStepMultipliers,
    rowsClimbed: fairStepMultipliers.length,
    cumulativeMultiplier: getDragonCumulativeMultiplier(fairStepMultipliers),
    alive,
  };
}

// ---------------------------------------------------------------------------
// Payout
// ---------------------------------------------------------------------------

export function computeDragonPayout(
  wager: number,
  fairStepMults: readonly number[],
  seed: number,
): number {
  const exactMult = getDragonExactCumulativeMultiplier(fairStepMults);
  if (exactMult <= 0) return 0;
  return roundArcadePayout(
    wager * exactMult,
    seed,
    `dragon:${fairStepMults.length}`,
  );
}
