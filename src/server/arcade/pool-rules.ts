// ---------------------------------------------------------------------------
// 8-Ball Pool rules engine.
//
// Given a match state and a shot result from the physics engine, evaluates
// fouls, group assignments, turn continuation, and win/loss conditions.
// ---------------------------------------------------------------------------

import type { Ball, BallGroup, ShotResult } from '@/features/arcade/lib/pool-physics';
import {
  isSolid,
  isStripe,
  ballGroup,
  respotEightBall,
  createBreakRack,
} from '@/features/arcade/lib/pool-physics';
import type { PoolMatch, MatchPhase, FoulState } from './pool-match';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FoulType = 'scratch' | 'wrong_first' | 'no_rail' | 'no_contact' | 'illegal_break';

export type ShotEvaluation = {
  /** Foul committed on this shot, or null. */
  foul: FoulType | null;
  /** Updated ball array (may have 8-ball re-spotted on break). */
  balls: Ball[];
  /** Whether the shooter continues (potted own ball without fouling). */
  turnContinues: boolean;
  /** Updated group assignments (may be set this shot). */
  player1Group: BallGroup | null;
  player2Group: BallGroup | null;
  /** Whether the table is still open (no groups assigned). */
  tableOpen: boolean;
  /** New match phase. */
  phase: MatchPhase;
  /** Winner user ID (null if game continues). */
  winnerId: string | null;
  /** Loser user ID (null if game continues). */
  loserId: string | null;
  /** Win/loss reason. */
  winReason: string | null;
  /** Foul state for the next turn (ball-in-hand, etc.). */
  foulState: FoulState | null;
  /** ID of the player whose turn it is next. */
  nextTurn: string;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getOpponentId(match: PoolMatch, playerId: string): string {
  return match.player1Id === playerId ? match.player2Id! : match.player1Id;
}

function oppositeGroup(group: BallGroup): BallGroup {
  return group === 'solids' ? 'stripes' : 'solids';
}

function normalizeLockedGroups(match: PoolMatch): {
  player1Group: BallGroup | null;
  player2Group: BallGroup | null;
  groupsLocked: boolean;
} {
  if (match.player1Group && match.player2Group) {
    return {
      player1Group: match.player1Group,
      player2Group: match.player2Group,
      groupsLocked: true,
    };
  }

  if (match.player1Group) {
    return {
      player1Group: match.player1Group,
      player2Group: oppositeGroup(match.player1Group),
      groupsLocked: true,
    };
  }

  if (match.player2Group) {
    return {
      player1Group: oppositeGroup(match.player2Group),
      player2Group: match.player2Group,
      groupsLocked: true,
    };
  }

  return {
    player1Group: null,
    player2Group: null,
    groupsLocked: false,
  };
}

function remainingBallsForGroup(
  balls: Ball[],
  group: BallGroup,
): number {
  return balls.filter(
    (b) =>
      !b.pocketed &&
      ((group === 'solids' && isSolid(b.id)) ||
        (group === 'stripes' && isStripe(b.id))),
  ).length;
}

function playerClearedGroup(
  balls: Ball[],
  group: BallGroup,
): boolean {
  return remainingBallsForGroup(balls, group) === 0;
}

function isObjectBall(id: number): boolean {
  return id >= 1 && id <= 15;
}

function hasPostContactRequirementSatisfied(shotResult: ShotResult): boolean {
  return shotResult.railContacts > 0
    || shotResult.pocketedBallIds.some((id) => id !== 0);
}

const ILLEGAL_BREAK_MIN_OBJECT_BALLS_TO_RAIL = 4;

function countObjectBallsDrivenToRail(shotResult: ShotResult): number {
  return shotResult.ballsToRail.size;
}

// ---------------------------------------------------------------------------
// Main evaluation
// ---------------------------------------------------------------------------

export function evaluateShot(
  match: PoolMatch,
  shotResult: ShotResult,
  shooterId: string,
  calledPocket?: number | null,
): ShotEvaluation {
  const balls = shotResult.finalBalls;
  const pocketed = shotResult.pocketedBallIds;
  const opponentId = getOpponentId(match, shooterId);
  const isBreak = match.phase === 'break';
  const lockedGroupsAtStart = normalizeLockedGroups(match);
  const groupsAssignedAtStart = lockedGroupsAtStart.groupsLocked;
  const tableOpen = match.phase === 'open_table' && !groupsAssignedAtStart;
  const shotStartedOpen = match.phase === 'open_table' && !groupsAssignedAtStart;
  const shooterGroupAtStart = match.player1Id === shooterId
    ? lockedGroupsAtStart.player1Group
    : lockedGroupsAtStart.player2Group;
  const shooterWasOnEight = shooterGroupAtStart
    ? playerClearedGroup(match.balls, shooterGroupAtStart)
    : false;

  let player1Group = lockedGroupsAtStart.player1Group;
  let player2Group = lockedGroupsAtStart.player2Group;
  let foul: FoulType | null = null;
  let turnContinues = false;
  let phase: MatchPhase = match.phase;
  let winnerId: string | null = null;
  let loserId: string | null = null;
  let winReason: string | null = null;
  let foulState: FoulState | null = null;

  if (isBreak) {
    // WPA break handling has discipline-specific outcomes that differ from
    // standard post-break fouls, so it is evaluated in a dedicated path.
    return evaluateBreakShot(
      shotResult,
      balls,
      shooterId,
      opponentId,
    );
  }

  const eightBallPocketed = pocketed.includes(8);

  // --- Scratch detection ---
  if (shotResult.scratch) {
    foul = 'scratch';
  }

  // --- No contact detection ---
  if (!foul && shotResult.firstContactBallId === null) {
    foul = 'no_contact';
  }

  // --- Wrong ball first ---
  if (!foul && shotResult.firstContactBallId !== null) {
    if (tableOpen) {
      if (shotResult.firstContactBallId === 8) {
        foul = 'wrong_first';
      }
    } else if (shooterGroupAtStart) {
      const firstBallGroup = ballGroup(shotResult.firstContactBallId);
      if (shooterWasOnEight) {
        if (shotResult.firstContactBallId !== 8) {
          foul = 'wrong_first';
        }
      } else if (firstBallGroup !== shooterGroupAtStart) {
        foul = 'wrong_first';
      }
    }
  }

  // --- Legal-shot rail / pocket requirement ---
  // Non-break: after first contact, at least one ball must reach a rail or pocket.
  if (
    !foul
    && !isBreak
    && shotResult.firstContactBallId !== null
    && !hasPostContactRequirementSatisfied(shotResult)
  ) {
    foul = 'no_rail';
  }

  // --- 8-ball endgame ---
  if (eightBallPocketed) {
    if (!shooterGroupAtStart || !shooterWasOnEight) {
      // Potted 8-ball before clearing own group → loss
      winnerId = opponentId;
      loserId = shooterId;
      winReason = 'opponent_early_8ball';
      phase = 'game_over';
    } else if (foul) {
      // Potted 8-ball but committed a foul (e.g., scratch) → loss
      winnerId = opponentId;
      loserId = shooterId;
      winReason = 'opponent_foul_8ball';
      phase = 'game_over';
    } else if (
      match.hardcoreMode &&
      calledPocket != null &&
      shotResult.pocketMap.get(8) !== calledPocket
    ) {
      // Hardcore: potted 8-ball in wrong pocket → loss
      winnerId = opponentId;
      loserId = shooterId;
      winReason = 'opponent_wrong_pocket_8ball';
      phase = 'game_over';
    } else {
      // Legally potted 8-ball after clearing group → WIN
      winnerId = shooterId;
      loserId = opponentId;
      winReason = 'cleared_8ball';
      phase = 'game_over';
    }

    return {
      foul,
      balls,
      turnContinues: false,
      player1Group,
      player2Group,
      tableOpen: false,
      phase,
      winnerId,
      loserId,
      winReason,
      foulState: null,
      nextTurn: opponentId,
    };
  }

  // --- Group assignment (open table, first legal pot after break) ---
  if (shotStartedOpen && !foul && pocketed.length > 0) {
    // Find the first pocketed ball that is a solid or stripe
    const firstPocketed = pocketed.find((id) => isSolid(id) || isStripe(id));
    if (firstPocketed !== undefined) {
      const firstGroup = ballGroup(firstPocketed)!;
      const shooterGetsGroup: BallGroup = firstGroup;
      const opponentGetsGroup: BallGroup =
        shooterGetsGroup === 'solids' ? 'stripes' : 'solids';

      if (match.player1Id === shooterId) {
        player1Group = shooterGetsGroup;
        player2Group = opponentGetsGroup;
      } else {
        player1Group = opponentGetsGroup;
        player2Group = shooterGetsGroup;
      }
      phase = 'play';
    }
  }

  // --- Turn continuation ---
  if (!foul) {
    const shooterGroup = match.player1Id === shooterId ? player1Group : player2Group;
    if (shooterGroup) {
      const pottedOwnBalls = pocketed.filter(
        (id) => ballGroup(id) === shooterGroup,
      ).length;
      turnContinues = pottedOwnBalls > 0;
    } else if (tableOpen && pocketed.some((id) => isObjectBall(id) && id !== 8)) {
      // Open table: potting any object ball continues your turn
      turnContinues = true;
    }
  }

  // --- Hardcore pocket calling: turn only continues if a legal ball enters
  //     the called pocket. No foul — just loss of turn. ---
  if (
    !foul &&
    turnContinues &&
    match.hardcoreMode &&
    calledPocket != null
  ) {
    const shooterGroup = match.player1Id === shooterId ? player1Group : player2Group;
    const legalPocketed = shooterGroup
      ? pocketed.filter((id) => ballGroup(id) === shooterGroup)
      : pocketed.filter((id) => isObjectBall(id) && id !== 8);
    const anyInCalledPocket = legalPocketed.some(
      (id) => shotResult.pocketMap.get(id) === calledPocket,
    );
    if (!anyInCalledPocket) {
      turnContinues = false;
    }
  }

  // --- Foul state for next turn ---
  if (foul) {
    foulState = {
      type: foul,
      ballInHand: true,
      behindHeadString: false,
    };
    turnContinues = false;
  }

  const nextTurn = turnContinues ? shooterId : opponentId;

  return {
    foul,
    balls,
    turnContinues,
    player1Group,
    player2Group,
    tableOpen: player1Group === null,
    phase,
    winnerId,
    loserId,
    winReason,
    foulState,
    nextTurn,
  };
}

// ---------------------------------------------------------------------------
// Break-specific evaluation (WPA 8-ball break rules)
// ---------------------------------------------------------------------------

function evaluateBreakShot(
  shotResult: ShotResult,
  balls: Ball[],
  shooterId: string,
  opponentId: string,
): ShotEvaluation {
  const pocketed = shotResult.pocketedBallIds;
  const objectBallsPocketed = pocketed.filter((id) => isObjectBall(id));
  const eightBallPocketed = pocketed.includes(8);
  let foul: FoulType | null = null;

  // WPA 4.3(e)/(f): 8-ball pocketed on break is spotted (legal and foul
  // breaks both support this option; we deterministically use "spot 8-ball").
  if (eightBallPocketed) {
    respotEightBall(balls);
  }

  // Scratch on break
  if (shotResult.scratch) {
    foul = 'scratch';
  }

  // No contact on break
  if (!foul && shotResult.firstContactBallId === null) {
    foul = 'no_contact';
  }

  // WPA 4.3(d): if no object-ball is pocketed, at least four object-balls
  // must be driven to one or more rails.
  if (
    !foul
    && objectBallsPocketed.length === 0
    && countObjectBallsDrivenToRail(shotResult) < ILLEGAL_BREAK_MIN_OBJECT_BALLS_TO_RAIL
  ) {
    foul = 'illegal_break';

    // WPA 4.3(d) provides option-based outcomes for illegal break.
    // Without an explicit decision UI, use a deterministic legal option:
    // re-rack and incoming player breaks.
    return {
      foul,
      balls: createBreakRack(),
      turnContinues: false,
      player1Group: null,
      player2Group: null,
      tableOpen: true,
      phase: 'break',
      winnerId: null,
      loserId: null,
      winReason: null,
      foulState: null,
      nextTurn: opponentId,
    };
  }

  // If balls were potted on break (and no foul), breaker continues
  const turnContinues = !foul && objectBallsPocketed.length > 0;
  const foulState: FoulState | null = foul
    ? {
        type: foul,
        ballInHand: true,
        // WPA 4.3(f)/(h): break fouls that hand over BIH are above head string.
        behindHeadString: true,
      }
    : null;

  return {
    foul,
    balls,
    turnContinues,
    player1Group: null,
    player2Group: null,
    tableOpen: true,
    phase: 'open_table',
    winnerId: null,
    loserId: null,
    winReason: null,
    foulState,
    nextTurn: turnContinues ? shooterId : opponentId,
  };
}
