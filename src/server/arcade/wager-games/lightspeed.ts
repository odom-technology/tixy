// ---------------------------------------------------------------------------
// tixy — Lightspeed (hyperspace navigation) game logic
// ---------------------------------------------------------------------------

import {
  LIGHTSPEED_LANE_CONFIG,
  LIGHTSPEED_WAYPOINTS,
  getLightspeedExactCumulativeMultiplier,
  getLightspeedCumulativeMultiplier,
  type LightspeedLane,
} from '../arcade-constants';
import { roundArcadePayout } from '../arcade-payout';
import { mulberry32, deriveSubSeed } from '../arcade-rng';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LightspeedJumpOutcome = {
  /** For each of the 3 lanes at this waypoint, did the player survive? */
  laneResults: [boolean, boolean, boolean];
};

export type LightspeedChoice = {
  lane: LightspeedLane;
  result: 'alive' | 'dead';
  fairMult: number;
};

export type LightspeedRoundState = {
  fairStepMultipliers: number[];
  jumpsCompleted: number;
  cumulativeMultiplier: number;
  alive: boolean;
};

// ---------------------------------------------------------------------------
// Config validation
// ---------------------------------------------------------------------------

/** Lightspeed has no config — single mode. */
export function validateLightspeedConfig(
  _config: unknown,
): Record<string, never> | null {
  return {};
}

// ---------------------------------------------------------------------------
// Pre-compute outcomes
// ---------------------------------------------------------------------------

/**
 * Pre-compute survival outcomes for all 8 waypoints × 3 lanes.
 * Each (waypoint, lane) pair gets an independent sub-seed so the
 * outcome is deterministic and provably fair.
 */
export function generateLightspeedJumps(
  seed: number,
): LightspeedJumpOutcome[] {
  const jumps: LightspeedJumpOutcome[] = [];

  for (let wp = 0; wp < LIGHTSPEED_WAYPOINTS; wp++) {
    const laneResults: [boolean, boolean, boolean] = [false, false, false];

    for (let lane = 0; lane < 3; lane++) {
      const subSeed = deriveSubSeed(seed, `lightspeed:${wp}:${lane}`);
      const rng = mulberry32(subSeed);
      const roll = rng();
      const config = LIGHTSPEED_LANE_CONFIG[lane as LightspeedLane];
      laneResults[lane] = roll < config.survival;
    }

    jumps.push({ laneResults });
  }

  return jumps;
}

// ---------------------------------------------------------------------------
// Advance a single jump
// ---------------------------------------------------------------------------

export function advanceLightspeedJump(
  jumps: readonly LightspeedJumpOutcome[],
  jumpIndex: number,
  lane: LightspeedLane,
  previousFairMults: readonly number[],
): {
  alive: boolean;
  jumpIndex: number;
  jumpsCompleted: number;
  currentMultiplier: number;
  allJumpsCompleted: boolean;
  fairMult: number;
} {
  if (jumpIndex < 0 || jumpIndex >= LIGHTSPEED_WAYPOINTS) {
    throw new Error('Jump index out of range.');
  }

  const survived = jumps[jumpIndex]!.laneResults[lane];
  const config = LIGHTSPEED_LANE_CONFIG[lane];

  if (!survived) {
    return {
      alive: false,
      jumpIndex,
      jumpsCompleted: jumpIndex, // didn't complete this one
      currentMultiplier: 0,
      allJumpsCompleted: false,
      fairMult: config.fairMult,
    };
  }

  const jumpsCompleted = jumpIndex + 1;
  const allFairMults = [...previousFairMults, config.fairMult];
  const currentMultiplier = getLightspeedCumulativeMultiplier(allFairMults);
  const allJumpsCompleted = jumpsCompleted >= LIGHTSPEED_WAYPOINTS;

  return {
    alive: true,
    jumpIndex,
    jumpsCompleted,
    currentMultiplier,
    allJumpsCompleted,
    fairMult: config.fairMult,
  };
}

// ---------------------------------------------------------------------------
// Replay a round from recorded choices (used at cashout)
// ---------------------------------------------------------------------------

export function replayLightspeedRound(
  seed: number,
  choices: readonly LightspeedChoice[],
): LightspeedRoundState {
  const jumps = generateLightspeedJumps(seed);
  const fairStepMultipliers: number[] = [];
  let alive = true;

  for (let i = 0; i < choices.length; i++) {
    const choice = choices[i]!;
    const survived = jumps[i]!.laneResults[choice.lane];

    if (!survived) {
      alive = false;
      break;
    }

    fairStepMultipliers.push(
      LIGHTSPEED_LANE_CONFIG[choice.lane].fairMult,
    );
  }

  return {
    fairStepMultipliers,
    jumpsCompleted: fairStepMultipliers.length,
    cumulativeMultiplier: getLightspeedCumulativeMultiplier(fairStepMultipliers),
    alive,
  };
}

// ---------------------------------------------------------------------------
// Payout
// ---------------------------------------------------------------------------

export function computeLightspeedPayout(
  wager: number,
  fairStepMults: readonly number[],
  seed: number,
): number {
  const exactMult = getLightspeedExactCumulativeMultiplier(fairStepMults);
  if (exactMult <= 0) return 0;
  return roundArcadePayout(
    wager * exactMult,
    seed,
    `lightspeed:${fairStepMults.length}`,
  );
}
