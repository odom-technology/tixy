/**
 * Server-authoritative PUNCH CARD replay + scoring (pure, deterministic).
 *
 * The client streams a timestamped log of cell-mark events (fill / X-mark /
 * clear). The score route re-derives the solution bitmap from the session seed
 * (never trusting the client for it) and calls `computePunchCardResult` to:
 *   1. replay the events into a final filled-set and verify it EXACTLY matches
 *      the solution (this is the "you solved it" gate, like sudoku's grid check);
 *   2. count wrong fills — fill events landing on a solution-empty cell — which
 *      drive the +10s-per-error penalty;
 *   3. report whether the solve was clean (zero wrong fills) for the purity
 *      bonus.
 *
 * The recorded TIME is server-authoritative (wall-clock elapsed on the server,
 * clamped to the client report exactly as sudoku does); the events only decide
 * the error penalty / clean-solve bonus, never the base time.
 */
import {
  SIZE_TO_N,
  type PunchCardSize,
} from './punch-card-generator';

export {
  generatePunchCard,
  deriveClues,
  isPunchCardSize,
  PUNCH_CARD_SIZES,
  SIZE_TO_N,
  type PunchCardSize,
} from './punch-card-generator';

/** +10 seconds recorded time per wrong fill (brief's error penalty). */
export const PUNCH_CARD_ERROR_PENALTY_MS = 10_000;

/** Clean-solve (zero errors) purity bonus — shaved off the recorded time. */
export const PUNCH_CARD_CLEAN_BONUS_MS = 3_000;

/** Floor for any recorded time. */
export const PUNCH_CARD_MIN_RECORDED_MS = 1_000;

/** Hard cap on recorded solve time (1 hour) — anything longer is rejected. */
export const PUNCH_CARD_MAX_SOLVE_MS = 3_600_000;

/**
 * Lower bound (ms) of physically-plausible solve duration per cell, used by the
 * session plausibility check. A blistering drag-paint tops out around ~20
 * cells/s (50 ms/cell) and only ~half the grid needs filling, so 20 ms/cell is
 * a generous floor that never false-rejects a human but catches a bot that
 * submits within a few hundred ms of session start.
 */
export const PUNCH_CARD_MIN_MS_PER_CELL = 20;

/** Minimum plausible server-measured solve duration for a board of size n. */
export function minPlausibleDurationMs(n: number): number {
  return n * n * PUNCH_CARD_MIN_MS_PER_CELL;
}

/** A cell-mark event. `a`: 0 = fill, 1 = X-mark, 2 = clear. */
export interface PunchCardEvent {
  /** ms since the run started (display-only; ordering is by array position). */
  t: number;
  /** cell index 0..n*n-1 (row-major). */
  i: number;
  /** action: 0 fill, 1 X-mark, 2 clear. */
  a: 0 | 1 | 2;
}

/**
 * Coerce an unknown payload into a clean event list, or null if malformed.
 * Accepts either `{t,i,a}` objects or compact `[t,i,a]` tuples. A generous cap
 * bounds abuse (a 15×15 board with heavy re-marking still fits far under this).
 */
export function normalizeEvents(
  value: unknown,
  cellCount: number,
  cap = 20_000,
): PunchCardEvent[] | null {
  if (!Array.isArray(value)) return null;
  if (value.length > cap) return null;
  const out: PunchCardEvent[] = [];
  for (const raw of value) {
    let t: unknown;
    let i: unknown;
    let a: unknown;
    if (Array.isArray(raw)) {
      [t, i, a] = raw;
    } else if (raw && typeof raw === 'object') {
      ({ t, i, a } = raw as Record<string, unknown>);
    } else {
      return null;
    }
    if (
      typeof t !== 'number' ||
      !Number.isFinite(t) ||
      typeof i !== 'number' ||
      !Number.isInteger(i) ||
      typeof a !== 'number' ||
      (a !== 0 && a !== 1 && a !== 2)
    ) {
      return null;
    }
    if (i < 0 || i >= cellCount) return null;
    out.push({ t: Math.max(0, Math.floor(t)), i, a: a as 0 | 1 | 2 });
  }
  return out;
}

export interface PunchCardResult {
  /** True iff replaying the events reproduces the solution's filled-set exactly. */
  solved: boolean;
  /** Number of fill events that landed on a solution-empty cell. */
  errorCount: number;
  /** How many solution cells ended up correctly filled. */
  filledCorrect: number;
}

/**
 * Replay `events` against `solution` (n*n bitmap of 0/1) and report the result.
 * Fill events on solution-empty cells count as errors; X-mark and clear both
 * un-fill a cell. Duplicate fills on an already-filled cell are ignored (no
 * double-counting).
 */
export function computePunchCardResult(
  events: PunchCardEvent[],
  n: number,
  solution: ArrayLike<number>,
): PunchCardResult {
  const filled = new Uint8Array(n * n);
  let errorCount = 0;

  for (const ev of events) {
    if (ev.a === 0) {
      if (filled[ev.i] === 0) {
        filled[ev.i] = 1;
        if (solution[ev.i] !== 1) errorCount += 1;
      }
    } else {
      filled[ev.i] = 0;
    }
  }

  let solved = true;
  let filledCorrect = 0;
  for (let i = 0; i < n * n; i += 1) {
    const want = solution[i] === 1 ? 1 : 0;
    if (filled[i] !== want) solved = false;
    if (want === 1 && filled[i] === 1) filledCorrect += 1;
  }

  return { solved, errorCount, filledCorrect };
}

/**
 * Combine the server-authoritative base solve time with the replay-derived
 * error count into the recorded (leaderboard) time. Lower is better.
 *   recorded = base + 10s * errors − (clean ? 3s : 0), floored at 1s.
 */
export function computeRecordedTimeMs(
  baseSolveMs: number,
  errorCount: number,
): number {
  const penalty = errorCount * PUNCH_CARD_ERROR_PENALTY_MS;
  const bonus = errorCount === 0 ? PUNCH_CARD_CLEAN_BONUS_MS : 0;
  return Math.max(PUNCH_CARD_MIN_RECORDED_MS, baseSolveMs + penalty - bonus);
}

/** n*n for a size, re-exported convenience for routes. */
export function sizeCellCount(size: PunchCardSize): number {
  const n = SIZE_TO_N[size];
  return n * n;
}
