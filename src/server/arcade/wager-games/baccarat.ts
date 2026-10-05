// ---------------------------------------------------------------------------
// Arcade — Baccarat (punto banco) game logic (server-authoritative)
// ---------------------------------------------------------------------------
//
// The world's highest-volume casino card game, single-shot wager shape (like
// keno / prize-wheel): the player picks ONE bet — Player, Banker, or Tie — the
// server deals a full round from a seeded 8-deck shoe using the OFFICIAL punto
// banco third-card tableau, and pays out. There are no per-round decisions: the
// tableau is fixed, so the deal is fully deterministic from the seed. The client
// re-derives the identical deal from the revealed seed (provably fair).
//
// Shoe: fresh 8-deck (416 cards) Fisher-Yates shuffle per round, derived from a
// sub-seed of the session seed — the same convention as 21 (blackjack.ts). Each
// round reshuffles from the seed chain (simplest provably-fair shape).
//
// House edge — DELIBERATE deviation from the arcade's usual ~1% convention:
// baccarat pays the classic casino table odds, so the edge is the table's, baked
// entirely into the fixed rules + commission (NOT an ARCADE_RTP multiplier):
//   Banker  1:1 − 5% commission  → 1.06% house edge
//   Player  1:1                  → 1.24% house edge
//   Tie     8:1                  → 14.36% house edge
// These are verified by high-N Monte Carlo (scripts under scratchpad/baccarat),
// since exact enumeration over an 8-deck shoe is infeasible. Honest odds are
// shown in the UI paytable.
// ---------------------------------------------------------------------------

import { deriveSubSeed, seededShuffle } from '../arcade-rng';
import { roundArcadePayout } from '../arcade-payout';

export type BaccaratSuit = 0 | 1 | 2 | 3; // spades, hearts, diamonds, clubs
export type BaccaratCard = { rank: number; suit: BaccaratSuit }; // rank 1 (A) .. 13 (K)

export type BaccaratBet = 'player' | 'banker' | 'tie';
export const BACCARAT_BETS: readonly BaccaratBet[] = ['player', 'banker', 'tie'];

export type BaccaratOutcome = 'player' | 'banker' | 'tie';

export type BaccaratResult = {
  playerCards: BaccaratCard[];
  bankerCards: BaccaratCard[];
  playerTotal: number;
  bankerTotal: number;
  outcome: BaccaratOutcome;
  /** True when the round ended on a two-card 8 or 9 (no third cards drawn). */
  natural: boolean;
};

export type BaccaratConfig = { bet: BaccaratBet };

const BACCARAT_DECKS = 8;
const _BACCARAT_SHOE_SIZE = BACCARAT_DECKS * 52; // 416

/**
 * Winning multiplier on the STAKE (returned stake included) for each bet on a
 * given outcome. A win returns stake + winnings; a tie pushes Player/Banker
 * (stake returned, multiplier 1); Tie itself pays 8:1 (returns 9×).
 *   player win  → 2      (1:1)
 *   banker win  → 1.95   (1:1 − 5% commission)
 *   tie   win   → 9      (8:1)
 *   push (P/B on a tie) → 1 (stake returned)
 *   loss        → 0
 */
export const BACCARAT_BANKER_COMMISSION = 0.05;

// ---------------------------------------------------------------------------
// Config validation
// ---------------------------------------------------------------------------

/** Validate a baccarat config from the client. */
export function validateBaccaratConfig(config: unknown): BaccaratConfig | null {
  if (!config || typeof config !== 'object') return null;
  const c = config as Record<string, unknown>;
  const bet = c.bet;
  if (typeof bet !== 'string' || !(BACCARAT_BETS as readonly string[]).includes(bet)) {
    return null;
  }
  return { bet: bet as BaccaratBet };
}

// ---------------------------------------------------------------------------
// Shoe + card values
// ---------------------------------------------------------------------------

/**
 * Build the deterministic 8-deck shoe from a sub-seed of the session seed, so
 * the shoe is stable even if the root seed is later used for something else.
 * Fisher-Yates shuffle (same helper the whole provably-fair stack uses).
 */
export function generateBaccaratShoe(seed: number): BaccaratCard[] {
  const cards: BaccaratCard[] = [];
  for (let d = 0; d < BACCARAT_DECKS; d++) {
    for (let suit = 0 as BaccaratSuit; suit <= 3; suit = (suit + 1) as BaccaratSuit) {
      for (let rank = 1; rank <= 13; rank++) {
        cards.push({ rank, suit });
      }
    }
  }
  return seededShuffle(cards, deriveSubSeed(seed, 'baccarat-shoe'));
}

/** Baccarat point value: Ace = 1, 2-9 face value, 10/J/Q/K = 0. */
export function baccaratCardValue(card: BaccaratCard): number {
  if (card.rank >= 10) return 0;
  return card.rank; // Ace (1) .. 9
}

/** Hand total = sum of card values, modulo 10 (0..9). */
function handTotal(cards: readonly BaccaratCard[]): number {
  let sum = 0;
  for (const card of cards) sum += baccaratCardValue(card);
  return sum % 10;
}

// ---------------------------------------------------------------------------
// Official punto banco tableau
// ---------------------------------------------------------------------------

/**
 * The banker's third-card decision when the PLAYER drew a third card. Indexed
 * by the banker's two-card total (0..7) → returns whether the banker draws,
 * given the value of the player's third card (0..9). This is the exact,
 * canonical drawing table used in every casino.
 *
 *   Banker 0,1,2            → always draws
 *   Banker 3               → draws unless player's third card is 8
 *   Banker 4               → draws if player's third card is 2-7
 *   Banker 5               → draws if player's third card is 4-7
 *   Banker 6               → draws if player's third card is 6-7
 *   Banker 7               → always stands
 */
function bankerDrawsAgainstPlayerThird(bankerTotal: number, playerThird: number): boolean {
  switch (bankerTotal) {
    case 0:
    case 1:
    case 2:
      return true;
    case 3:
      return playerThird !== 8;
    case 4:
      return playerThird >= 2 && playerThird <= 7;
    case 5:
      return playerThird >= 4 && playerThird <= 7;
    case 6:
      return playerThird >= 6 && playerThird <= 7;
    default: // 7 (and any 8/9 which would be a natural, handled earlier)
      return false;
  }
}

/**
 * Deal a full round from the seed and resolve it under the official tableau.
 * Deterministic and pure — the client re-derives the identical result from the
 * revealed seed. The outcome is INDEPENDENT of which bet the player placed.
 */
export function resolveBaccarat(seed: number): BaccaratResult {
  const shoe = generateBaccaratShoe(seed);
  let idx = 0;
  const draw = (): BaccaratCard => {
    const card = shoe[idx];
    if (!card) throw new Error('Baccarat shoe exhausted.');
    idx += 1;
    return card;
  };

  // Initial deal order: Player, Banker, Player, Banker.
  const playerCards: BaccaratCard[] = [draw(), (undefined as never)];
  const bankerCards: BaccaratCard[] = [draw(), (undefined as never)];
  playerCards[1] = draw();
  bankerCards[1] = draw();

  let playerTotal = handTotal(playerCards);
  let bankerTotal = handTotal(bankerCards);

  const playerNatural = playerTotal >= 8;
  const bankerNatural = bankerTotal >= 8;

  // Naturals (8 or 9 on the first two cards) end the hand immediately — no
  // third cards are drawn by either side.
  if (!playerNatural && !bankerNatural) {
    let playerThirdValue: number | null = null;

    // Player rule: draws a third card on 0-5, stands on 6-7.
    if (playerTotal <= 5) {
      const third = draw();
      playerCards.push(third);
      playerThirdValue = baccaratCardValue(third);
      playerTotal = handTotal(playerCards);
    }

    // Banker rule.
    if (playerThirdValue === null) {
      // Player stood: banker follows the same 0-5 draw / 6-7 stand rule.
      if (bankerTotal <= 5) {
        bankerCards.push(draw());
        bankerTotal = handTotal(bankerCards);
      }
    } else if (bankerDrawsAgainstPlayerThird(bankerTotal, playerThirdValue)) {
      bankerCards.push(draw());
      bankerTotal = handTotal(bankerCards);
    }
  }

  const outcome: BaccaratOutcome =
    playerTotal > bankerTotal ? 'player' : bankerTotal > playerTotal ? 'banker' : 'tie';

  return {
    playerCards,
    bankerCards,
    playerTotal,
    bankerTotal,
    outcome,
    natural: playerNatural || bankerNatural,
  };
}

// ---------------------------------------------------------------------------
// Payout
// ---------------------------------------------------------------------------

/**
 * Total return multiplier on the stake (returned stake included) for a bet on a
 * resolved round. Used both for the payout and for the history `multiplier`.
 *   Player: win 2×, tie push 1×, else 0
 *   Banker: win 1.95×, tie push 1×, else 0
 *   Tie:    win 9×, else 0 (Player/Banker pushes are handled by their own bet)
 */
export function baccaratReturnMultiplier(bet: BaccaratBet, outcome: BaccaratOutcome): number {
  if (bet === 'player') {
    if (outcome === 'player') return 2;
    if (outcome === 'tie') return 1; // push
    return 0;
  }
  if (bet === 'banker') {
    if (outcome === 'banker') return 2 - BACCARAT_BANKER_COMMISSION; // 1.95
    if (outcome === 'tie') return 1; // push
    return 0;
  }
  // tie
  return outcome === 'tie' ? 9 : 0;
}

/**
 * Integer Ticket payout (returned stake included) for a settled round. The
 * banker's 1.95× can be fractional; it is rounded once through the shared
 * unbiased helper so the 5% commission is exact in expectation (no downward
 * rounding bias). Player/Tie multipliers are integers.
 */
export function computeBaccaratPayout(
  wager: number,
  bet: BaccaratBet,
  outcome: BaccaratOutcome,
  seed: number,
): number {
  const mult = baccaratReturnMultiplier(bet, outcome);
  if (mult <= 0) return 0;
  return roundArcadePayout(wager * mult, seed, `baccarat:${bet}:${outcome}`);
}
