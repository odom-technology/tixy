// ---------------------------------------------------------------------------
// tixy — Gem Roll game logic (instant one-roll pattern wager)
//
// Five gems roll from 7 possible colours (5 independent uniform draws off the
// session seed). Colours have NO order, so the hand is scored purely by its
// multiplicity pattern — a poker-hand hierarchy on matches:
//
//   five-of-a-kind > four-of-a-kind > full house (3+2) > three-of-a-kind >
//   two pair > one pair > no pair (bust, 0×)
//
// Provably-fair shape (mirrors dice/prize-wheel):
//   rng   = mulberry32(seed)             // shared PRNG, no sub-seed
//   gem_i = floor(rng() * 7)             // 5 consecutive draws, i = 0..4
// The client reconstructs the same 5 draws from the revealed seed with the same
// math to verify the roll; the payout, however, always comes from the server's
// settle response.
//
// House edge lives ENTIRELY in the multiplier table. The 7 patterns partition
// all 7^5 = 16,807 equally-likely ordered outcomes; the multipliers below are
// tuned so the weighted return is EXACTLY 0.99 by enumeration:
//
//   sum_pattern( count(pattern) × multiplier(pattern) ) = 16,638.93
//   RTP = 16,638.93 / 16,807 = 0.990000  (exactly)
//
// Because the edge is baked into the table, ARCADE_RTP['arcade-gem-roll'] is 1.0
// — do NOT discount a second time. See scratchpad/gem-roll/verify-rtp.ts for the
// full 16,807-outcome enumeration proof.
// ---------------------------------------------------------------------------

import { roundArcadePayout } from '../arcade-payout';
import { mulberry32 } from '../arcade-rng';

/** The 7 gem colours. Order is fixed so the seeded draw is reproducible. */
export const GEM_COLORS = [
  'ruby',
  'amber',
  'citrine',
  'emerald',
  'sapphire',
  'amethyst',
  'rose',
] as const;
export type GemColor = (typeof GEM_COLORS)[number];

/** Gems rolled per round. */
export const GEM_ROLL_COUNT = 5;
/** Distinct colours a gem can be. */
export const GEM_COLOR_COUNT = GEM_COLORS.length; // 7
/** Total equally-likely ordered outcomes: 7^5. */
export const GEM_TOTAL_OUTCOMES = GEM_COLOR_COUNT ** GEM_ROLL_COUNT; // 16807

/**
 * Multiplicity patterns, best → worst. `bust` = five distinct colours (no
 * match at all). These are the only 7 partitions of 5 gems reachable.
 */
export const GEM_PATTERNS = [
  'five',
  'four',
  'fullHouse',
  'three',
  'twoPair',
  'pair',
  'bust',
] as const;
export type GemPattern = (typeof GEM_PATTERNS)[number];

/** Human-readable pattern names (UI paytable + result callout). */
export const GEM_PATTERN_LABELS: Record<GemPattern, string> = {
  five: 'Five of a kind',
  four: 'Four of a kind',
  fullHouse: 'Full house',
  three: 'Three of a kind',
  twoPair: 'Two pair',
  pair: 'One pair',
  bust: 'No match',
};

/**
 * Ordered-outcome counts per pattern over all 7^5 = 16,807 sequences. Derived by
 * exact combinatorics (verified by full enumeration in the offline proof):
 *
 *   five  [5]        : 7·(5!/5!)              = 7
 *   four  [4,1]      : 7·6·(5!/4!)            = 210
 *   full  [3,2]      : 7·6·(5!/3!2!)          = 420
 *   three [3,1,1]    : 7·C(6,2)·(5!/3!)       = 2100
 *   2pair [2,2,1]    : C(7,2)·5·(5!/2!2!)     = 3150
 *   pair  [2,1,1,1]  : 7·C(6,3)·(5!/2!)       = 8400
 *   bust  [1,1,1,1,1]: 7·6·5·4·3              = 2520
 *   ------------------------------------------------
 *   total                                     = 16,807 ✓
 */
export const GEM_PATTERN_COUNTS: Record<GemPattern, number> = {
  five: 7,
  four: 210,
  fullHouse: 420,
  three: 2100,
  twoPair: 3150,
  pair: 8400,
  bust: 2520,
};

/**
 * Payout multipliers, tuned so the enumerated RTP is EXACTLY 0.99.
 *
 *   count × multiplier contributions:
 *     five  7    × 49.89 =   349.23
 *     four  210  ×  7.57 =  1589.70
 *     full  420  ×  3.50 =  1470.00
 *     three 2100 ×  2.50 =  5250.00
 *     2pair 3150 ×  1.20 =  3780.00
 *     pair  8400 ×  0.50 =  4200.00
 *     bust  2520 ×  0    =     0.00
 *     -------------------------------
 *     total              = 16,638.93  →  /16,807 = 0.990000 exactly
 *
 * The headline five-of-a-kind pays ~50× (49.89× makes the whole table land on
 * an exact 0.99 with clean 2-decimal multipliers everywhere).
 */
export const GEM_ROLL_PAYOUTS: Record<GemPattern, number> = {
  five: 49.89,
  four: 7.57,
  fullHouse: 3.5,
  three: 2.5,
  twoPair: 1.2,
  pair: 0.5,
  bust: 0,
};

export type GemRollResult = {
  /** The 5 rolled gem colours, in draw order. */
  gems: GemColor[];
  /** The scored multiplicity pattern. */
  pattern: GemPattern;
  /** Payout multiplier for the pattern (already includes the house edge). */
  multiplier: number;
  /** Colours that form a paying group (multiplicity ≥ 2); [] on a bust. */
  matchedColors: GemColor[];
  won: boolean;
};

/**
 * Roll the 5 gems for a seed. Deterministic and reproducible after reveal.
 * Mirrors the client's inline reconstruction exactly.
 */
export function rollGems(seed: number): GemColor[] {
  const rng = mulberry32(seed);
  const gems: GemColor[] = [];
  for (let i = 0; i < GEM_ROLL_COUNT; i++) {
    gems.push(GEM_COLORS[Math.floor(rng() * GEM_COLOR_COUNT)]!);
  }
  return gems;
}

/** Count occurrences of each colour present in the hand. */
function colorCounts(gems: readonly GemColor[]): Map<GemColor, number> {
  const counts = new Map<GemColor, number>();
  for (const g of gems) counts.set(g, (counts.get(g) ?? 0) + 1);
  return counts;
}

/** Classify a hand into its multiplicity pattern. */
export function classifyPattern(gems: readonly GemColor[]): GemPattern {
  const counts = [...colorCounts(gems).values()].sort((a, b) => b - a);
  const [top = 0, second = 0] = counts;
  if (top === 5) return 'five';
  if (top === 4) return 'four';
  if (top === 3 && second === 2) return 'fullHouse';
  if (top === 3) return 'three';
  if (top === 2 && second === 2) return 'twoPair';
  if (top === 2) return 'pair';
  return 'bust';
}

/** Colours appearing ≥ 2 times — the gems that "flare" on a match. */
function matchedColorsOf(gems: readonly GemColor[]): GemColor[] {
  const out: GemColor[] = [];
  for (const [color, n] of colorCounts(gems)) if (n >= 2) out.push(color);
  return out;
}

/** Resolve the full Gem Roll outcome from a seed. */
export function resolveGemRoll(seed: number): GemRollResult {
  const gems = rollGems(seed);
  const pattern = classifyPattern(gems);
  const multiplier = GEM_ROLL_PAYOUTS[pattern];
  return {
    gems,
    pattern,
    multiplier,
    matchedColors: pattern === 'bust' ? [] : matchedColorsOf(gems),
    won: multiplier > 0,
  };
}

/**
 * Integer Ticket payout for a settled roll. The edge is already inside the
 * multiplier table, so the payout multiplier is exactly the table value — no
 * extra RTP factor. Rounded once through the shared unbiased helper.
 */
export function computeGemRollPayout(
  wager: number,
  result: GemRollResult,
  seed: number,
): number {
  if (!result.won || result.multiplier <= 0) return 0;
  return roundArcadePayout(
    wager * result.multiplier,
    seed,
    `gem-roll:${result.pattern}`,
  );
}

// ---------------------------------------------------------------------------
// Verification helpers (used by the offline enumeration proof + dev asserts).
// ---------------------------------------------------------------------------

/** Exact probability of a pattern = count / 7^5. */
export function gemPatternProbability(pattern: GemPattern): number {
  return GEM_PATTERN_COUNTS[pattern] / GEM_TOTAL_OUTCOMES;
}

/**
 * Theoretical RTP from the multiplier table, computed from the closed-form
 * pattern counts. Equals 0.99 exactly by construction.
 */
export function gemRollTheoreticalRtp(): number {
  let weighted = 0;
  for (const pattern of GEM_PATTERNS) {
    weighted += GEM_PATTERN_COUNTS[pattern] * GEM_ROLL_PAYOUTS[pattern];
  }
  return weighted / GEM_TOTAL_OUTCOMES;
}
