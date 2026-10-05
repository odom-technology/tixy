// ---------------------------------------------------------------------------
// tixy — Hi-Lo card game logic
// ---------------------------------------------------------------------------

import {
  HILO_MAX_CHAIN,
  HILO_MAX_RANK,
  HILO_MIN_RANK,
  HILO_RANK_COUNT,
  getHiLoExactCumulativeMultiplier,
  getHiLoCumulativeMultiplier,
  getHiLoStepFairMultiplier,
  type HiLoGuess,
} from '../arcade-constants';
import { roundArcadePayout } from '../arcade-payout';
import { deriveSubSeed, mulberry32 } from '../arcade-rng';

export type HiLoSuit = 0 | 1 | 2 | 3; // spades, hearts, diamonds, clubs
export type HiLoCard = { rank: number; suit: HiLoSuit };

/**
 * A recorded player action for a hi-lo round. Stake-style rules: "higher"
 * wins on >= current, "lower" wins on <= current. Ties always count as a
 * win for whichever direction the player picked — no pushes.
 */
export type HiLoChoice = {
  guess: HiLoGuess;
  result: 'win' | 'lose';
};

export type HiLoConfig = Record<string, never>;

/** Hi-lo takes no per-session config today; validate an empty object. */
export function validateHiLoConfig(config: unknown): HiLoConfig | null {
  if (config == null) return {};
  if (typeof config !== 'object') return null;
  return {};
}

/**
 * Draw the Nth card from the seeded deck stream. Each card is an independent
 * uniform draw from 13 ranks × 4 suits (i.e. infinite-deck / reshuffle-every-
 * card semantics, same as Stake's Hi-Lo).
 */
export function drawHiLoCard(seed: number, index: number): HiLoCard {
  const rng = mulberry32(deriveSubSeed(seed, 'hilo-cards'));
  let last = 0;
  for (let i = 0; i <= index; i++) {
    last = rng();
  }
  const rank = HILO_MIN_RANK + Math.floor(last * HILO_RANK_COUNT);
  // Separate stream for suit so suits look independent
  const suitRng = mulberry32(deriveSubSeed(seed, `hilo-suit-${index}`));
  const suit = Math.floor(suitRng() * 4) as HiLoSuit;
  return { rank: Math.min(HILO_MAX_RANK, rank), suit };
}

/**
 * Resolve a single guess against the next card in the stream.
 *   win  → multiplier advances by 1/winProb (ties count as a win)
 *   lose → round busts, payout 0
 */
function resolveHiLoStep(
  currentCard: HiLoCard,
  nextCard: HiLoCard,
  guess: HiLoGuess,
): HiLoChoice {
  const won =
    guess === 'higher'
      ? nextCard.rank >= currentCard.rank
      : nextCard.rank <= currentCard.rank;
  return { guess, result: won ? 'win' : 'lose' };
}

/**
 * Replay a sequence of guesses against the deterministic card stream to
 * compute the cumulative state. Returns:
 *   - stepMultipliers: fair per-step factors for each winning guess
 *   - currentCard: the card the NEXT guess will be made against
 *   - cumulativeMultiplier: the cashout multiplier if the player stops here
 *   - alive: false if any guess lost
 *   - cardIndex: how far into the card stream we've consumed
 */
export function replayHiLoRound(
  seed: number,
  choices: readonly HiLoChoice[],
): {
  stepFairMultipliers: number[];
  currentCard: HiLoCard;
  cumulativeMultiplier: number;
  alive: boolean;
  cardIndex: number;
} {
  const startingCard = drawHiLoCard(seed, 0);
  let currentCard = startingCard;
  let cardIndex = 0;
  const stepFairMultipliers: number[] = [];
  let alive = true;

  for (let i = 0; i < choices.length; i++) {
    const choice = choices[i]!;
    if (!alive) break;
    cardIndex += 1;
    const nextCard = drawHiLoCard(seed, cardIndex);
    const resolved = resolveHiLoStep(currentCard, nextCard, choice.guess);
    if (resolved.result === 'lose') {
      alive = false;
      break;
    }
    stepFairMultipliers.push(
      getHiLoStepFairMultiplier(currentCard.rank, choice.guess),
    );
    currentCard = nextCard;
  }

  return {
    stepFairMultipliers,
    currentCard,
    cumulativeMultiplier: alive
      ? getHiLoCumulativeMultiplier(stepFairMultipliers)
      : 0,
    alive,
    cardIndex,
  };
}

/**
 * Resolve the NEXT guess (one step forward from the current replayed state).
 * Returns the draw + resolved choice + updated cumulative multiplier.
 */
export function resolveHiLoNextGuess(
  seed: number,
  previousChoices: readonly HiLoChoice[],
  guess: HiLoGuess,
): {
  choice: HiLoChoice;
  drawnCard: HiLoCard;
  currentCardAfter: HiLoCard;
  cumulativeMultiplier: number;
  alive: boolean;
  chainComplete: boolean;
} {
  if (previousChoices.length >= HILO_MAX_CHAIN) {
    throw new Error('Chain already at maximum length.');
  }
  const prior = replayHiLoRound(seed, previousChoices);
  if (!prior.alive) {
    throw new Error('Session already busted.');
  }
  const drawnCard = drawHiLoCard(seed, prior.cardIndex + 1);
  const choice = resolveHiLoStep(prior.currentCard, drawnCard, guess);

  const nextChoices = [...previousChoices, choice];
  const after = replayHiLoRound(seed, nextChoices);

  return {
    choice,
    drawnCard,
    currentCardAfter: drawnCard,
    cumulativeMultiplier: after.cumulativeMultiplier,
    alive: after.alive,
    chainComplete: nextChoices.length >= HILO_MAX_CHAIN,
  };
}

/** Compute payout at cashout given the choices recorded so far. */
export function computeHiLoPayout(
  wager: number,
  seed: number,
  choices: readonly HiLoChoice[],
): number {
  const state = replayHiLoRound(seed, choices);
  if (!state.alive) return 0;
  const exactMultiplier = getHiLoExactCumulativeMultiplier(state.stepFairMultipliers);
  if (exactMultiplier <= 0) return 0;
  return roundArcadePayout(
    wager * exactMultiplier,
    seed,
    `hilo:${choices.length}`,
  );
}
