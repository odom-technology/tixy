import {
  addAntiCheatLog,
  countRecentFlags,
  FLAG_ESCALATION_THRESHOLD,
  FLAG_ESCALATION_WINDOW_MS,
} from './anti-cheat-logs';
import { applyAutomaticAntiCheatBan } from './game-bans';

export interface ActionEntry {
  t: number;
  d?: unknown;
}

export interface EnvFingerprint {
  devtools: boolean;
  webdriver: boolean;
  timeRatio: number;
  screen: { w: number; h: number };
  wasHidden: boolean;
}

export interface AntiCheatResult {
  ok: boolean;
  reason?: string;
  severity?: 'reject' | 'flag';
  confidence?: number;
}

export interface FullAntiCheatInput {
  gameType: string;
  userId?: string;
  userName?: string | null;
  score: number;
  actions: ActionEntry[];
  env?: EnvFingerprint | null;
  previousBest?: number | null;
  sessionDurationMs?: number;
  serverActionCount?: number;
  serverActionCounts?: Record<string, number>;
  gameCount?: number;
  claimedAvgTime?: number;
  claimedBestTime?: number;
  claimedWpm?: number;
  claimedAccuracy?: number;
  claimedCorrectChars?: number;
  claimedIncorrectChars?: number;
  modeDurationSec?: number;
  /** A game's own checks over more than one run (ticket stop's play check).
   *  A flag here goes through the same escalation as any other flag. */
  gameChecks?: CheckFailure[];
}

export type CheckFailure = {
  reason: string;
  severity: 'reject' | 'flag';
  stage: string;
};

type ActionSummary = {
  counts: Record<string, number>;
  reactionTimes: number[];
  typedKeys: number;
  firstT: number | null;
  lastT: number | null;
};

const LOG_PASSES = process.env.ANTI_CHEAT_LOG_PASSES === 'true';

const roundToHundredth = (value: number) =>
  Math.round(value * 100) / 100;

const isFiniteNonNegative = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

function summarizeActions(actions: ActionEntry[]): ActionSummary {
  const counts: Record<string, number> = {};
  const reactionTimes: number[] = [];
  let typedKeys = 0;
  let firstT: number | null = null;
  let lastT: number | null = null;

  for (const action of actions) {
    if (!Number.isFinite(action.t)) continue;
    firstT = firstT === null ? action.t : Math.min(firstT, action.t);
    lastT = lastT === null ? action.t : Math.max(lastT, action.t);

    const data = action.d as
      | {
          type?: unknown;
          key?: unknown;
          c?: unknown;
          reactionMs?: unknown;
          greenAt?: unknown;
          clickAt?: unknown;
        }
      | undefined;
    const type = typeof data?.type === 'string' ? data.type : null;
    if (type) counts[type] = (counts[type] ?? 0) + 1;
    if (typeof data?.key === 'string' || typeof data?.c === 'string') {
      typedKeys += 1;
    }
    if (isFiniteNonNegative(data?.reactionMs)) {
      reactionTimes.push(data.reactionMs);
    } else if (
      isFiniteNonNegative(data?.greenAt) &&
      isFiniteNonNegative(data?.clickAt)
    ) {
      reactionTimes.push(Math.max(0, data.clickAt - data.greenAt));
    }
  }

  return { counts, reactionTimes, typedKeys, firstT, lastT };
}

function timesForType(actions: ActionEntry[], type: string) {
  return actions
    .filter((action) => {
      const data = action.d as { type?: unknown } | undefined;
      return data?.type === type && Number.isFinite(action.t);
    })
    .map((action) => action.t)
    .sort((a, b) => a - b);
}

function minimumIntervalFailure(
  times: number[],
  minMs: number,
  label: string,
): CheckFailure | null {
  for (let index = 1; index < times.length; index += 1) {
    const interval = times[index] - times[index - 1];
    if (interval < minMs) {
      return {
        severity: 'reject',
        stage: 'replay',
        reason: `${label} interval too short (${Math.round(interval)}ms < ${minMs}ms)`,
      };
    }
  }
  return null;
}

function validateEnvironment(env?: EnvFingerprint | null): CheckFailure | null {
  if (!env) return null;
  if (env.webdriver) {
    return {
      severity: 'reject',
      stage: 'env',
      reason: 'Automation framework detected',
    };
  }
  if (Number.isFinite(env.timeRatio)) {
    if (env.timeRatio < 0.45 || env.timeRatio > 2.25) {
      return {
        severity: 'reject',
        stage: 'env',
        reason: `Extreme timer drift (${env.timeRatio.toFixed(3)})`,
      };
    }
    if (env.timeRatio < 0.7 || env.timeRatio > 1.55) {
      return {
        severity: 'flag',
        stage: 'env',
        reason: `Suspicious timer drift (${env.timeRatio.toFixed(3)})`,
      };
    }
  }
  return null;
}

function validateTyping(
  input: FullAntiCheatInput,
  summary: ActionSummary,
): CheckFailure | null {
  if (input.actions.length === 0) {
    return {
      severity: 'reject',
      stage: 'replay',
      reason: 'No typing action log provided',
    };
  }

  const totalClaimed =
    (input.claimedCorrectChars ?? 0) + (input.claimedIncorrectChars ?? 0);
  if (totalClaimed > 0 && summary.typedKeys < totalClaimed * 0.5) {
    return {
      severity: 'reject',
      stage: 'replay',
      reason: `Too few logged keystrokes (${summary.typedKeys}/${totalClaimed})`,
    };
  }

  const spanMs =
    summary.firstT !== null && summary.lastT !== null
      ? Math.max(1, summary.lastT - summary.firstT)
      : 0;
  if (summary.typedKeys > 10 && spanMs > 0) {
    const keysPerSec = summary.typedKeys / (spanMs / 1000);
    if (keysPerSec > 25) {
      return {
        severity: 'reject',
        stage: 'timing',
        reason: `Typing log too compressed (${keysPerSec.toFixed(1)} keys/s)`,
      };
    }
  }

  const modeDuration = input.modeDurationSec ?? 0;
  if (modeDuration > 0 && summary.typedKeys > modeDuration * 25) {
    return {
      severity: 'reject',
      stage: 'replay',
      reason: `Too many keystrokes for ${modeDuration}s mode`,
    };
  }
  return null;
}

function validateReaction(
  input: FullAntiCheatInput,
  summary: ActionSummary,
): CheckFailure | null {
  if (summary.reactionTimes.length < 5) {
    return {
      severity: 'reject',
      stage: 'replay',
      reason: 'Reaction log must have at least 5 entries',
    };
  }

  const avg = roundToHundredth(
    summary.reactionTimes.reduce((total, value) => total + value, 0) /
      summary.reactionTimes.length,
  );
  const best = roundToHundredth(Math.min(...summary.reactionTimes));

  if (
    typeof input.claimedAvgTime === 'number' &&
    Math.abs(avg - input.claimedAvgTime) > 30
  ) {
    return {
      severity: 'reject',
      stage: 'replay',
      reason: `Average reaction mismatch (${avg}ms vs ${input.claimedAvgTime}ms)`,
    };
  }
  if (
    typeof input.claimedBestTime === 'number' &&
    Math.abs(best - input.claimedBestTime) > 30
  ) {
    return {
      severity: 'reject',
      stage: 'replay',
      reason: `Best reaction mismatch (${best}ms vs ${input.claimedBestTime}ms)`,
    };
  }
  return null;
}

function validateSnake(input: FullAntiCheatInput): CheckFailure | null {
  if (input.score % 10 !== 0) {
    return {
      severity: 'reject',
      stage: 'replay',
      reason: 'Snake score is not aligned to food value',
    };
  }

  const foodTimes = timesForType(input.actions, 'food');
  const expectedFood = input.score / 10;
  if (foodTimes.length !== expectedFood) {
    return {
      severity: 'reject',
      stage: 'replay',
      reason: `Food count mismatch (${foodTimes.length}/${expectedFood})`,
    };
  }

  const intervalFailure = minimumIntervalFailure(foodTimes, 40, 'Food');
  if (intervalFailure) return intervalFailure;

  if (foodTimes.length > 5) {
    const totalMs = foodTimes[foodTimes.length - 1] - foodTimes[0];
    const avgMs = totalMs / Math.max(1, foodTimes.length - 1);
    if (avgMs < 120) {
      return {
        severity: 'reject',
        stage: 'timing',
        reason: `Food collection rate too high (${Math.round(avgMs)}ms avg)`,
      };
    }
    if (avgMs < 180) {
      return {
        severity: 'flag',
        stage: 'timing',
        reason: `Unusually fast food collection (${Math.round(avgMs)}ms avg)`,
      };
    }
  }

  return null;
}

function validateFlappy(input: FullAntiCheatInput): CheckFailure | null {
  const pipeTimes = timesForType(input.actions, 'pipe');
  if (pipeTimes.length !== input.score) {
    return {
      severity: 'reject',
      stage: 'replay',
      reason: `Pipe count mismatch (${pipeTimes.length}/${input.score})`,
    };
  }
  return minimumIntervalFailure(pipeTimes, 800, 'Pipe');
}

function validateReplay(
  input: FullAntiCheatInput,
  summary: ActionSummary,
): CheckFailure | null {
  switch (input.gameType) {
    case 'typing-test':
      return validateTyping(input, summary);
    case 'reaction-time':
      return validateReaction(input, summary);
    case 'snake':
      return validateSnake(input);
    case 'flappy-bird':
      return validateFlappy(input);
    default:
      return null;
  }
}

function validateSessionSpan(input: FullAntiCheatInput, summary: ActionSummary) {
  if (
    !input.sessionDurationMs ||
    summary.firstT === null ||
    summary.lastT === null ||
    summary.lastT <= summary.firstT
  ) {
    return null;
  }

  const logSpanMs = summary.lastT - summary.firstT;
  if (logSpanMs > input.sessionDurationMs * 1.1 + 2000) {
    return {
      severity: 'reject',
      stage: 'session-span',
      reason: `Action span exceeds session duration (${Math.round(logSpanMs)}ms > ${Math.round(input.sessionDurationMs)}ms)`,
    } satisfies CheckFailure;
  }
  return null;
}

function validateAnomaly(input: FullAntiCheatInput): CheckFailure | null {
  const absoluteLimits: Record<string, { max: number; label: string }> = {
    snake: { max: 2000, label: 'score' },
    'flappy-bird': { max: 500, label: 'score' },
    'reaction-time': { max: 400, label: 'score' },
    'typing-test': { max: 250, label: 'WPM' },
  };

  const limit = absoluteLimits[input.gameType];
  if (limit && input.score > limit.max) {
    return {
      severity: 'reject',
      stage: 'anomaly',
      reason: `${limit.label} ${input.score} exceeds cap ${limit.max}`,
    };
  }

  if (input.gameType === 'reaction-time') {
    if (
      typeof input.claimedAvgTime === 'number' &&
      input.claimedAvgTime < 100
    ) {
      return {
        severity: 'reject',
        stage: 'anomaly',
        reason: `Average reaction time below human range (${input.claimedAvgTime}ms)`,
      };
    }
    if (
      typeof input.claimedBestTime === 'number' &&
      input.claimedBestTime < 100
    ) {
      return {
        severity: 'reject',
        stage: 'anomaly',
        reason: `Best reaction time below human range (${input.claimedBestTime}ms)`,
      };
    }
  }

  if (
    input.previousBest &&
    input.previousBest > 0 &&
    input.score > 20 &&
    (input.gameCount ?? 0) >= 2
  ) {
    const jumpRatio = input.score / input.previousBest;
    if (jumpRatio > 10) {
      return {
        severity: 'reject',
        stage: 'anomaly',
        reason: `Score jump too large (${jumpRatio.toFixed(1)}x)`,
      };
    }
    if (jumpRatio > 5) {
      return {
        severity: 'flag',
        stage: 'anomaly',
        reason: `Large score jump (${jumpRatio.toFixed(1)}x)`,
      };
    }
  }

  return null;
}

function collectFailures(input: FullAntiCheatInput) {
  const summary = summarizeActions(input.actions);
  const failures = [
    validateEnvironment(input.env),
    validateReplay(input, summary),
    validateSessionSpan(input, summary),
    validateAnomaly(input),
    ...(input.gameChecks ?? []),
  ].filter((failure): failure is CheckFailure => failure !== null);

  return { failures, summary };
}

async function recordAntiCheatResult(
  input: FullAntiCheatInput,
  result: AntiCheatResult,
  stage: string,
  checks: string[],
) {
  const shouldLog =
    result.severity === 'reject' ||
    result.severity === 'flag' ||
    LOG_PASSES;
  if (!shouldLog) return;

  const score =
    input.gameType === 'reaction-time' &&
    typeof input.claimedAvgTime === 'number'
      ? roundToHundredth(input.claimedAvgTime)
      : input.score;

  await addAntiCheatLog({
    ts: Date.now(),
    gameType: input.gameType,
    userId: input.userId,
    userName: input.userName,
    score,
    modeSec: input.modeDurationSec,
    result: result.severity === 'reject'
      ? 'reject'
      : result.severity === 'flag'
        ? 'flag'
        : 'pass',
    severity: result.severity,
    reason: result.reason,
    stage,
    checks,
  });
}

export async function runAntiCheat(
  input: FullAntiCheatInput,
): Promise<AntiCheatResult> {
  const { failures, summary } = collectFailures(input);
  const checks = [
    `actions=${input.actions.length}`,
    `typed=${summary.typedKeys}`,
    `reactions=${summary.reactionTimes.length}`,
    ...Object.entries(summary.counts).map(([type, count]) => `${type}=${count}`),
  ];

  const reject = failures.find((failure) => failure.severity === 'reject');
  if (reject) {
    const result: AntiCheatResult = {
      ok: false,
      reason: reject.reason,
      severity: 'reject',
      confidence: 0.05,
    };
    await recordAntiCheatResult(input, result, reject.stage, checks);
    return result;
  }

  const flags = failures.filter((failure) => failure.severity === 'flag');
  if (flags.length > 0) {
    if (input.userId) {
      const recentFlags = await countRecentFlags(
        input.userId,
        Date.now() - FLAG_ESCALATION_WINDOW_MS,
      );
      if (recentFlags + 1 >= FLAG_ESCALATION_THRESHOLD) {
        const autoBan = await applyAutomaticAntiCheatBan({
          userId: input.userId,
          reason: `Reached ${recentFlags + 1} flagged runs within 30 minutes.`,
        });
        const result: AntiCheatResult = {
          ok: false,
          reason: autoBan.isIndefinite
            ? `Too many flagged runs (${recentFlags + 1}). Auto-ban applied indefinitely.`
            : `Too many flagged runs (${recentFlags + 1}). Auto-ban applied for ${Math.ceil(autoBan.remainingMs / 60000)} minute(s).`,
          severity: 'reject',
          confidence: 0.05,
        };
        await recordAntiCheatResult(input, result, 'flag-escalation', checks);
        return result;
      }
    }

    const result: AntiCheatResult = {
      ok: true,
      reason: `Flagged: ${flags.map((failure) => failure.reason).join('; ')}`,
      severity: 'flag',
      confidence: 0.45,
    };
    await recordAntiCheatResult(input, result, 'flag', checks);
    return result;
  }

  const result: AntiCheatResult = { ok: true, confidence: 0.95 };
  await recordAntiCheatResult(input, result, 'pass', checks);
  return result;
}
