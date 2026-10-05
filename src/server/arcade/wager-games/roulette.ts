// ---------------------------------------------------------------------------
// Arcade — Roulette game logic (European single-zero, single-action settle)
// ---------------------------------------------------------------------------
//
// The player places chips to build a bet set; the sum of all chip amounts is
// the session wager. The server spins a single pocket (0–36) from the seed and
// pays each winning bet at fair European odds. Because the 37-pocket geometry
// with fair payouts already yields RTP = 36/37 ≈ 97.3%, NO extra house-edge
// multiplier is applied here (ARCADE_RTP['arcade-roulette'] is 1.0). Applying
// 0.97 on top would double-discount to ~94.4%.
//
// sum(amounts) === wager is enforced in TWO places:
//   1. PRIMARY — the session route (/api/wagers/session), which has `wager` in
//      scope, calls validateRouletteConfig() then checks getRouletteStake() vs
//      wager and 400s on mismatch (see sharedEditNotes).
//   2. DEFENSE — resolveRoulette() throws if the staked sum doesn't match the
//      wager, so a forged/mismatched session can never settle inconsistently.
// ---------------------------------------------------------------------------

import { mulberry32 } from '../arcade-rng';
import { roundArcadePayout } from '../arcade-payout';

/** Total pockets on a European wheel: 0–36 (single green zero). */
export const ROULETTE_POCKETS = 37;

/** Maximum number of distinct chip placements in one round. */
export const ROULETTE_MAX_BETS = 60;

/** Standard European red set. Everything else 1–36 is black; 0 is green. */
export const RED_NUMBERS: readonly number[] = [
  1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36,
];

const RED_SET = new Set<number>(RED_NUMBERS);

export type RouletteColor = 'red' | 'black' | 'green';

/** Bet kinds. Inside bets carry explicit `numbers`; outside bets are matched
 *  by condition against the winning pocket (numbers[] may be empty for those). */
export type RouletteBetType =
  | 'straight'
  | 'split'
  | 'street'
  | 'corner'
  | 'six-line'
  | 'dozen'
  | 'column'
  | 'red'
  | 'black'
  | 'even'
  | 'odd'
  | 'low'
  | 'high';

export type RouletteBet = {
  type: RouletteBetType;
  /** Pocket numbers this bet covers (0–36). Inside bets list them explicitly;
   *  outside bets resolve by condition and may pass an empty array. */
  numbers: number[];
  /** Chip amount staked on this bet (positive integer). */
  amount: number;
};

export type RouletteConfig = {
  bets: RouletteBet[];
};

export type RouletteResult = {
  /** Winning pocket 0–36. */
  pocket: number;
  color: RouletteColor;
  /** Indices (into config.bets) of bets that won. */
  winningBets: number[];
  /** Integer total payout in tickets across all winning bets. */
  totalPayout: number;
  /** totalPayout / totalStaked — the settle multiplier. */
  multiplier: number;
};

// ---------------------------------------------------------------------------
// Odds table — total return multiple = amount × (odds + 1)
// ---------------------------------------------------------------------------
//
// These are the standard European single-zero "to-one" odds; the multiple
// below is (odds + 1), i.e. stake-inclusive total return on a win. The blended
// EV across any combination of these bets is exactly 36/37 of the staked total
// (each covered number returns its stake×multiple with probability 1/37, and
// `multiple × coveredCount = 36` for every bet type), so RTP ≈ 97.3% falls out
// automatically with NO extra multiplier.

export const ROULETTE_ODDS: Record<RouletteBetType, number> = {
  straight: 36, // 1 number  · 35:1
  split: 18, //    2 numbers · 17:1
  street: 12, //   3 numbers · 11:1
  corner: 9, //    4 numbers ·  8:1
  'six-line': 6, // 6 numbers ·  5:1
  dozen: 3, //     12 numbers ·  2:1
  column: 3, //    12 numbers ·  2:1
  red: 2, //       18 numbers ·  1:1
  black: 2,
  even: 2,
  odd: 2,
  low: 2, //       1–18
  high: 2, //      19–36
};

/** Required number of explicit pockets for inside bets. Outside bets resolve
 *  by condition and do not carry pockets, so they are absent here. */
const INSIDE_BET_COUNTS: Partial<Record<RouletteBetType, number>> = {
  straight: 1,
  split: 2,
  street: 3,
  corner: 4,
  'six-line': 6,
};

const OUTSIDE_BET_TYPES = new Set<RouletteBetType>([
  'dozen',
  'column',
  'red',
  'black',
  'even',
  'odd',
  'low',
  'high',
]);

const ALL_BET_TYPES = new Set<RouletteBetType>(
  Object.keys(ROULETTE_ODDS) as RouletteBetType[],
);

// ---------------------------------------------------------------------------
// Pocket helpers
// ---------------------------------------------------------------------------

/** Color of a pocket on a European wheel. */
export function pocketColor(pocket: number): RouletteColor {
  if (pocket === 0) return 'green';
  return RED_SET.has(pocket) ? 'red' : 'black';
}

/** Sum of all staked chip amounts — this MUST equal the session wager. */
export function getRouletteStake(bets: readonly RouletteBet[]): number {
  let sum = 0;
  for (const b of bets) sum += b.amount;
  return sum;
}

/**
 * Does a bet cover the winning pocket?
 * - Inside bets: membership in the explicit `numbers` list.
 * - Outside bets: the standard European condition (0/green never wins these).
 */
function betCoversPocket(bet: RouletteBet, pocket: number): boolean {
  switch (bet.type) {
    case 'straight':
    case 'split':
    case 'street':
    case 'corner':
    case 'six-line':
      return bet.numbers.includes(pocket);
    case 'red':
      return pocketColor(pocket) === 'red';
    case 'black':
      return pocketColor(pocket) === 'black';
    case 'even':
      return pocket !== 0 && pocket % 2 === 0;
    case 'odd':
      return pocket !== 0 && pocket % 2 === 1;
    case 'low':
      return pocket >= 1 && pocket <= 18;
    case 'high':
      return pocket >= 19 && pocket <= 36;
    case 'dozen':
      // numbers[] carries the dozen's 12 pockets (1–12 / 13–24 / 25–36).
      return bet.numbers.includes(pocket);
    case 'column':
      // numbers[] carries the column's 12 pockets.
      return bet.numbers.includes(pocket);
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate a roulette bet set from the client.
 *
 * Checks per bet: a known `type`; `amount` is a positive integer; and for
 * INSIDE bets a `numbers[]` of the exact required length whose entries are all
 * integers in 0–36. We validate length + range + integer-ness (and for dozen/
 * column, that 12 in-range pockets are supplied). ADJACENCY IS RELAXED — we do
 * NOT verify that a "split" is two physically-adjacent pockets or that a
 * "corner" forms a real square; a hostile client that lies about adjacency only
 * ever hurts itself (it still pays the same multiple over the same number of
 * covered pockets, so EV stays 36/37 and the house is never exposed). This keeps
 * the validator simple and the bet board free to evolve.
 *
 * Returns the parsed { bets } config, or null to reject. The sum===wager check
 * lives in the session route (which has `wager`) and is re-asserted in
 * resolveRoulette(); it is intentionally NOT done here because this function
 * cannot see the wager.
 */
export function validateRouletteConfig(config: unknown): RouletteConfig | null {
  if (!config || typeof config !== 'object') return null;
  const c = config as Record<string, unknown>;

  const rawBets = c.bets;
  if (!Array.isArray(rawBets)) return null;
  if (rawBets.length === 0 || rawBets.length > ROULETTE_MAX_BETS) return null;

  const bets: RouletteBet[] = [];

  for (const raw of rawBets) {
    if (!raw || typeof raw !== 'object') return null;
    const b = raw as Record<string, unknown>;

    const type = b.type;
    if (typeof type !== 'string' || !ALL_BET_TYPES.has(type as RouletteBetType)) {
      return null;
    }
    const betType = type as RouletteBetType;

    const amount = b.amount;
    if (
      typeof amount !== 'number' ||
      !Number.isInteger(amount) ||
      amount <= 0
    ) {
      return null;
    }

    const numbers = b.numbers;
    if (!Array.isArray(numbers)) return null;

    // Every supplied pocket must be an integer in 0–36.
    for (const n of numbers) {
      if (
        typeof n !== 'number' ||
        !Number.isInteger(n) ||
        n < 0 ||
        n > 36
      ) {
        return null;
      }
    }
    // No duplicate pockets within a single bet.
    if (new Set(numbers as number[]).size !== numbers.length) return null;

    // Length checks by bet kind.
    const requiredInside = INSIDE_BET_COUNTS[betType];
    if (requiredInside !== undefined) {
      if (numbers.length !== requiredInside) return null;
      // straight bets cannot sit on a "number" that isn't a real pocket — all
      // pockets 0–36 are valid, already range-checked above.
    } else if (betType === 'dozen' || betType === 'column') {
      // Dozen/column must carry their 12 covered pockets (1–36, never 0).
      if (numbers.length !== 12) return null;
      for (const n of numbers as number[]) {
        if (n < 1 || n > 36) return null;
      }
    } else if (OUTSIDE_BET_TYPES.has(betType)) {
      // red/black/even/odd/low/high resolve by condition — must carry no pockets.
      if (numbers.length !== 0) return null;
    } else {
      return null;
    }

    bets.push({ type: betType, numbers: numbers as number[], amount });
  }

  return { bets };
}

// ---------------------------------------------------------------------------
// Resolve + payout
// ---------------------------------------------------------------------------

/**
 * Spin the wheel from the seed and settle every bet.
 *
 * Winning pocket = floor(rng() * 37) ∈ 0..36 from mulberry32(seed). Each
 * winning bet's exact return is amount × ROULETTE_ODDS[type] (stake-inclusive);
 * we sum the exact returns, then round ONCE via roundArcadePayout for unbiased
 * integer tickets. The multiplier returned is totalPayout / totalStaked.
 *
 * `wager` is optional; when provided, it MUST equal the staked sum or this
 * throws — the second line of defense for the sum===wager invariant.
 */
export function resolveRoulette(
  seed: number,
  bets: readonly RouletteBet[],
  wager?: number,
): RouletteResult {
  const totalStaked = getRouletteStake(bets);
  if (wager !== undefined && totalStaked !== wager) {
    throw new Error('Roulette stake does not match the wagered amount.');
  }

  const rng = mulberry32(seed);
  const pocket = Math.floor(rng() * ROULETTE_POCKETS); // 0..36
  const color = pocketColor(pocket);

  const winningBets: number[] = [];
  let exactPayout = 0;

  for (let i = 0; i < bets.length; i++) {
    const bet = bets[i]!;
    if (betCoversPocket(bet, pocket)) {
      winningBets.push(i);
      exactPayout += bet.amount * ROULETTE_ODDS[bet.type];
    }
  }

  // Round the summed exact payout once (unbiased fractional-ticket rounding).
  // No fractional component is possible today (all odds are integers and chips
  // are integers), but rounding through the shared helper keeps the contract
  // future-proof and deterministic.
  const totalPayout = roundArcadePayout(
    exactPayout,
    seed,
    `roulette:${pocket}:${winningBets.join('-')}`,
  );

  const multiplier = totalStaked > 0 ? totalPayout / totalStaked : 0;

  return { pocket, color, winningBets, totalPayout, multiplier };
}

/**
 * Integer payout for a settled roulette round. Thin wrapper around
 * resolveRoulette so the settle route can read both the result (for the audit
 * outcomeJson + client animation) and the payout from one deterministic spin.
 */
export function computeRoulettePayout(
  wager: number,
  bets: readonly RouletteBet[],
  seed: number,
): number {
  return resolveRoulette(seed, bets, wager).totalPayout;
}
