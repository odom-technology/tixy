// ---------------------------------------------------------------------------
// Arcade — Blackjack game logic (server-authoritative)
// ---------------------------------------------------------------------------
//
// All card draws and dealer play happen on the server from a seeded shoe.
// Every player action ('deal' | 'hit' | 'stand' | 'double' | 'split') is
// stored in the session's `choices` array and the authoritative state is
// recomputed by replaying the action log against the seed. The client
// never supplies card data, which closes the "hack your hand" attack
// surface (mirrors how Hi-Lo, Mines, and Crash are protected).
//
// Rules implemented (standard Vegas, S17):
//   - 4-deck shoe
//   - Dealer stands on all 17 (including soft 17)
//   - Blackjack (natural 21 on the initial 2-card hand) pays 3:2
//   - Double on any two-card hand (1 card dealt, then stand)
//   - Split on any two cards of equal point value; split aces get 1 card
//     each and must stand (no resplitting)
//   - No surrender, no insurance
//
// Wager accounting: splits and doubles each debit an additional 1× base
// wager from the wallet via `addArcadeWagerHold`. The session's
// `arcade_wager` is updated so `arcade_round_history.wager_amount` equals
// the total player exposure — which is what the wager leaderboard sums.
// ---------------------------------------------------------------------------

import { deriveSubSeed, mulberry32, seededShuffle } from '../arcade-rng';

export type BlackjackSuit = 0 | 1 | 2 | 3; // spades, hearts, diamonds, clubs
export type BlackjackCard = { rank: number; suit: BlackjackSuit }; // rank 1 (A) .. 13 (K)

export type BlackjackAction =
  | { type: 'deal' }
  | { type: 'hit' }
  | { type: 'stand' }
  | { type: 'double' }
  | { type: 'split' };

export type BlackjackHandOutcome =
  | 'win'
  | 'lose'
  | 'push'
  | 'blackjack'
  | 'bust'
  | 'dealerBust'
  | 'surrender';

export type BlackjackHandState = {
  cards: BlackjackCard[];
  bet: number;
  done: boolean;
  doubled: boolean;
  fromSplit: boolean;
  splitAce: boolean;
  outcome: BlackjackHandOutcome | null;
};

export type BlackjackReplayState = {
  dealerCards: BlackjackCard[];
  dealerPlayed: boolean;
  hands: BlackjackHandState[];
  activeHandIndex: number;
  phase: 'awaiting-deal' | 'playerTurn' | 'dealerTurn' | 'roundEnd';
  shoeIndex: number;
  baseWager: number;
};

export type BlackjackConfig = Record<string, never>;

const BLACKJACK_DECKS = 4;
const _BLACKJACK_SHOE_SIZE = BLACKJACK_DECKS * 52; // 208

/** Validate session config. Blackjack takes no per-session options. */
export function validateBlackjackConfig(config: unknown): BlackjackConfig | null {
  if (config == null) return {};
  if (typeof config !== 'object') return null;
  return {};
}

/**
 * Build the deterministic 4-deck shoe. The seed is the session's server
 * seed; we derive a sub-seed so if a future feature uses the root seed
 * for something else the shoe remains stable. Fisher-Yates shuffle.
 */
function generateBlackjackShoe(seed: number): BlackjackCard[] {
  const cards: BlackjackCard[] = [];
  for (let d = 0; d < BLACKJACK_DECKS; d++) {
    for (let suit = 0 as BlackjackSuit; suit <= 3; suit = (suit + 1) as BlackjackSuit) {
      for (let rank = 1; rank <= 13; rank++) {
        cards.push({ rank, suit });
      }
    }
  }
  const shuffleSeed = deriveSubSeed(seed, 'blackjack-shoe');
  // seededShuffle uses mulberry32 internally (imported below for awareness)
  // — this single call fully determines the shoe.
  void mulberry32; // keep import explicit for auditability
  return seededShuffle(cards, shuffleSeed);
}

/** Point value of a single card (Ace = 11, face cards = 10). */
function cardPoints(card: BlackjackCard): number {
  if (card.rank === 1) return 11;
  if (card.rank >= 11) return 10;
  return card.rank;
}

/** Best legal hand value (soft/hard A handling). */
function getHandValue(cards: readonly BlackjackCard[]): number {
  let total = 0;
  let aces = 0;
  for (const card of cards) {
    if (card.rank === 1) {
      total += 11;
      aces++;
    } else if (card.rank >= 11) {
      total += 10;
    } else {
      total += card.rank;
    }
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }
  return total;
}

function isBust(cards: readonly BlackjackCard[]): boolean {
  return getHandValue(cards) > 21;
}

function isNaturalBlackjack(cards: readonly BlackjackCard[]): boolean {
  return cards.length === 2 && getHandValue(cards) === 21;
}

function canSplitCards(a: BlackjackCard, b: BlackjackCard): boolean {
  return cardPoints(a) === cardPoints(b);
}

function shouldDealerHit(cards: readonly BlackjackCard[]): boolean {
  // Dealer stands on all 17 (S17).
  return getHandValue(cards) < 17;
}

/**
 * Draw the next card from the shoe. If the shoe were ever exhausted (can't
 * happen in practice — max ~20 cards per hand times up to 4 split hands is
 * far below 208) we would throw; the caller-level replay logic guarantees
 * we stop acting once a hand is resolved.
 */
function drawNext(
  shoe: readonly BlackjackCard[],
  index: number,
): { card: BlackjackCard; nextIndex: number } {
  if (index >= shoe.length) {
    throw new Error('Blackjack shoe exhausted.');
  }
  return { card: shoe[index]!, nextIndex: index + 1 };
}

/**
 * Replay a recorded action log from the seed and return the authoritative
 * state. Throws if any action is illegal given the prior state (e.g., hit
 * after bust, split on non-pair, double after a hit). The action log is
 * the sole source of truth; any state the client thinks it has is ignored.
 */
export function replayBlackjackRound(
  seed: number,
  baseWager: number,
  actions: readonly BlackjackAction[],
): BlackjackReplayState {
  const shoe = generateBlackjackShoe(seed);
  const state: BlackjackReplayState = {
    dealerCards: [],
    dealerPlayed: false,
    hands: [],
    activeHandIndex: 0,
    phase: 'awaiting-deal',
    shoeIndex: 0,
    baseWager,
  };

  for (const action of actions) {
    applyAction(state, shoe, action);
  }

  // Auto-finalize when appropriate (post-deal with natural BJ, or post any
  // action that leaves all hands done).
  maybeAdvanceToDealerOrEnd(state, shoe);

  return state;
}

function applyAction(
  state: BlackjackReplayState,
  shoe: readonly BlackjackCard[],
  action: BlackjackAction,
) {
  if (action.type === 'deal') {
    if (state.phase !== 'awaiting-deal') {
      throw new Error('Round already dealt.');
    }
    // Standard deal order: player card 1, dealer card 1, player card 2, dealer card 2.
    const p1 = drawNext(shoe, state.shoeIndex); state.shoeIndex = p1.nextIndex;
    const d1 = drawNext(shoe, state.shoeIndex); state.shoeIndex = d1.nextIndex;
    const p2 = drawNext(shoe, state.shoeIndex); state.shoeIndex = p2.nextIndex;
    const d2 = drawNext(shoe, state.shoeIndex); state.shoeIndex = d2.nextIndex;

    state.hands = [makeHand([p1.card, p2.card], state.baseWager, false, false)];
    state.dealerCards = [d1.card, d2.card];
    state.activeHandIndex = 0;
    state.phase = 'playerTurn';

    // Natural blackjack ends the player turn immediately.
    if (isNaturalBlackjack(state.hands[0]!.cards)) {
      state.hands[0]!.done = true;
    }

    // Dealer peeks for blackjack: if the dealer's initial two cards are a
    // natural 21, the hand ends right now. The player never gets to act —
    // if they also have a natural it's a push, otherwise they lose. The
    // dealer does NOT draw any additional cards (shouldDealerHit at 21
    // returns false, so maybeAdvanceToDealerOrEnd won't either).
    if (isNaturalBlackjack(state.dealerCards)) {
      for (const h of state.hands) h.done = true;
    }
    return;
  }

  if (state.phase !== 'playerTurn') {
    throw new Error('No player action allowed in current phase.');
  }
  const hand = state.hands[state.activeHandIndex];
  if (!hand || hand.done) {
    throw new Error('Active hand already resolved.');
  }

  switch (action.type) {
    case 'hit': {
      if (hand.splitAce) {
        throw new Error('Split aces cannot take another card.');
      }
      const draw = drawNext(shoe, state.shoeIndex);
      state.shoeIndex = draw.nextIndex;
      hand.cards.push(draw.card);
      if (isBust(hand.cards) || getHandValue(hand.cards) === 21) {
        hand.done = true;
        advanceActiveHand(state);
      }
      return;
    }
    case 'stand': {
      hand.done = true;
      advanceActiveHand(state);
      return;
    }
    case 'double': {
      if (hand.cards.length !== 2) {
        throw new Error('Double only allowed on two-card hand.');
      }
      if (hand.splitAce) {
        throw new Error('Split aces cannot be doubled.');
      }
      const draw = drawNext(shoe, state.shoeIndex);
      state.shoeIndex = draw.nextIndex;
      hand.cards.push(draw.card);
      hand.doubled = true;
      hand.bet = state.baseWager * 2; // reflect the extra hold
      hand.done = true;
      advanceActiveHand(state);
      return;
    }
    case 'split': {
      if (state.hands.length >= 4) {
        throw new Error('Maximum splits reached.');
      }
      if (hand.cards.length !== 2) {
        throw new Error('Split only allowed on two-card hand.');
      }
      if (!canSplitCards(hand.cards[0]!, hand.cards[1]!)) {
        throw new Error('Cannot split: cards differ in value.');
      }
      const [a, b] = hand.cards;
      const isAces = a!.rank === 1;
      const cardA = drawNext(shoe, state.shoeIndex); state.shoeIndex = cardA.nextIndex;
      const cardB = drawNext(shoe, state.shoeIndex); state.shoeIndex = cardB.nextIndex;

      const newHand1 = makeHand([a!, cardA.card], state.baseWager, true, isAces);
      const newHand2 = makeHand([b!, cardB.card], state.baseWager, true, isAces);

      if (isAces) {
        newHand1.done = true;
        newHand2.done = true;
      }

      // Replace current hand with the two new split hands, preserving position.
      state.hands.splice(state.activeHandIndex, 1, newHand1, newHand2);

      // With split aces both hands auto-stand; advance to the next unresolved.
      if (isAces) {
        advanceActiveHand(state);
      }
      return;
    }
    case 'deal' as never:
      throw new Error('Round already dealt.');
    default:
      throw new Error(`Unknown blackjack action: ${(action as { type?: string }).type}`);
  }
}

function makeHand(
  cards: BlackjackCard[],
  bet: number,
  fromSplit: boolean,
  splitAce: boolean,
): BlackjackHandState {
  return {
    cards,
    bet,
    done: false,
    doubled: false,
    fromSplit,
    splitAce,
    outcome: null,
  };
}

function advanceActiveHand(state: BlackjackReplayState) {
  while (
    state.activeHandIndex < state.hands.length &&
    state.hands[state.activeHandIndex]!.done
  ) {
    state.activeHandIndex++;
  }
}

/**
 * If every player hand is resolved, run dealer play (if any hand could
 * still win) and mark the round ended. Assigns per-hand outcomes.
 */
function maybeAdvanceToDealerOrEnd(
  state: BlackjackReplayState,
  shoe: readonly BlackjackCard[],
) {
  if (state.phase !== 'playerTurn') return;
  if (state.hands.length === 0) return;
  if (state.hands.some((h) => !h.done)) return;

  // All player hands resolved. Dealer plays only if at least one hand is
  // still "alive" (not busted) — otherwise dealer wins by default and we
  // don't need to reveal or draw more cards.
  const anyAlive = state.hands.some((h) => !isBust(h.cards));
  if (anyAlive) {
    while (shouldDealerHit(state.dealerCards)) {
      const draw = drawNext(shoe, state.shoeIndex);
      state.shoeIndex = draw.nextIndex;
      state.dealerCards.push(draw.card);
    }
  }
  state.dealerPlayed = true;

  for (const hand of state.hands) {
    hand.outcome = determineHandOutcome(hand, state.dealerCards);
  }
  state.phase = 'roundEnd';
  state.activeHandIndex = state.hands.length;
}

function determineHandOutcome(
  hand: BlackjackHandState,
  dealerCards: readonly BlackjackCard[],
): BlackjackHandOutcome {
  const playerValue = getHandValue(hand.cards);
  const dealerValue = getHandValue(dealerCards);
  const playerBJ = !hand.fromSplit && isNaturalBlackjack(hand.cards);
  const dealerBJ = isNaturalBlackjack(dealerCards);

  if (playerBJ && dealerBJ) return 'push';
  if (playerBJ) return 'blackjack';
  if (dealerBJ) return 'lose';
  if (playerValue > 21) return 'bust';
  if (dealerValue > 21) return 'dealerBust';
  if (playerValue > dealerValue) return 'win';
  if (playerValue < dealerValue) return 'lose';
  return 'push';
}

/**
 * Compute the Ticket payout (including returned stake) for a completed
 * round. Returns 0 only if every hand lost; losing hands contribute 0,
 * pushes return the hand bet, wins return 2× hand bet, blackjack returns
 * 2.5× the hand bet.
 */
export function computeBlackjackPayout(state: BlackjackReplayState): number {
  if (state.phase !== 'roundEnd') return 0;
  let payout = 0;
  for (const hand of state.hands) {
    payout += payoutForHand(hand);
  }
  return payout;
}

function payoutForHand(hand: BlackjackHandState): number {
  if (hand.outcome === 'blackjack') {
    // 3:2 blackjack: win = 1.5 × bet, returned stake = bet. Floor total.
    return Math.floor(hand.bet * 2.5);
  }
  if (hand.outcome === 'win' || hand.outcome === 'dealerBust') {
    return hand.bet * 2;
  }
  if (hand.outcome === 'push') {
    return hand.bet;
  }
  return 0; // lose / bust
}

/** Total wagered across every hand (base + all doubles + all splits). */
export function totalWagered(state: BlackjackReplayState): number {
  return state.hands.reduce((sum, h) => sum + h.bet, 0) || state.baseWager;
}

/**
 * Produce the client-facing view of the current state. Before the round
 * ends we hide the dealer's hole card so the client can't peek.
 */
export function serializeForClient(state: BlackjackReplayState) {
  const hideHole = state.phase === 'playerTurn' && !state.dealerPlayed;
  const dealerVisible = hideHole
    ? state.dealerCards.slice(0, 1)
    : state.dealerCards.slice();

  return {
    phase: state.phase,
    activeHandIndex: state.activeHandIndex,
    hands: state.hands.map((hand) => ({
      cards: hand.cards,
      bet: hand.bet,
      done: hand.done,
      doubled: hand.doubled,
      fromSplit: hand.fromSplit,
      splitAce: hand.splitAce,
      outcome: hand.outcome,
      value: getHandValue(hand.cards),
      bust: isBust(hand.cards),
      blackjack: !hand.fromSplit && isNaturalBlackjack(hand.cards),
    })),
    dealer: {
      cards: dealerVisible,
      hiddenCount: hideHole ? Math.max(0, state.dealerCards.length - 1) : 0,
      value: hideHole ? getHandValue(dealerVisible) : getHandValue(state.dealerCards),
    },
    totalWagered: totalWagered(state),
  };
}

/** Public legal-action check, exposed so the client can disable buttons. */
export function legalActionsForState(
  state: BlackjackReplayState,
): Array<'hit' | 'stand' | 'double' | 'split'> {
  if (state.phase !== 'playerTurn') return [];
  const hand = state.hands[state.activeHandIndex];
  if (!hand || hand.done) return [];
  const legal: Array<'hit' | 'stand' | 'double' | 'split'> = [];
  if (!hand.splitAce) legal.push('hit');
  legal.push('stand');
  if (hand.cards.length === 2 && !hand.splitAce) legal.push('double');
  if (
    hand.cards.length === 2 &&
    state.hands.length < 4 &&
    canSplitCards(hand.cards[0]!, hand.cards[1]!)
  ) {
    legal.push('split');
  }
  return legal;
}
