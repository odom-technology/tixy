/**
 * Reaction Time — pure rule/timing/scoring contract, extracted from the client
 * so the invariant proof (scripts/verify-reaction-time-invariants.ts) can pin
 * it and cosmetic/game-feel work cannot silently change the rules.
 *
 * Everything here mirrors the server-side expectations in
 * src/app/api/games/reaction-time/score/route.ts: 5 trials per run, the
 * score formula roundToHundredth(max(0, 500 - avg)), and the retry contract
 * for the 'Incomplete transcript' race. Presentation code lives in the client;
 * NOTHING in this module may depend on React, the DOM, or the WS transport.
 */

/** Delay before a too-early auto-continue restarts the round (ms). */
export const MIN_DELAY = 1000;
/** Auto-advance delay between a result and the next round (ms). */
export const NEXT_ROUND_DELAY_MS = 3000;
/** Trials per run — the server transcript expects exactly this many rounds. */
export const TRIALS = 5;
/** Input debounce so a single press cannot double-fire (ms). */
export const INPUT_LOCK_MS = 32;

export const REWARDS_HINT_TEXT =
  'Rewards hint: Average Time <= 437ms = 1 Ticket | <= 350ms = 5 Tickets | <= 212ms = 10 Tickets. Rewards taper at higher scores.';

export const roundToHundredth = (value: number) =>
  Math.round(value * 100) / 100;

export const formatMs = (value: number) => roundToHundredth(value).toFixed(2);

/** Keyboard/pointer events carry epoch-ish or timeOrigin-based stamps depending
 *  on the browser; normalize onto the performance.now() clock. */
export const normalizeEventTimestamp = (timestamp: number) => {
  if (!Number.isFinite(timestamp)) return performance.now();
  return timestamp > 1e12 ? timestamp - performance.timeOrigin : timestamp;
};

/** Aggregate stats for a completed run — the exact numbers embedded in the
 *  score-submit payload (score / averageTime / bestTime / clientStats). The
 *  server recomputes these from the WS transcript and rejects on mismatch, so
 *  this formula is part of the anti-cheat contract. */
export type ReactionRunStats = {
  attempts: number;
  average: number;
  best: number;
  worst: number;
  totalReactionTime: number;
  variance: number;
  finalScore: number;
};

export const computeReactionRunStats = (
  results: readonly number[],
): ReactionRunStats => {
  const avg = results.reduce((a, b) => a + b, 0) / results.length;
  const best = Math.min(...results);
  const worst = Math.max(...results);
  const variance =
    results.reduce((sum, time) => sum + Math.pow(time - avg, 2), 0) /
    results.length;
  const avgRounded = roundToHundredth(avg);
  const bestRounded = roundToHundredth(best);
  const worstRounded = roundToHundredth(worst);
  const finalScore = roundToHundredth(Math.max(0, 500 - avgRounded));
  return {
    attempts: results.length,
    average: avgRounded,
    best: bestRounded,
    worst: worstRounded,
    totalReactionTime: roundToHundredth(
      results.reduce((a, b) => a + b, 0),
    ),
    variance: roundToHundredth(variance),
    finalScore,
  };
};

export const getSubmitErrorMessage = (
  status: number,
  data: { error?: string; details?: string; retryAfterSec?: number } | null,
) => {
  if (status === 429) {
    const retry =
      typeof data?.retryAfterSec === 'number'
        ? ` Try again in ${data.retryAfterSec}s.`
        : '';
    return `${data?.error ?? 'Too many score submissions.'}${retry}`;
  }
  if (typeof data?.details === 'string' && data.details.trim()) {
    return data.details;
  }
  if (typeof data?.error === 'string' && data.error.trim()) {
    return data.error;
  }
  return 'Could not submit score. Please try again.';
};

export type SubmitResponseData = {
  error?: string;
  details?: string;
  retryAfterSec?: number;
  reward?: unknown;
  verifiedRun?: unknown;
};

/** The submit route can 400/403 with an 'Incomplete transcript' detail while
 *  the final WS click is still landing server-side — that exact race (and only
 *  that race) is safe to retry. */
export const isRetryableTranscriptError = (
  status: number,
  data: SubmitResponseData | null,
) => {
  if (status !== 400 && status !== 403) return false;
  if (!data) return true;

  const details = typeof data.details === 'string' ? data.details : '';
  return details.startsWith('Incomplete transcript');
};
