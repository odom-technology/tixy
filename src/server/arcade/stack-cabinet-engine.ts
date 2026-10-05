/**
 * Stacker's cabinet mode: rules, engine and validator. Pure TypeScript, no
 * React, no DOM, no Date.now(), no Math.random(). The client draws from it
 * and the score route replays with it, so both always agree. Endless mode
 * (stack-replay.ts) is a different game and is untouched by this file.
 *
 * The machine: a grid of lamps 7 wide and 15 high. A row of lit lamps
 * sweeps left and right one lamp at a time on a fixed step clock. Press to
 * stop it. Lamps that don't sit on the row below fall off, so the row
 * narrows; a row that sits on nothing ends the run. Each row is faster than
 * the last, and the row is never wider than its cap (3 lamps, then 2, then
 * 1), whatever is below. Placing row 11 pays the minor prize and placing
 * row 15 pays the major. The run goes on after row 11 without asking: the
 * minor is banked, and the major replaces it.
 *
 * Timing model (the same as ticket stop, so 30 and 144 Hz screens agree):
 *  - Everything is a function of elapsed time since the run began, in whole
 *    milliseconds. Nothing counts frames. A frame only samples the state.
 *  - A stop is the input event's own timestamp, so a slow or fast display
 *    changes when you see a lamp change, never where a stop lands.
 *  - The row moves in whole lamps. The fastest step is longer than one frame
 *    at 30 Hz, so every position is on screen at every refresh rate.
 *  - Reduced motion changes only the drawing (overhangs vanish instead of
 *    falling). The clock, the rows and every number are the same.
 *
 * Fairness across seeds: the seed only picks which wall each row starts
 * from. Speeds and caps are fixed per row, and the row sweeps until you stop
 * it, so a seed changes when a row first passes the tower, never how long it
 * stays there. Every seed is as hard as every other.
 *
 * The run's timeline, from t = 0 (the run's first input):
 *  - Row 1 starts moving at LEAD_IN_MS.
 *  - Row r+1 starts ROW_GAP_MS after the stop that placed row r (MINOR_GAP_MS
 *    after row 11, so the minor prize can land).
 *  - A press earlier than ARM_MS into a row is ignored by the client, so an
 *    honest run never sends one. The server rejects a run that has one.
 *  - The run ends on the stop that misses, or on the stop that places row
 *    15. There is no time limit inside a row (bounded by MAX_ROW_MS for the
 *    validator).
 */

const TAU = Math.PI * 2;

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

/** Lamps across. Matches the approved mockup (st-grid). */
export const STACKER_COLUMNS = 7;
/** Rows in the cabinet. */
export const STACKER_ROWS = 15;
/** Placing this row pays the minor prize. */
export const STACKER_MINOR_ROW = 11;
/** Placing this row pays the major prize, and ends the run. */
export const STACKER_MAJOR_ROW = 15;

export type StackerRowRule = {
  /** Time the row spends on each position, ms. */
  stepMs: number;
  /** The row is never wider than this, whatever is below it. */
  cap: number;
};

/**
 * Row 1 is the bottom row. Steps shorten by about 7.5% a row, from 150 ms to
 * 50 ms; the cap drops to 2 at row 6 and to 1 at row 10. Tuned in
 * scripts/verify-stack-cabinet-replay.ts (section 7) so the minor is a good
 * player's prize and the major a sharp one's.
 */
export const STACKER_ROW_RULES: readonly StackerRowRule[] = [
  { stepMs: 150, cap: 3 },
  { stepMs: 139, cap: 3 },
  { stepMs: 129, cap: 3 },
  { stepMs: 119, cap: 3 },
  { stepMs: 110, cap: 3 },
  { stepMs: 102, cap: 2 },
  { stepMs: 94, cap: 2 },
  { stepMs: 87, cap: 2 },
  { stepMs: 81, cap: 2 },
  { stepMs: 75, cap: 1 },
  { stepMs: 69, cap: 1 },
  { stepMs: 64, cap: 1 },
  { stepMs: 59, cap: 1 },
  { stepMs: 54, cap: 1 },
  { stepMs: 50, cap: 1 },
];

/** From the run's first input to row 1 moving, ms. */
export const STACKER_LEAD_IN_MS = 600;
/** From a stop to the next row moving, ms. The overhang falls in this gap. */
export const STACKER_ROW_GAP_MS = 400;
/** The gap after the minor row: the minor prize lands before row 12 moves. */
export const STACKER_MINOR_GAP_MS = 1000;
/** A row's stop arms this long after it starts moving, ms. */
export const STACKER_ARM_MS = 150;
/** The validator's bound on one row, ms. A real row never gets near it. */
export const STACKER_MAX_ROW_MS = 120_000;
/** How long the last stop holds before the result strip, ms (client only). */
export const STACKER_END_HOLD_MS = 900;
/** A row's width at the start of a run. */
export const STACKER_START_WIDTH = 3;

/** The prizes, in tickets, paid through the skill-game pipeline (daily cap
 *  included). The major replaces the minor; it doesn't add to it.
 *  The mockup's 50 and 500 can't be paid: 500 is above the 300-ticket daily
 *  cap, so the pipeline would clamp it, and 75 (MAX_GAME_RUN_CREDITS) is
 *  the most any quick-game run pays. A 75 major at the 1:5 ratio keeps
 *  cabinet mode below ticket stop in tickets per minute at every skill
 *  level, so it isn't the fastest way to the daily cap
 *  (scripts/verify-stack-cabinet-replay.ts, section 7). */
export const STACKER_MINOR_TICKETS = 15;
export const STACKER_MAJOR_TICKETS = 75;

/** Tickets a run pays before the daily cap, from the rows it placed. */
export function stackerPrizeTickets(rows: number): number {
  if (!Number.isFinite(rows)) return 0;
  if (rows >= STACKER_MAJOR_ROW) return STACKER_MAJOR_TICKETS;
  if (rows >= STACKER_MINOR_ROW) return STACKER_MINOR_TICKETS;
  return 0;
}

// ---------------------------------------------------------------------------
// Seeded layout
// ---------------------------------------------------------------------------

/** mulberry32, byte-identical to ticket stop and the other seeded games. */
function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type StackerLayout = {
  seed: number;
  /** Per row: +1 starts at the left wall moving right, -1 at the right wall. */
  dirs: readonly (1 | -1)[];
};

/** Which wall each row starts from. One draw per row, in row order. Never
 *  reorder, or client and server diverge. */
export function stackerLayout(seed: number): StackerLayout {
  const safeSeed = seed | 0;
  const rng = mulberry32(safeSeed ^ 0x5a17c4b3);
  const dirs = STACKER_ROW_RULES.map((): 1 | -1 => (rng() < 0.5 ? 1 : -1));
  return { seed: safeSeed, dirs };
}

// ---------------------------------------------------------------------------
// The sweep
// ---------------------------------------------------------------------------

const mod = (value: number, n: number) => ((value % n) + n) % n;

/** Whole steps a row has taken `elapsedMs` into it. */
export function stackerStepsAt(rule: StackerRowRule, elapsedMs: number): number {
  if (!(elapsedMs > 0)) return 0;
  return Math.floor(elapsedMs / rule.stepMs);
}

/** Left lamp of a row `width` wide after `steps` steps, starting from the
 *  wall `dir` names and bouncing off both walls. */
export function stackerLeftAfter(steps: number, width: number, dir: 1 | -1): number {
  const span = STACKER_COLUMNS - width;
  if (span <= 0) return 0;
  const p = mod(steps, span * 2);
  const travelled = p <= span ? p : span * 2 - p;
  return dir === 1 ? travelled : span - travelled;
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

export type StackerSpan = { left: number; width: number };

export type StackerRowResult = {
  /** 0 is row 1, the bottom row. */
  row: number;
  /** Stop time, ms since the run began. */
  stopMs: number;
  /** Where the moving row was when it stopped. */
  moving: StackerSpan;
  /** What stayed on the tower: null when nothing sat on the row below. */
  placed: StackerSpan | null;
  /** Lamps that fell off. */
  lost: number;
  /** No lamp fell off (rows 2 to 15; row 1 sits on the cabinet floor). */
  perfect: boolean;
  /** Where in its step the stop landed, 0 (the step just began) to 1. */
  phase: number;
};

export type StackerState = {
  /** Rows placed so far, bottom first. */
  tower: StackerSpan[];
  /** Every stop so far, in order, with its result. */
  results: StackerRowResult[];
  /** Width of the row that moves next (0 once the run is over). */
  width: number;
  /** The run is over: a miss, or row 15 placed. */
  over: boolean;
  /** Rows placed: the run's score, 0 to 15. */
  rows: number;
  perfects: number;
};

/** When row `index` (0-based) starts moving, given the stops so far. */
export function stackerRowStart(stops: readonly number[], index: number): number {
  if (index <= 0) return STACKER_LEAD_IN_MS;
  const gap = index === STACKER_MINOR_ROW ? STACKER_MINOR_GAP_MS : STACKER_ROW_GAP_MS;
  return stops[index - 1] + gap;
}

/** The moving row `elapsedMs` into row `index`. */
export function stackerMovingAt(
  layout: StackerLayout,
  index: number,
  width: number,
  elapsedMs: number,
): StackerSpan {
  const rule = STACKER_ROW_RULES[index];
  const steps = stackerStepsAt(rule, elapsedMs);
  return { left: stackerLeftAfter(steps, width, layout.dirs[index] ?? 1), width };
}

/** Width of the next row after one that kept `kept` lamps at `index`. */
function nextWidth(index: number, kept: number): number {
  const next = STACKER_ROW_RULES[index + 1];
  return next ? Math.min(kept, next.cap) : 0;
}

/** Resolve one stop. Pure: returns the new state. */
function applyStop(layout: StackerLayout, state: StackerState, stopMs: number, rowStart: number): StackerState {
  const index = state.results.length;
  const rule = STACKER_ROW_RULES[index];
  const elapsed = stopMs - rowStart;
  const moving = stackerMovingAt(layout, index, state.width, elapsed);
  // Row 1 sits on the cabinet floor, which is as wide as the cabinet.
  const below = state.tower[state.tower.length - 1] ?? { left: 0, width: STACKER_COLUMNS };
  const left = Math.max(moving.left, below.left);
  const right = Math.min(moving.left + moving.width, below.left + below.width);
  const kept = Math.max(0, right - left);
  const placed = kept > 0 ? { left, width: kept } : null;
  const result: StackerRowResult = {
    row: index,
    stopMs,
    moving,
    placed,
    lost: moving.width - kept,
    perfect: placed !== null && kept === moving.width && index > 0,
    phase: elapsed > 0 ? mod(elapsed, rule.stepMs) / rule.stepMs : 0,
  };
  const tower = placed ? [...state.tower, placed] : state.tower;
  const rows = tower.length;
  const over = placed === null || rows >= STACKER_ROWS;
  return {
    tower,
    results: [...state.results, result],
    width: over ? 0 : nextWidth(index, kept),
    over,
    rows,
    perfects: state.perfects + (result.perfect ? 1 : 0),
  };
}

export const stackerInitialState = (): StackerState => ({
  tower: [],
  results: [],
  width: STACKER_START_WIDTH,
  over: false,
  rows: 0,
  perfects: 0,
});

/** The run after the stops so far. Assumes the stops came through
 *  `stackerPress`; use `scoreStackerRun` for untrusted input. */
export function stackerState(layout: StackerLayout, stops: readonly number[]): StackerState {
  let state = stackerInitialState();
  for (let i = 0; i < stops.length && !state.over; i += 1) {
    state = applyStop(layout, state, stops[i], stackerRowStart(stops, i));
  }
  return state;
}

// ---------------------------------------------------------------------------
// The glide (client drawing only)
// ---------------------------------------------------------------------------

/** Half a lamp: the turn at each wall eases over this much travel. */
const GLIDE_TURN = 0.5;

/** From rest at a wall to full speed at `w` lamps, with no kink. */
const glideTurn = (d: number, w: number) => (2 * d * d) / w - (d * d * d) / (w * w);

/**
 * Where to draw the moving row, in lamps (a fractional left edge),
 * `elapsedMs` into its row. Drawing only: scoring never reads it, and stops
 * still land on whole lamps (`stackerMovingAt`).
 *
 * The row glides at one lamp per step instead of jumping a lamp per step, and
 * it is centred on the steps: it sits exactly on lamp k at the middle of step
 * k, and is half a lamp either side at the step's edges. So the lamp nearest
 * the drawn row is always the lamp a stop at that moment lights; the drawn
 * row is never more than half a lamp from it (the verifier checks every ms).
 * It waits at its wall for the first half step, and slows into each wall and
 * back out over half a lamp, staying inside that half lamp.
 */
export function stackerGlideLeft(
  layout: StackerLayout,
  index: number,
  width: number,
  elapsedMs: number,
): number {
  const rule = STACKER_ROW_RULES[index];
  const dir = layout.dirs[index] ?? 1;
  const span = STACKER_COLUMNS - width;
  if (!rule || span <= 0) return 0;
  // Lamps travelled from the start wall, on the unfolded path.
  const x = elapsedMs / rule.stepMs - 0.5;
  const w = Math.min(GLIDE_TURN, span / 2);
  let q: number;
  if (x <= 0) {
    q = 0;
  } else {
    const p = mod(x, span * 2);
    q = p <= span ? p : span * 2 - p;
  }
  if (x > 0 && q < w) q = glideTurn(q, w);
  else if (q > span - w) q = span - glideTurn(span - q, w);
  return dir === 1 ? q : span - q;
}

// ---------------------------------------------------------------------------
// Drawing ahead (client)
// ---------------------------------------------------------------------------

/**
 * How far ahead of the frame's timestamp to draw, ms. A frame drawn at time
 * t reaches the screen about one frame interval later, so drawing the row
 * for t + interval makes what is on screen match the clock a press is
 * stamped with. Drawing only: scoring never reads it. Same rule as ticket
 * stop's.
 */
export function stackerDisplayLeadMs(frameIntervalMs: number): number {
  if (!Number.isFinite(frameIntervalMs) || frameIntervalMs <= 0) return 1000 / 60;
  return Math.min(50, Math.max(4, frameIntervalMs));
}

// ---------------------------------------------------------------------------
// Taking a press (client)
// ---------------------------------------------------------------------------

export type StackerPress =
  | { kind: 'stop'; result: StackerRowResult; state: StackerState }
  /** Before the row arms (the lead-in, a gap, or the first ARM_MS of a row),
   *  or after the run ended. Nothing is recorded. */
  | { kind: 'ignored'; reason: 'not-armed' | 'over' };

/**
 * What a press at `atMs` (ms since the run began, whole ms) does. The client
 * records `atMs` only when this says `stop`, so it only ever sends stops the
 * validator accepts.
 */
export function stackerPress(
  layout: StackerLayout,
  stops: readonly number[],
  atMs: number,
): StackerPress {
  const state = stackerState(layout, stops);
  if (state.over) return { kind: 'ignored', reason: 'over' };
  const index = stops.length;
  const start = stackerRowStart(stops, index);
  if (!Number.isFinite(atMs) || atMs < start + STACKER_ARM_MS) {
    return { kind: 'ignored', reason: 'not-armed' };
  }
  const next = applyStop(layout, state, atMs, start);
  return { kind: 'stop', result: next.results[next.results.length - 1], state: next };
}

/** Whole milliseconds since the run began, from an input event's timestamp
 *  and the run's start on the same clock. */
export function stackerInputMs(eventTimeMs: number, runStartMs: number): number {
  return Math.round(eventTimeMs - runStartMs);
}

// ---------------------------------------------------------------------------
// What to draw at a moment (client)
// ---------------------------------------------------------------------------

export type StackerView = {
  /** lead-in: row 1 waits at its wall. move: a row sweeps. gap: a stop just
   *  landed and the next row waits at its wall. done: the run is over. */
  phase: 'lead-in' | 'move' | 'gap' | 'done';
  /** The row on screen (0-based): the moving or waiting one, or the last
   *  stopped one when done. */
  row: number;
  /** The moving or waiting row; null when done. */
  moving: StackerSpan | null;
  /** When the row on screen starts (or started) moving, ms since the run
   *  began. Drawing uses it for the afterglow of lamps the row just left. */
  rowStartMs: number;
  /** The row can be stopped now. */
  armed: boolean;
  /** The run so far. */
  state: StackerState;
  /** The last stop, if any. */
  last: StackerRowResult | null;
  /** ms since the last stop (or since the run began, before one). */
  sinceStopMs: number;
};

/**
 * The cabinet at `tMs` since the run began, given the stops so far. A pure
 * function of elapsed time: draw whatever this returns, at any frame rate.
 */
export function stackerView(layout: StackerLayout, stops: readonly number[], tMs: number): StackerView {
  const state = stackerState(layout, stops);
  const last = state.results[state.results.length - 1] ?? null;
  const sinceStopMs = last ? Math.max(0, tMs - last.stopMs) : Math.max(0, tMs);
  if (state.over) {
    const row = last?.row ?? 0;
    return {
      phase: 'done',
      row,
      moving: null,
      rowStartMs: stackerRowStart(stops, row),
      armed: false,
      state,
      last,
      sinceStopMs,
    };
  }
  const index = state.results.length;
  const start = stackerRowStart(stops, index);
  const waiting = stackerMovingAt(layout, index, state.width, 0);
  if (tMs < start) {
    return {
      phase: last ? 'gap' : 'lead-in',
      row: index,
      moving: waiting,
      rowStartMs: start,
      armed: false,
      state,
      last,
      sinceStopMs,
    };
  }
  const elapsed = tMs - start;
  return {
    phase: 'move',
    row: index,
    moving: stackerMovingAt(layout, index, state.width, elapsed),
    rowStartMs: start,
    armed: elapsed >= STACKER_ARM_MS,
    state,
    last,
    sinceStopMs,
  };
}

// ---------------------------------------------------------------------------
// Validation (server)
// ---------------------------------------------------------------------------

export type StackerRejection =
  /** Not an array, empty, or longer than the cabinet. */
  | 'count'
  /** A stop that is not a whole, finite, non-negative number of ms. */
  | 'malformed'
  /** A stop before its row armed. An honest client never sends one. */
  | 'early'
  /** A row longer than MAX_ROW_MS. */
  | 'bounds'
  /** Stops after the run ended (a miss, or row 15). */
  | 'extra'
  /** The stops end before the run does: neither a miss nor row 15. */
  | 'unfinished'
  /** The run's timeline is longer than the time since the server stamped
   *  its start: it was submitted faster than it could be played. */
  | 'too-fast'
  /** Submitted long after the run's timeline ended. */
  | 'stale';

export type StackerRun =
  | {
      ok: true;
      rows: number;
      perfects: number;
      results: StackerRowResult[];
      /** Tickets before the daily cap. */
      prize: number;
      /** ms from the run's first input to the last stop. */
      durationMs: number;
    }
  | { ok: false; reason: StackerRejection; row?: number };

/** Slack for the start-stamp check. The client starts its clock only once
 *  the server has stamped the start; this covers clock rounding. */
export const STACKER_SESSION_SLACK_MS = 250;
/** How long after its last stop a run may be submitted. */
export const STACKER_MAX_SUBMIT_DELAY_MS = 120_000;

/**
 * Recompute a run from the seed and the submitted stop times, rejecting
 * anything an honest client cannot send. Never throws.
 */
export function scoreStackerRun(
  seed: number,
  stops: unknown,
  /** `sinceStartMs`: server ms from the run's start stamp to the submit. */
  options: { sinceStartMs?: number } = {},
): StackerRun {
  if (!Array.isArray(stops) || stops.length < 1 || stops.length > STACKER_ROWS) {
    return { ok: false, reason: 'count' };
  }
  const clean: number[] = [];
  for (let i = 0; i < stops.length; i += 1) {
    const value = stops[i];
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
      return { ok: false, reason: 'malformed', row: i };
    }
    clean.push(value);
  }

  const layout = stackerLayout(seed);
  let state = stackerInitialState();
  for (let i = 0; i < clean.length; i += 1) {
    if (state.over) return { ok: false, reason: 'extra', row: i };
    const start = stackerRowStart(clean, i);
    if (clean[i] < start + STACKER_ARM_MS) return { ok: false, reason: 'early', row: i };
    if (clean[i] - start > STACKER_MAX_ROW_MS) return { ok: false, reason: 'bounds', row: i };
    state = applyStop(layout, state, clean[i], start);
  }
  if (!state.over) return { ok: false, reason: 'unfinished' };

  const durationMs = clean[clean.length - 1];
  if (typeof options.sinceStartMs === 'number') {
    if (options.sinceStartMs + STACKER_SESSION_SLACK_MS < durationMs) {
      return { ok: false, reason: 'too-fast' };
    }
    if (options.sinceStartMs > durationMs + STACKER_MAX_SUBMIT_DELAY_MS) {
      return { ok: false, reason: 'stale' };
    }
  }

  return {
    ok: true,
    rows: state.rows,
    perfects: state.perfects,
    results: state.results,
    prize: stackerPrizeTickets(state.rows),
    durationMs,
  };
}

// ---------------------------------------------------------------------------
// Play that no hand produces (server, over a player's recent runs)
// ---------------------------------------------------------------------------

/** One stored run, as stack_cabinet_runs keeps it. */
export type StackerRunSummary = { rows: number; phases: readonly number[] };

/** Runs the check looks back over, newest included. */
export const STACKER_PLAY_WINDOW = 50;
/**
 * Only stops on rows this fast or faster go into the offset check. On a
 * slow row a careful hand can land near the same point of a step again and
 * again; on these rows 10 ms of timing noise (sharper than any player the
 * verifier models) spreads the stops to R under 0.6.
 */
export const STACKER_PHASE_MAX_STEP_MS = 81;
/** Stops landing at the same point inside their step, run after run: R
 *  above this over at least STACKER_PHASE_MIN_STOPS stops is flagged and
 *  goes into the anti-cheat's escalation. 0.9 means under 3 ms of noise on a
 *  50 ms step. */
export const STACKER_PHASE_R_MAX = 0.9;
export const STACKER_PHASE_MIN_STOPS = 30;
/** Majors are tested against a player who reaches row 15 this often at best
 *  (the verifier's sharpest human, rounded up). Logged for review when that
 *  player would win this many majors less often than ALPHA. Never counted
 *  toward a ban: very good honest players can get there. */
export const STACKER_MAJOR_P0 = 0.6;
export const STACKER_MAJOR_ALPHA = 1e-6;
export const STACKER_MAJOR_MIN_RUNS = 20;
/** A run whose stops all share a factor this large came from a rounded
 *  clock; its in-step points say nothing about a hand. */
export const STACKER_COARSE_CLOCK_MS = 16;

export type StackerPlayCheck = {
  runs: number;
  majorRate: number;
  phaseR: number;
  stops: number;
  /** Stops at the same point in their step: a flag that escalates. */
  flag: string | null;
  /** Too many majors: logged for a person to review, never a ban. */
  review: string | null;
};

/** P(X >= k) for X ~ Binomial(n, p). Exact; n is at most the window. */
export function stackerBinomialTail(n: number, k: number, p: number): number {
  if (k <= 0) return 1;
  if (k > n) return 0;
  let term = Math.pow(1 - p, n);
  let tail = 0;
  for (let i = 0; i <= n; i += 1) {
    if (i >= k) tail += term;
    term *= ((n - i) / (i + 1)) * (p / (1 - p));
  }
  return Math.min(1, tail);
}

const gcd = (a: number, b: number): number => (b === 0 ? Math.abs(a) : gcd(b, a % b));

/** The in-step points a run adds to the offset check: its stops on fast
 *  rows, and none when its stops came from a rounded clock. */
export function stackerCheckPhases(results: readonly StackerRowResult[]): number[] {
  const factor = results.reduce((acc, r) => gcd(acc, Math.round(r.stopMs)), 0);
  if (factor >= STACKER_COARSE_CLOCK_MS) return [];
  return results
    .filter((r) => STACKER_ROW_RULES[r.row].stepMs <= STACKER_PHASE_MAX_STEP_MS)
    .map((r) => Math.round(r.phase * 1000) / 1000);
}

/** Circular concentration of phases in [0, 1): 1 when they all agree. */
export function stackerPhaseConcentration(phases: readonly number[]): number {
  if (phases.length === 0) return 0;
  let x = 0;
  let y = 0;
  for (const phase of phases) {
    x += Math.cos(phase * TAU);
    y += Math.sin(phase * TAU);
  }
  return Math.hypot(x, y) / phases.length;
}

/**
 * Look at a player's recent runs (oldest first, this run last). `flag`
 * (stops at the same point in their step, which only a machine does) feeds
 * the anti-cheat's flag escalation. `review` (more majors than the best
 * honest player wins once in a million) is only logged.
 */
export function stackerPlayCheck(history: readonly StackerRunSummary[]): StackerPlayCheck {
  const recent = history.slice(-STACKER_PLAY_WINDOW);
  const runs = recent.length;
  const majors = recent.filter((run) => run.rows >= STACKER_MAJOR_ROW).length;
  const majorRate = runs === 0 ? 0 : majors / runs;
  const phases = recent.flatMap((run) => run.phases);
  const phaseR = stackerPhaseConcentration(phases);
  const flag =
    phases.length >= STACKER_PHASE_MIN_STOPS && phaseR > STACKER_PHASE_R_MAX
      ? `Stops land at the same point in their step (R ${phaseR.toFixed(2)} over ${phases.length} stops)`
      : null;
  const review =
    runs >= STACKER_MAJOR_MIN_RUNS &&
    stackerBinomialTail(runs, majors, STACKER_MAJOR_P0) < STACKER_MAJOR_ALPHA
      ? `Row 15 in ${majors} of the last ${runs} runs`
      : null;
  return { runs, majorRate, phaseR, stops: phases.length, flag, review };
}
