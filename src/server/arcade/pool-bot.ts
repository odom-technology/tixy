// ---------------------------------------------------------------------------
// 8-Ball Pool AI bot.
//
// Uses ghost-ball aiming plus deterministic physics previews to rank shots.
// Difficulty is applied after the ideal shot is found by adding random aim
// and power error within difficulty-specific ranges.
// ---------------------------------------------------------------------------

import {
  simulateShot,
  isValidCuePlacement,
  BALL_DIAMETER,
  TABLE_WIDTH,
  TABLE_HEIGHT,
  POCKETS,
  HEAD_STRING_X,
  ROLLING_DECEL,
  shotSpeedToPower,
  type Ball,
  type Vec2,
  type ShotInput,
} from '@/features/arcade/lib/pool-physics';
import { isSolid, isStripe } from '@/features/arcade/lib/pool-physics';
import {
  distance,
  normalize,
  pointToSegment,
  sub,
} from '@/features/arcade/lib/pool-physics/vec2';
import type { PoolMatch } from './pool-match';
import { evaluateShot } from './pool-rules';

export type BotDifficulty = 'easy' | 'medium' | 'hard';

const BOT_USER_ID_PREFIX = 'bot:';
export const BOT_NAMES: Record<BotDifficulty, string> = {
  easy: 'Pool Rookie (Bot)',
  medium: 'Pool Shark (Bot)',
  hard: 'Pool Master (Bot)',
};

type DifficultyProfile = {
  aimErrorDeg: number;
  powerErrorFraction: number;
  candidateCount: number;
  positionPlayWeight: number;
};

const BOT_DIFFICULTY: Record<BotDifficulty, DifficultyProfile> = {
  easy: {
    aimErrorDeg: 4.5,
    powerErrorFraction: 0.22,
    candidateCount: 2,
    positionPlayWeight: 0,
  },
  medium: {
    aimErrorDeg: 2.25,
    powerErrorFraction: 0.12,
    candidateCount: 4,
    positionPlayWeight: 0.35,
  },
  hard: {
    aimErrorDeg: 0.45,
    powerErrorFraction: 0.03,
    candidateCount: 8,
    positionPlayWeight: 0.8,
  },
};

type ShotCandidate = {
  cuePosition: Vec2 | null;
  angle: number;
  power: number;
  targetId: number;
  pocket: Vec2 | null;
  score: number;
  totalDistance: number;
  result: ReturnType<typeof simulateShot>;
};

type ExecutedBotCandidate = {
  input: ShotInput;
  score: number;
};

const DEG = Math.PI / 180;
const SHOT_CLEARANCE = BALL_DIAMETER * 0.58;
const POWER_MULTIPLIERS = [0.9, 1.0, 1.1, 1.2];

export function isBotUser(userId: string): boolean {
  return userId.startsWith(BOT_USER_ID_PREFIX);
}

export function getBotUserId(difficulty: BotDifficulty): string {
  return `${BOT_USER_ID_PREFIX}${difficulty}`;
}

function getCueBall(balls: Ball[]): Ball | undefined {
  return balls.find((b) => b.id === 0 && !b.pocketed);
}

function getBotGroup(match: PoolMatch, botId: string) {
  return match.player1Id === botId ? match.player1Group : match.player2Group;
}

function getLegalTargets(match: PoolMatch, botId: string): Ball[] {
  const botGroup = getBotGroup(match, botId);
  const active = match.balls.filter((b) => !b.pocketed && b.id !== 0);

  if (!botGroup) {
    return active.filter((b) => b.id !== 8);
  }

  const ownBalls = active.filter(
    (b) =>
      (botGroup === 'solids' && isSolid(b.id))
      || (botGroup === 'stripes' && isStripe(b.id)),
  );

  if (ownBalls.length === 0) {
    const eight = active.find((b) => b.id === 8);
    return eight ? [eight] : [];
  }

  return ownBalls;
}

function getFutureLegalTargets(
  match: PoolMatch,
  botId: string,
  balls: Ball[],
): Ball[] {
  const botGroup = getBotGroup(match, botId);
  const active = balls.filter((b) => !b.pocketed && b.id !== 0);

  if (!botGroup) {
    return active.filter((b) => b.id !== 8);
  }

  const ownBalls = active.filter(
    (b) =>
      (botGroup === 'solids' && isSolid(b.id))
      || (botGroup === 'stripes' && isStripe(b.id)),
  );

  if (ownBalls.length === 0) {
    const eight = active.find((b) => b.id === 8);
    return eight ? [eight] : [];
  }

  return ownBalls;
}

function randomCentered(range: number): number {
  return (Math.random() - 0.5) * 2 * range;
}

function clampPower(power: number): number {
  return Math.max(0.05, Math.min(1, power));
}

function isLaneClear(
  start: Vec2,
  end: Vec2,
  balls: Ball[],
  ignoredIds: Set<number>,
  clearance = SHOT_CLEARANCE,
): boolean {
  const laneLength = distance(start, end);
  if (laneLength < 1e-3) return false;

  for (const other of balls) {
    if (other.pocketed || ignoredIds.has(other.id)) continue;
    const projection = pointToSegment(other.pos, start, end);
    if (projection.t <= 0.02 || projection.t >= 0.98) continue;
    if (projection.distance < clearance) return false;
  }

  return true;
}

function ghostBallForPocket(target: Ball, pocket: Vec2): Vec2 {
  const dir = normalize(sub(pocket, target.pos));
  return {
    x: target.pos.x - dir.x * BALL_DIAMETER,
    y: target.pos.y - dir.y * BALL_DIAMETER,
  };
}

function estimateIdealPower(cuePos: Vec2, ghostPos: Vec2, targetPos: Vec2, pocket: Vec2): number {
  const cueDistance = distance(cuePos, ghostPos);
  const targetDistance = distance(targetPos, pocket);
  const effectiveDistance = cueDistance * 0.75 + targetDistance * 1.05;
  const requiredSpeed = Math.sqrt(2 * ROLLING_DECEL * effectiveDistance);
  return clampPower(shotSpeedToPower(requiredSpeed));
}

function evaluateCueBallPosition(match: PoolMatch, botId: string, cuePos: Vec2): number {
  const futureTargets = getFutureLegalTargets(match, botId, match.balls);
  if (futureTargets.length === 0) return 0;
  const nearest = futureTargets.reduce((best, ball) =>
    distance(cuePos, ball.pos) < distance(cuePos, best.pos) ? ball : best,
  );
  return Math.max(0, 220 - distance(cuePos, nearest.pos));
}

function scoreCandidate(
  match: PoolMatch,
  botId: string,
  difficulty: BotDifficulty,
  target: Ball,
  pocket: Vec2,
  shotResult: ReturnType<typeof simulateShot>,
  totalDistance: number,
): number {
  // Run the full rules engine to detect ALL fouls (not just scratch/wrong-first)
  const evaluation = evaluateShot(match, shotResult, botId);

  // Any foul is heavily penalized — the bot should avoid fouls at all costs
  if (evaluation.foul) {
    return -100000;
  }

  // Also reject if the cue ball was scratched (redundant with foul check but explicit)
  if (shotResult.scratch) {
    return Number.NEGATIVE_INFINITY;
  }

  const pocketedTarget = shotResult.pocketedBallIds.includes(target.id);
  const pocketedAnyObjectBall = shotResult.pocketedBallIds.some((id) => id !== 0);
  const cueAfter = shotResult.finalBalls.find((b) => b.id === 0 && !b.pocketed)?.pos;
  const targetDistanceToPocket = distance(target.pos, pocket);

  let score = 0;
  if (pocketedTarget) {
    score += 10000;
  } else if (pocketedAnyObjectBall) {
    score += 4500;
  } else {
    // Legal shot that didn't pocket anything — still OK but low score
    score += 1000;
  }

  score += Math.max(0, 320 - targetDistanceToPocket) * 5;
  score += Math.max(0, 1200 - totalDistance);

  if (cueAfter) {
    score += evaluateCueBallPosition(
      { ...match, balls: shotResult.finalBalls },
      botId,
      cueAfter,
    ) * BOT_DIFFICULTY[difficulty].positionPlayWeight;
  }

  // Bonus for having rail contacts (helps ensure legality)
  if (shotResult.railContacts >= 1) {
    score += 200;
  }

  return score;
}

function buildShotCandidates(
  match: PoolMatch,
  botId: string,
  cuePos: Vec2,
  cuePosition: Vec2 | null,
  difficulty: BotDifficulty,
): ShotCandidate[] {
  const targets = getLegalTargets(match, botId);
  const activeBalls = match.balls.filter((b) => !b.pocketed);
  const candidates: ShotCandidate[] = [];

  for (const target of targets) {
    for (const pocket of POCKETS) {
      const ghostPos = ghostBallForPocket(target, pocket);
      const cueToGhostClear = isLaneClear(
        cuePos,
        ghostPos,
        activeBalls,
        new Set([0, target.id]),
      );
      if (!cueToGhostClear) continue;

      const targetToPocketClear = isLaneClear(
        target.pos,
        pocket,
        activeBalls,
        new Set([0, target.id]),
        BALL_DIAMETER * 0.52,
      );
      if (!targetToPocketClear) continue;

      const baseAngle = Math.atan2(ghostPos.y - cuePos.y, ghostPos.x - cuePos.x);
      const basePower = estimateIdealPower(cuePos, ghostPos, target.pos, pocket);
      const totalDistance = distance(cuePos, ghostPos) + distance(target.pos, pocket);

      for (const multiplier of POWER_MULTIPLIERS) {
        const power = clampPower(basePower * multiplier);
        const shotResult = simulateShot(match.balls, {
          angle: baseAngle,
          power,
          cuePosition,
        });

        const score = scoreCandidate(
          match,
          botId,
          difficulty,
          target,
          pocket,
          shotResult,
          totalDistance,
        );
        if (!Number.isFinite(score)) continue;

        candidates.push({
          cuePosition,
          angle: baseAngle,
          power,
          targetId: target.id,
          pocket,
          score,
          totalDistance,
          result: shotResult,
        });
      }
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates;
}

function fallbackSafetyShot(match: PoolMatch, botId: string, cuePosition: Vec2 | null): ShotInput {
  const cueBall = getCueBall(match.balls);
  const cuePos = cuePosition ?? cueBall?.pos ?? { x: TABLE_WIDTH / 4, y: TABLE_HEIGHT / 2 };
  const targets = getLegalTargets(match, botId);

  if (targets.length > 0) {
    const nearest = targets.reduce((best, ball) =>
      distance(cuePos, ball.pos) < distance(cuePos, best.pos) ? ball : best,
    );
    const angle = Math.atan2(nearest.pos.y - cuePos.y, nearest.pos.x - cuePos.x);
    const power = clampPower(estimateIdealPower(cuePos, nearest.pos, nearest.pos, nearest.pos) * 0.75);
    return { angle, power, cuePosition };
  }

  return {
    angle: Math.random() * Math.PI * 2,
    power: 0.4,
    cuePosition,
  };
}

function applyDifficultyError(
  shot: ShotCandidate | ShotInput,
  difficulty: BotDifficulty,
): ShotInput {
  const profile = BOT_DIFFICULTY[difficulty];
  const angleNoise = randomCentered(profile.aimErrorDeg * DEG);
  const powerNoise = randomCentered(profile.powerErrorFraction);

  // Hard bots use mild topspin/backspin for position play.
  // Easy/medium bots always hit center (no spin).
  const spinX = 0;
  let spinY = 0;
  if (difficulty === 'hard') {
    // 50% chance of using spin; mild values
    if (Math.random() < 0.5) {
      // Prefer backspin on hard shots (draw for safety), topspin on soft follow shots
      spinY = shot.power > 0.5
        ? -(0.2 + Math.random() * 0.25) // mild backspin on hard shots
        : (0.2 + Math.random() * 0.2);  // mild topspin on soft shots
    }
  }

  return {
    angle: shot.angle + angleNoise,
    power: clampPower(shot.power * (1 + powerNoise)),
    cuePosition: shot.cuePosition ?? null,
    spinX,
    spinY,
  };
}

function chooseCuePlacement(
  match: PoolMatch,
  botId: string,
  difficulty: BotDifficulty,
  behindHeadString: boolean,
): Vec2 {
  const xCandidates = behindHeadString
    ? [HEAD_STRING_X * 0.25, HEAD_STRING_X * 0.45, HEAD_STRING_X * 0.65, HEAD_STRING_X * 0.85]
    : [TABLE_WIDTH * 0.2, TABLE_WIDTH * 0.28, TABLE_WIDTH * 0.36, TABLE_WIDTH * 0.45];
  const yCandidates = [TABLE_HEIGHT * 0.2, TABLE_HEIGHT * 0.35, TABLE_HEIGHT * 0.5, TABLE_HEIGHT * 0.65, TABLE_HEIGHT * 0.8];

  let bestPos: Vec2 | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const x of xCandidates) {
    for (const y of yCandidates) {
      const candidate = { x, y };
      if (!isValidCuePlacement(candidate, match.balls, { behindHeadString })) continue;
      const shots = buildShotCandidates(match, botId, candidate, candidate, difficulty);
      const score = shots[0]?.score ?? Number.NEGATIVE_INFINITY;
      if (score > bestScore) {
        bestScore = score;
        bestPos = candidate;
      }
    }
  }

  if (bestPos) return bestPos;

  return behindHeadString
    ? { x: HEAD_STRING_X * 0.5, y: TABLE_HEIGHT / 2 }
    : { x: TABLE_WIDTH / 4, y: TABLE_HEIGHT / 2 };
}

export function computeBotShot(
  match: PoolMatch,
  botId: string,
  difficulty: BotDifficulty,
): ShotInput {
  // Break shot: aim directly at the rack apex with high power.
  // A real break aims the cue ball straight at the head ball of the triangle.
  if (match.phase === 'break') {
    const cueBall = getCueBall(match.balls);
    const cuePos = cueBall?.pos ?? { x: TABLE_WIDTH / 4, y: TABLE_HEIGHT / 2 };
    // Find the apex ball (closest to the cue ball among non-cue balls)
    const rackBalls = match.balls.filter((b) => !b.pocketed && b.id !== 0);
    const apex = rackBalls.reduce((best, b) =>
      distance(cuePos, b.pos) < distance(cuePos, best.pos) ? b : best,
    );
    const breakAngle = Math.atan2(apex.pos.y - cuePos.y, apex.pos.x - cuePos.x);
    // Add slight random offset for variety (±0.02 radians ≈ ±1 degree)
    const angleNoise = (Math.random() - 0.5) * 0.04;
    // Break at 85-100% power
    const breakPower = 0.85 + Math.random() * 0.15;
    return {
      angle: breakAngle + angleNoise,
      power: clampPower(breakPower),
      cuePosition: null,
      spinX: 0,
      spinY: 0,
    };
  }

  let cuePosition: Vec2 | null = null;
  if (match.foulState?.ballInHand) {
    cuePosition = chooseCuePlacement(
      match,
      botId,
      difficulty,
      match.foulState.behindHeadString,
    );
  }

  const cueBall = getCueBall(match.balls);
  const cuePos = cuePosition ?? cueBall?.pos ?? { x: TABLE_WIDTH / 4, y: TABLE_HEIGHT / 2 };
  const candidates = buildShotCandidates(match, botId, cuePos, cuePosition, difficulty);

  if (candidates.length > 0) {
    const profile = BOT_DIFFICULTY[difficulty];
    const shortlisted = candidates.slice(0, profile.candidateCount);
    const executed: ExecutedBotCandidate[] = shortlisted
      .map((candidate) => {
        const input = applyDifficultyError(candidate, difficulty);
        const shotResult = simulateShot(match.balls, input);
        const score = scoreCandidate(
          match,
          botId,
          difficulty,
          match.balls.find((ball) => ball.id === candidate.targetId)!,
          candidate.pocket!,
          shotResult,
          candidate.totalDistance,
        );
        return { input, score };
      })
      .filter((candidate) => Number.isFinite(candidate.score))
      .sort((a, b) => b.score - a.score);

    if (executed.length > 0) {
      if (difficulty === 'hard') {
        return executed[0].input;
      }
      const topSlice = executed.slice(0, Math.min(executed.length, Math.max(2, Math.ceil(executed.length / 2))));
      return topSlice[Math.floor(Math.random() * topSlice.length)].input;
    }
  }

  return applyDifficultyError(
    fallbackSafetyShot(match, botId, cuePosition),
    difficulty,
  );
}
