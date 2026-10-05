/**
 * Offline RULE + SCORE-FORMULA invariant proof for Reaction Time.
 *
 *   npx tsx scripts/verify-reaction-time-invariants.ts
 *
 * Pins the contract the score route, leaderboard, WS transcript, and anti-cheat
 * rely on, so cosmetic/game-feel work cannot silently change the rules:
 *  1. Round-structure constants — 5 trials, prefire/auto-continue delays, the
 *     input debounce, and the rewards-hint thresholds (which describe the
 *     server rewards curve).
 *  2. Score formula — score = roundToHundredth(max(0, 500 - avg)), computed
 *     over the exact aggregate stats embedded in the submit payload
 *     (averageTime / bestTime / clientStats), including rounding edge cases.
 *  3. Event-timestamp normalization — epoch vs timeOrigin-based stamps both
 *     land on the performance.now() clock (reactionMs feeds rt_click).
 *  4. Submit-error + retry contract — 429 retry suffix, details precedence,
 *     and exactly the 'Incomplete transcript' race being retryable.
 *
 * Exits non-zero on any failed assertion.
 */
import {
  MIN_DELAY,
  NEXT_ROUND_DELAY_MS,
  TRIALS,
  INPUT_LOCK_MS,
  REWARDS_HINT_TEXT,
  roundToHundredth,
  formatMs,
  normalizeEventTimestamp,
  computeReactionRunStats,
  getSubmitErrorMessage,
  isRetryableTranscriptError,
} from '@/app/(games)/reaction-time/_reaction-time-helpers';

let failures = 0;
const assert = (cond: boolean, msg: string) => {
  if (!cond) {
    console.error('  FAIL: ' + msg);
    failures += 1;
  }
};

// ── 1. Round-structure constants (exact parity lock) ───────────────────────
console.log('1. Round-structure constants…');
{
  assert(MIN_DELAY === 1000, `MIN_DELAY ${MIN_DELAY}`);
  assert(NEXT_ROUND_DELAY_MS === 3000, `NEXT_ROUND_DELAY_MS ${NEXT_ROUND_DELAY_MS}`);
  assert(TRIALS === 5, `TRIALS ${TRIALS}`);
  assert(INPUT_LOCK_MS === 32, `INPUT_LOCK_MS ${INPUT_LOCK_MS}`);
  // The hint text describes the server rewards curve (max(0, 430-avg)/200 …)
  // and must keep quoting these exact thresholds.
  assert(
    REWARDS_HINT_TEXT.includes('<= 437ms = 1 Ticket') &&
      REWARDS_HINT_TEXT.includes('<= 350ms = 5 Tickets') &&
      REWARDS_HINT_TEXT.includes('<= 212ms = 10 Tickets'),
    'rewards hint thresholds drifted',
  );
}

// ── 2. Score formula + submit-payload stats ────────────────────────────────
console.log('2. Score formula + submit-payload stats…');
{
  // Reference implementation of the long-standing client formula.
  const refStats = (results: number[]) => {
    const avg = results.reduce((a, b) => a + b, 0) / results.length;
    const best = Math.min(...results);
    const worst = Math.max(...results);
    const variance =
      results.reduce((sum, time) => sum + Math.pow(time - avg, 2), 0) /
      results.length;
    const avgRounded = Math.round(avg * 100) / 100;
    return {
      score: Math.round(Math.max(0, 500 - avgRounded) * 100) / 100,
      averageTime: avgRounded,
      bestTime: Math.round(best * 100) / 100,
      worstTime: Math.round(worst * 100) / 100,
      totalReactionTime: Math.round(results.reduce((a, b) => a + b, 0) * 100) / 100,
      variance: Math.round(variance * 100) / 100,
    };
  };

  const runs: number[][] = [
    [250, 250, 250, 250, 250], // avg 250 → score 250
    [300, 310, 295, 305, 290], // avg 300 → score 200
    [212, 220, 208, 215, 205], // fast run
    [437.5, 437.5, 437.5, 437.5, 437.5], // rounding edge (avg .5)
    [499.99, 500.01, 500, 499.5, 500.5], // straddling the 500 zero point
    [550, 600, 520, 580, 610], // avg > 500 → score clamped to 0
    [75, 80, 78, 82, 79], // near the server's 75ms hard cap
    [123.456, 234.567, 345.678, 156.789, 267.891], // float noise
  ];
  for (const results of runs) {
    const stats = computeReactionRunStats(results);
    const ref = refStats(results);
    assert(stats.attempts === results.length, `attempts drift: ${results}`);
    assert(stats.finalScore === ref.score,
      `score drift for ${results}: ${stats.finalScore} vs ${ref.score}`);
    assert(stats.average === ref.averageTime,
      `average drift for ${results}: ${stats.average} vs ${ref.averageTime}`);
    assert(stats.best === ref.bestTime, `best drift for ${results}`);
    assert(stats.worst === ref.worstTime, `worst drift for ${results}`);
    assert(stats.totalReactionTime === ref.totalReactionTime,
      `total drift for ${results}`);
    assert(stats.variance === ref.variance, `variance drift for ${results}`);
  }

  // Formula semantics, stated directly.
  assert(computeReactionRunStats([250, 250, 250, 250, 250]).finalScore === 250,
    'avg 250 must score 250');
  assert(computeReactionRunStats([300, 300, 300, 300, 300]).finalScore === 200,
    'avg 300 must score 200');
  assert(computeReactionRunStats([600, 600, 600, 600, 600]).finalScore === 0,
    'avg 600 must clamp to 0');
  assert(computeReactionRunStats([500, 500, 500, 500, 500]).finalScore === 0,
    'avg 500 must score exactly 0');

  // Rounding helpers.
  assert(roundToHundredth(1.005) === 1.01 || roundToHundredth(1.005) === 1,
    'roundToHundredth broke'); // float-tolerant: just must not throw/drift shape
  assert(roundToHundredth(250.129) === 250.13, 'roundToHundredth drifted');
  assert(formatMs(250) === '250.00', 'formatMs drifted');
  assert(formatMs(250.129) === '250.13', 'formatMs rounding drifted');
}

// ── 3. Event-timestamp normalization ───────────────────────────────────────
console.log('3. Event-timestamp normalization…');
{
  // timeOrigin-based stamps pass through untouched.
  assert(normalizeEventTimestamp(1234.5) === 1234.5, 'perf stamp mutated');
  // Epoch stamps (>1e12) land on the performance clock.
  const epoch = performance.timeOrigin + 500;
  assert(normalizeEventTimestamp(epoch) === 500, 'epoch stamp not rebased');
  // Non-finite input falls back to a fresh perf timestamp.
  const fallback = normalizeEventTimestamp(NaN);
  assert(
    Number.isFinite(fallback) && fallback >= 0 && fallback < 1e12,
    'non-finite stamp fallback broken',
  );
}

// ── 4. Submit-error + retry contract ───────────────────────────────────────
console.log('4. Submit-error + retry contract…');
{
  assert(
    getSubmitErrorMessage(429, { error: 'Too many score submissions.', retryAfterSec: 42 }) ===
      'Too many score submissions. Try again in 42s.',
    '429 message drifted',
  );
  assert(
    getSubmitErrorMessage(429, null) === 'Too many score submissions.',
    '429 fallback drifted',
  );
  assert(
    getSubmitErrorMessage(400, { error: 'Bad', details: 'Detailed reason.' }) === 'Detailed reason.',
    'details precedence drifted',
  );
  assert(getSubmitErrorMessage(400, { error: 'Bad' }) === 'Bad', 'error fallback drifted');
  assert(
    getSubmitErrorMessage(500, null) === 'Could not submit score. Please try again.',
    'generic fallback drifted',
  );

  // Only 400/403 with an empty body or the exact 'Incomplete transcript'
  // prefix may be retried; anything else is a hard failure.
  assert(isRetryableTranscriptError(400, null) === true, 'empty 400 not retryable');
  assert(isRetryableTranscriptError(403, null) === true, 'empty 403 not retryable');
  assert(
    isRetryableTranscriptError(400, { details: 'Incomplete transcript: 4/5 rounds' }) === true,
    'transcript race not retryable',
  );
  assert(
    isRetryableTranscriptError(403, { details: 'Incomplete transcript' }) === true,
    'transcript 403 not retryable',
  );
  assert(
    isRetryableTranscriptError(400, { details: 'Other rejection' }) === false,
    'unrelated 400 retryable',
  );
  assert(
    isRetryableTranscriptError(500, { details: 'Incomplete transcript' }) === false,
    '500 treated as retryable',
  );
  assert(
    isRetryableTranscriptError(429, null) === false,
    '429 treated as retryable',
  );
}

// ── Summary ────────────────────────────────────────────────────────────────
if (failures > 0) {
  console.error(`\n${failures} invariant failure(s).`);
  process.exit(1);
}
console.log('\nAll Reaction Time invariants hold.');
