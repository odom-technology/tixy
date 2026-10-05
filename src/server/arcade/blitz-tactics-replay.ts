// ──────────────────────────────────────────────────────────────────────────
// BLITZ TACTICS — shared, pure ladder generator + server-authoritative replay.
//
// This module is the SINGLE SOURCE OF TRUTH for both the client (which renders
// the seeded puzzle ladder and gives per-move feedback) and the score route
// (which re-derives the same ladder and recomputes the authoritative score from
// the recorded moves). Same seed ⇒ identical puzzle sequence on both sides, so
// the client can never pick easier puzzles or claim solves it didn't make.
//
// Game model (single-POST, seed-deterministic):
//   • The seed selects a rating-laddered sequence of puzzles from the bundled,
//     machine-verified bank (see data/blitz-tactics-puzzles.ts). Difficulty
//     escalates band-by-band with ladder depth (draw WITHOUT replacement).
//   • The player solves puzzles in order. Each puzzle is a forced mate (in 1 or
//     2) whose FIRST move is UNIQUE. A correct solve advances (+1). A wrong move
//     is a strike; 3 strikes ends the run. Score = puzzles solved.
//   • Multi-move puzzles: the opponent's reply between the player's moves is
//     part of the puzzle data (a forced/canonical line), so it is deterministic
//     on client and server. The final player move is accepted iff it delivers
//     checkmate (any mate solves); intermediate moves must equal the unique
//     forcing move.
//
// SERVER-AUTHORITATIVE TIME (the punch-card lesson): the 5-minute clock is the
// server session durationMs, never a client-reported duration. Additionally, a
// per-solve cadence floor bounds the achievable score by TIME — even a cheater
// who precomputes every solution (the bank ships in the client bundle) cannot
// exceed ~durationSec / MIN_SOLVE_INTERVAL solves, because each counted solve
// must be spaced at least that far from the previous one.
//
// Everything here is pure: no Date.now(), no Math.random(), no I/O. chess.js is
// used only to re-derive move legality / checkmate from a FEN (already bundled
// for the board component).
// ──────────────────────────────────────────────────────────────────────────

import { applyUciMove } from '@/features/arcade/lib/chess';
import {
  BLITZ_PUZZLES,
  BLITZ_BAND_COUNT,
  type BlitzPuzzle,
} from '@/server/arcade/data/blitz-tactics-puzzles';

// ── Run constants (client mirrors these) ────────────────────────────────────

/** Run length in seconds. */
export const BLITZ_DURATION_SEC = 300;

/** Misses that end the run. */
export const BLITZ_MAX_STRIKES = 3;

/**
 * Minimum wall-clock spacing (ms) between two COUNTED solves. The fastest a
 * human can recognize + execute a trivial one-move mate is ~1s; this floor sits
 * just below that so genuine play is never dropped, while it hard-caps a
 * precompute bot at ~BLITZ_DURATION_SEC*1000 / this (≈333) — an order of
 * magnitude above the top achievement tier and easily flagged by anti-cheat.
 */
export const BLITZ_MIN_SOLVE_INTERVAL_MS = 900;

/** Length of the seeded ladder (puzzles drawn without replacement). No human
 *  solves anywhere near this in 5 minutes; it is a generous headroom bound. */
export const BLITZ_LADDER_LENGTH = Math.min(80, BLITZ_PUZZLES.length);

/** Defensive cap on player moves recorded per puzzle (a mate-in-2 needs 2). */
export const BLITZ_MAX_MOVES_PER_PUZZLE = 6;

/** Absolute ceiling on a run's solved count (defense in depth). */
export const BLITZ_MAX_SOLVED = BLITZ_LADDER_LENGTH;

// ── Seeded RNG — identical mulberry32 to the other replays / the client ──────
function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher–Yates shuffle driven by a seeded RNG (pure, deterministic). */
function seededShuffle<T>(items: readonly T[], rng: () => number): T[] {
  const arr = items.slice();
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

// ── Band partition (computed once from the bank) ─────────────────────────────
/** Puzzle-bank indices grouped by their stored escalating-difficulty band. */
const BAND_INDICES: number[][] = (() => {
  const bands: number[][] = Array.from({ length: BLITZ_BAND_COUNT }, () => []);
  BLITZ_PUZZLES.forEach((p, idx) => {
    const b = Math.max(0, Math.min(BLITZ_BAND_COUNT - 1, p.band));
    bands[b].push(idx);
  });
  return bands;
})();

/**
 * The target band for ladder slot `slot` — an escalating ramp from band 0 up to
 * the top band across the full ladder length. Pure + deterministic.
 */
function bandForSlot(slot: number): number {
  const frac = BLITZ_LADDER_LENGTH <= 1 ? 0 : slot / (BLITZ_LADDER_LENGTH - 1);
  // Slightly ease-in so the first several puzzles stay in the easy bands.
  const eased = Math.pow(frac, 0.85);
  return Math.min(BLITZ_BAND_COUNT - 1, Math.floor(eased * BLITZ_BAND_COUNT));
}

/**
 * Build the deterministic escalating ladder for a seed: an array of bank indices
 * (length BLITZ_LADDER_LENGTH), drawn WITHOUT replacement, with difficulty
 * rising band-by-band with depth. Identical on client + server for a given seed.
 *
 * Each band's indices are seeded-shuffled once; slot `i` draws from its target
 * band, falling back to the nearest band with puzzles remaining so the ladder
 * always fills even if bands are unevenly sized.
 */
export function buildLadder(seed: number): number[] {
  const rng = mulberry32((seed | 0) ^ 0x5bd1e995);
  // Independent shuffled queues per band (fresh RNG stream per band so a band's
  // order doesn't correlate with the slot-assignment draws).
  const queues: number[][] = BAND_INDICES.map((band, b) =>
    seededShuffle(band, mulberry32(((seed | 0) + b * 0x9e3779b1) | 0)),
  );
  const cursor = new Array(BLITZ_BAND_COUNT).fill(0);

  const drawFromBand = (b: number): number | null => {
    if (cursor[b] < queues[b].length) {
      const idx = queues[b][cursor[b]];
      cursor[b] += 1;
      return idx;
    }
    return null;
  };

  const ladder: number[] = [];
  for (let slot = 0; slot < BLITZ_LADDER_LENGTH; slot += 1) {
    const target = bandForSlot(slot);
    let picked = drawFromBand(target);
    // Fall back outward (nearest band with puzzles left) if the target is empty.
    for (let d = 1; picked === null && d < BLITZ_BAND_COUNT; d += 1) {
      if (target - d >= 0) picked = drawFromBand(target - d);
      if (picked === null && target + d < BLITZ_BAND_COUNT) {
        picked = drawFromBand(target + d);
      }
    }
    if (picked === null) break; // all bands exhausted (bank smaller than ladder)
    ladder.push(picked);
  }
  // `rng` retained for potential future per-slot jitter; touch to avoid unused.
  void rng;
  return ladder;
}

/** Resolve the puzzle at ladder position `slot` for a seed. */
export function ladderPuzzle(seed: number, slot: number): BlitzPuzzle | null {
  const ladder = buildLadder(seed);
  const idx = ladder[slot];
  return idx === undefined ? null : BLITZ_PUZZLES[idx];
}

// ── Per-puzzle attempt evaluation ────────────────────────────────────────────

export type PuzzleAttemptResult = {
  /** True iff the recorded player moves solve the puzzle (reach checkmate along
   *  the forced line). */
  solved: boolean;
  /** How many player moves were consumed before solve / first wrong move. */
  movesUsed: number;
};

/**
 * Replay a player's recorded moves for ONE puzzle and decide solved vs. missed.
 *
 * Rules (pure, chess.js-checked, never trusts the client's claim):
 *  - Even solution indices are player moves; odd indices are the forced
 *    opponent reply (applied automatically from the puzzle data).
 *  - An intermediate player move MUST equal the unique forcing move at that
 *    index. The final player move is accepted iff it delivers checkmate.
 *  - Any illegal move, wrong intermediate move, non-mating final move, or an
 *    attempt that runs out of moves before mate ⇒ NOT solved (a miss).
 */
export function evaluatePuzzleAttempt(
  puzzle: BlitzPuzzle,
  playerMoves: readonly string[],
): PuzzleAttemptResult {
  const solution = puzzle.solution;
  let fen = puzzle.fen;
  let solIdx = 0; // index into solution (even = player move)
  let used = 0;

  for (let k = 0; k < playerMoves.length; k += 1) {
    if (solIdx >= solution.length) break; // solution already complete
    const move = playerMoves[k];
    if (typeof move !== 'string') return { solved: false, movesUsed: used };
    used += 1;

    let applied;
    try {
      applied = applyUciMove(fen, move);
    } catch {
      return { solved: false, movesUsed: used }; // illegal move ⇒ miss
    }

    const isFinalPlayerMove = solIdx === solution.length - 1;
    if (isFinalPlayerMove) {
      return { solved: applied.checkmate, movesUsed: used };
    }

    // Intermediate move must be the unique forcing move.
    if (move.toLowerCase() !== solution[solIdx].toLowerCase()) {
      return { solved: false, movesUsed: used };
    }

    // Apply the forced opponent reply, then continue with the next player move.
    const reply = solution[solIdx + 1];
    try {
      fen = applyUciMove(applied.fenAfter, reply).fenAfter;
    } catch {
      // The bank is machine-verified, so this cannot happen for a real puzzle;
      // treat as unsolved defensively rather than throwing.
      return { solved: false, movesUsed: used };
    }
    solIdx += 2;
  }

  return { solved: false, movesUsed: used }; // ran out of moves ⇒ not solved
}

// ── Recorded event + run result shapes ───────────────────────────────────────

/** One recorded puzzle attempt.
 *  `i` = ladder slot (0-based, must be sequential); `m` = player UCI moves in
 *  order; `t` = ms since run start when the attempt ended (client clock — only
 *  sanity-bounded; the authoritative elapsed is the server session duration). */
export type BlitzEvent = {
  i: number;
  m: string[];
  t: number;
};

export type BlitzRunResult = {
  /** Authoritative score = validated solved puzzles (in-cadence, in-window). */
  solved: number;
  /** Strikes accrued (misses); the run stops at BLITZ_MAX_STRIKES. */
  strikes: number;
  /** How many events were processed before the run ended. */
  counted: number;
  /** True if the log was rejected as structurally implausible (score ⇒ 0). */
  rejected: boolean;
  /** Human-readable reason when rejected. */
  reason: string | null;
};

const isFiniteNum = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v);

/**
 * Re-derive the authoritative solved-count from a submitted event log.
 *
 * @param seed        the server blitzTacticsSeed for this session
 * @param events      recorded puzzle attempts ({ i, m, t })
 * @param durationMs  the bounded server session duration in ms
 */
export function validateBlitzRun(
  seed: number,
  events: readonly BlitzEvent[],
  durationMs: number,
): BlitzRunResult {
  const reject = (reason: string): BlitzRunResult => ({
    solved: 0,
    strikes: 0,
    counted: 0,
    rejected: true,
    reason,
  });

  if (!Array.isArray(events) || events.length === 0) {
    return { solved: 0, strikes: 0, counted: 0, rejected: false, reason: null };
  }
  if (events.length > BLITZ_LADDER_LENGTH + BLITZ_MAX_STRIKES + 4) {
    return reject(`Event payload too large (${events.length})`);
  }

  const ladder = buildLadder(seed);

  // Clean + order by ladder slot. Sorting by slot means out-of-order delivery
  // can't unfairly break the sequential-slot check below.
  const clean = events
    .filter(
      (e) =>
        e != null &&
        Number.isInteger(e.i) &&
        e.i >= 0 &&
        Array.isArray(e.m) &&
        e.m.length <= BLITZ_MAX_MOVES_PER_PUZZLE &&
        isFiniteNum(e.t) &&
        e.t >= 0,
    )
    .slice()
    .sort((a, b) => a.i - b.i || a.t - b.t);

  if (clean.length === 0) return reject('No well-formed events');

  const serverWindowMs =
    Number.isFinite(durationMs) && durationMs > 0
      ? durationMs + 2_000
      : Number.POSITIVE_INFINITY;

  let solved = 0;
  let strikes = 0;
  let counted = 0;
  let expectedSlot = 0;
  let prevT = -Infinity;
  let lastCountedSolveT: number | null = null;

  for (const e of clean) {
    // Sequential slots: 0,1,2,… no gaps, no repeats.
    if (e.i !== expectedSlot) {
      return reject(`Slots out of sequence (got ${e.i}, expected ${expectedSlot})`);
    }
    const idx = ladder[e.i];
    if (idx === undefined) {
      return reject(`Ladder slot ${e.i} out of range`);
    }
    // Timing sanity: monotonic and inside the bounded session window.
    if (e.t + 1 < prevT) {
      return reject(`Event ${e.i} timestamp went backwards`);
    }
    if (e.t > serverWindowMs) {
      return reject(
        `Event ${e.i} outside session window (t=${Math.round(e.t)}ms > ${Math.round(serverWindowMs)}ms)`,
      );
    }

    const puzzle = BLITZ_PUZZLES[idx];
    const attempt = evaluatePuzzleAttempt(puzzle, e.m);

    counted += 1;
    expectedSlot += 1;
    prevT = e.t;

    if (attempt.solved) {
      // Cadence floor: a counted solve must be spaced from the previous counted
      // solve. Too-fast solves are DROPPED (not counted, not a strike) — the
      // client mirrors this so its displayed score matches the server's.
      if (
        lastCountedSolveT !== null &&
        e.t - lastCountedSolveT < BLITZ_MIN_SOLVE_INTERVAL_MS
      ) {
        continue;
      }
      solved += 1;
      lastCountedSolveT = e.t;
      if (solved >= BLITZ_MAX_SOLVED) break;
    } else {
      strikes += 1;
      if (strikes >= BLITZ_MAX_STRIKES) break; // 3 misses ends the run
    }
  }

  return {
    solved: Math.min(BLITZ_MAX_SOLVED, solved),
    strikes,
    counted,
    rejected: false,
    reason: null,
  };
}
