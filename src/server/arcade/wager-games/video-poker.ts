// ---------------------------------------------------------------------------
// Arcade — Video Poker (Jacks or Better) game logic
// ---------------------------------------------------------------------------
//
// Provably-fair model: the session seed deterministically shuffles a standard
// 52-card deck (Fisher-Yates via mulberry32). The first 5 cards are the deal.
// On the draw, every card the player did NOT hold is replaced, in order, by
// the next cards in the shuffled deck (positions 5..9). The final 5-card hand
// is ranked against a Jacks-or-Better paytable and paid.
//
// Action model (see action/route.ts):
//   - `peek`  : non-mutating, NO recorded choice, NO seed in response. Returns
//               the initial 5-card deal derived from the seed.
//   - `draw`  : mutating + terminal. Computes the final hand deterministically
//               from { holds }, evaluates the rank, settles (reveals the seed),
//               and records ONE choice { holds, rank, payoutMult }.
//
// RTP: the house edge is baked entirely into the PAYTABLE (this is an 8/5
// Jacks-or-Better table with a bounded 250× royal). ARCADE_RTP for this game
// is 1.0 and the payout is NEVER multiplied by RTP. See the paytable note for
// the cited optimal-strategy return.
// ---------------------------------------------------------------------------

import { roundArcadePayout } from '../arcade-payout';
import { deriveSubSeed, seededShuffle } from '../arcade-rng';

export type VideoPokerSuit = 0 | 1 | 2 | 3; // spades, hearts, diamonds, clubs
export type Card = { rank: number; suit: VideoPokerSuit };

/** The hand categories we pay, best → worst. `none` is the losing bucket. */
export type VideoPokerRank =
  | 'royalFlush'
  | 'straightFlush'
  | 'fourKind'
  | 'fullHouse'
  | 'flush'
  | 'straight'
  | 'threeKind'
  | 'twoPair'
  | 'jacksOrBetter'
  | 'none';

/**
 * Jacks-or-Better paytable expressed as TOTAL-RETURN multipliers per unit
 * staked (i.e. payout = wager × value; a value of 1 returns the stake — a
 * push). This is the classic **8/5 Jacks or Better** schedule (8× full house,
 * 5× flush) with the royal flush BOUNDED to 250× rather than the headline
 * 800× max-coin bonus, so a single jackpot can't blow up the bankroll.
 *
 * Optimal-strategy RTP: published 8/5 Jacks or Better returns ≈ 97.30% under
 * perfect play (full house 8, flush 5, straight 4, trips 3, two pair 2, JoB 1,
 * straight flush 50, quads 25, royal 250-for-1). Capping the royal at 250×
 * (the standard non-max-coin royal value the 97.30% figure is computed from)
 * keeps us right at that ~97.3% mark — comfortably inside the 97–98% target.
 */
export const VIDEO_POKER_PAYTABLE: Record<VideoPokerRank, number> = {
  royalFlush: 250,
  straightFlush: 50,
  fourKind: 25,
  fullHouse: 8,
  flush: 5,
  straight: 4,
  threeKind: 3,
  twoPair: 2,
  jacksOrBetter: 1,
  none: 0,
};

/** Human-friendly labels for the paytable / result UI. */
export const VIDEO_POKER_RANK_LABELS: Record<VideoPokerRank, string> = {
  royalFlush: 'Royal Flush',
  straightFlush: 'Straight Flush',
  fourKind: 'Four of a Kind',
  fullHouse: 'Full House',
  flush: 'Flush',
  straight: 'Straight',
  threeKind: 'Three of a Kind',
  twoPair: 'Two Pair',
  jacksOrBetter: 'Jacks or Better',
  none: 'No Win',
};

export const VIDEO_POKER_HAND_SIZE = 5;

/**
 * One recorded player action for a video-poker round. The whole round is a
 * single draw, so exactly one choice is stored: which cards were held, the
 * resulting rank, and the total-return multiplier paid.
 */
export type VideoPokerChoice = {
  holds: boolean[];
  rank: VideoPokerRank;
  payoutMult: number;
};

export type VideoPokerConfig = Record<string, never>;

/** Video poker takes no per-session config; validate an empty object. */
export function validateVideoPokerConfig(config: unknown): VideoPokerConfig | null {
  if (config == null) return {};
  if (typeof config !== 'object') return null;
  return {};
}

/** The ordered 52-card deck before shuffling (ranks 2..14, A high = 14). */
function buildOrderedDeck(): Card[] {
  const deck: Card[] = [];
  for (let suit = 0 as VideoPokerSuit; suit <= 3; suit = (suit + 1) as VideoPokerSuit) {
    for (let rank = 2; rank <= 14; rank++) {
      deck.push({ rank, suit });
    }
  }
  return deck;
}

/**
 * Deterministically shuffle the 52-card deck for a given seed. A dedicated
 * sub-seed keeps this stream independent from any payout-rounding stream.
 */
export function buildVideoPokerDeck(seed: number): Card[] {
  return seededShuffle(buildOrderedDeck(), deriveSubSeed(seed, 'video-poker-deck'));
}

/** The initial 5-card deal: the top 5 cards of the shuffled deck. */
export function dealVideoPoker(seed: number): Card[] {
  return buildVideoPokerDeck(seed).slice(0, VIDEO_POKER_HAND_SIZE);
}

/**
 * Compute the final 5-card hand after a draw. Held positions keep their dealt
 * card; every non-held position is replaced, left-to-right, by the next card
 * in the shuffled deck (positions 5, 6, 7, …). Fully deterministic in the seed
 * + holds, so the server can recompute the result from the recorded choice.
 */
export function drawVideoPoker(seed: number, holds: readonly boolean[]): Card[] {
  const deck = buildVideoPokerDeck(seed);
  const dealt = deck.slice(0, VIDEO_POKER_HAND_SIZE);
  let nextDrawIndex = VIDEO_POKER_HAND_SIZE;
  const final: Card[] = [];
  for (let i = 0; i < VIDEO_POKER_HAND_SIZE; i++) {
    if (holds[i]) {
      final.push(dealt[i]!);
    } else {
      final.push(deck[nextDrawIndex]!);
      nextDrawIndex += 1;
    }
  }
  return final;
}

/** Normalize/validate a holds payload into exactly 5 booleans. */
export function normalizeHolds(raw: unknown): boolean[] | null {
  if (!Array.isArray(raw) || raw.length !== VIDEO_POKER_HAND_SIZE) return null;
  const holds: boolean[] = [];
  for (const v of raw) {
    if (typeof v !== 'boolean') return null;
    holds.push(v);
  }
  return holds;
}

/**
 * Detect a 5-card straight. Handles BOTH ace-high (10-J-Q-K-A) and ace-low
 * (A-2-3-4-5) wheels. Returns whether it's a straight and, when it is, the
 * straight's high card (the A counts as 5 for the wheel, 14 for the broadway
 * straight) so callers can tell a royal from a lower straight flush.
 */
function evaluateStraight(ranks: readonly number[]): { isStraight: boolean; highCard: number } {
  const unique = Array.from(new Set(ranks));
  if (unique.length !== VIDEO_POKER_HAND_SIZE) {
    return { isStraight: false, highCard: 0 };
  }
  const sorted = [...unique].sort((a, b) => a - b);

  // Ace-high / normal run: every step is +1.
  const isSequential = sorted.every(
    (r, i) => i === 0 || r === sorted[i - 1]! + 1,
  );
  if (isSequential) {
    return { isStraight: true, highCard: sorted[sorted.length - 1]! };
  }

  // Ace-low wheel: A(14)-2-3-4-5 → treat the ace as 1, high card is 5.
  const isWheel =
    sorted[0] === 2 &&
    sorted[1] === 3 &&
    sorted[2] === 4 &&
    sorted[3] === 5 &&
    sorted[4] === 14;
  if (isWheel) {
    return { isStraight: true, highCard: 5 };
  }

  return { isStraight: false, highCard: 0 };
}

/**
 * Evaluate a final 5-card hand against the Jacks-or-Better schedule.
 *
 * "Jacks or Better" means a single pair only pays when it is a pair of
 * Jacks (11), Queens (12), Kings (13), or Aces (14). Lower pairs lose.
 */
export function evaluateJacksOrBetter(cards: readonly Card[]): VideoPokerRank {
  if (cards.length !== VIDEO_POKER_HAND_SIZE) return 'none';

  const ranks = cards.map((c) => c.rank);
  const suits = cards.map((c) => c.suit);

  const isFlush = suits.every((s) => s === suits[0]);
  const { isStraight, highCard } = evaluateStraight(ranks);

  // Count how many cards share each rank → the multiplicity histogram.
  const rankCounts = new Map<number, number>();
  for (const r of ranks) {
    rankCounts.set(r, (rankCounts.get(r) ?? 0) + 1);
  }
  const counts = Array.from(rankCounts.values()).sort((a, b) => b - a);

  // Straight flush family (a royal is a straight flush topped by an ace).
  if (isStraight && isFlush) {
    return highCard === 14 ? 'royalFlush' : 'straightFlush';
  }
  if (counts[0] === 4) return 'fourKind';
  if (counts[0] === 3 && counts[1] === 2) return 'fullHouse';
  if (isFlush) return 'flush';
  if (isStraight) return 'straight';
  if (counts[0] === 3) return 'threeKind';
  if (counts[0] === 2 && counts[1] === 2) return 'twoPair';

  // Exactly one pair — pays only on Jacks or higher.
  if (counts[0] === 2) {
    for (const [rank, count] of rankCounts) {
      if (count === 2 && rank >= 11) return 'jacksOrBetter';
    }
  }

  return 'none';
}

/** The total-return multiplier for a rank (0 for a losing hand). */
export function getVideoPokerPayoutMultiplier(rank: VideoPokerRank): number {
  return VIDEO_POKER_PAYTABLE[rank] ?? 0;
}

/**
 * Final payout for a settled video-poker hand. The edge lives in the
 * paytable, so we do NOT apply ARCADE_RTP here — payout is simply
 * wager × paytableReturn, rounded to an integer via the seeded
 * fractional-rounding helper.
 */
export function computeVideoPokerPayout(
  wager: number,
  rank: VideoPokerRank,
  seed: number,
): number {
  const mult = getVideoPokerPayoutMultiplier(rank);
  if (mult <= 0) return 0;
  return roundArcadePayout(wager * mult, seed, `vp:${rank}`);
}
