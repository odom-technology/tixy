/**
 * Log Splitter — pure, deterministic branch schedule + run validator.
 *
 * This module is the single source of truth for BOTH the client (which renders
 * the descending branch column, the draining time bar, and the chopper) and the
 * server score route (which re-derives every branch + re-runs the exact same
 * fixed-point time-bar simulation to validate the submitted chops). Same
 * `(seed, chopIndex)` ⇒ identical branch side on both sides, and the time-bar
 * math is INTEGER (fixed-point) so the client and the server can never drift.
 *
 * Mechanic (two-button panic rhythm):
 *  - A tree descends toward the lumberjack. Each trunk segment carries a branch
 *    on the LEFT, the RIGHT, or NEITHER side (seed-derived). The player taps a
 *    side to chop and stand on that side; if the branch of the segment now at
 *    head height is on the side they chopped, the branch hits them — the run
 *    ends. There is ALWAYS a safe side (a segment never has a branch on both
 *    sides), and the first LOG_SPLITTER_SAFE_START segments are guaranteed
 *    branch-free, so the opening chop is safe on either side.
 *  - A time bar drains continuously and drains FASTER the deeper you go. Every
 *    chop refills a fixed chunk (capped), so speed is survival: keep chopping or
 *    the bar hits zero and the run ends. Because the drain rate escalates past
 *    what even a min-cadence tapper can outrun, the score has a finite ceiling.
 *  - Score = chops completed before the run ends.
 *
 * Anti-cheat model (single-POST, no WebSocket — mirrors Tumbler / Math Sprint):
 *  - The authoritative score is recomputed by replaying the recorded chops
 *    through the same pure state machine the client ran (`logSplitterApplyChop`).
 *    We trust ONLY the chop's side + timestamp; the branch layout is re-derived
 *    from the session seed, so a client can never choose an easier tree.
 *  - A minimum interval between COUNTED chops caps how fast a precomputing
 *    cheater can fire; under-cadence taps are deterministically IGNORED on both
 *    sides (they neither score nor end the run), so an accidental double-tap can
 *    never desync the client from the validator. Combined with the escalating
 *    time-bar drain, this bounds the maximum reachable score.
 *
 * Everything here is pure: no Date.now(), no Math.random(), no I/O.
 */

// ---------------------------------------------------------------------------
// Tunable constants (exported so the route + client agree on the same bounds)
// ---------------------------------------------------------------------------

/** Sides a chop can land on. */
export type LogSplitterSide = 'L' | 'R';

/** A segment's branch: on the left, on the right, or no branch. */
export type LogSplitterBranch = 'L' | 'R' | 'N';

/**
 * Minimum spacing between consecutive COUNTED chops (ms). A human two-button
 * mash tops out well under this rate; a faster tap is IGNORED (not counted, not
 * fatal) on BOTH sides, which both protects the time-bounded ceiling and makes
 * an accidental double-tap harmless. 60 ms ⇒ ~16.7 chops/s hard ceiling.
 */
export const LOG_SPLITTER_MIN_CHOP_INTERVAL_MS = 60;

// --- Time bar (all integer / fixed-point) ----------------------------------
// The bar is stored in "units" where 1000 units == 1 ms of drain at the base
// rate (LOG_SPLITTER_DRAIN_BASE). Drain over an interval is `dt_ms * F(chops)`,
// an integer × integer product, so the client and server bar never diverge.

/** Bar capacity (units). BAR_MAX / DRAIN_BASE ms ⇒ 4.8 s full bar at chop 0. */
export const LOG_SPLITTER_BAR_MAX = 4_800_000;

/** Bar value at the start of a run (units) ⇒ 3.2 s of headroom at chop 0. */
export const LOG_SPLITTER_BAR_START = 3_200_000;

/** Units refilled by each successful chop (capped at BAR_MAX) ⇒ +0.52 s at base. */
export const LOG_SPLITTER_REFILL = 520_000;

/** Drain rate at chop 0 (units per ms). 1000 ⇒ the bar reads in real ms early. */
export const LOG_SPLITTER_DRAIN_BASE = 1000;

/** Added to the drain rate per chop cleared (the tree bites faster as you go). */
export const LOG_SPLITTER_DRAIN_STEP = 18;

/** Hard ceiling on the drain rate (units per ms) — reached deep in a run. */
export const LOG_SPLITTER_DRAIN_MAX = 9000;

// --- Branch schedule -------------------------------------------------------

/** The first N danger segments are guaranteed branch-free (safe opening chop). */
export const LOG_SPLITTER_SAFE_START = 2;

/** Probability a given (non-safe-start) segment has NO branch. */
export const LOG_SPLITTER_BRANCH_NONE_CHANCE = 0.3;

// --- Defensive bounds ------------------------------------------------------

/** Absolute ceiling on chops we will ever score for one run. */
export const LOG_SPLITTER_MAX_CHOPS = 2000;

/** A single run cannot legitimately last longer than this (ms). */
export const LOG_SPLITTER_MAX_T_MS = 20 * 60 * 1000; // 20 minutes

/** Absolute ceiling on the submitted chop payload (one event per chop + slack). */
export const LOG_SPLITTER_MAX_EVENTS = LOG_SPLITTER_MAX_CHOPS + 64;

/** Coarse plausibility ceiling on the score value of one run. */
export const LOG_SPLITTER_MAX_SCORE = LOG_SPLITTER_MAX_CHOPS;

// ---------------------------------------------------------------------------
// PRNG — mulberry32. Byte-identical to the repo's seededRandom (tumbler,
// math-sprint, sequence-replay). Returns a function producing floats in [0, 1).
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
 * Derive a stable per-segment RNG from (seed, index). Mixing the index into the
 * seed makes `logSplitterBranchFor` O(1) and pure — no need to replay the whole
 * stream to get segment N, and no cross-index state to drift. Identical mixing
 * to tumbler's `rngForIndex`, so adjacent segments don't correlate.
 */
function rngForIndex(seed: number, index: number): () => number {
  let mixed = (seed ^ Math.imul(index + 1, 0x9e3779b1)) | 0;
  mixed = (mixed + 0x6d2b79f5) | 0;
  return mulberry32(mixed);
}

// ---------------------------------------------------------------------------
// Branch schedule (deterministic)
// ---------------------------------------------------------------------------

/**
 * The branch on the danger segment for chop `index` (0-based). Pure and
 * identical on client + server. The first LOG_SPLITTER_SAFE_START segments are
 * forced branch-free so the opening chop is safe on either side; every other
 * segment is NONE with probability LOG_SPLITTER_BRANCH_NONE_CHANCE, else a
 * seeded L/R. A segment never carries a branch on both sides, so there is always
 * a safe side (no impossible pattern).
 *
 * RNG draw order is FIXED (presence, then side) — never reorder, or the two
 * sides diverge.
 */
export function logSplitterBranchFor(seed: number, index: number): LogSplitterBranch {
  const safeIndex = index < 0 ? 0 : Math.floor(index);
  if (safeIndex < LOG_SPLITTER_SAFE_START) return 'N';
  const rng = rngForIndex(seed | 0, safeIndex);
  const presence = rng();
  if (presence < LOG_SPLITTER_BRANCH_NONE_CHANCE) return 'N';
  return rng() < 0.5 ? 'L' : 'R';
}

/** Drain rate (units per ms) for a given chop count (ramps, then clamps). */
export function logSplitterDrainRate(chops: number): number {
  const k = chops < 0 ? 0 : Math.floor(chops);
  return Math.min(
    LOG_SPLITTER_DRAIN_MAX,
    LOG_SPLITTER_DRAIN_BASE + k * LOG_SPLITTER_DRAIN_STEP,
  );
}

// ---------------------------------------------------------------------------
// Shared chop state machine — the ONE sim both the client and validator run.
// ---------------------------------------------------------------------------

export interface LogSplitterSimState {
  /** Chops fully completed so far (== the authoritative score). */
  chops: number;
  /** Time bar remaining, in fixed-point units [0, LOG_SPLITTER_BAR_MAX]. */
  bar: number;
  /** Absolute ms of the last COUNTED chop, or -1 if none yet. */
  lastChopT: number;
}

export function logSplitterInitialState(): LogSplitterSimState {
  return {
    chops: 0,
    bar: LOG_SPLITTER_BAR_START,
    lastChopT: -1,
  };
}

export type LogSplitterChopEvent =
  /** Under the cadence floor — deterministically a no-op on both sides. */
  | { type: 'ignored' }
  /** Timestamp malformed / non-monotonic / past the run ceiling — run ends. */
  | { type: 'bounds' }
  /** The time bar hit zero before this chop landed — run ends (timeout). */
  | { type: 'timeout'; bar: number }
  /** Chopped into the branch on this side — run ends (struck). */
  | { type: 'struck'; branch: LogSplitterBranch }
  /** Chop landed. `chops` + `bar` are the values AFTER this chop. */
  | { type: 'chop'; chops: number; bar: number; barBefore: number };

/**
 * Apply one chop (side + absolute t in ms since run start) to a sim state.
 * Pure: returns a NEW state plus the event describing what happened. This exact
 * function runs on the client per real tap and on the server per recorded tap,
 * so the two can never disagree.
 */
export function logSplitterApplyChop(
  seed: number,
  state: LogSplitterSimState,
  t: number,
  side: LogSplitterSide,
): { state: LogSplitterSimState; event: LogSplitterChopEvent } {
  // Malformed timestamp, run past its ceiling, or a tap that goes backwards in
  // time relative to the last counted chop → out of bounds, end the run.
  if (
    !Number.isFinite(t) ||
    t < 0 ||
    t > LOG_SPLITTER_MAX_T_MS ||
    (state.lastChopT >= 0 && t < state.lastChopT)
  ) {
    return { state, event: { type: 'bounds' } };
  }

  // Cadence floor: too-soon taps are ignored on BOTH sides (never fatal, never
  // scoring), so accidental double-taps cannot desync client from validator.
  if (state.lastChopT >= 0 && t - state.lastChopT < LOG_SPLITTER_MIN_CHOP_INTERVAL_MS) {
    return { state, event: { type: 'ignored' } };
  }

  // Drain the bar over the elapsed interval at THIS chop-count's rate (integer
  // × integer, so byte-identical on both sides). First chop drains from t=0.
  const from = state.lastChopT >= 0 ? state.lastChopT : 0;
  const dt = t - from;
  const barBefore = state.bar - dt * logSplitterDrainRate(state.chops);
  if (barBefore <= 0) {
    return { state, event: { type: 'timeout', bar: 0 } };
  }

  // Branch death: struck if this side carries the danger segment's branch.
  const branch = logSplitterBranchFor(seed | 0, state.chops);
  if (branch === side) {
    return { state, event: { type: 'struck', branch } };
  }

  // Successful chop — refill (capped) and advance.
  const bar = Math.min(LOG_SPLITTER_BAR_MAX, barBefore + LOG_SPLITTER_REFILL);
  const chops = state.chops + 1;
  return {
    state: { chops, bar, lastChopT: t },
    event: { type: 'chop', chops, bar, barBefore },
  };
}

// ---------------------------------------------------------------------------
// Run validation (server-authoritative scoring)
// ---------------------------------------------------------------------------

/** One recorded chop from the client. `t` = ms since run start (monotonic). */
export interface LogSplitterChop {
  side: LogSplitterSide;
  t: number;
}

export interface LogSplitterRunResult {
  /** Authoritative score (chops completed) before the run ended. */
  score: number;
  /** How many events were inspected before scoring stopped. */
  inspected: number;
  /** Why scoring stopped. */
  stop: 'struck' | 'timeout' | 'bounds' | 'cap' | 'end';
  /** Absolute ms of every COUNTED chop, for anti-cheat action streams. */
  chopTimes: number[];
}

const isSide = (value: unknown): value is LogSplitterSide =>
  value === 'L' || value === 'R';

/**
 * Re-derive the authoritative run from a submitted chop list by replaying every
 * chop through the same `logSplitterApplyChop` state machine the client ran. The
 * FIRST fatal event (struck / timeout / bounds) ends the run; under-cadence taps
 * are skipped exactly as the client skips them. Pure and never throws — bad
 * input simply stops scoring.
 */
export function validateLogSplitterRun(
  seed: number,
  chops: readonly LogSplitterChop[],
): LogSplitterRunResult {
  if (!Array.isArray(chops) || chops.length === 0) {
    return { score: 0, inspected: 0, stop: 'end', chopTimes: [] };
  }

  let state = logSplitterInitialState();
  let inspected = 0;
  const chopTimes: number[] = [];

  for (let i = 0; i < chops.length && i < LOG_SPLITTER_MAX_EVENTS; i += 1) {
    if (state.chops >= LOG_SPLITTER_MAX_CHOPS) {
      return { score: state.chops, inspected, stop: 'cap', chopTimes };
    }
    inspected = i + 1;

    const raw = chops[i];
    const side = isSide(raw?.side) ? raw.side : null;
    const t = typeof raw?.t === 'number' ? raw.t : NaN;
    if (side === null) {
      return { score: state.chops, inspected, stop: 'bounds', chopTimes };
    }

    const applied = logSplitterApplyChop(seed, state, t, side);
    const { event } = applied;
    if (event.type === 'bounds') {
      return { score: state.chops, inspected, stop: 'bounds', chopTimes };
    }
    if (event.type === 'timeout') {
      return { score: state.chops, inspected, stop: 'timeout', chopTimes };
    }
    if (event.type === 'struck') {
      return { score: state.chops, inspected, stop: 'struck', chopTimes };
    }
    if (event.type === 'chop') {
      chopTimes.push(t);
    }
    state = applied.state;
  }

  return { score: state.chops, inspected, stop: 'end', chopTimes };
}
