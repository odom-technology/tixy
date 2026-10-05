/**
 * Mental Math Sprint — pure, deterministic problem generator + run validator.
 *
 * This module is the single source of truth for BOTH the client (which renders
 * problems for instant feedback) and the server score route (which re-derives
 * every problem to validate the submitted answers). Same `(seed, index)` ⇒
 * identical problem on both sides, so the client can never choose easier math.
 *
 * Anti-cheat model (single-POST, no WebSocket):
 *  - The 60s sprint is bounded by the SERVER clock (game_sessions.started_at →
 *    validateGameSession durationMs) plus the per-answer cadence floor enforced
 *    here. The seed is exposed in the session response, but a precomputing
 *    cheater still cannot beat the legit ceiling: every answer must land inside
 *    the window AND be spaced ≥ MIN_ANSWER_INTERVAL_MS apart, so the maximum
 *    number of countable answers is hard-capped by time, not by knowledge of
 *    the stream.
 *  - The authoritative score is the count of validated-correct answers; the
 *    client-claimed number is never trusted (the route rejects a mismatch).
 *
 * Everything here is pure: no Date.now(), no Math.random(), no I/O.
 */

// ---------------------------------------------------------------------------
// Tunable constants (exported so the route + client agree on the same bounds)
// ---------------------------------------------------------------------------

/** Sprint length in seconds (mirrors the session modeSec concept). */
export const MATH_SPRINT_DURATION_SEC = 60;

/** Hard window for accepting an answer's client timestamp `t` (ms).
 *  60s sprint + 2s grace for the final keypress / network skew. */
export const MATH_MAX_ANSWER_T_MS = 62_000;

/** Minimum spacing between consecutive countable answers (ms). A human reading
 *  a problem, typing 1-3 digits, and pressing enter cannot legitimately answer
 *  faster than this; anything tighter is dropped (not counted). */
export const MATH_MIN_ANSWER_INTERVAL_MS = 120;

/** Absolute ceiling on how many answers we will ever score for one run.
 *  62_000ms / 120ms ≈ 516; round down to a safe cap. Mirrors / stays below the
 *  shared MATH_MAX_CLIENT_SCORE the orchestrator defines. */
export const MATH_MAX_ANSWERS = 500;

// ---------------------------------------------------------------------------
// PRNG — mulberry32. Byte-identical to the repo's seededRandom (typing-words,
// sequence-replay). Returns a function producing floats in [0, 1).
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Derive a stable per-problem RNG from (seed, index). Mixing the index into the
 * seed makes `mathProblemFor` O(1) and pure — we do NOT have to replay the whole
 * stream to get problem N, and there is no cross-index state to drift between
 * client and server. The two 32-bit mixes spread adjacent indices apart so
 * consecutive problems don't correlate.
 */
function rngForIndex(seed: number, index: number): () => number {
  // Combine with a large odd multiplier + golden-ratio-ish constant, all in
  // 32-bit space, so the derived seed is well-distributed and deterministic.
  let mixed = (seed ^ Math.imul(index + 1, 0x9e3779b1)) | 0;
  mixed = (mixed + 0x6d2b79f5) | 0;
  return mulberry32(mixed);
}

// ---------------------------------------------------------------------------
// Problem generation
// ---------------------------------------------------------------------------

export type MathOp = '+' | '-' | '*';

export interface MathProblem {
  /** 0-based position in the deterministic stream. */
  index: number;
  a: number;
  b: number;
  op: MathOp;
  /** The single correct integer answer. */
  answer: number;
  /** Human-readable prompt, e.g. "12 × 7". */
  prompt: string;
}

const OP_SYMBOL: Record<MathOp, string> = { '+': '+', '-': '−', '*': '×' };

function intInRange(rng: () => number, min: number, max: number): number {
  // inclusive [min, max]
  return min + Math.floor(rng() * (max - min + 1));
}

/**
 * Difficulty tier for a given index. Ramps as the player gets deeper into the
 * sprint: easy single-digit add/sub → two-digit add/sub → small multiplication
 * → harder two-digit multiplication. Capped so it never becomes impossible.
 */
function tierForIndex(index: number): number {
  if (index < 4) return 0; // warm-up: single-digit + / −
  if (index < 9) return 1; // two-digit + / −
  if (index < 15) return 2; // single-digit ×, larger + / −
  if (index < 24) return 3; // 2-digit × 1-digit, harder + / −
  return 4; // 2-digit × 2-digit (small), big + / −
}

/**
 * Pure, deterministic problem for a given seed + index. Identical output on the
 * client and the server. The answer is always a non-negative integer (we order
 * subtraction operands so the result never goes negative — friendlier + avoids
 * sign-entry ambiguity on a digits-only keypad).
 */
export function mathProblemFor(seed: number, index: number): MathProblem {
  const safeSeed = seed | 0;
  const safeIndex = index < 0 ? 0 : Math.floor(index);
  const rng = rngForIndex(safeSeed, safeIndex);
  const tier = tierForIndex(safeIndex);

  let a = 0;
  let b = 0;
  let op: MathOp = '+';

  switch (tier) {
    case 0: {
      // single-digit addition / subtraction
      op = rng() < 0.5 ? '+' : '-';
      a = intInRange(rng, 2, 9);
      b = intInRange(rng, 1, 9);
      break;
    }
    case 1: {
      // two-digit addition / subtraction
      op = rng() < 0.5 ? '+' : '-';
      a = intInRange(rng, 10, 49);
      b = intInRange(rng, 2, 39);
      break;
    }
    case 2: {
      // mix: single-digit multiplication OR mid two-digit add/sub
      const roll = rng();
      if (roll < 0.5) {
        op = '*';
        a = intInRange(rng, 2, 9);
        b = intInRange(rng, 2, 9);
      } else {
        op = rng() < 0.5 ? '+' : '-';
        a = intInRange(rng, 20, 89);
        b = intInRange(rng, 5, 59);
      }
      break;
    }
    case 3: {
      // 2-digit × 1-digit, or harder add/sub
      const roll = rng();
      if (roll < 0.6) {
        op = '*';
        a = intInRange(rng, 11, 29);
        b = intInRange(rng, 2, 9);
      } else {
        op = rng() < 0.5 ? '+' : '-';
        a = intInRange(rng, 40, 199);
        b = intInRange(rng, 10, 99);
      }
      break;
    }
    default: {
      // tier 4: small 2-digit × 2-digit, or large add/sub
      const roll = rng();
      if (roll < 0.55) {
        op = '*';
        a = intInRange(rng, 11, 25);
        b = intInRange(rng, 11, 19);
      } else {
        op = rng() < 0.5 ? '+' : '-';
        a = intInRange(rng, 100, 499);
        b = intInRange(rng, 20, 199);
      }
      break;
    }
  }

  // Keep subtraction non-negative by ordering operands (larger − smaller).
  if (op === '-' && b > a) {
    const tmp = a;
    a = b;
    b = tmp;
  }

  const answer = op === '+' ? a + b : op === '-' ? a - b : a * b;
  const prompt = `${a} ${OP_SYMBOL[op]} ${b}`;

  return { index: safeIndex, a, b, op, answer, prompt };
}

// ---------------------------------------------------------------------------
// Run validation (server-authoritative scoring)
// ---------------------------------------------------------------------------

/** One submitted answer from the client. `t` = ms since the player's first
 *  problem appeared (client clock — used only for cadence/window sanity; the
 *  authoritative elapsed time is the server session durationMs). */
export interface MathAnswer {
  index: number;
  value: number;
  t: number;
}

export interface MathRunResult {
  /** Authoritative score = number of validated-correct, in-cadence answers. */
  correct: number;
  /** How many submitted answers were actually scored (after dropping the
   *  implausible/too-fast/out-of-window/duplicate ones). */
  counted: number;
  /** Answers ignored as too-fast / out-of-window / duplicate-index / malformed. */
  dropped: number;
}

/**
 * Re-derive the authoritative correct-count from a submitted answer list.
 *
 * Rules (an answer must satisfy ALL to be counted):
 *  - well-formed: integer index ≥ 0, integer value, finite numeric `t`
 *  - in-window: 0 ≤ t ≤ MATH_MAX_ANSWER_T_MS
 *  - in-bounds vs the server clock: t ≤ durationMs + grace (the server-measured
 *    elapsed; rejects answers claimed after the sprint physically ended)
 *  - monotonic + spaced: `t` must be ≥ previous counted answer's t and at least
 *    MATH_MIN_ANSWER_INTERVAL_MS after it (too-fast answers are dropped, not
 *    scored — protects the time-bounded ceiling)
 *  - unique index: each problem index may only be answered once (later
 *    duplicates are dropped)
 *  - capped: at most MATH_MAX_ANSWERS answers are ever considered
 *
 * Correctness is checked against `mathProblemFor(seed, index)`. The function is
 * pure and never throws on bad input — malformed entries are simply dropped.
 */
export function validateMathRun(
  seed: number,
  answers: readonly MathAnswer[],
  durationMs: number,
): MathRunResult {
  if (!Array.isArray(answers) || answers.length === 0) {
    return { correct: 0, counted: 0, dropped: 0 };
  }

  // Upper bound for acceptable `t`: the smaller of the hard 62s window and the
  // server-measured elapsed time plus a small grace for the final keypress.
  const serverWindowMs =
    Number.isFinite(durationMs) && durationMs > 0
      ? Math.min(MATH_MAX_ANSWER_T_MS, durationMs + 1_500)
      : MATH_MAX_ANSWER_T_MS;

  // Score in submission order, but enforce monotonic cadence on `t`. We sort by
  // t first so out-of-order delivery doesn't unfairly drop valid answers, then
  // apply the spacing floor. Index uniqueness is tracked across the whole run.
  const candidates = answers
    .filter(
      (entry): entry is MathAnswer =>
        !!entry &&
        Number.isInteger(entry.index) &&
        entry.index >= 0 &&
        Number.isInteger(entry.value) &&
        typeof entry.t === 'number' &&
        Number.isFinite(entry.t),
    )
    .slice()
    .sort((x, y) => x.t - y.t);

  let correct = 0;
  let counted = 0;
  let dropped = answers.length - candidates.length;
  let lastCountedT = -Infinity;
  const seenIndices = new Set<number>();

  for (const entry of candidates) {
    if (counted >= MATH_MAX_ANSWERS) {
      dropped += 1;
      continue;
    }
    // Window check.
    if (entry.t < 0 || entry.t > serverWindowMs) {
      dropped += 1;
      continue;
    }
    // Cadence check — must be spaced from the previous COUNTED answer.
    if (lastCountedT !== -Infinity && entry.t - lastCountedT < MATH_MIN_ANSWER_INTERVAL_MS) {
      dropped += 1;
      continue;
    }
    // One answer per problem index.
    if (seenIndices.has(entry.index)) {
      dropped += 1;
      continue;
    }

    seenIndices.add(entry.index);
    lastCountedT = entry.t;
    counted += 1;

    const problem = mathProblemFor(seed, entry.index);
    if (entry.value === problem.answer) {
      correct += 1;
    }
  }

  return { correct, counted, dropped };
}
