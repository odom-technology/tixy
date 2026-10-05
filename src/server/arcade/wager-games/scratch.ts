// ---------------------------------------------------------------------------
// tixy — Scratch Cards game logic
// ---------------------------------------------------------------------------
//
// A scratch card is a 3x3 grid (9 cells) of prize symbols. MATCH 3 of the same
// prize symbol → win that symbol's multiplier × wager. The ENTIRE card (the
// symbol grid AND the win/loss outcome) is predetermined by the session seed at
// purchase time — the foil-scratch interaction on the client is purely cosmetic
// and cannot change the result.
//
// config.tier selects a volatility / RTP profile:
//   bronze — low volatility, frequent small wins (~86% win rate, cap 25x)
//   silver — medium volatility                    (~50% win rate, cap 75x)
//   gold   — high volatility, rare big multipliers (~25% win rate, cap 200x)
//
// RTP: ARCADE_RTP['arcade-scratch'] is 1.0. We do NOT multiply the payout by
// RTP — the weighted distribution IS the RTP. Each tier's loss weight is
// auto-solved so the expected value lands on SCRATCH_TARGET_EV (≈0.96, i.e. a
// ~4% house edge), well inside the 0.95–0.97 target band. Verified EVs:
//   bronze 0.9600 · silver 0.9600 · gold 0.9600
// (sum(mult × weight) / sum(weight) — see SCRATCH_TIERS below.)

import { ARCADE_RTP } from '../arcade-constants';
import { roundArcadePayout } from '../arcade-payout';
import { deriveSubSeed, mulberry32 } from '../arcade-rng';

/* ===========================================================================
 *  Tiers + symbols
 * ========================================================================= */

export type ScratchTier = 'bronze' | 'silver' | 'gold';

export const SCRATCH_TIERS_LIST: readonly ScratchTier[] = [
  'bronze',
  'silver',
  'gold',
];

/**
 * Prize symbols shown on the card. The winning symbol on a win is chosen from
 * this set; losses fill from it too. Ten distinct symbols give the grid-builder
 * plenty of room to fill 6 non-winning cells without colliding into an
 * accidental 3-of-a-kind.
 */
export const SCRATCH_SYMBOLS = [
  'cherry',
  'lemon',
  'bell',
  'bar',
  'seven',
  'star',
  'diamond',
  'clover',
  'crown',
  'horseshoe',
] as const;

export type ScratchSymbol = (typeof SCRATCH_SYMBOLS)[number];

export const SCRATCH_GRID_SIZE = 9; // 3x3

/** Target expected value per tier (a hair under RTP so there's a small edge). */
const SCRATCH_TARGET_EV = 0.96;

type ScratchOutcome = { mult: number; weight: number };

/**
 * WIN buckets per tier (mult > 0 only). The 0x loss weight is auto-solved at
 * module load (see buildTier) so EV == SCRATCH_TARGET_EV. Multipliers are
 * capped per tier (bronze 25x, silver 75x, gold 200x) to bound bankroll
 * variance. Volatility rises bronze → silver → gold (fewer wins, fatter tail).
 */
const SCRATCH_WIN_BUCKETS: Record<
  ScratchTier,
  readonly { mult: number; weight: number }[]
> = {
  // Low volatility — wins are common but mostly small (half/even-money).
  bronze: [
    { mult: 0.5, weight: 3400 },
    { mult: 1, weight: 3000 },
    { mult: 2, weight: 1100 },
    { mult: 3, weight: 320 },
    { mult: 5, weight: 110 },
    { mult: 10, weight: 30 },
    { mult: 25, weight: 8 },
  ],
  // Medium volatility — roughly coin-flip win rate, a real mid tail.
  silver: [
    { mult: 0.5, weight: 1500 },
    { mult: 1, weight: 1500 },
    { mult: 2, weight: 950 },
    { mult: 4, weight: 360 },
    { mult: 8, weight: 140 },
    { mult: 20, weight: 46 },
    { mult: 50, weight: 12 },
    { mult: 75, weight: 5 },
  ],
  // High volatility — wins are rare but can pay big (up to the 200x cap).
  gold: [
    { mult: 1, weight: 1400 },
    { mult: 2, weight: 760 },
    { mult: 5, weight: 360 },
    { mult: 12, weight: 130 },
    { mult: 30, weight: 48 },
    { mult: 75, weight: 18 },
    { mult: 150, weight: 6 },
    { mult: 200, weight: 3 },
  ],
};

/**
 * Build the full weighted outcome table for a tier: prepend a 0x loss bucket
 * whose weight is solved so EV == target.
 *   lossWeight = winEV / target − winWeight
 * (Same idea as buildCaseItems / buildPacksPool in arcade-constants.)
 */
function buildTier(
  buckets: readonly { mult: number; weight: number }[],
  targetEv: number,
): ScratchOutcome[] {
  let winEV = 0;
  let winWeight = 0;
  for (const b of buckets) {
    winEV += b.mult * b.weight;
    winWeight += b.weight;
  }
  const lossWeight = Math.max(0, Math.round(winEV / targetEv - winWeight));
  return [{ mult: 0, weight: lossWeight }, ...buckets.map((b) => ({ ...b }))];
}

/** Full outcome tables (loss + wins) per tier. Index by tier. */
export const SCRATCH_TIERS: Record<ScratchTier, ScratchOutcome[]> = {
  bronze: buildTier(SCRATCH_WIN_BUCKETS.bronze, SCRATCH_TARGET_EV),
  silver: buildTier(SCRATCH_WIN_BUCKETS.silver, SCRATCH_TARGET_EV),
  gold: buildTier(SCRATCH_WIN_BUCKETS.gold, SCRATCH_TARGET_EV),
};

/* ===========================================================================
 *  Tier metadata (for UI previews / paytables — no game logic depends on this)
 * ========================================================================= */

/** Expected value of a tier's table: sum(mult × weight) / sum(weight). */
export function scratchTierEV(tier: ScratchTier): number {
  const table = SCRATCH_TIERS[tier];
  let ev = 0;
  let total = 0;
  for (const o of table) {
    ev += o.mult * o.weight;
    total += o.weight;
  }
  return total > 0 ? ev / total : 0;
}

/** Probability the tier produces any win (mult > 0). */
export function scratchTierWinRate(tier: ScratchTier): number {
  const table = SCRATCH_TIERS[tier];
  let win = 0;
  let total = 0;
  for (const o of table) {
    total += o.weight;
    if (o.mult > 0) win += o.weight;
  }
  return total > 0 ? win / total : 0;
}

/** Largest multiplier offered by a tier. */
export function scratchTierMaxMult(tier: ScratchTier): number {
  return SCRATCH_TIERS[tier].reduce((m, o) => Math.max(m, o.mult), 0);
}

/** Probability of landing an exact multiplier within a tier (for paytables). */
export function scratchOutcomeChance(tier: ScratchTier, mult: number): number {
  const table = SCRATCH_TIERS[tier];
  const total = table.reduce((s, o) => s + o.weight, 0);
  const bucket = table.find((o) => o.mult === mult);
  return bucket && total > 0 ? bucket.weight / total : 0;
}

/* ===========================================================================
 *  Config validation
 * ========================================================================= */

export type ScratchConfig = { tier: ScratchTier };

/**
 * Validate scratch configuration from the client. tier ∈ {bronze,silver,gold},
 * defaulting to 'bronze' when omitted/undefined; any other value is rejected.
 */
export function validateScratchConfig(config: unknown): ScratchConfig | null {
  // Allow an entirely-absent config → default tier.
  if (config === undefined || config === null) return { tier: 'bronze' };
  if (typeof config !== 'object') return null;

  const tier = (config as { tier?: unknown }).tier;
  if (tier === undefined) return { tier: 'bronze' };
  if (typeof tier !== 'string') return null;
  if (!(SCRATCH_TIERS_LIST as readonly string[]).includes(tier)) return null;

  return { tier: tier as ScratchTier };
}

/* ===========================================================================
 *  Resolver
 * ========================================================================= */

export type ScratchResult = {
  tier: ScratchTier;
  /** Row-major 3x3 grid of prize symbols. */
  grid: ScratchSymbol[];
  /** Whether the card is a winner (3 of a kind). */
  win: boolean;
  /** The winning symbol (only meaningful when win === true). */
  symbol: ScratchSymbol | null;
  /** Winning multiplier M (> 0 on a win, 0 on a loss). */
  multiplier: number;
  /** Indices (0..8) of the 3 matched cells on a win; [] on a loss. */
  prizeCells: number[];
};

/** Weighted pick of an outcome row from a tier's table using a 0..1 roll. */
function pickOutcome(table: ScratchOutcome[], roll: number): ScratchOutcome {
  const total = table.reduce((s, o) => s + o.weight, 0);
  const target = roll * total;
  let cum = 0;
  for (const o of table) {
    cum += o.weight;
    if (target < cum) return o;
  }
  // Numerical tail — fall back to the last row.
  return table[table.length - 1]!;
}

/** mulberry32-backed integer in [0, max). */
function randInt(rng: () => number, max: number): number {
  return Math.floor(rng() * max);
}

/**
 * Build the 9-cell symbol grid so it is COSMETICALLY CONSISTENT with the
 * predetermined outcome:
 *   • WIN  — the winning symbol appears EXACTLY 3 times and NO other symbol
 *            reaches 3 (and the winning symbol never appears a 4th time).
 *   • LOSS — NO symbol appears 3 or more times.
 *
 * Determinism: a dedicated sub-seed stream ('scratch:grid') drives symbol
 * choice and Fisher–Yates placement, so the grid is reproducible after the
 * seed is revealed.
 */
function buildGrid(
  rng: () => number,
  win: boolean,
  winningSymbol: ScratchSymbol | null,
): { grid: ScratchSymbol[]; prizeCells: number[] } {
  const counts: Record<string, number> = {};
  const cells: ScratchSymbol[] = [];

  // No symbol may appear more than twice via the FILL step — that's what keeps
  // a loss free of any 3-of-a-kind and stops a win from getting a SECOND triple
  // or a 4th copy of the winning symbol. On a win the winning symbol is seeded
  // at 3 up front (3 > 2 → never re-picked below), so it stays exactly 3.
  const MAX_PER_SYMBOL = 2;

  if (win && winningSymbol) {
    // Seed exactly three copies of the winning symbol.
    for (let i = 0; i < 3; i++) cells.push(winningSymbol);
    counts[winningSymbol] = 3;
  }

  // Fill the remaining cells. A symbol is eligible while its running count is
  // below MAX_PER_SYMBOL. With 10 symbols and at most 9 cells, an eligible
  // symbol always exists, so this loop always terminates with a valid grid.
  while (cells.length < SCRATCH_GRID_SIZE) {
    const eligible: ScratchSymbol[] = [];
    for (const sym of SCRATCH_SYMBOLS) {
      if ((counts[sym] ?? 0) < MAX_PER_SYMBOL) eligible.push(sym);
    }
    // eligible is guaranteed non-empty (10 symbols, ≤9 cells, cap 2 each).
    const pick = eligible[randInt(rng, eligible.length)]!;
    cells.push(pick);
    counts[pick] = (counts[pick] ?? 0) + 1;
  }

  // Shuffle placement so the three winning cells aren't always first
  // (Fisher–Yates with the same deterministic stream).
  for (let i = cells.length - 1; i > 0; i--) {
    const j = randInt(rng, i + 1);
    const tmp = cells[i]!;
    cells[i] = cells[j]!;
    cells[j] = tmp;
  }

  const prizeCells: number[] = [];
  if (win && winningSymbol) {
    for (let i = 0; i < cells.length; i++) {
      if (cells[i] === winningSymbol) prizeCells.push(i);
    }
  }

  return { grid: cells, prizeCells };
}

/**
 * Resolve a scratch card deterministically from the seed.
 *  1. Roll the OUTCOME (winning multiplier M>0 + winning symbol, or a loss)
 *     from the tier's weighted table.
 *  2. Build the 9-cell grid consistent with that outcome (see buildGrid).
 * Scratching on the client is cosmetic; this is the single source of truth.
 */
export function resolveScratch(seed: number, tier: ScratchTier): ScratchResult {
  const table = SCRATCH_TIERS[tier];

  // Stream 1 — pick the outcome row.
  const outcomeRng = mulberry32(deriveSubSeed(seed, `scratch:outcome:${tier}`));
  const outcome = pickOutcome(table, outcomeRng());
  const win = outcome.mult > 0;

  // Stream 2 — pick the winning symbol (on a win) + arrange the grid.
  const gridRng = mulberry32(deriveSubSeed(seed, `scratch:grid:${tier}`));
  const winningSymbol: ScratchSymbol | null = win
    ? SCRATCH_SYMBOLS[randInt(gridRng, SCRATCH_SYMBOLS.length)]!
    : null;

  const { grid, prizeCells } = buildGrid(gridRng, win, winningSymbol);

  return {
    tier,
    grid,
    win,
    symbol: winningSymbol,
    multiplier: outcome.mult,
    prizeCells,
  };
}

/* ===========================================================================
 *  Payout
 * ========================================================================= */

/**
 * Compute the scratch payout. The multiplier already embeds the RTP (the
 * distribution IS the RTP), so we do NOT apply any ARCADE_RTP factor here —
 * we simply convert wager × M to integer Tickets without biasing EV.
 * ARCADE_RTP['arcade-scratch'] is read so this file stays in lockstep with the
 * shared constant (it is 1.0; multiplying is a no-op but documents intent).
 */
export function computeScratchPayout(
  wager: number,
  result: ScratchResult,
  seed: number,
): number {
  if (!result.win || result.multiplier <= 0) return 0;
  const exactPayout =
    wager * result.multiplier * ARCADE_RTP['arcade-scratch'];
  return roundArcadePayout(
    exactPayout,
    seed,
    `scratch:${result.tier}:${result.multiplier}`,
  );
}
