/**
 * High striker, rules version 3: the endless tower. Pure and deterministic,
 * the one source of truth for the client (which draws the wind-up and judges
 * each release at once) and the score route (which replays every swing).
 *
 * The move: hold to wind up, let go to swing. Each swing's gauge is a pure
 * function of the time held: a triangle from empty to full and back, at a
 * seeded speed. Let go while the gauge is over the swing's line and the puck
 * clears it (a hit); let go in the band at the very top and it rings the bell
 * (a perfect strike). Let go under the line, early or late, and the run ends.
 *
 * The line and the bell band are set as TIME windows around the gauge's peak,
 * so the skill is exact: a swing's hit window is `windowMs` wide and its bell
 * window `bellWindowMs` wide, both centred on the peak. The gauge's speed sets
 * where those windows sit on the tower (line = 1 - freq * windowMs / 1000).
 *
 * The curve (docs/design/tixy-rebrand/HIGH_STRIKER.md has the table):
 *  - the hit window narrows from 260 ms toward 56 ms (tau 30 swings),
 *  - the bell window narrows from 48 ms toward 22 ms (tau 40 swings),
 *  - the gauge speeds up from 0.6 toward 1.3 sweeps a second (tau 30), so the
 *    peak comes sooner (833 ms, toward 385 ms),
 *  - each swing's speed is offset by a seeded amount that grows from 4% to
 *    14%, so the peak can't be counted, only watched.
 * Every quantity is a smooth exponential in the swing index: no walls.
 *
 * Scoring: a hit pays 1 and breaks the bell streak. A bell pays 3, plus 1 for
 * every bell before it in the streak, up to 8. The run ends on the first miss
 * (no spare: see the doc), or after STRIKER_MAX_SWINGS hits, where the tower
 * tops out.
 *
 * Anti-cheat model (single POST, like ticket stop):
 *  - The score is recomputed by replaying the recorded holds through the same
 *    state machine the client ran (`strikerApplySwing`). The client sends only
 *    each hold's length `t` (release minus press, the two events' own
 *    timestamps, so frame rate never enters); the server derives the strength.
 *  - A run is saved only COMPLETE: every swing a hit until the one miss that
 *    ends it (or the top), and nothing after. A tap (a hold under
 *    STRIKER_MIN_HOLD_MS) is never a swing, so the client never sends one, and
 *    one in a payload is rejected.
 *  - What a replay can't see, a program sending valid holds, is checked by the
 *    spread of the holds' offsets from each swing's peak (`strikerPlayCheck`).
 *
 * Everything here is pure: no Date.now(), no Math.random(), no I/O.
 */

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

/** Rules version a run is saved under. 1 was the unbounded run with an easy
 *  line, 2 the five-swing run. */
export const STRIKER_RULES_VERSION = 3;

/** Gauge speed in full up-and-down sweeps a second: the first swing's, the
 *  speed it tends to, and how many swings it takes to cover 63% of the way. */
export const STRIKER_SPEED_START = 0.6;
export const STRIKER_SPEED_END = 1.3;
export const STRIKER_SPEED_TAU = 30;

/** Seeded speed offset, as a fraction either way: the first swing's, the
 *  limit, and the time constant. */
export const STRIKER_JITTER_START = 0.04;
export const STRIKER_JITTER_END = 0.14;
export const STRIKER_JITTER_TAU = 25;

/** The hit window, ms, centred on the gauge's peak. */
export const STRIKER_WINDOW_START_MS = 260;
export const STRIKER_WINDOW_END_MS = 56;
export const STRIKER_WINDOW_TAU = 30;

/** The bell window, ms, centred on the peak (inside the hit window). */
export const STRIKER_BELL_WINDOW_START_MS = 48;
export const STRIKER_BELL_WINDOW_END_MS = 22;
export const STRIKER_BELL_WINDOW_TAU = 40;

/** Points: a hit, a bell, the bell's step per bell already in the streak, and
 *  how many steps the streak can add. */
export const STRIKER_POINTS_HIT = 1;
export const STRIKER_POINTS_BELL = 3;
export const STRIKER_BELL_STREAK_STEP = 1;
export const STRIKER_BELL_STREAK_CAP = 5;

/** The most a single swing can pay. */
export const STRIKER_MAX_POINTS_PER_SWING =
  STRIKER_POINTS_BELL + STRIKER_BELL_STREAK_STEP * STRIKER_BELL_STREAK_CAP;

/** The tower tops out: a run ends after this many hits. Far past any human
 *  run (an expert simulated hand's p90 is under 150); it bounds the payload. */
export const STRIKER_MAX_SWINGS = 300;

/** Absolute ceiling on one run's score. */
export const STRIKER_MAX_SCORE = STRIKER_MAX_SWINGS * STRIKER_MAX_POINTS_PER_SWING;

/** A hold shorter than this is a tap: not a swing, never counted, never sent.
 *  The earliest any hit window opens is about 310 ms (the fastest seeded
 *  gauge's peak, less half its window), so nothing is lost. */
export const STRIKER_MIN_HOLD_MS = 200;

/** A hold longer than this is malformed. The client lets go for you once the
 *  gauge falls back under the line, so a real hold never comes near it. */
export const STRIKER_MAX_HOLD_MS = 5_000;

/** The client lets go for you this long after the hit window closes (the
 *  fill has dropped visibly under the line). A swing then is a miss on both
 *  sides, whatever `t` it carries. */
export const STRIKER_LATE_GRACE_MS = 70;

/** The reward curve: tickets = 75 * (1 - exp(-(score / DIVISOR) ^ POWER)).
 *  The power is steeper than the shared 1.15 so a minute pays more as timing
 *  gets better up to a good player (a short casual run would otherwise out-earn
 *  a good one a minute); the divisor is solved so a good player earns about
 *  46 tickets a minute. Both in scripts/verify-high-striker-replay.ts. */
export const STRIKER_REWARD_DIVISOR = 49;
export const STRIKER_REWARD_POWER = 1.4;

// ---------------------------------------------------------------------------
// Presentation timings both sides share. The server never reads them, but the
// reward curve is priced per minute of play, so the verifier does.
// ---------------------------------------------------------------------------

/** A hit short of the bell is a near miss for it when it lands within this
 *  many bell windows of the peak (so within half a bell window of the band).
 *  Relative to the swing, because every hit is high on the tower now. */
export const STRIKER_NEAR_BELL_WINDOWS = 1;

/** The mallet's drop from a light draw and from a full draw (ms). */
export const STRIKER_DROP_MS_MIN = 55;
export const STRIKER_DROP_MS_MAX = 100;

export type StrikerPuckKind = 'weak' | 'normal' | 'near' | 'bell';

export function strikerPuckKind(hit: boolean, bell: boolean, near: boolean): StrikerPuckKind {
  if (!hit) return 'weak';
  if (bell) return 'bell';
  return near ? 'near' : 'normal';
}

/**
 * The puck's flight. Rise time grows with the height it climbs to, and `power`
 * sets how hard it slows toward the top: 2 is gravity, more is a creep. The
 * bell creeps the most. Shorter than rules 2's: an endless run is many swings.
 */
export function strikerFlightTimes(kind: StrikerPuckKind, strength: number) {
  const s = clamp01(strength);
  if (kind === 'bell') return { riseMs: 900, power: 3.2, holdMs: 420, downMs: 300 + 300 * s };
  if (kind === 'near') return { riseMs: 760, power: 2.8, holdMs: 160, downMs: 260 + 300 * s };
  if (kind === 'weak') return { riseMs: 260 + 360 * s, power: 2, holdMs: 60, downMs: 240 + 260 * s };
  return { riseMs: 320 + 420 * s, power: 2, holdMs: 110, downMs: 260 + 300 * s };
}

// ---------------------------------------------------------------------------
// PRNG: mulberry32, byte-identical to the repo's seededRandom.
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

/** A stable per-swing RNG from (seed, index), so swing N is O(1) and pure. */
function rngForIndex(seed: number, index: number): () => number {
  let mixed = (seed ^ Math.imul(index + 1, 0x9e3779b1)) | 0;
  mixed = (mixed + 0x6d2b79f5) | 0;
  return mulberry32(mixed);
}

/** Triangle wave in [0, 1]: 0 at x=0, 1 at x=0.5, 0 at x=1. */
function tri(x: number): number {
  const f = x - Math.floor(x);
  return 1 - Math.abs(2 * f - 1);
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** `start` easing toward `end`, 63% of the way after `tau` swings. */
function curve(start: number, end: number, tau: number, index: number): number {
  return end + (start - end) * Math.exp(-index / tau);
}

// ---------------------------------------------------------------------------
// The difficulty curve
// ---------------------------------------------------------------------------

const safeIndex = (index: number) => (index > 0 && Number.isFinite(index) ? Math.floor(index) : 0);

/** The gauge's base speed for swing `index`, before the seeded offset. */
export const strikerBaseSpeed = (index: number) =>
  curve(STRIKER_SPEED_START, STRIKER_SPEED_END, STRIKER_SPEED_TAU, safeIndex(index));

/** How far either way the seeded offset can move swing `index`'s speed. */
export const strikerJitterFor = (index: number) =>
  curve(STRIKER_JITTER_START, STRIKER_JITTER_END, STRIKER_JITTER_TAU, safeIndex(index));

/** Swing `index`'s hit window, ms. */
export const strikerWindowFor = (index: number) =>
  curve(STRIKER_WINDOW_START_MS, STRIKER_WINDOW_END_MS, STRIKER_WINDOW_TAU, safeIndex(index));

/** Swing `index`'s bell window, ms. */
export const strikerBellWindowFor = (index: number) =>
  curve(STRIKER_BELL_WINDOW_START_MS, STRIKER_BELL_WINDOW_END_MS, STRIKER_BELL_WINDOW_TAU, safeIndex(index));

export interface StrikerRound {
  /** 0-based swing index: the depth. */
  index: number;
  /** Gauge speed, full up-and-down sweeps a second. */
  freq: number;
  /** ms from the press to the gauge's peak. */
  peakMs: number;
  /** The hit window and the bell window, ms, both centred on the peak. */
  windowMs: number;
  bellWindowMs: number;
  /** The line: a release at or over this strength is a hit. */
  qualifier: number;
  /** The bell band's floor: at or over this strength rings the bell. */
  bellLine: number;
  /** The hit window's edges, ms since the press. */
  earlyMs: number;
  lateMs: number;
}

/**
 * Swing `index` of the run seeded `seed`. Identical on the client and the
 * server. One RNG draw (the speed offset); never reorder or add draws without
 * a new rules version.
 */
export function strikerRoundFor(seed: number, index: number): StrikerRound {
  const i = safeIndex(index);
  const rng = rngForIndex(seed | 0, i);
  const offset = (rng() * 2 - 1) * strikerJitterFor(i);
  const freq = strikerBaseSpeed(i) * (1 + offset);
  const peakMs = 500 / freq;
  const windowMs = strikerWindowFor(i);
  const bellWindowMs = strikerBellWindowFor(i);
  return {
    index: i,
    freq,
    peakMs,
    windowMs,
    bellWindowMs,
    qualifier: 1 - (freq * windowMs) / 1000,
    bellLine: 1 - (freq * bellWindowMs) / 1000,
    earlyMs: peakMs - windowMs / 2,
    lateMs: peakMs + windowMs / 2,
  };
}

/**
 * The gauge at `tMs` since the press: up from empty to the peak and back
 * down, once. After one full sweep it stays empty (the client has let go long
 * before then). Exposed so the client draws exactly what is judged.
 */
export function strikerGaugeValue(round: StrikerRound, tMs: number): number {
  const x = (round.freq * (tMs > 0 ? tMs : 0)) / 1000;
  if (x >= 1) return 0;
  return clamp01(tri(x));
}

// ---------------------------------------------------------------------------
// The swing state machine: the ONE sim both the client and the validator run.
// ---------------------------------------------------------------------------

export type StrikerEndReason = 'early' | 'late' | 'top';

export interface StrikerSimState {
  /** Swings judged so far; also the index of the next swing. */
  roundIndex: number;
  /** Hits (bells included). */
  rounds: number;
  /** Bells rung. */
  bells: number;
  /** Authoritative score (points). */
  score: number;
  /** Bells in a row right now. */
  bellStreak: number;
  /** The longest bell streak this run. */
  bestBellStreak: number;
  /** Highest strength of any swing. */
  bestStrength: number;
  /** Sum of every swing's hold, ms. */
  timeline: number;
  /** Set when the run has ended, and why. */
  ended: StrikerEndReason | null;
}

export function strikerInitialState(): StrikerSimState {
  return {
    roundIndex: 0,
    rounds: 0,
    bells: 0,
    score: 0,
    bellStreak: 0,
    bestBellStreak: 0,
    bestStrength: 0,
    timeline: 0,
    ended: null,
  };
}

/** True once the run has ended (a miss, or the top). */
export const strikerRunDone = (state: StrikerSimState) => state.ended !== null;

/** What a bell pays with `streakBefore` bells already in the streak. */
export const strikerBellPoints = (streakBefore: number) =>
  STRIKER_POINTS_BELL +
  STRIKER_BELL_STREAK_STEP * Math.min(STRIKER_BELL_STREAK_CAP, Math.max(0, Math.floor(streakBefore)));

export type StrikerSwingEvent =
  /** A hold `t` was malformed: under the tap floor, over the ceiling, or not a number. */
  | { type: 'bounds' }
  /** The run has ended already: nothing more counts. */
  | { type: 'over' }
  /** Under the line: the run ends. `side` says whether it was let go before or after the peak. */
  | { type: 'miss'; strength: number; qualifier: number; side: 'early' | 'late'; offsetMs: number }
  /** Over the line. */
  | {
      type: 'hit';
      strength: number;
      bell: boolean;
      /** Short of the bell but close to it (STRIKER_NEAR_BELL_WINDOWS). */
      near: boolean;
      points: number;
      /** Bells in a row after this swing. */
      bellStreak: number;
      qualifier: number;
      /** ms from the peak (negative is early). */
      offsetMs: number;
      /** This hit was the last the tower allows: the run ends on it. */
      top: boolean;
    };

export type StrikerHoldJudgement =
  | { tap: true; t: number }
  | { tap: false; t: number; state: StrikerSimState; event: StrikerSwingEvent };

/**
 * Judge a press and a release from their own timestamps on one clock. A hold
 * shorter than STRIKER_MIN_HOLD_MS is a tap: no swing. Pure; the client calls
 * it on release.
 */
export function strikerJudgeHold(
  seed: number,
  state: StrikerSimState,
  pressMs: number,
  releaseMs: number,
): StrikerHoldJudgement {
  const t = Math.max(0, releaseMs - pressMs);
  if (!(t >= STRIKER_MIN_HOLD_MS)) return { tap: true, t };
  const applied = strikerApplySwing(seed, state, t);
  return { tap: false, t, state: applied.state, event: applied.event };
}

/**
 * Apply one swing (`t` = ms held) to a state. Pure: returns a new state and
 * the event. The client runs it per real swing, the server per recorded one.
 */
export function strikerApplySwing(
  seed: number,
  state: StrikerSimState,
  t: number,
): { state: StrikerSimState; event: StrikerSwingEvent } {
  if (strikerRunDone(state)) return { state, event: { type: 'over' } };
  if (!Number.isFinite(t) || t < STRIKER_MIN_HOLD_MS || t > STRIKER_MAX_HOLD_MS) {
    return { state, event: { type: 'bounds' } };
  }

  const round = strikerRoundFor(seed | 0, state.roundIndex);
  const strength = strikerGaugeValue(round, t);
  const offsetMs = t - round.peakMs;
  const bestStrength = Math.max(state.bestStrength, strength);
  const timeline = state.timeline + t;

  if (strength < round.qualifier) {
    const side = offsetMs < 0 ? 'early' : 'late';
    return {
      state: {
        ...state,
        roundIndex: state.roundIndex + 1,
        bellStreak: 0,
        bestStrength,
        timeline,
        ended: side,
      },
      event: { type: 'miss', strength, qualifier: round.qualifier, side, offsetMs },
    };
  }

  const bell = strength >= round.bellLine;
  const points = bell ? strikerBellPoints(state.bellStreak) : STRIKER_POINTS_HIT;
  const bellStreak = bell ? state.bellStreak + 1 : 0;
  const rounds = state.rounds + 1;
  const top = rounds >= STRIKER_MAX_SWINGS;

  return {
    state: {
      roundIndex: state.roundIndex + 1,
      rounds,
      bells: state.bells + (bell ? 1 : 0),
      score: state.score + points,
      bellStreak,
      bestBellStreak: Math.max(state.bestBellStreak, bellStreak),
      bestStrength,
      timeline,
      ended: top ? 'top' : null,
    },
    event: {
      type: 'hit',
      strength,
      bell,
      near: !bell && Math.abs(offsetMs) <= round.bellWindowMs * STRIKER_NEAR_BELL_WINDOWS,
      points,
      bellStreak,
      qualifier: round.qualifier,
      offsetMs,
      top,
    },
  };
}

// ---------------------------------------------------------------------------
// Run validation (server-authoritative scoring)
// ---------------------------------------------------------------------------

/** One recorded swing: `t` = ms between the press and the release. */
export interface StrikerSwing {
  t: number;
}

export interface StrikerRunResult {
  score: number;
  /** Hits, bells included: the depth the run reached. */
  rounds: number;
  /** Swings judged, the ending miss included. */
  swingsUsed: number;
  bells: number;
  bestBellStreak: number;
  bestStrength: number;
  /** Entries inspected before scoring stopped. */
  inspected: number;
  /** True only when the run ended (a miss, or the top) on its last entry. */
  complete: boolean;
  /** 'complete', 'extra' (entries after the end), 'bounds' (a bad `t`) or
   *  'incomplete' (the list ran out before the run ended). */
  stop: 'complete' | 'extra' | 'bounds' | 'incomplete';
  /** How the run ended, when it did. */
  ended: StrikerEndReason | null;
  /** Each judged swing's offset from its peak, ms (for the spread check). */
  offsetsMs: number[];
  /** Sum of every hold, ms. */
  holdTotalMs: number;
}

/**
 * Replay a submitted swing list. Pure and never throws: bad input stops
 * scoring and the result says why.
 */
export function validateStrikerRun(seed: number, swings: readonly StrikerSwing[]): StrikerRunResult {
  let state = strikerInitialState();
  let inspected = 0;
  const offsetsMs: number[] = [];
  const finish = (stop: StrikerRunResult['stop']): StrikerRunResult => ({
    score: state.score,
    rounds: state.rounds,
    swingsUsed: state.roundIndex,
    bells: state.bells,
    bestBellStreak: state.bestBellStreak,
    bestStrength: state.bestStrength,
    inspected,
    complete: stop === 'complete',
    stop,
    ended: state.ended,
    offsetsMs,
    holdTotalMs: state.timeline,
  });

  if (!Array.isArray(swings) || swings.length === 0) return finish('incomplete');

  for (let i = 0; i < swings.length; i += 1) {
    inspected = i + 1;
    if (strikerRunDone(state)) return finish('extra');
    const swing = swings[i];
    const t = typeof swing?.t === 'number' ? swing.t : NaN;
    const applied = strikerApplySwing(seed, state, t);
    if (applied.event.type === 'bounds') return finish('bounds');
    if (applied.event.type === 'hit' || applied.event.type === 'miss') offsetsMs.push(applied.event.offsetMs);
    state = applied.state;
  }
  return finish(strikerRunDone(state) ? 'complete' : 'incomplete');
}

// ---------------------------------------------------------------------------
// Timing floor and the spread check (server)
// ---------------------------------------------------------------------------

/** The least wall time a swing after the first can follow the last one's
 *  release: the mallet's drop and the shortest climb to the top of a hit. */
export const STRIKER_MIN_SWING_GAP_MS = STRIKER_DROP_MS_MIN + 320;

/** The least time a run can take on the server's clock: every hold, plus the
 *  gap between swings. A session that ends sooner is a forged list. */
export const strikerMinRunMs = (run: Pick<StrikerRunResult, 'holdTotalMs' | 'swingsUsed'>) =>
  run.holdTotalMs + Math.max(0, run.swingsUsed - 1) * STRIKER_MIN_SWING_GAP_MS;

/** The spread check reads runs with at least this many swings. */
export const STRIKER_PLAY_MIN_SWINGS = 30;
/** A run whose offsets from the peak spread less than this (SD, ms) is flagged. */
export const STRIKER_PLAY_SD_MS = 6;
/** Bells in a row that are logged for a person to look at (never a flag). */
export const STRIKER_PLAY_REVIEW_STREAK = 40;

export type StrikerPlayCheck = { sdMs: number | null; flag: string | null; review: string | null };

/**
 * The spread of one run's holds around their peaks. An honest hand spreads by
 * 10 ms at the very least (simulated hands at 10 to 80 ms of noise, on fine
 * and rounded clocks, are never flagged); a program aimed at the peak spreads
 * by a few. The ending miss is left out: it is the one swing that went wrong.
 */
export function strikerPlayCheck(run: Pick<StrikerRunResult, 'offsetsMs' | 'ended' | 'bestBellStreak'>): StrikerPlayCheck {
  const offsets = run.ended === 'top' ? run.offsetsMs : run.offsetsMs.slice(0, -1);
  const review =
    run.bestBellStreak >= STRIKER_PLAY_REVIEW_STREAK ? `${run.bestBellStreak} bells in a row` : null;
  if (offsets.length < STRIKER_PLAY_MIN_SWINGS) return { sdMs: null, flag: null, review };
  const mean = offsets.reduce((a, b) => a + b, 0) / offsets.length;
  const variance = offsets.reduce((a, b) => a + (b - mean) ** 2, 0) / (offsets.length - 1);
  const sdMs = Math.sqrt(variance);
  const flag =
    sdMs < STRIKER_PLAY_SD_MS
      ? `Holds land within ${sdMs.toFixed(1)} ms of the peak (SD over ${offsets.length} swings)`
      : null;
  return { sdMs, flag, review };
}

// ---------------------------------------------------------------------------
// The display lead (client)
// ---------------------------------------------------------------------------

/**
 * How far ahead of the frame's own time the gauge is drawn. A frame rendered
 * at time T reaches the eye about one refresh later, so the fill on screen is
 * drawn at T plus one frame: the fill you see when you let go is the strength
 * you get. Clamped so a stalled frame can't push it far. Same as ticket stop.
 */
export function strikerDisplayLeadMs(frameIntervalMs: number): number {
  if (!Number.isFinite(frameIntervalMs) || frameIntervalMs <= 0) return 1000 / 60;
  return Math.min(34, Math.max(4, frameIntervalMs));
}
