// ---------------------------------------------------------------------------
// tixy — Slots game logic
// ---------------------------------------------------------------------------

import {
  SLOT_REEL_STOPS,
  SLOT_SYMBOL_WEIGHTS,
  SLOT_3_MATCH_PAYOUTS,
  SLOT_2_MATCH_PAYOUTS,
  SLOT_PAYLINES,
  type SlotSymbol,
} from '../arcade-constants';
import { roundArcadePayout } from '../arcade-payout';
import { mulberry32, deriveSubSeed } from '../arcade-rng';

export type SlotsResult = {
  /** 3x3 grid of symbols (row-major: [0..2] = top row, [3..5] = mid, [6..8] = bottom) */
  grid: SlotSymbol[];
  /** Raw reel stop positions (0..SLOT_REEL_STOPS-1) for each of 3 reels */
  reelStops: [number, number, number];
  /** Best-paying payline result (null if no win) */
  winPayline: { paylineIndex: number; symbols: SlotSymbol[]; multiplier: number } | null;
  /** Total payout multiplier (0 if no win) */
  multiplier: number;
};

/** Build the symbol lookup array from weights. */
function buildReelStrip(): SlotSymbol[] {
  const strip: SlotSymbol[] = [];
  for (const { symbol, weight } of SLOT_SYMBOL_WEIGHTS) {
    for (let i = 0; i < weight; i++) {
      strip.push(symbol);
    }
  }
  return strip;
}

const REEL_STRIP = buildReelStrip();

/** Map a reel stop index (0..31) to the 3 visible symbols (above, center, below). */
function getVisibleSymbols(stop: number): [SlotSymbol, SlotSymbol, SlotSymbol] {
  const above = REEL_STRIP[(stop + SLOT_REEL_STOPS - 1) % SLOT_REEL_STOPS]!;
  const center = REEL_STRIP[stop % SLOT_REEL_STOPS]!;
  const below = REEL_STRIP[(stop + 1) % SLOT_REEL_STOPS]!;
  return [above, center, below];
}

/** Evaluate all paylines and return the best win. */
function evaluatePaylines(grid: SlotSymbol[]): SlotsResult['winPayline'] {
  let bestPayline: SlotsResult['winPayline'] = null;
  let bestMultiplier = 0;

  for (let pi = 0; pi < SLOT_PAYLINES.length; pi++) {
    const [a, b, c] = SLOT_PAYLINES[pi]!;
    const symbols = [grid[a]!, grid[b]!, grid[c]!];

    // Check 3-match
    if (symbols[0] === symbols[1] && symbols[1] === symbols[2]) {
      const mult = SLOT_3_MATCH_PAYOUTS[symbols[0]];
      if (mult > bestMultiplier) {
        bestMultiplier = mult;
        bestPayline = { paylineIndex: pi, symbols, multiplier: mult };
      }
      continue;
    }

    // Check 2-match (first two or last two matching, with a 2-match payout)
    for (const pair of [[0, 1], [1, 2]] as const) {
      if (symbols[pair[0]] === symbols[pair[1]]) {
        const sym = symbols[pair[0]];
        const mult = SLOT_2_MATCH_PAYOUTS[sym];
        if (mult && mult > bestMultiplier) {
          bestMultiplier = mult;
          bestPayline = { paylineIndex: pi, symbols, multiplier: mult };
        }
      }
    }
  }

  return bestPayline;
}

/** Resolve the slots outcome from a seed. */
export function resolveSlots(seed: number): SlotsResult {
  const rng = mulberry32(deriveSubSeed(seed, 'slots-reels'));
  const reelStops: [number, number, number] = [
    Math.floor(rng() * SLOT_REEL_STOPS),
    Math.floor(rng() * SLOT_REEL_STOPS),
    Math.floor(rng() * SLOT_REEL_STOPS),
  ];

  // Build the 3x3 grid from the 3 reel stops
  const [r1Above, r1Center, r1Below] = getVisibleSymbols(reelStops[0]);
  const [r2Above, r2Center, r2Below] = getVisibleSymbols(reelStops[1]);
  const [r3Above, r3Center, r3Below] = getVisibleSymbols(reelStops[2]);

  const grid: SlotSymbol[] = [
    r1Above, r2Above, r3Above,   // top row
    r1Center, r2Center, r3Center, // middle row
    r1Below, r2Below, r3Below,    // bottom row
  ];

  const winPayline = evaluatePaylines(grid);
  const multiplier = winPayline?.multiplier ?? 0;

  return { grid, reelStops, winPayline, multiplier };
}

/** Compute slots payout amount. */
export function computeSlotsPayout(
  wager: number,
  multiplier: number,
  seed: number,
): number {
  if (multiplier <= 0) return 0;
  return roundArcadePayout(wager * multiplier, seed, `slots:${multiplier}`);
}
