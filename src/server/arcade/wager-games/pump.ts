// ---------------------------------------------------------------------------
// Arcade — Pump ("Balloon") game logic
// ---------------------------------------------------------------------------
//
// Inflate a balloon: every PUMP multiplies the running multiplier by that
// pump's fair step factor (= 1 / survivalProb) but carries a pop probability
// of (1 − survivalProb). Survival DECREASES as pumps accumulate (more pumps
// banked ⇒ higher pop risk). Cash out before it pops to bank
// wager × cumulative × RTP. A pop loses the stake. Reaching PUMP_MAX pumps
// auto-cashes (terminal win).
//
// PROVABLY FAIR / RTP INVARIANTS (do not regress):
//   • The seed is fixed at session creation and is never sent to the client
//     until the round ends (pop, terminal-win, or cashout). Interim `pump`
//     responses carry NO seed/seedHash.
//   • State is replay-from-seed: choices is an append-only log; we never store
//     a mutable round object. Each pump's pop roll is derived from
//     deriveSubSeed(seed, `pump:${i}`) + mulberry32 and compared to that pump's
//     pop probability.
//   • RTP (0.97) is applied ONCE, to the PRODUCT of the raw fair step factors —
//     never per step. The pop probabilities set VOLATILITY only; EV at any
//     fixed stop point stays exactly 0.97 because
//       P(survive N) × Π(1/survival_i) × RTP
//         = (Π survival_i) × (Π 1/survival_i) × RTP = RTP.
//     (The PUMP_MAX_MULTIPLIER cap can truncate the extreme tail, which only
//     ever favors the house — acceptable.)
// ---------------------------------------------------------------------------

import { ARCADE_RTP } from '../arcade-constants';
import { roundArcadePayout } from '../arcade-payout';
import { mulberry32, deriveSubSeed } from '../arcade-rng';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Hard ceiling on any single pump cumulative multiplier. */
export const PUMP_MAX_MULTIPLIER = 500;

/**
 * Terminal pump cap. Reaching this many successful pumps auto-cashes the round
 * (terminal win). Past the cap there is nothing left to gain on the easier
 * difficulties (and the harder ones long since hit PUMP_MAX_MULTIPLIER), so we
 * stop the round and reveal the seed.
 */
export const PUMP_MAX_PUMPS = 25;

export type PumpDifficulty = 'easy' | 'medium' | 'hard';

export const PUMP_DIFFICULTIES: readonly PumpDifficulty[] = [
  'easy',
  'medium',
  'hard',
];

/**
 * Per-difficulty survival ramp. Survival for pump index `i` (0-based) is
 *   survival_i = clamp(baseSurvival − ramp × i, floorSurvival, 1)
 * so the pop risk grows the deeper you pump, and `floorSurvival` keeps even a
 * very long run from reaching certain death.
 *
 * Resulting pop-prob progression + cumulative ceilings (RTP applied once):
 *   easy   — base 0.99 / ramp 0.005 / floor 0.80
 *            pop climbs 1.0% → 13.0% over 25 pumps; ~6.06x ceiling at pump 25;
 *            never reaches the 500x cap (almost-certain slow grind).
 *   medium — base 0.92 / ramp 0.020 / floor 0.55
 *            pop climbs 8% → 45%; hits the 500x cap around pump 20 (sweet spot).
 *   hard   — base 0.80 / ramp 0.035 / floor 0.30
 *            pop climbs 20% → 70%; hits the 500x cap by pump 13 (high variance).
 */
export type PumpDifficultyConfig = {
  label: string;
  baseSurvival: number;
  ramp: number;
  floorSurvival: number;
};

export const PUMP_DIFFICULTY_CONFIG: Record<PumpDifficulty, PumpDifficultyConfig> = {
  easy: { label: 'Easy', baseSurvival: 0.99, ramp: 0.005, floorSurvival: 0.8 },
  medium: { label: 'Medium', baseSurvival: 0.92, ramp: 0.02, floorSurvival: 0.55 },
  hard: { label: 'Hard', baseSurvival: 0.8, ramp: 0.035, floorSurvival: 0.3 },
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PumpConfig = {
  difficulty: PumpDifficulty;
};

/** One recorded pump. `fairMult` = 1 / survivalProb for that pump index. */
export type PumpChoice = {
  result: 'alive' | 'pop';
  fairMult: number;
};

export type PumpRoundState = {
  fairStepMultipliers: number[];
  pumpsCompleted: number;
  cumulativeMultiplier: number;
  alive: boolean;
};

// ---------------------------------------------------------------------------
// Helpers (local floor-to-2dp; arcade-constants does not export one)
// ---------------------------------------------------------------------------

function floorToTwoDecimals(value: number): number {
  return Math.floor(value * 100) / 100;
}

// ---------------------------------------------------------------------------
// Survival / pop model
// ---------------------------------------------------------------------------

/**
 * Survival probability for the pump at 0-based index `i` under `difficulty`.
 * Decreases linearly with `i`, clamped to [floorSurvival, 1].
 */
export function survivalProbForPump(i: number, difficulty: PumpDifficulty): number {
  const cfg = PUMP_DIFFICULTY_CONFIG[difficulty];
  const raw = cfg.baseSurvival - cfg.ramp * i;
  return Math.max(cfg.floorSurvival, Math.min(1, raw));
}

/** Pop probability for the pump at 0-based index `i` (= 1 − survival). */
export function popProbForPump(i: number, difficulty: PumpDifficulty): number {
  return 1 - survivalProbForPump(i, difficulty);
}

/** Raw fair step factor for the pump at 0-based index `i` (= 1 / survival). */
export function fairMultForPump(i: number, difficulty: PumpDifficulty): number {
  const survival = survivalProbForPump(i, difficulty);
  if (survival <= 0) return 0;
  return 1 / survival;
}

/**
 * Deterministic pop check for the pump at 0-based index `i`. Derives an
 * independent sub-seed per pump so the outcome is provably fair and
 * reproducible after reveal.
 *
 * Returns `true` if the balloon SURVIVES this pump.
 */
export function pumpSurvives(
  seed: number,
  i: number,
  difficulty: PumpDifficulty,
): boolean {
  const rng = mulberry32(deriveSubSeed(seed, `pump:${i}`));
  const roll = rng();
  // Survive when the roll lands inside the survival band. Equivalent to
  // `roll >= popProb`; written against survival to mirror the lane model.
  return roll < survivalProbForPump(i, difficulty);
}

// ---------------------------------------------------------------------------
// Multiplier helpers — RTP applied ONCE to the product (never per step)
// ---------------------------------------------------------------------------

/** EXACT cumulative multiplier (no 2dp floor) — used for payout math. */
export function getPumpExactCumulativeMultiplier(
  fairStepMults: readonly number[],
): number {
  if (fairStepMults.length === 0) return 0;
  let product = 1;
  for (const m of fairStepMults) {
    if (m <= 0) return 0;
    product *= m;
  }
  return Math.min(PUMP_MAX_MULTIPLIER, product * ARCADE_RTP['arcade-pump']);
}

/** DISPLAY cumulative multiplier (floored to 2dp) — used for the UI. */
export function getPumpCumulativeMultiplier(
  fairStepMults: readonly number[],
): number {
  return floorToTwoDecimals(getPumpExactCumulativeMultiplier(fairStepMults));
}

// ---------------------------------------------------------------------------
// Config validation
// ---------------------------------------------------------------------------

export function validatePumpConfig(config: unknown): PumpConfig | null {
  if (!config || typeof config !== 'object') return null;
  const difficulty = (config as { difficulty?: unknown }).difficulty;
  if (
    typeof difficulty !== 'string' ||
    !(PUMP_DIFFICULTIES as readonly string[]).includes(difficulty)
  ) {
    return null;
  }
  return { difficulty: difficulty as PumpDifficulty };
}

// ---------------------------------------------------------------------------
// Advance a single pump
// ---------------------------------------------------------------------------

export function advancePumpStep(
  seed: number,
  pumpIndex: number,
  difficulty: PumpDifficulty,
  previousFairMults: readonly number[],
): {
  alive: boolean;
  pumpIndex: number;
  pumpsCompleted: number;
  currentMultiplier: number;
  allPumpsCompleted: boolean;
  fairMult: number;
} {
  if (pumpIndex < 0 || pumpIndex >= PUMP_MAX_PUMPS) {
    throw new Error('Pump index out of range.');
  }

  const fairMult = fairMultForPump(pumpIndex, difficulty);
  const survived = pumpSurvives(seed, pumpIndex, difficulty);

  if (!survived) {
    return {
      alive: false,
      pumpIndex,
      pumpsCompleted: pumpIndex, // this pump didn't complete
      currentMultiplier: 0,
      allPumpsCompleted: false,
      fairMult,
    };
  }

  const pumpsCompleted = pumpIndex + 1;
  const allFairMults = [...previousFairMults, fairMult];
  const currentMultiplier = getPumpCumulativeMultiplier(allFairMults);
  const allPumpsCompleted = pumpsCompleted >= PUMP_MAX_PUMPS;

  return {
    alive: true,
    pumpIndex,
    pumpsCompleted,
    currentMultiplier,
    allPumpsCompleted,
    fairMult,
  };
}

// ---------------------------------------------------------------------------
// Replay a round from recorded choices (used at cashout + as a defensive
// guard before each pump in the action route)
// ---------------------------------------------------------------------------

export function replayPumpRound(
  seed: number,
  choices: readonly PumpChoice[],
  difficulty: PumpDifficulty,
): PumpRoundState {
  const fairStepMultipliers: number[] = [];
  let alive = true;

  for (let i = 0; i < choices.length; i++) {
    if (!pumpSurvives(seed, i, difficulty)) {
      alive = false;
      break;
    }
    fairStepMultipliers.push(fairMultForPump(i, difficulty));
  }

  return {
    fairStepMultipliers,
    pumpsCompleted: fairStepMultipliers.length,
    cumulativeMultiplier: getPumpCumulativeMultiplier(fairStepMultipliers),
    alive,
  };
}

// ---------------------------------------------------------------------------
// Payout
// ---------------------------------------------------------------------------

export function computePumpPayout(
  wager: number,
  fairStepMults: readonly number[],
  seed: number,
): number {
  const exactMult = getPumpExactCumulativeMultiplier(fairStepMults);
  if (exactMult <= 0) return 0;
  return roundArcadePayout(
    wager * exactMult,
    seed,
    `pump:${fairStepMults.length}`,
  );
}
