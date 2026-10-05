/**
 * Ticket stop: rules, engine and validator. Pure TypeScript, no React, no DOM,
 * no Date.now(), no Math.random(). The client draws from it and the score
 * route replays with it, so both always agree.
 *
 * The machine: a ring of 28 bulbs. One light chases round the ring, one bulb
 * at a time, on a fixed step clock. A window of bulbs is lit in ticket amber.
 * Press the button to stop the light. Three rounds; each is faster than the
 * last and rounds 2 and 3 have a narrower window. Points come from how many
 * bulbs the light stopped from the window's centre.
 *
 * Timing model (why phones at 60 and 120 Hz score the same):
 *  - Everything is a function of elapsed time since the run began, in whole
 *    milliseconds. Nothing counts frames. A frame only samples the state.
 *  - A stop is the input event's own timestamp (`event.timeStamp`), not the
 *    time the frame was drawn or the handler ran, so a slow or fast display
 *    changes when you see a bulb change, never which bulb a stop lands on.
 *  - The light moves in whole bulbs. The fastest step is 38 ms, longer than
 *    one frame at 30 Hz (33.3 ms), so every bulb is on screen for at least one
 *    frame at every refresh rate the verifier samples (30, 60, 120, 144 Hz).
 *  - Reduced motion only drops the trail behind the light. The light's
 *    position, the window and every number are the same.
 *
 * Fairness across seeds: the seed only turns the picture. It picks where
 * each window sits and which way the light runs. The light always starts
 * opposite the window, and speeds and widths are fixed per round, so every
 * seed is exactly as hard as every other and a player gains nothing by
 * starting a run over until a seed looks easy.
 *
 * The run's timeline, from t = 0 (the run's first input):
 *  - Round 1 starts at LEAD_IN_MS.
 *  - Round r+1 starts ROUND_GAP_MS after the stop that ended round r.
 *  - A press earlier than ARM_MS into a round is ignored by the client (the
 *    button is not armed yet), so an honest run never sends one. The server
 *    rejects a run that has one.
 *  - The run ends on the third stop. There is no time limit inside a round;
 *    the light keeps going until you stop it (bounded by MAX_ROUND_MS for
 *    the validator).
 */

const TAU = Math.PI * 2;

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

/** Bulbs in the ring. Matches the approved mockup (art.stop). */
export const TICKET_STOP_BULBS = 28;

export type TicketStopRoundRule = {
  /** Time the light spends on each bulb, ms. */
  stepMs: number;
  /** Window half-width in bulbs: the window is 2 * reach + 1 bulbs. */
  reach: number;
  /** Points by distance from the centre: points[0] is the centre bulb. */
  points: readonly number[];
};

/** Three rounds: each faster than the last, rounds 2 and 3 narrower. */
export const TICKET_STOP_ROUNDS: readonly TicketStopRoundRule[] = [
  { stepMs: 60, reach: 2, points: [100, 40, 10] },
  { stepMs: 48, reach: 1, points: [100, 40] },
  { stepMs: 38, reach: 1, points: [100, 40] },
];

export const TICKET_STOP_ROUND_COUNT = TICKET_STOP_ROUNDS.length;

/** From the run's first input to round 1's light moving, ms. */
export const TICKET_STOP_LEAD_IN_MS = 700;
/** From a stop to the next round's light moving, ms. */
export const TICKET_STOP_ROUND_GAP_MS = 1100;
/** Of the gap, how long the stopped light and its points stay up before the
 *  next round's window lights, ms. */
export const TICKET_STOP_RESULT_HOLD_MS = 650;
/** A round's button arms this long after its light starts moving, ms. */
export const TICKET_STOP_ARM_MS = 150;
/** The validator's bound on one round, ms. A real round never gets near it. */
export const TICKET_STOP_MAX_ROUND_MS = 600_000;
/** How long the last stop holds before the result strip, ms (client only). */
export const TICKET_STOP_END_HOLD_MS = 900;

/** Best possible run. */
export const TICKET_STOP_MAX_SCORE = TICKET_STOP_ROUNDS.reduce(
  (sum, round) => sum + round.points[0],
  0,
);

/** Tickets: the server's saturating curve (rewards/wallet.ts) takes
 *  score / this divisor, like every other quick game. 300 is the best run,
 *  so a perfect run pays 47 and a good one (about 180) pays 32. A run lasts
 *  seconds, so this sits below the other quick games' mid-curve payout and
 *  ticket stop isn't the fastest way to the daily cap. Distribution in
 *  scripts/verify-ticket-stop-replay.ts. */
export const TICKET_STOP_REWARD_DIVISOR = 300;

// ---------------------------------------------------------------------------
// Seeded layout
// ---------------------------------------------------------------------------

/** mulberry32, byte-identical to tumbler-replay and the other seeded games. */
function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function rngForRound(seed: number, round: number): () => number {
  let mixed = (seed ^ Math.imul(round + 1, 0x9e3779b1)) | 0;
  mixed = (mixed + 0x6d2b79f5) | 0;
  return mulberry32(mixed);
}

const mod = (value: number, n: number) => ((value % n) + n) % n;

export type TicketStopRound = TicketStopRoundRule & {
  index: number;
  /** The window's centre bulb. */
  centre: number;
  /** +1 clockwise, -1 anticlockwise. */
  dir: 1 | -1;
  /** Where the light waits before the round starts: opposite the centre. */
  start: number;
};

export type TicketStopLayout = {
  seed: number;
  rounds: readonly TicketStopRound[];
};

/** The run's three rounds for a seed. Draw order is fixed: centre, then
 *  direction. Never reorder, or client and server diverge. */
export function ticketStopLayout(seed: number): TicketStopLayout {
  const safeSeed = seed | 0;
  const rounds = TICKET_STOP_ROUNDS.map((rule, index) => {
    const rng = rngForRound(safeSeed, index);
    const centre = Math.floor(rng() * TICKET_STOP_BULBS) % TICKET_STOP_BULBS;
    const dir: 1 | -1 = rng() < 0.5 ? 1 : -1;
    const start = mod(centre + TICKET_STOP_BULBS / 2, TICKET_STOP_BULBS);
    return { ...rule, index, centre, dir, start };
  });
  return { seed: safeSeed, rounds };
}

/** Angle of a bulb on screen, radians, bulb 0 at the top, clockwise. */
export function ticketStopBulbAngle(bulb: number): number {
  return (bulb / TICKET_STOP_BULBS) * TAU - Math.PI / 2;
}

/** Shortest distance between two bulbs round the ring. */
export function ticketStopBulbDistance(a: number, b: number): number {
  const d = Math.abs(mod(a, TICKET_STOP_BULBS) - mod(b, TICKET_STOP_BULBS));
  return Math.min(d, TICKET_STOP_BULBS - d);
}

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------

/** When round `index`'s light starts moving, given the stops so far. */
export function ticketStopRoundStart(stops: readonly number[], index: number): number {
  if (index <= 0) return TICKET_STOP_LEAD_IN_MS;
  return stops[index - 1] + TICKET_STOP_ROUND_GAP_MS;
}

/** Whole steps the light has taken `elapsedMs` into a round. */
export function ticketStopStepsAt(round: TicketStopRoundRule, elapsedMs: number): number {
  if (!(elapsedMs > 0)) return 0;
  return Math.floor(elapsedMs / round.stepMs);
}

/** The bulb the light is on `elapsedMs` into a round. */
export function ticketStopBulbAt(round: TicketStopRound, elapsedMs: number): number {
  return mod(round.start + round.dir * ticketStopStepsAt(round, elapsedMs), TICKET_STOP_BULBS);
}

export type TicketStopRoundResult = {
  round: number;
  /** Stop time, ms since the run began. */
  stopMs: number;
  /** Bulb the light stopped on. */
  bulb: number;
  /** Bulbs from the window's centre. */
  distance: number;
  /** Inside the window. */
  inWindow: boolean;
  perfect: boolean;
  points: number;
  /** Where in its bulb the stop landed, 0 (the bulb just lit) to 1. */
  phase: number;
};

/** Score one stop. */
export function ticketStopResolve(
  round: TicketStopRound,
  roundStartMs: number,
  stopMs: number,
): TicketStopRoundResult {
  const elapsed = stopMs - roundStartMs;
  const bulb = ticketStopBulbAt(round, elapsed);
  const distance = ticketStopBulbDistance(bulb, round.centre);
  const inWindow = distance <= round.reach;
  const points = inWindow ? round.points[distance] ?? 0 : 0;
  return {
    round: round.index,
    stopMs,
    bulb,
    distance,
    inWindow,
    perfect: distance === 0,
    points,
    phase: elapsed > 0 ? mod(elapsed, round.stepMs) / round.stepMs : 0,
  };
}

// ---------------------------------------------------------------------------
// Drawing ahead (client)
// ---------------------------------------------------------------------------

/**
 * How far ahead of the frame's timestamp to draw, ms. A frame drawn at time
 * t reaches the screen about one frame interval later, so drawing the light
 * for t + interval makes what is on screen match the clock a press is
 * stamped with. Without it, a 30 Hz screen shows the light 50 ms late on
 * average and a 120 Hz one 12.5 ms late (verify-ticket-stop-replay).
 * Drawing only: scoring never reads it.
 */
export function ticketStopDisplayLeadMs(frameIntervalMs: number): number {
  if (!Number.isFinite(frameIntervalMs) || frameIntervalMs <= 0) return 1000 / 60;
  return Math.min(50, Math.max(4, frameIntervalMs));
}

// ---------------------------------------------------------------------------
// Taking a press (client)
// ---------------------------------------------------------------------------

export type TicketStopPress =
  | { kind: 'stop'; result: TicketStopRoundResult }
  /** Before the button arms (lead-in, a gap, or the first ARM_MS of a round),
   *  or after the third stop. Nothing is recorded. */
  | { kind: 'ignored'; reason: 'not-armed' | 'over' };

/**
 * What a press at `atMs` (ms since the run began, whole ms) does. The client
 * records `atMs` only when this says `stop`, so it only ever sends stops the
 * validator accepts.
 */
export function ticketStopPress(
  layout: TicketStopLayout,
  stops: readonly number[],
  atMs: number,
): TicketStopPress {
  const index = stops.length;
  if (index >= layout.rounds.length) return { kind: 'ignored', reason: 'over' };
  const start = ticketStopRoundStart(stops, index);
  if (!Number.isFinite(atMs) || atMs < start + TICKET_STOP_ARM_MS) {
    return { kind: 'ignored', reason: 'not-armed' };
  }
  return { kind: 'stop', result: ticketStopResolve(layout.rounds[index], start, atMs) };
}

/** Whole milliseconds since the run began, from an input event's timestamp
 *  and the run's start on the same clock. */
export function ticketStopInputMs(eventTimeMs: number, runStartMs: number): number {
  return Math.round(eventTimeMs - runStartMs);
}

// ---------------------------------------------------------------------------
// What to draw at a moment (client)
// ---------------------------------------------------------------------------

export type TicketStopView = {
  /** lead-in: the window is lit and the light waits. chase: the light runs.
   *  result: a stopped light and its points. done: the third stop is in. */
  phase: 'lead-in' | 'chase' | 'result' | 'done';
  /** The round on screen. */
  round: number;
  /** The bulb the light is on. */
  bulb: number;
  /** The window on screen. */
  centre: number;
  reach: number;
  /** Bulbs behind the light, newest first, with brightness 0 to 1. Empty
   *  under reduced motion and whenever the light is still. */
  trail: ReadonlyArray<{ bulb: number; glow: number }>;
  /** The button can stop the light now. */
  armed: boolean;
  /** The result on screen (phase result or done). */
  result: TicketStopRoundResult | null;
  /** ms since the result on screen landed, or since the round started. */
  sinceMs: number;
};

const TRAIL_GLOWS = [0.42, 0.18] as const;

/**
 * The machine at `tMs` since the run began, given the stops so far. A pure
 * function of elapsed time: draw whatever this returns, at any frame rate.
 */
export function ticketStopView(
  layout: TicketStopLayout,
  stops: readonly number[],
  tMs: number,
  options: { reducedMotion?: boolean } = {},
): TicketStopView {
  const results = ticketStopResults(layout, stops);
  const last = results[results.length - 1] ?? null;
  const roundCount = layout.rounds.length;

  if (results.length >= roundCount && last) {
    const round = layout.rounds[last.round];
    return {
      phase: 'done',
      round: last.round,
      bulb: last.bulb,
      centre: round.centre,
      reach: round.reach,
      trail: [],
      armed: false,
      result: last,
      sinceMs: Math.max(0, tMs - last.stopMs),
    };
  }

  const index = results.length;
  const round = layout.rounds[index];
  const start = ticketStopRoundStart(stops, index);

  if (last && tMs < last.stopMs + TICKET_STOP_RESULT_HOLD_MS) {
    const previous = layout.rounds[last.round];
    return {
      phase: 'result',
      round: last.round,
      bulb: last.bulb,
      centre: previous.centre,
      reach: previous.reach,
      trail: [],
      armed: false,
      result: last,
      sinceMs: Math.max(0, tMs - last.stopMs),
    };
  }

  if (tMs < start) {
    return {
      phase: 'lead-in',
      round: index,
      bulb: round.start,
      centre: round.centre,
      reach: round.reach,
      trail: [],
      armed: false,
      result: null,
      sinceMs: tMs - start,
    };
  }

  const elapsed = tMs - start;
  const steps = ticketStopStepsAt(round, elapsed);
  const trail: Array<{ bulb: number; glow: number }> = [];
  if (!options.reducedMotion) {
    for (let i = 0; i < TRAIL_GLOWS.length && i < steps; i += 1) {
      trail.push({
        bulb: mod(round.start + round.dir * (steps - 1 - i), TICKET_STOP_BULBS),
        glow: TRAIL_GLOWS[i],
      });
    }
  }
  return {
    phase: 'chase',
    round: index,
    bulb: mod(round.start + round.dir * steps, TICKET_STOP_BULBS),
    centre: round.centre,
    reach: round.reach,
    trail,
    armed: elapsed >= TICKET_STOP_ARM_MS,
    result: null,
    sinceMs: elapsed,
  };
}

/** Results for the stops so far, in order. Assumes the stops came through
 *  `ticketStopPress`; use `scoreTicketStopRun` for untrusted input. */
export function ticketStopResults(
  layout: TicketStopLayout,
  stops: readonly number[],
): TicketStopRoundResult[] {
  const results: TicketStopRoundResult[] = [];
  for (let i = 0; i < stops.length && i < layout.rounds.length; i += 1) {
    results.push(ticketStopResolve(layout.rounds[i], ticketStopRoundStart(stops, i), stops[i]));
  }
  return results;
}

// ---------------------------------------------------------------------------
// Validation (server)
// ---------------------------------------------------------------------------

export type TicketStopRejection =
  /** Not an array, or not exactly three stops. */
  | 'count'
  /** A stop that is not a whole, finite, non-negative number of ms. */
  | 'malformed'
  /** A stop before its round's button armed: before the round started, or
   *  inside its first ARM_MS. An honest client never sends one. */
  | 'early'
  /** A round longer than MAX_ROUND_MS. */
  | 'bounds'
  /** The run's timeline is longer than the time since the server stamped
   *  its start: it was submitted faster than it could be played. */
  | 'too-fast'
  /** Submitted long after the run's timeline ended. */
  | 'stale';

export type TicketStopRun =
  | {
      ok: true;
      rounds: TicketStopRoundResult[];
      score: number;
      perfects: number;
      /** ms from the run's first input to the third stop. */
      durationMs: number;
    }
  | { ok: false; reason: TicketStopRejection; round?: number };

/** Slack for the start-stamp check. The client starts its clock only once
 *  the server has stamped the start, so an honest run always has more server
 *  time than timeline; this covers clock rounding. */
export const TICKET_STOP_SESSION_SLACK_MS = 250;
/** How long after its last stop a run may be submitted. The client posts at
 *  once; this covers a slow network. */
export const TICKET_STOP_MAX_SUBMIT_DELAY_MS = 120_000;

/**
 * Recompute a run from the seed and the submitted stop times, rejecting
 * anything an honest client cannot send. Never throws.
 */
export function scoreTicketStopRun(
  seed: number,
  stops: unknown,
  /** `sinceStartMs`: server ms from the run's start stamp to the submit. */
  options: { sinceStartMs?: number } = {},
): TicketStopRun {
  if (!Array.isArray(stops) || stops.length !== TICKET_STOP_ROUND_COUNT) {
    return { ok: false, reason: 'count' };
  }
  const clean: number[] = [];
  for (let i = 0; i < stops.length; i += 1) {
    const value = stops[i];
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
      return { ok: false, reason: 'malformed', round: i };
    }
    clean.push(value);
  }

  const layout = ticketStopLayout(seed);
  const rounds: TicketStopRoundResult[] = [];
  for (let i = 0; i < clean.length; i += 1) {
    const start = ticketStopRoundStart(clean, i);
    if (clean[i] < start + TICKET_STOP_ARM_MS) {
      return { ok: false, reason: 'early', round: i };
    }
    if (clean[i] - start > TICKET_STOP_MAX_ROUND_MS) {
      return { ok: false, reason: 'bounds', round: i };
    }
    rounds.push(ticketStopResolve(layout.rounds[i], start, clean[i]));
  }

  const durationMs = clean[clean.length - 1];
  if (typeof options.sinceStartMs === 'number') {
    if (options.sinceStartMs + TICKET_STOP_SESSION_SLACK_MS < durationMs) {
      return { ok: false, reason: 'too-fast' };
    }
    if (options.sinceStartMs > durationMs + TICKET_STOP_MAX_SUBMIT_DELAY_MS) {
      return { ok: false, reason: 'stale' };
    }
  }

  return {
    ok: true,
    rounds,
    score: rounds.reduce((sum, round) => sum + round.points, 0),
    perfects: rounds.filter((round) => round.perfect).length,
    durationMs,
  };
}

/** The earliest a light can reach its window's centre after its round
 *  starts, ms: half a lap of steps. */
export function ticketStopFirstCentreMs(round: TicketStopRoundRule): number {
  return (TICKET_STOP_BULBS / 2) * round.stepMs;
}

// ---------------------------------------------------------------------------
// Play that no hand produces (server, over a player's recent runs)
// ---------------------------------------------------------------------------

/** One stored run, as ticket_stop_runs keeps it. */
export type TicketStopRunSummary = { perfects: number; phases: readonly number[] };

/** Runs the check looks back over, newest included. */
export const TICKET_STOP_PLAY_WINDOW = 50;
/** Three-center runs are tested against a player who gets them this often
 *  at best. A player with 20 ms of timing noise and no bias at all makes
 *  44%; real players drift, and the simulated sharp level averages 31%. */
export const TICKET_STOP_PERFECT_P0 = 0.45;
/** Log for review when that best player would get this many three-center runs less
 *  often than this: one in a million. At 20 runs that is 20 of 20, at 50 it
 *  is about 40 of 50. */
export const TICKET_STOP_PERFECT_ALPHA = 1e-6;
export const TICKET_STOP_PERFECT_MIN_RUNS = 20;
/** Stops landing at the same point inside their bulb, run after run. The
 *  phases' circular concentration R is 1 for a fixed offset and about
 *  0.1 for 20 to 80 ms of human timing noise; R above this, over at least
 *  TICKET_STOP_PHASE_MIN_RUNS, is flagged. 0.9 means under 3 ms of noise. */
export const TICKET_STOP_PHASE_R_MAX = 0.9;
export const TICKET_STOP_PHASE_MIN_RUNS = 10;
// (Counted in stops: 10 runs' worth, 30, from runs on a fine clock.)

export type TicketStopPlayCheck = {
  runs: number;
  perfectRate: number;
  phaseR: number;
  /** Stops at the same point in their bulb: a flag that escalates. */
  flag: string | null;
  /** Too many three-center runs: logged for a person to review, never
   *  counted toward a ban. Very good honest players can get here. */
  review: string | null;
};

/** P(X >= k) for X ~ Binomial(n, p). Exact; n is at most the window. */
export function binomialTail(n: number, k: number, p: number): number {
  if (k <= 0) return 1;
  if (k > n) return 0;
  let term = Math.pow(1 - p, n); // P(X = 0)
  let tail = 0;
  for (let i = 0; i <= n; i += 1) {
    if (i >= k) tail += term;
    term *= ((n - i) / (i + 1)) * (p / (1 - p));
  }
  return Math.min(1, tail);
}

/** A run whose stops all share a factor this large came from a rounded
 *  clock (Firefox's resist-fingerprinting rounds to 100 ms, some browsers
 *  to 20 or 50). Its in-bulb points say nothing about a hand, so the
 *  offset check leaves them out. A 1 ms clock gets here 1 run in 4,096. */
export const TICKET_STOP_COARSE_CLOCK_MS = 16;

const gcd = (a: number, b: number): number => (b === 0 ? Math.abs(a) : gcd(b, a % b));

/** The in-bulb points a run contributes to the offset check: none when its
 *  stops came from a rounded clock. */
export function ticketStopCheckPhases(rounds: readonly TicketStopRoundResult[]): number[] {
  const factor = rounds.reduce((acc, round) => gcd(acc, Math.round(round.stopMs)), 0);
  if (factor >= TICKET_STOP_COARSE_CLOCK_MS) return [];
  return rounds.map((round) => round.phase);
}

/** Circular concentration of phases in [0, 1): 1 when they all agree. */
export function ticketStopPhaseConcentration(phases: readonly number[]): number {
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
 * Look at a player's recent runs (oldest first, this run last) for play no
 * hand produces. `flag` (stops landing at the same point in their bulb,
 * which only a machine does) feeds the anti-cheat's flag escalation.
 * `review` (more three-center runs than a 45% player would get once in a
 * million times) is only logged: at 10 to 12 ms of timing noise an honest
 * player can get there, and a ban would hit them on every run after.
 */
export function ticketStopPlayCheck(history: readonly TicketStopRunSummary[]): TicketStopPlayCheck {
  const recent = history.slice(-TICKET_STOP_PLAY_WINDOW);
  const runs = recent.length;
  const threeCenter = recent.filter((run) => run.perfects >= TICKET_STOP_ROUND_COUNT).length;
  const perfectRate = runs === 0 ? 0 : threeCenter / runs;
  const phases = recent.flatMap((run) => run.phases);
  const phaseR = ticketStopPhaseConcentration(phases);
  const flag =
    phases.length >= TICKET_STOP_PHASE_MIN_RUNS * TICKET_STOP_ROUND_COUNT &&
    phaseR > TICKET_STOP_PHASE_R_MAX
      ? `Stops land at the same point in their bulb (R ${phaseR.toFixed(2)} over ${runs} runs)`
      : null;
  const review =
    runs >= TICKET_STOP_PERFECT_MIN_RUNS &&
    binomialTail(runs, threeCenter, TICKET_STOP_PERFECT_P0) < TICKET_STOP_PERFECT_ALPHA
      ? `Three center stops in ${threeCenter} of the last ${runs} runs`
      : null;
  return { runs, perfectRate, phaseR, flag, review };
}
