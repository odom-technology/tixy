// ---------------------------------------------------------------------------
// tixy — Shared constants and configuration
// ---------------------------------------------------------------------------

export type ArcadeGameType =
  | 'arcade-coin-flip'
  | 'arcade-mines'
  | 'arcade-slots'
  | 'arcade-crash'
  | 'arcade-stoplight'
  | 'arcade-plinko'
  | 'arcade-dice'
  | 'arcade-chicken'
  | 'arcade-hilo'
  | 'arcade-cases'
  | 'arcade-packs'
  | 'arcade-darts'
  | 'arcade-lightspeed'
  | 'arcade-blackjack'
  | 'arcade-limbo'
  | 'arcade-dragon'
  | 'arcade-video-poker'
  | 'arcade-roulette'
  | 'arcade-scratch'
  | 'arcade-pump'
  | 'arcade-keno'
  | 'arcade-prize-wheel'
  | 'arcade-baccarat'
  | 'arcade-fortune-teller'
  | 'arcade-gem-roll'
  | 'arcade-lucky-cage'
  | 'arcade-prize-claw'
  | 'arcade-derby'
  | 'arcade-coin-pusher';

const ARCADE_GAME_TYPES: readonly ArcadeGameType[] = [
  'arcade-coin-flip',
  'arcade-mines',
  'arcade-slots',
  'arcade-crash',
  'arcade-stoplight',
  'arcade-plinko',
  'arcade-dice',
  'arcade-chicken',
  'arcade-hilo',
  'arcade-cases',
  'arcade-packs',
  'arcade-darts',
  'arcade-lightspeed',
  'arcade-blackjack',
  'arcade-limbo',
  'arcade-dragon',
  'arcade-video-poker',
  'arcade-roulette',
  'arcade-scratch',
  'arcade-pump',
  'arcade-keno',
  'arcade-prize-wheel',
  'arcade-baccarat',
  'arcade-fortune-teller',
  'arcade-gem-roll',
  'arcade-lucky-cage',
  'arcade-prize-claw',
  'arcade-derby',
  'arcade-coin-pusher',
];

export function isArcadeGameType(value: string): value is ArcadeGameType {
  return (ARCADE_GAME_TYPES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Bet limits
// ---------------------------------------------------------------------------

export const ARCADE_MIN_BET = 5;

/** The most a ticket column holds. wallets.credits, currency_ledger.amount and
 *  balance_after, game_sessions.arcade_wager and arcade_payout, and
 *  arcade_round_history are all 32-bit integers (migrations 0002 and 0004). */
export const TICKET_COLUMN_MAX = 2_147_483_647;
/** The most one round can pay. Under TICKET_COLUMN_MAX with room left for the
 *  balance it lands on: a win is added to the wallet in the same transaction,
 *  so the payout alone must not use up the column. A technical limit; no
 *  machine's odds are changed by it. */
export const MAX_ROUND_PAYOUT = 1_000_000_000;
/** A multiple of the bet no machine but mines pays more than. The biggest is
 *  keno's ten-spot on high risk, 10,012x once its RTP factor is applied; next
 *  are packs and fortune teller at 5,000x, then crash, limbo and cases at
 *  1,000x. Rounded up to leave room. scripts/verify-bet-ceiling.ts reads every
 *  game's table and fails if one pays more. */
export const TOP_PAID_MULTIPLIER = 12_500;
/** The largest bet on a ticket machine, a technical ceiling and not an
 *  economy cap: this bet at TOP_PAID_MULTIPLIER is MAX_ROUND_PAYOUT. A bet is
 *  any whole number from ARCADE_MIN_BET to the player's tickets, up to this. */
export const MAX_TICKET_BET = MAX_ROUND_PAYOUT / TOP_PAID_MULTIPLIER;
/** The step of the old bet selector and of derby's bets. Machine bets are
 *  whole numbers and don't use it. */
export const ARCADE_BET_INCREMENT = 5;

/** A round's payout, held under MAX_ROUND_PAYOUT. Only mines can reach it: a
 *  10-gem clear with 15 mines pays 3.17 million times the bet. */
export function capRoundPayout(payout: number): number {
  return Math.min(payout, MAX_ROUND_PAYOUT);
}

/** The most a player can bet with `balance` tickets: the whole balance, up to
 *  MAX_TICKET_BET. With no balance (a guest, or one still loading) it is
 *  `fallback`. */
export function maxBetFor(balance: number | null | undefined, fallback = 250): number {
  if (balance == null || !Number.isFinite(balance)) return Math.min(fallback, MAX_TICKET_BET);
  return Math.max(0, Math.min(Math.floor(balance), MAX_TICKET_BET));
}

/** The bet a wager route accepts: a whole number from ARCADE_MIN_BET to
 *  MAX_TICKET_BET. Returns the error sentence, or null when it is valid. The
 *  player's tickets are checked by the wallet debit, in the same transaction. */
export function invalidBetMessage(amount: unknown): string | null {
  if (typeof amount === 'number' && Number.isInteger(amount) && amount >= ARCADE_MIN_BET && amount <= MAX_TICKET_BET) {
    return null;
  }
  return `Bets are whole numbers from ${ARCADE_MIN_BET} to ${MAX_TICKET_BET.toLocaleString('en-US')} tickets.`;
}

// ---------------------------------------------------------------------------
// House edge (applied as multiplier on fair odds)
// ---------------------------------------------------------------------------

/** RTP = 1 - house edge. 0.97 means 3% house edge. */
export const ARCADE_RTP: Record<ArcadeGameType, number> = {
  'arcade-coin-flip': 0.97,
  'arcade-mines': 0.97,
  'arcade-slots': 0.97,
  'arcade-crash': 0.97,
  'arcade-stoplight': 0.97,
  'arcade-plinko': 0.97,
  'arcade-dice': 0.97,
  'arcade-chicken': 0.97,
  'arcade-hilo': 0.97,
  'arcade-cases': 0.97,
  'arcade-packs': 0.97,
  'arcade-darts': 0.97,
  'arcade-lightspeed': 0.97,
  // Blackjack's house edge is baked into the rules (dealer acts last, S17,
  // 3:2 blackjack pays). No extra RTP multiplier is applied to the raw payouts.
  'arcade-blackjack': 1.0,
  'arcade-limbo': 0.99, // ~1% edge baked into the crash-point distribution
  'arcade-dragon': 0.97,
  'arcade-video-poker': 1.0, // edge baked into the Jacks-or-Better paytable
  'arcade-roulette': 1.0, // edge baked into the 37-pocket single-zero geometry
  'arcade-scratch': 1.0, // edge baked into the per-tier prize distribution
  'arcade-pump': 0.97,
  // Keno pins every (profile, picks) column to exactly this RTP via
  // KENO_RTP_FACTORS (see wager-games/keno.ts) — ~1% house edge.
  'arcade-keno': 0.99,
  // Prize Wheel bakes the ~1% edge into every segment layout (each wheel sums
  // to 0.99 × count → RTP 0.990). No extra multiplier — see
  // wager-games/prize-wheel.ts.
  'arcade-prize-wheel': 1.0,
  // Baccarat pays the classic casino table odds — the house edge is baked
  // entirely into the fixed punto banco rules + the 5% banker commission
  // (Banker 1.06%, Player 1.24%, Tie 14.36%), NOT an RTP multiplier. This is a
  // DELIBERATE deviation from the arcade's usual ~1% convention (documented in
  // wager-games/baccarat.ts and the UI paytable). Do NOT discount payouts again.
  'arcade-baccarat': 1.0,
  // Fortune Teller bakes the ~1% edge into every tier's per-card distribution:
  // each card's EV is pinned to cbrt(0.99), so the compounded (product) RTP of
  // the three iid draws is ≈ 0.990. No extra multiplier — see
  // wager-games/fortune-teller.ts.
  'arcade-fortune-teller': 1.0,
  // Gem Roll bakes the ~1% edge into its multiplicity-pattern payout table: the
  // 7 patterns partition all 7^5 = 16,807 outcomes and the multipliers sum to
  // exactly 0.99 by enumeration (count × mult = 16,638.93). No extra multiplier
  // — see wager-games/gem-roll.ts.
  'arcade-gem-roll': 1.0,
  // Lucky Cage builds EVERY one of its 51 ticket multipliers directly from the
  // ticket's exact combinatoric probability over C(20,5) = 15,504 as
  // (1 / p) * this value, so each ticket returns exactly 0.99 by construction
  // and there is no paytable to drift. Unlike the games above this constant is
  // consumed as a real multiplier (see wager-games/lucky-cage.ts) — the settle
  // route must NOT discount the payout again.
  'arcade-lucky-cage': 0.99,
  // Prize Claw pins EVERY tier to this value at OPTIMAL CLEAR-TARGET PLAY:
  // each tier's maximum grab chance is derived as this / (holdChance ×
  // multiplier), so pGrabMax × pHold × mult = 0.97 exactly for all five tiers
  // and prize choice is a pure variance choice. A player who aims off the grip
  // cross, or picks a leaning (×0.80) or buried (×0.55) prize, returns less —
  // and the cabinet prints the exact grip chance before the drop. Like Lucky
  // Cage this constant is consumed as a real factor (see
  // wager-games/prize-claw.ts); the route must NOT discount the payout again.
  'arcade-prize-claw': 0.97,
  // Derby Royale: the ~4% edge is baked into the winner-draw distribution
  // (winner probability q_i is proportional to 1/m_i, renormalized), so every
  // horse's effective RTP is exactly 0.96/Sum(0.96/m_j) ≈ 0.96 regardless of
  // display rounding — see derby-shared.ts drawWinner/effectiveRtp. No extra
  // multiplier is applied to the amount x multiplier payout.
  'arcade-derby': 0.96,
  // Coin Pusher: a coin is 5 tickets and every coin that reaches the tray
  // pays 5 × this, with the hundredths carried on the machine, so the return
  // is exact. The sides are walls, so every coin dropped leaves through the
  // tray in the end; aim, timing and bet size can't change the return. See
  // features/arcade/lib/coin-pusher/economy.ts and verify-coin-pusher-rtp.ts.
  'arcade-coin-pusher': 0.97,
};

// ---------------------------------------------------------------------------
// Mines config
// ---------------------------------------------------------------------------

export const MINES_GRID_SIZE = 25; // 5x5
export const MINES_ALLOWED_COUNTS = [1, 3, 5, 10, 15] as const;
export type MineCount = (typeof MINES_ALLOWED_COUNTS)[number];

function floorToTwoDecimals(value: number): number {
  return Math.floor(value * 100) / 100;
}

/**
 * Pre-compute the payout multiplier for revealing `k` safe tiles
 * out of a grid with `m` mines. Applies house edge.
 *
 * Fair multiplier = product_{i=0}^{k-1} [ gridSize-i / (gridSize-mines-i) ]
 * Actual multiplier = fairMultiplier * RTP
 */
export function getMinesExactMultiplier(
  tilesRevealed: number,
  mineCount: number,
): number {
  if (tilesRevealed <= 0) return 0;
  const safeTiles = MINES_GRID_SIZE - mineCount;
  if (tilesRevealed > safeTiles) return 0;

  let fairMult = 1;
  for (let i = 0; i < tilesRevealed; i++) {
    fairMult *= (MINES_GRID_SIZE - i) / (safeTiles - i);
  }

  return fairMult * ARCADE_RTP['arcade-mines'];
}

export function getMinesMultiplier(
  tilesRevealed: number,
  mineCount: number,
): number {
  return floorToTwoDecimals(getMinesExactMultiplier(tilesRevealed, mineCount));
}

// ---------------------------------------------------------------------------
// Slots config
// ---------------------------------------------------------------------------

export type SlotSymbol = 'cherry' | 'lemon' | 'bar' | 'bell' | 'seven' | 'star';

export const SLOT_REEL_STOPS = 32;

/** Weights per reel (out of 32 total stops). Order matters for mapping. */
export const SLOT_SYMBOL_WEIGHTS: { symbol: SlotSymbol; weight: number }[] = [
  { symbol: 'cherry', weight: 10 },
  { symbol: 'lemon', weight: 8 },
  { symbol: 'bar', weight: 6 },
  { symbol: 'bell', weight: 4 },
  { symbol: 'seven', weight: 3 },
  { symbol: 'star', weight: 1 },
];

/**
 * Payout multipliers for 3 matching symbols on a payline.
 * Tuned via exhaustive 32^3 enumeration to yield ~96.96% RTP.
 */
export const SLOT_3_MATCH_PAYOUTS: Record<SlotSymbol, number> = {
  cherry: 3,
  lemon: 5,
  bar: 9,
  bell: 18,
  seven: 50,
  star: 250,
};

/** Payout multipliers for 2 matching symbols on a payline (only some symbols). */
export const SLOT_2_MATCH_PAYOUTS: Partial<Record<SlotSymbol, number>> = {
  cherry: 1,
  seven: 3,
  star: 6,
};

/**
 * 5 paylines on a 3x3 grid:
 * Grid positions:
 *   0 1 2
 *   3 4 5
 *   6 7 8
 *
 * Paylines: top row, middle row, bottom row, diagonal TL-BR, diagonal BL-TR
 */
export const SLOT_PAYLINES: [number, number, number][] = [
  [0, 1, 2], // top row
  [3, 4, 5], // middle row
  [6, 7, 8], // bottom row
  [0, 4, 8], // diagonal TL-BR
  [6, 4, 2], // diagonal BL-TR
];

// ---------------------------------------------------------------------------
// Crash config
// ---------------------------------------------------------------------------

/** Growth rate for the crash multiplier: mult(t) = e^(rate * t) */
export const CRASH_GROWTH_RATE = 0.06; // per 100ms tick
/** Maximum multiplier before auto-cashout */
export const CRASH_MAX_MULTIPLIER = 1000;

// ---------------------------------------------------------------------------
// Stoplight / Lucky Wheel config
// ---------------------------------------------------------------------------

export type StoplightZone = {
  label: string;
  multiplier: number;
  /** Probability weight (will be normalized). */
  weight: number;
  color: string;
};

/**
 * Wheel segments tuned to exactly 97.00% RTP.
 * EV = sum(weight/100 * multiplier) = 0.9700
 */
function stoplightZone(
  label: string,
  multiplier: number,
  weight: number,
  color: string,
): StoplightZone {
  return { label, multiplier, weight, color };
}

export const STOPLIGHT_ZONES: StoplightZone[] = [
  stoplightZone('Lose', 0, 47.5, '#374151'),
  stoplightZone('0.5x', 0.5, 20, '#f97316'),
  stoplightZone('1x', 1, 14.5, '#eab308'),
  stoplightZone('2x', 2, 9, '#22c55e'),
  stoplightZone('3x', 3, 4, '#14b8a6'),
  stoplightZone('5x', 5, 3, '#3b82f6'),
  stoplightZone('10x', 10, 1.5, '#8b5cf6'),
  stoplightZone('25x', 25, 0.5, '#ec4899'),
];

export const STOPLIGHT_TOTAL_WEIGHT = STOPLIGHT_ZONES.reduce(
  (sum, z) => sum + z.weight,
  0,
);

// ---------------------------------------------------------------------------
// Plinko config
// ---------------------------------------------------------------------------

export type PlinkoRisk = 'low' | 'medium' | 'high';
export type PlinkoRows = 8 | 12 | 16;

export const PLINKO_ALLOWED_ROWS = [8, 12, 16] as const;
export const PLINKO_ALLOWED_RISKS = ['low', 'medium', 'high'] as const;

/**
 * Raw display multipliers per (risk, rows) config. Indexed 0..rows.
 * Symmetric: slot 0 and slot N have the same multiplier.
 */
function symmetricMultipliers(leftSide: number[], center: number): number[] {
  return [...leftSide, center, ...[...leftSide].reverse()];
}

export const PLINKO_MULTIPLIERS: Record<PlinkoRisk, Record<PlinkoRows, number[]>> = {
  low: {
    8: symmetricMultipliers([5.6, 2.1, 1.1, 1], 0.5),
    12: symmetricMultipliers([11, 3, 1.6, 1.4, 1.1, 1], 0.5),
    16: symmetricMultipliers([16, 9, 2, 1.4, 1.4, 1.2, 1.1, 1], 0.5),
  },
  medium: {
    8: symmetricMultipliers([13, 3, 1.3, 0.7], 0.4),
    12: symmetricMultipliers([83, 10, 4, 2, 1.1, 0.5], 0.3),
    16: symmetricMultipliers([110, 41, 10, 5, 3, 1.5, 1, 0.5], 0.3),
  },
  high: {
    8: symmetricMultipliers([29, 4, 1.5, 0.3], 0.2),
    12: symmetricMultipliers([170, 24, 8.1, 2, 0.7, 0.2], 0.2),
    16: symmetricMultipliers([555, 118, 26, 9, 4, 2, 0.2, 0.2], 0.2),
  },
};

/**
 * Per-config RTP correction factors. Multiplied with the raw multiplier
 * to ensure exactly 97% theoretical RTP. Factor = 0.97 / rawRTP.
 */
export const PLINKO_RTP_FACTORS: Record<PlinkoRisk, Record<PlinkoRows, number>> = {
  low:    { 8: 0.9800, 12: 0.9795, 16: 0.9798 },
  medium: { 8: 0.9807, 12: 1.0002, 16: 0.9799 },
  high:   { 8: 0.9792, 12: 0.9786, 16: 0.9997 },
};

// ---------------------------------------------------------------------------
// Dice config
// ---------------------------------------------------------------------------

export type DiceDirection = 'over' | 'under';

/** Slider range: 2..98 (can't pick 1 or 100, that'd be 99% or 0%). */
export const DICE_MIN_TARGET = 2;
export const DICE_MAX_TARGET = 98;
/** The roll result range: 1..100 (integers). */
export const DICE_RANGE = 100;

/**
 * Compute the win probability for a given target and direction.
 * - "under": win if roll < target  → probability = (target - 1) / 100
 * - "over":  win if roll > target  → probability = (100 - target) / 100
 */
export function getDiceWinChance(
  target: number,
  direction: DiceDirection,
): number {
  if (direction === 'under') return (target - 1) / DICE_RANGE;
  return (DICE_RANGE - target) / DICE_RANGE;
}

/**
 * Compute the payout multiplier for a given win chance (with house edge).
 * Fair multiplier = 1 / winChance. Actual = fair * RTP.
 */
export function getDiceExactMultiplier(
  target: number,
  direction: DiceDirection,
): number {
  const winChance = getDiceWinChance(target, direction);
  if (winChance <= 0) return 0;
  const fairMult = 1 / winChance;
  return fairMult * ARCADE_RTP['arcade-dice'];
}

export function getDiceMultiplier(
  target: number,
  direction: DiceDirection,
): number {
  return floorToTwoDecimals(getDiceExactMultiplier(target, direction));
}

// ---------------------------------------------------------------------------
// Chicken (Crossy Road) config
// ---------------------------------------------------------------------------

export type ChickenDifficulty = 'easy' | 'medium' | 'hard' | 'daredevil';

export const CHICKEN_DIFFICULTIES: readonly ChickenDifficulty[] = [
  'easy',
  'medium',
  'hard',
  'daredevil',
];

export const CHICKEN_LANE_COUNTS: Record<ChickenDifficulty, number> = {
  easy: 24,
  medium: 24,
  hard: 24,
  daredevil: 12,
};

/**
 * Per-lane death probabilities by difficulty.
 * Survival per lane: 1 - deathProb.
 * Max multiplier at step 24 = RTP / survival^24.
 *
 *   easy:      1/25  → max ~2.51x     (almost-certain grind)
 *   medium:    3/25  → max ~21.7x     (meaningful risk, sweet spot)
 *   hard:      5/25  → max ~199x      (high variance)
 *   daredevil: 10/25 → max ~448x at 12 lanes (lottery — 40% death per step)
 */
export const CHICKEN_DEATH_PROB: Record<ChickenDifficulty, number> = {
  easy: 1 / 25,
  medium: 3 / 25,
  hard: 5 / 25,
  daredevil: 10 / 25,
};

/** Hard ceiling on any single chicken multiplier. */
const CHICKEN_MAX_MULTIPLIER = 500;

/**
 * Multiplier after successfully crossing `lanes` lanes at a given difficulty.
 * Fair mult = 1 / survival^lanes, apply RTP once. Floor to 2 decimals.
 * Returns 0 if the player hasn't crossed any lanes yet.
 */
export function getChickenExactMultiplier(
  lanesCrossed: number,
  difficulty: ChickenDifficulty,
): number {
  if (lanesCrossed <= 0) return 0;
  const laneCount = CHICKEN_LANE_COUNTS[difficulty];
  if (lanesCrossed > laneCount) return 0;
  const survival = 1 - CHICKEN_DEATH_PROB[difficulty];
  if (survival <= 0) return 0;
  const fairMult = 1 / Math.pow(survival, lanesCrossed);
  return Math.min(CHICKEN_MAX_MULTIPLIER, fairMult * ARCADE_RTP['arcade-chicken']);
}

export function getChickenMultiplier(
  lanesCrossed: number,
  difficulty: ChickenDifficulty,
): number {
  return floorToTwoDecimals(getChickenExactMultiplier(lanesCrossed, difficulty));
}

// ---------------------------------------------------------------------------
// Hi-Lo config
// ---------------------------------------------------------------------------

export type HiLoGuess = 'higher' | 'lower';

/** Standard 52-card deck, ranks 2..14 (J=11, Q=12, K=13, A=14). */
export const HILO_MIN_RANK = 2;
export const HILO_MAX_RANK = 14;
export const HILO_RANK_COUNT = HILO_MAX_RANK - HILO_MIN_RANK + 1; // 13
/** Hard ceiling so stacked chains can't blow up the multiplier. */
const HILO_MAX_MULTIPLIER = 500;
/** Max number of guesses allowed in one chain (practical ceiling). */
export const HILO_MAX_CHAIN = 20;

/**
 * Win probability for a given current rank + guess direction.
 * Stake-style inclusive convention:
 *   - "higher" wins when next rank >= current (ties count as a win).
 *   - "lower"  wins when next rank <= current (ties count as a win).
 * Each pick always has at least a 1/13 chance because of the tie, so neither
 * direction is ever "impossible" — this eliminates the need for push handling
 * and keeps chained EV cleanly at 97%.
 */
function getHiLoWinChance(
  currentRank: number,
  guess: HiLoGuess,
): number {
  if (currentRank < HILO_MIN_RANK || currentRank > HILO_MAX_RANK) return 0;
  if (guess === 'higher') {
    return (HILO_MAX_RANK - currentRank + 1) / HILO_RANK_COUNT;
  }
  return (currentRank - HILO_MIN_RANK + 1) / HILO_RANK_COUNT;
}

/**
 * Per-step fair multiplier for a Hi-Lo guess. We apply RTP once at cashout
 * (see getHiLoCumulativeMultiplier), so this is the raw fair increment.
 */
export function getHiLoStepFairMultiplier(
  currentRank: number,
  guess: HiLoGuess,
): number {
  const p = getHiLoWinChance(currentRank, guess);
  if (p <= 0) return 0;
  return 1 / p;
}

/**
 * Per-step *displayed* multiplier shown to the player before they commit
 * (already includes RTP discount — this is the "what I could win on this guess"
 * number). Final cumulative payout uses getHiLoCumulativeMultiplier so the
 * house edge is applied exactly once per round.
 */
function _getHiLoStepDisplayMultiplier(
  currentRank: number,
  guess: HiLoGuess,
): number {
  const fair = getHiLoStepFairMultiplier(currentRank, guess);
  if (fair <= 0) return 0;
  return floorToTwoDecimals(fair * ARCADE_RTP['arcade-hilo']);
}

/**
 * Cumulative payout multiplier for a completed chain of correct guesses.
 * Applies RTP once to the product of fair step multipliers, floors to 2dp.
 */
export function getHiLoExactCumulativeMultiplier(
  fairStepMultipliers: readonly number[],
): number {
  if (fairStepMultipliers.length === 0) return 0;
  let product = 1;
  for (const m of fairStepMultipliers) {
    if (m <= 0) return 0;
    product *= m;
  }
  return Math.min(HILO_MAX_MULTIPLIER, product * ARCADE_RTP['arcade-hilo']);
}

export function getHiLoCumulativeMultiplier(
  fairStepMultipliers: readonly number[],
): number {
  return floorToTwoDecimals(getHiLoExactCumulativeMultiplier(fairStepMultipliers));
}

// ---------------------------------------------------------------------------
// Cases (CS:GO-style multiplier box) config
// ---------------------------------------------------------------------------

export type CaseRisk = 'low' | 'medium' | 'high';

export const CASE_RISKS: readonly CaseRisk[] = ['low', 'medium', 'high'];

/** Rarity tier drives the item visuals. Modeled after CS:GO skin rarities. */
export type CasesRarity =
  | 'loss'
  | 'common'
  | 'uncommon'
  | 'rare'
  | 'mythic'
  | 'legendary'
  | 'covert';

export type CasesItem = {
  mult: number;
  /** Integer weight. Total weight per risk is whatever it ends up as after
   *  solving for a 0x loss that drives EV to exactly the RTP target. */
  weight: number;
  rarity: CasesRarity;
};

function pickRarity<T extends string>(
  mult: number,
  lossRarity: T,
  thresholds: readonly { below: number; rarity: T }[],
  fallback: T,
): T {
  if (mult <= 0) return lossRarity;
  return thresholds.find(({ below }) => mult < below)?.rarity ?? fallback;
}

const CASE_RARITY_THRESHOLDS: readonly { below: number; rarity: CasesRarity }[] = [
  { below: 2, rarity: 'common' },
  { below: 5, rarity: 'uncommon' },
  { below: 25, rarity: 'rare' },
  { below: 100, rarity: 'mythic' },
  { below: 1000, rarity: 'legendary' },
];

function rarityForMult(mult: number): CasesRarity {
  return pickRarity(mult, 'loss', CASE_RARITY_THRESHOLDS, 'covert');
}

/** Build a full item list from a set of win buckets, auto-computing the 0x
 *  loss weight so the distribution lands on the target RTP exactly (modulo
 *  integer rounding — verified at call sites). */
function buildCaseItems(
  winBuckets: readonly { mult: number; weight: number }[],
  rtp: number,
): CasesItem[] {
  let winEV = 0;
  let winWeight = 0;
  for (const b of winBuckets) {
    winEV += b.mult * b.weight;
    winWeight += b.weight;
  }
  // Solve: winEV / (winWeight + lossWeight) = rtp
  //   →   lossWeight = winEV / rtp - winWeight
  const lossWeight = Math.max(0, Math.round(winEV / rtp - winWeight));
  return [
    { mult: 0, weight: lossWeight, rarity: 'loss' as const },
    ...winBuckets.map((b) => ({
      mult: b.mult,
      weight: b.weight,
      rarity: rarityForMult(b.mult),
    })),
  ];
}

/* Low risk — max 10x, mostly small wins, ~28% loss rate. */
const LOW_WIN_BUCKETS = [
  { mult: 0.5, weight: 2500 },
  { mult: 1, weight: 2500 },
  { mult: 1.5, weight: 1500 },
  { mult: 2, weight: 800 },
  { mult: 3, weight: 400 },
  { mult: 5, weight: 200 },
  { mult: 10, weight: 100 },
] as const;

/* Medium risk — max 100x, wider spread, ~65% loss rate. */
const MEDIUM_WIN_BUCKETS = [
  { mult: 0.5, weight: 2000 },
  { mult: 1, weight: 1500 },
  { mult: 2, weight: 1000 },
  { mult: 5, weight: 500 },
  { mult: 10, weight: 250 },
  { mult: 25, weight: 100 },
  { mult: 50, weight: 40 },
  { mult: 100, weight: 10 },
] as const;

/* High risk — max 1,000x (1-in-~4k), ~93% loss rate. The previous tail had
 * a 10,000x at 1-in-36k that dominated ~28% of the entire EV budget and made
 * the house catastrophically variance-exposed (one hit = 333k spins to
 * recover). Removing it and redistributing the freed weight into 500x/1000x
 * keeps the "legendary moment" feel while capping the blast radius. */
const HIGH_WIN_BUCKETS = [
  { mult: 0.5, weight: 800 },
  { mult: 1, weight: 500 },
  { mult: 2, weight: 400 },
  { mult: 5, weight: 200 },
  { mult: 10, weight: 150 },
  { mult: 25, weight: 100 },
  { mult: 50, weight: 60 },
  { mult: 100, weight: 35 },
  { mult: 250, weight: 15 },
  { mult: 500, weight: 12 },
  { mult: 1000, weight: 8 },
] as const;

export const CASES_ITEMS: Record<CaseRisk, CasesItem[]> = {
  low: buildCaseItems(LOW_WIN_BUCKETS, ARCADE_RTP['arcade-cases']),
  medium: buildCaseItems(MEDIUM_WIN_BUCKETS, ARCADE_RTP['arcade-cases']),
  high: buildCaseItems(HIGH_WIN_BUCKETS, ARCADE_RTP['arcade-cases']),
};

/** Max multiplier for a given risk tier (for UI previews). */
const _CASES_MAX_MULT: Record<CaseRisk, number> = {
  low: 10,
  medium: 100,
  high: 1000,
};

// ---------------------------------------------------------------------------
// Packs config
// ---------------------------------------------------------------------------

export const PACKS_CARDS_PER_PACK = 5;

export type PacksRarity =
  | 'dud'
  | 'common'
  | 'uncommon'
  | 'rare'
  | 'epic'
  | 'legendary'
  | 'ultra'
  | 'mythic';

export type PacksCardBucket = {
  mult: number;
  weight: number;
  rarity: PacksRarity;
};

/**
 * Card themes derived from all Holocron games + two originals.
 * The 1000x Mythic is always 'holocron'.
 */
export const PACKS_THEMES = [
  'snake', 'flappy', 'eightball', 'tetris', 'coinflip',
  'typing', 'reaction', 'connections', 'mines', 'slots',
  'crash', 'wheel', 'plinko', 'dice', 'chicken',
  'hilo', 'cases', 'packs', 'chrome', 'holocron',
] as const;

export type PacksTheme = (typeof PACKS_THEMES)[number];

/**
 * Per-card win buckets. 5 cards drawn per pack.
 * Target per-card EV = 0.97 / 5 = 0.194.
 *
 * winEV   = 17 000
 * winWt   = 49 809
 * lossWt  = winEV / 0.194 - winWt ≈ 37 820
 * totalWt = 87 629
 * EV/card = 17 000 / 87 629 = 0.19400 → pack EV = 0.970 = 97% RTP ✓
 */
const PACKS_WIN_BUCKETS: readonly { mult: number; weight: number }[] = [
  { mult: 0.05,  weight: 20000 },  // common
  { mult: 0.1,   weight: 15000 },  // common
  { mult: 0.2,   weight: 8000 },   // uncommon
  { mult: 0.5,   weight: 4000 },   // uncommon
  { mult: 1,     weight: 1500 },   // rare
  { mult: 2,     weight: 800 },    // rare
  { mult: 5,     weight: 300 },    // epic
  { mult: 10,    weight: 120 },    // epic
  { mult: 25,    weight: 50 },     // epic
  { mult: 50,    weight: 25 },     // legendary
  { mult: 100,   weight: 10 },     // legendary
  { mult: 200,   weight: 3 },      // ultra
  { mult: 1000,  weight: 1 },      // mythic
];

const PACKS_RARITY_THRESHOLDS: readonly { below: number; rarity: PacksRarity }[] = [
  { below: 0.2, rarity: 'common' },
  { below: 1, rarity: 'uncommon' },
  { below: 5, rarity: 'rare' },
  { below: 50, rarity: 'epic' },
  { below: 200, rarity: 'legendary' },
  { below: 1000, rarity: 'ultra' },
];

function packsRarityForMult(mult: number): PacksRarity {
  return pickRarity(mult, 'dud', PACKS_RARITY_THRESHOLDS, 'mythic');
}

function buildPacksPool(rtp: number): PacksCardBucket[] {
  let winEV = 0;
  let winWeight = 0;
  for (const b of PACKS_WIN_BUCKETS) {
    winEV += b.mult * b.weight;
    winWeight += b.weight;
  }
  const perCardEV = rtp / PACKS_CARDS_PER_PACK;
  const lossWeight = Math.max(0, Math.round(winEV / perCardEV - winWeight));
  return [
    { mult: 0, weight: lossWeight, rarity: 'dud' as const },
    ...PACKS_WIN_BUCKETS.map((b) => ({
      mult: b.mult,
      weight: b.weight,
      rarity: packsRarityForMult(b.mult),
    })),
  ];
}

export const PACKS_CARD_POOL: PacksCardBucket[] = buildPacksPool(
  ARCADE_RTP['arcade-packs'],
);

/** Holo chance by rarity (mythic is always holo). */
export const PACKS_HOLO_CHANCE: Record<PacksRarity, number> = {
  dud: 0,
  common: 0.05,
  uncommon: 0.05,
  rare: 0.08,
  epic: 0.10,
  legendary: 0.12,
  ultra: 0.15,
  mythic: 1.0,
};

// ---------------------------------------------------------------------------
// Darts config
// ---------------------------------------------------------------------------

export type DartsZone = {
  label: string;
  multiplier: number;
  weight: number;
  color: string;
};

/**
 * 8 concentric zones from center outward.
 * Weights tuned for 97% RTP:
 *   winEV = 9950, winWeight = 7060, lossWeight = 3198,
 *   totalWeight = 10258, EV = 9950/10258 = 0.9700 ✓
 *   Miss rate ≈ 31%
 */
export const DARTS_ZONES: DartsZone[] = [
  { label: 'Bullseye',   multiplier: 100, weight: 10,   color: '#ef4444' },
  { label: 'Inner Bull',  multiplier: 25,  weight: 50,   color: '#f97316' },
  { label: 'Outer Bull',  multiplier: 8,   weight: 200,  color: '#eab308' },
  { label: 'Double',      multiplier: 3,   weight: 600,  color: '#8b5cf6' },
  { label: 'Treble',      multiplier: 1.5, weight: 1200, color: '#3b82f6' },
  { label: 'Single',      multiplier: 0.8, weight: 2000, color: '#22c55e' },
  { label: 'Outer',       multiplier: 0.3, weight: 3000, color: '#64748b' },
  { label: 'Miss',        multiplier: 0,   weight: 3198, color: '#374151' },
];

export const DARTS_TOTAL_WEIGHT = DARTS_ZONES.reduce(
  (sum, z) => sum + z.weight,
  0,
);

// ---------------------------------------------------------------------------
// Lightspeed config
// ---------------------------------------------------------------------------

export type LightspeedLane = 0 | 1 | 2;

export const LIGHTSPEED_WAYPOINTS = 8;
const LIGHTSPEED_MAX_MULTIPLIER = 500;

const _LIGHTSPEED_LANES: readonly LightspeedLane[] = [0, 1, 2];

export const LIGHTSPEED_LANE_CONFIG: Record<
  LightspeedLane,
  { label: string; survival: number; fairMult: number; color: string }
> = {
  0: { label: 'Safe',   survival: 0.95, fairMult: 1 / 0.95, color: '#3b82f6' },
  1: { label: 'Risky',  survival: 0.65, fairMult: 1 / 0.65, color: '#f59e0b' },
  2: { label: 'Deadly', survival: 0.35, fairMult: 1 / 0.35, color: '#ef4444' },
};

/** Display multiplier for a single step (includes RTP discount). */
function _getLightspeedStepDisplayMultiplier(lane: LightspeedLane): number {
  const fair = LIGHTSPEED_LANE_CONFIG[lane].fairMult;
  return floorToTwoDecimals(fair * ARCADE_RTP['arcade-lightspeed']);
}

/**
 * Cumulative payout multiplier for a sequence of successful jumps.
 * Product of fair step multipliers × RTP, capped at MAX_MULTIPLIER.
 */
export function getLightspeedExactCumulativeMultiplier(
  fairStepMults: readonly number[],
): number {
  if (fairStepMults.length === 0) return 0;
  let product = 1;
  for (const m of fairStepMults) {
    if (m <= 0) return 0;
    product *= m;
  }
  return Math.min(
    LIGHTSPEED_MAX_MULTIPLIER,
    product * ARCADE_RTP['arcade-lightspeed'],
  );
}

export function getLightspeedCumulativeMultiplier(
  fairStepMults: readonly number[],
): number {
  return floorToTwoDecimals(
    getLightspeedExactCumulativeMultiplier(fairStepMults),
  );
}
