/**
 * Ticket stop, rules 2 (the lock): rules, engine and replay. Pure TypeScript,
 * no React, no DOM, no Date.now(), no Math.random(). The client draws from it
 * and the score route will replay with it, so both always agree.
 *
 * The game, after Pop the Lock: a needle sweeps round a dial. An amber dot
 * sits on the ring. Tap while the needle is on the dot: the dot pops, the
 * needle turns round, and the next dot appears further along its new way. A
 * tap off the dot, or letting the needle pass it, ends the run. Each level
 * needs a set number of hits; clearing one opens the lock, and the next
 * level is faster. The score is the run's hits.
 *
 * Timing model (why phones at 60, 120 and 144 Hz score the same):
 *  - Everything is a function of whole milliseconds since the run's first
 *    input. Nothing counts frames; a frame only samples the state.
 *  - A tap is the input event's own timestamp. The needle's angle is a pure
 *    function of time and the earlier hits, so a slow or fast display changes
 *    only how often you see the needle, never where a tap lands.
 *  - Hit or miss is decided in degrees: the needle touches the dot when the
 *    angle between them is at most the dot's radius plus the needle's half
 *    width (HIT_HALF_DEG). That is the picture's own overlap, so what you see
 *    touching scores, at any frame rate.
 *
 * The seed only places the dots. Dot i sits SPAWN distance ahead of dot i-1
 * along the needle's new direction, and every spawn distance comes from the
 * seed, never from where a tap landed. The needle starts at the top (0 deg)
 * and alternates direction on every hit. Speeds and dot sizes are fixed per
 * level, so every seed is about as hard as any other.
 *
 * The run's timeline, from t = 0 (the run's first input):
 *  - The needle waits at the top until LEAD_IN_MS, then moves.
 *  - A hit at time e reverses the needle from wherever it is at e.
 *  - The hit that clears a level stops the needle where it is. The next
 *    level's needle moves LEVEL_GAP_MS later, from the same spot.
 *  - Taps while the needle waits (lead-in, a level gap) do nothing.
 *  - The run ends at the first tap off the dot, or when the needle passes
 *    the dot's far edge untouched.
 */

// ---------------------------------------------------------------------------
// Rules and tuning
// ---------------------------------------------------------------------------

/** The rules version this engine scores. v1 (the bulb ring) is 1. */
export const TICKET_STOP_LOCK_RULES = 2;

/** From the run's first input to the needle moving, ms. */
export const LOCK_LEAD_IN_MS = 600;
/** From a level-clearing hit to the next level's needle moving, ms. The lock
 *  opens, the hit-stop holds, the shackle drops back, the count resets. */
export const LOCK_LEVEL_GAP_MS = 1100;

/** The dot's radius, in degrees of the ring. */
export const LOCK_DOT_HALF_DEG = 12;
/** Half the needle's width, in degrees of the ring. */
export const LOCK_NEEDLE_HALF_DEG = 1.5;
/** A tap scores when the needle is within this of the dot's centre: they
 *  touch on screen. */
export const LOCK_HIT_HALF_DEG = LOCK_DOT_HALF_DEG + LOCK_NEEDLE_HALF_DEG;

export type LockLevelRule = {
  /** 1-based. */
  level: number;
  /** Hits that clear the level. */
  hits: number;
  /** Needle speed, degrees per second. */
  speedDps: number;
  /** Seeded spawn distances for this level's dots, degrees. */
  spawnMinDeg: number;
  spawnMaxDeg: number;
};

/** Level 1's speed, deg/s: a lap in 2.4 s. */
export const LOCK_SPEED_START_DPS = 160;
/** Each level adds this, deg/s. */
export const LOCK_SPEED_STEP_DPS = 10;
/** Speed stops rising here, deg/s (level 13 on): a lap in 0.97 s. */
export const LOCK_SPEED_MAX_DPS = 360;
/** Hits per level: level 1 needs HITS_START, each level one more, up to
 *  HITS_MAX. */
export const LOCK_HITS_START = 4;
export const LOCK_HITS_MAX = 10;
/** The nearest a dot spawns, as time for the needle to reach it, ms: under
 *  this a dot can't be read before it arrives. */
export const LOCK_SPAWN_MIN_MS = 300;
/** Spawn distance bounds, degrees. Max stays well under a lap so a dot never
 *  sits behind the needle's start. */
export const LOCK_SPAWN_MIN_DEG = 60;
export const LOCK_SPAWN_MAX_DEG = 220;

/** The rule for a level (1-based). Every level exists; past the ramp's end
 *  they stay the same. */
export function lockLevelRule(level: number): LockLevelRule {
  const l = Math.max(1, Math.floor(level));
  const speedDps = Math.min(LOCK_SPEED_MAX_DPS, LOCK_SPEED_START_DPS + LOCK_SPEED_STEP_DPS * (l - 1));
  const hits = Math.min(LOCK_HITS_MAX, LOCK_HITS_START + (l - 1));
  const spawnMinDeg = Math.max(LOCK_SPAWN_MIN_DEG, (speedDps * LOCK_SPAWN_MIN_MS) / 1000);
  return { level: l, hits, speedDps, spawnMinDeg, spawnMaxDeg: LOCK_SPAWN_MAX_DEG };
}

/** Hits needed to clear levels 1 through `level`. */
export function lockHitsThrough(level: number): number {
  let total = 0;
  for (let l = 1; l <= level; l += 1) total += lockLevelRule(l).hits;
  return total;
}

/** The level (1-based) that the hit with 0-based index `hitIndex` belongs to,
 *  and its place in that level. */
export function lockLevelOfHit(hitIndex: number): { level: number; inLevel: number; rule: LockLevelRule } {
  let level = 1;
  let before = 0;
  for (;;) {
    const rule = lockLevelRule(level);
    if (hitIndex < before + rule.hits) return { level, inLevel: hitIndex - before, rule };
    before += rule.hits;
    level += 1;
  }
}

/** Tickets: score / this divisor through the wallet's saturating curve
 *  (rewards/wallet.ts). The maths is in scripts/verify-ticket-stop-replay.ts. */
export const TICKET_STOP_LOCK_REWARD_DIVISOR = 60;

// ---------------------------------------------------------------------------
// Seeded dots
// ---------------------------------------------------------------------------

/** mulberry32, byte-identical to ticket-stop-engine and tumbler-replay. */
function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A fresh generator per dot, so dot i never depends on how many draws
 *  earlier dots took. */
function rngForDot(seed: number, index: number): () => number {
  let mixed = (seed ^ Math.imul(index + 1, 0x9e3779b1) ^ 0x5f3759df) | 0;
  mixed = (mixed + 0x6d2b79f5) | 0;
  return mulberry32(mixed);
}

const mod = (value: number, n: number) => ((value % n) + n) % n;

export type LockDot = {
  /** 0-based, across the whole run. */
  index: number;
  level: number;
  /** 0-based place in its level. */
  inLevel: number;
  /** Centre, degrees clockwise from the top, unwrapped (may leave 0..360). */
  centreDeg: number;
  /** The needle's direction on its way to this dot: +1 clockwise. */
  dir: 1 | -1;
  /** Seeded distance from the previous dot's centre, degrees. */
  spawnDeg: number;
};

export type LockLayout = {
  seed: number;
  /** The first direction, from the seed. */
  firstDir: 1 | -1;
  /** Dot `index`. Computed on demand and cached; pure in seed and index. */
  dot: (index: number) => LockDot;
};

/** The run's dots for a seed. Draw order inside a dot is fixed: spawn
 *  distance, then (dot 0 only) direction. Never reorder. */
export function lockLayout(seed: number): LockLayout {
  const safeSeed = seed | 0;
  const firstDir: 1 | -1 = mulberry32(safeSeed ^ 0x2545f491)() < 0.5 ? 1 : -1;
  const cache: LockDot[] = [];
  const dot = (index: number): LockDot => {
    if (!Number.isInteger(index) || index < 0) throw new RangeError('dot index');
    while (cache.length <= index) {
      const i = cache.length;
      const { level, inLevel, rule } = lockLevelOfHit(i);
      const rng = rngForDot(safeSeed, i);
      const spawnDeg = rule.spawnMinDeg + rng() * (rule.spawnMaxDeg - rule.spawnMinDeg);
      const dir: 1 | -1 = i % 2 === 0 ? firstDir : firstDir === 1 ? -1 : 1;
      const from = i === 0 ? 0 : cache[i - 1].centreDeg;
      cache.push({ index: i, level, inLevel, centreDeg: from + dir * spawnDeg, dir, spawnDeg });
    }
    return cache[index];
  };
  return { seed: safeSeed, firstDir, dot };
}

// ---------------------------------------------------------------------------
// The needle: a pure function of time and the hits so far
// ---------------------------------------------------------------------------

/** The needle on its way to one dot. */
export type LockSegment = {
  dot: LockDot;
  rule: LockLevelRule;
  /** When the needle starts moving toward this dot, ms. */
  startMs: number;
  /** Where it starts, degrees (unwrapped). */
  startDeg: number;
  /** Degrees of travel to the dot's centre (always positive). */
  toCentreDeg: number;
  /** Degrees of travel at which the hit window opens and closes. */
  openDeg: number;
  closeDeg: number;
  /** When the needle passes the dot's far edge untouched, ms (fractional). */
  passMs: number;
};

const travelAt = (segment: LockSegment, tMs: number) =>
  (Math.max(0, tMs - segment.startMs) * segment.rule.speedDps) / 1000;

/** Needle angle (degrees, unwrapped) on a segment at `tMs`. Before the
 *  segment starts it waits at startDeg. */
export function lockSegmentAngle(segment: LockSegment, tMs: number): number {
  return segment.startDeg + segment.dot.dir * travelAt(segment, tMs);
}

/** The segment toward dot `index`, given where and when the last hit was. */
function segmentFor(layout: LockLayout, index: number, fromMs: number, fromDeg: number): LockSegment {
  const dot = layout.dot(index);
  const rule = lockLevelOfHit(index).rule;
  const startMs = index === 0 ? LOCK_LEAD_IN_MS : dot.inLevel === 0 ? fromMs + LOCK_LEVEL_GAP_MS : fromMs;
  // Travel from the needle to the dot's centre along `dir`: the spawn
  // distance, give or take where in the last dot the hit landed.
  const toCentreDeg = mod(dot.dir * (dot.centreDeg - fromDeg), 360);
  const openDeg = toCentreDeg - LOCK_HIT_HALF_DEG;
  const closeDeg = toCentreDeg + LOCK_HIT_HALF_DEG;
  const passMs = startMs + (closeDeg * 1000) / rule.speedDps;
  return { dot, rule, startMs, startDeg: fromDeg, toCentreDeg, openDeg, closeDeg, passMs };
}

export type LockHit = {
  index: number;
  level: number;
  atMs: number;
  /** Needle angle at the hit, degrees (unwrapped). */
  angleDeg: number;
  /** Signed offset from the dot's centre along the travel, degrees:
   *  negative is early. */
  offsetDeg: number;
  /** The same offset as time, ms: negative is early. */
  offsetMs: number;
  /** This hit cleared its level. */
  clears: boolean;
};

export type LockEnd =
  /** A tap before the needle reached the dot. */
  | { kind: 'early'; atMs: number; angleDeg: number; dotIndex: number }
  /** The needle passed the dot's far edge untouched. */
  | { kind: 'passed'; atMs: number; angleDeg: number; dotIndex: number };

export type LockReplay = {
  hits: LockHit[];
  /** The segment the needle is on after the last hit. */
  segment: LockSegment;
  end: LockEnd | null;
};

/**
 * Replay taps (whole ms since the run began, in order) that an honest
 * client recorded: every tap a hit except perhaps the last, an early miss.
 * Taps the engine would ignore (while the needle waits) must not be in the
 * list. `nowMs` (optional) also ends the run by a pass that happened before
 * it. Untrusted input goes through `scoreLockRun`.
 */
export function lockReplay(layout: LockLayout, taps: readonly number[], nowMs?: number): LockReplay {
  const hits: LockHit[] = [];
  let segment = segmentFor(layout, 0, 0, 0);
  for (let i = 0; i < taps.length; i += 1) {
    const result = resolveTap(segment, taps[i]);
    if (result.kind === 'hit') {
      hits.push(result.hit);
      segment = segmentFor(layout, segment.dot.index + 1, result.hit.atMs, result.hit.angleDeg);
      continue;
    }
    if (result.kind === 'early') {
      return { hits, segment, end: { kind: 'early', atMs: taps[i], angleDeg: result.angleDeg, dotIndex: segment.dot.index } };
    }
    // An ignored or late tap in a trusted list: stop where the run stopped.
    break;
  }
  const passed = nowMs != null && nowMs > segment.passMs;
  return {
    hits,
    segment,
    end: passed ? passEnd(segment) : null,
  };
}

const passEnd = (segment: LockSegment): LockEnd => ({
  kind: 'passed',
  atMs: segment.passMs,
  angleDeg: segment.startDeg + segment.dot.dir * segment.closeDeg,
  dotIndex: segment.dot.index,
});

type TapResult =
  | { kind: 'hit'; hit: LockHit }
  | { kind: 'early'; angleDeg: number }
  /** The needle is waiting (lead-in or a level gap): nothing happens. */
  | { kind: 'ignored' }
  /** After the needle passed the dot: the run was already over. */
  | { kind: 'late' };

function resolveTap(segment: LockSegment, atMs: number): TapResult {
  if (!Number.isFinite(atMs) || atMs < segment.startMs) return { kind: 'ignored' };
  const travel = travelAt(segment, atMs);
  if (travel > segment.closeDeg) return { kind: 'late' };
  const angleDeg = segment.startDeg + segment.dot.dir * travel;
  if (travel < segment.openDeg) return { kind: 'early', angleDeg };
  const offsetDeg = travel - segment.toCentreDeg;
  const rule = segment.rule;
  return {
    kind: 'hit',
    hit: {
      index: segment.dot.index,
      level: segment.dot.level,
      atMs,
      angleDeg,
      offsetDeg,
      offsetMs: (offsetDeg * 1000) / rule.speedDps,
      clears: segment.dot.inLevel === rule.hits - 1,
    },
  };
}

// ---------------------------------------------------------------------------
// Taking a tap (client)
// ---------------------------------------------------------------------------

export type LockPress =
  | { kind: 'hit'; hit: LockHit }
  | { kind: 'early'; end: LockEnd }
  /** The needle is waiting, or the run is over. Nothing is recorded. */
  | { kind: 'ignored'; reason: 'waiting' | 'over' };

/**
 * What a tap at `atMs` (whole ms since the run began) does, given the taps
 * recorded so far. The client records `atMs` only for `hit` and `early`, so
 * it only ever sends taps the replay accepts.
 */
export function lockPress(layout: LockLayout, taps: readonly number[], atMs: number): LockPress {
  const replay = lockReplay(layout, taps);
  if (replay.end) return { kind: 'ignored', reason: 'over' };
  const result = resolveTap(replay.segment, atMs);
  if (result.kind === 'hit') return { kind: 'hit', hit: result.hit };
  if (result.kind === 'early') {
    return {
      kind: 'early',
      end: { kind: 'early', atMs, angleDeg: result.angleDeg, dotIndex: replay.segment.dot.index },
    };
  }
  return { kind: 'ignored', reason: result.kind === 'late' ? 'over' : 'waiting' };
}

/** Whole milliseconds since the run began, from an input event's timestamp
 *  and the run's start on the same clock. */
export function lockInputMs(eventTimeMs: number, runStartMs: number): number {
  return Math.round(eventTimeMs - runStartMs);
}

/**
 * How far ahead of the frame's timestamp to draw, ms. A frame drawn at t
 * reaches the screen about one frame interval later, so drawing the needle
 * for t + interval makes what is on screen match the clock a tap is stamped
 * with (as v1 does). Drawing only: scoring never reads it.
 */
export function lockDisplayLeadMs(frameIntervalMs: number): number {
  if (!Number.isFinite(frameIntervalMs) || frameIntervalMs <= 0) return 1000 / 60;
  return Math.min(50, Math.max(4, frameIntervalMs));
}

// ---------------------------------------------------------------------------
// What to draw at a moment (client)
// ---------------------------------------------------------------------------

export type LockView = {
  /** wait: before the first move. run: the needle moves. clear: a level
   *  just opened, the needle waits. over: the run ended. */
  phase: 'wait' | 'run' | 'clear' | 'over';
  /** Needle angle, degrees (unwrapped). */
  needleDeg: number;
  /** The needle's direction (for the trail): +1 clockwise, 0 when still. */
  needleDir: 1 | -1 | 0;
  /** Degrees per second while moving. */
  speedDps: number;
  /** The dot on screen. During `clear` it is the next level's first dot. */
  dot: LockDot;
  /** The level on screen and hits left in it. */
  level: number;
  hitsLeft: number;
  levelHits: number;
  /** Hits so far. */
  score: number;
  /** The last hit, for effects. */
  lastHit: LockHit | null;
  end: LockEnd | null;
  /** ms since the current phase began. */
  sinceMs: number;
};

/**
 * The lock at `tMs` since the run began, given the recorded taps. A pure
 * function of time: draw whatever this returns, at any frame rate. Pass
 * `tMs` 0 (or less) before the run starts.
 */
export function lockView(layout: LockLayout, taps: readonly number[], tMs: number): LockView {
  const replay = lockReplay(layout, taps, tMs);
  const { hits, segment, end } = replay;
  const lastHit = hits[hits.length - 1] ?? null;
  const dot = segment.dot;
  const rule = segment.rule;
  const levelHits = rule.hits;
  const hitsLeft = levelHits - dot.inLevel;
  const base = {
    speedDps: rule.speedDps,
    dot,
    level: dot.level,
    hitsLeft,
    levelHits,
    score: hits.length,
    lastHit,
  };
  if (end) {
    return {
      ...base,
      phase: 'over',
      needleDeg: end.angleDeg,
      needleDir: 0,
      end,
      sinceMs: tMs - end.atMs,
    };
  }
  if (tMs < segment.startMs) {
    const clearing = lastHit != null && lastHit.clears;
    return {
      ...base,
      phase: clearing ? 'clear' : 'wait',
      needleDeg: segment.startDeg,
      needleDir: 0,
      end: null,
      sinceMs: clearing ? tMs - lastHit.atMs : tMs,
    };
  }
  return {
    ...base,
    phase: 'run',
    needleDeg: lockSegmentAngle(segment, tMs),
    needleDir: dot.dir,
    end: null,
    sinceMs: tMs - segment.startMs,
  };
}

// ---------------------------------------------------------------------------
// Validation (server, stage 2 uses this)
// ---------------------------------------------------------------------------

export type LockRejection =
  /** Not an array, empty-but-malformed, or too many taps. */
  | 'count'
  /** A tap that is not a whole, finite, non-negative number of ms. */
  | 'malformed'
  /** Taps out of order. */
  | 'order'
  /** A tap while the needle waited: an honest client never sends one. */
  | 'waiting'
  /** A tap after the needle had passed its dot, or after an early miss. */
  | 'late'
  /** The run's timeline is longer than the session has existed. */
  | 'too-fast'
  /** Submitted long after the run ended. */
  | 'stale';

export type LockRun =
  | {
      ok: true;
      hits: LockHit[];
      score: number;
      /** Levels fully cleared. */
      levelsCleared: number;
      end: LockEnd;
      /** ms from the run's first input to its end. */
      durationMs: number;
    }
  | { ok: false; reason: LockRejection; tap?: number };

/** A run can't have more taps than this. Far past any human run. */
export const LOCK_MAX_TAPS = 2000;
export const LOCK_SESSION_SLACK_MS = 250;
export const LOCK_MAX_SUBMIT_DELAY_MS = 120_000;

/**
 * Recompute a run from the seed and the submitted taps, rejecting anything
 * an honest client can't send. Never throws.
 */
export function scoreLockRun(
  seed: number,
  taps: unknown,
  options: { sinceStartMs?: number } = {},
): LockRun {
  if (!Array.isArray(taps) || taps.length > LOCK_MAX_TAPS) return { ok: false, reason: 'count' };
  const clean: number[] = [];
  for (let i = 0; i < taps.length; i += 1) {
    const value = taps[i];
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
      return { ok: false, reason: 'malformed', tap: i };
    }
    if (i > 0 && value < clean[i - 1]) return { ok: false, reason: 'order', tap: i };
    clean.push(value);
  }
  const layout = lockLayout(seed);
  const hits: LockHit[] = [];
  let segment = segmentFor(layout, 0, 0, 0);
  let end: LockEnd | null = null;
  for (let i = 0; i < clean.length; i += 1) {
    if (end) return { ok: false, reason: 'late', tap: i };
    const result = resolveTap(segment, clean[i]);
    if (result.kind === 'ignored') return { ok: false, reason: 'waiting', tap: i };
    if (result.kind === 'late') return { ok: false, reason: 'late', tap: i };
    if (result.kind === 'early') {
      end = { kind: 'early', atMs: clean[i], angleDeg: result.angleDeg, dotIndex: segment.dot.index };
      continue;
    }
    hits.push(result.hit);
    segment = segmentFor(layout, segment.dot.index + 1, result.hit.atMs, result.hit.angleDeg);
  }
  end ??= passEnd(segment);
  const durationMs = Math.ceil(end.atMs);
  if (typeof options.sinceStartMs === 'number') {
    if (options.sinceStartMs + LOCK_SESSION_SLACK_MS < durationMs) return { ok: false, reason: 'too-fast' };
    if (options.sinceStartMs > durationMs + LOCK_MAX_SUBMIT_DELAY_MS) return { ok: false, reason: 'stale' };
  }
  const last = hits[hits.length - 1];
  const levelsCleared = last ? last.level - (last.clears ? 0 : 1) : 0;
  return { ok: true, hits, score: hits.length, levelsCleared, end, durationMs };
}

// ---------------------------------------------------------------------------
// Play that no hand produces (server, over a player's recent runs)
// ---------------------------------------------------------------------------

/**
 * The replay decides a run, so a tampered tap list can't score. What it can't
 * see is a program that sends valid taps: it aims every tap at the dot's
 * centre. A hand misses the centre by tens of ms, hit after hit; the spread of
 * a hit's offset (LockHit.offsetMs) over a run is the player's own timing
 * noise, 10 ms for the sharpest hand and more for everyone else. A program
 * with no noise of its own lands every tap within a few ms of the centre.
 *
 * Three things come out of a run:
 *  - `offsets`: the signed offset of each hit, ms, to one decimal. Kept for
 *    the player's last LOCK_PLAY_WINDOW runs, none from a run on a rounded
 *    clock (below).
 *  - `streak`: the longest run of hits in a row within LOCK_NEAR_MS of the
 *    centre. Logged for review only.
 *  - the pooled within-run SD of the offsets over the window: flagged when
 *    it is under LOCK_SD_MAX_MS over at least LOCK_SD_MIN_DF degrees of
 *    freedom. Within-run, so a program that shifts its aim from run to run
 *    can't hide behind the spread of those shifts.
 */

/** One stored run, as ticket_stop_runs keeps it for rules 2. */
export type LockRunSummary = { streak: number; offsets: readonly number[] };

/** Runs the check looks back over, newest included. */
export const LOCK_PLAY_WINDOW = 50;
/** Offsets stored per run: the first this many. A run of 300 hits is 2.5 kB. */
export const LOCK_STORED_OFFSETS = 300;
/** Pooled SD under this, ms, is flagged. Honest timing noise starts near
 *  10 ms (the sharpest simulated hand); a program with no noise sits at 1 to
 *  3. Not a bound on every program: one that adds 6 ms of noise passes. */
export const LOCK_SD_MAX_MS = 5;
/** Degrees of freedom (hits less one per run) needed before judging. At 10
 *  ms of real noise the chance of a pooled SD under 5 ms at this many is
 *  about 3 in 10 million, and it falls fast with more hits (scripts/verify-ticket-stop-replay.ts prints it). */
export const LOCK_SD_MIN_DF = 40;
/** A hit this close to the centre is "near-perfect". */
export const LOCK_NEAR_MS = 5;
/** Log for review at this many near-perfect hits in a row. A 10 ms hand
 *  lands within 5 ms 38% of the time: 20 in a row is 4 in a billion. */
export const LOCK_STREAK_REVIEW = 20;
/** A run whose taps all share a factor this large (over at least
 *  LOCK_COARSE_MIN_TAPS taps) came from a rounded clock: Firefox with
 *  resist-fingerprinting rounds to 100 ms, some browsers to 20 or 50. Its
 *  offsets say nothing about a hand. A 1 ms clock gets here 1 run in 4^11. */
export const LOCK_COARSE_CLOCK_MS = 16;
export const LOCK_COARSE_MIN_TAPS = 12;

const gcd = (a: number, b: number): number => (b === 0 ? Math.abs(a) : gcd(b, a % b));

/** The offsets a run contributes to the spread check: none when its taps
 *  came from a rounded clock. Offsets are stored to 0.1 ms. */
export function lockCheckOffsets(hits: readonly LockHit[], taps: readonly number[]): number[] {
  if (taps.length >= LOCK_COARSE_MIN_TAPS) {
    const factor = taps.reduce((acc, tap) => gcd(acc, tap), 0);
    if (factor >= LOCK_COARSE_CLOCK_MS) return [];
  }
  return hits.slice(0, LOCK_STORED_OFFSETS).map((hit) => Math.round(hit.offsetMs * 10) / 10);
}

/** The longest run of hits in a row within LOCK_NEAR_MS of the centre. */
export function lockNearStreak(hits: readonly LockHit[]): number {
  let best = 0;
  let run = 0;
  for (const hit of hits) {
    run = Math.abs(hit.offsetMs) <= LOCK_NEAR_MS ? run + 1 : 0;
    if (run > best) best = run;
  }
  return best;
}

export type LockPlayCheck = {
  runs: number;
  /** Degrees of freedom behind `sdMs`. */
  df: number;
  /** Pooled within-run SD of the offsets, ms; null with under 1 df. */
  sdMs: number | null;
  /** Timing spread too small to be a hand: a flag that escalates. */
  flag: string | null;
  /** A streak of near-perfect hits: logged for a person to look at, never
   *  counted toward a ban. */
  review: string | null;
  streak: number;
};

/** Pooled within-run SD of per-run offsets, and its degrees of freedom. */
export function lockPooledSpread(runs: ReadonlyArray<readonly number[]>): { sdMs: number | null; df: number; hits: number } {
  let ss = 0;
  let df = 0;
  let hits = 0;
  for (const offsets of runs) {
    if (offsets.length < 2) continue;
    hits += offsets.length;
    const mean = offsets.reduce((a, b) => a + b, 0) / offsets.length;
    for (const value of offsets) ss += (value - mean) ** 2;
    df += offsets.length - 1;
  }
  return { sdMs: df > 0 ? Math.sqrt(ss / df) : null, df, hits };
}

/**
 * Look at a player's recent v2 runs (oldest first, this run last) for play
 * no hand produces. `flag` feeds the anti-cheat's flag escalation; `review`
 * (about this run alone) is only logged.
 */
export function lockPlayCheck(history: readonly LockRunSummary[]): LockPlayCheck {
  const recent = history.slice(-LOCK_PLAY_WINDOW);
  const { sdMs, df, hits } = lockPooledSpread(recent.map((run) => run.offsets));
  const streak = recent[recent.length - 1]?.streak ?? 0;
  const flag =
    sdMs !== null && df >= LOCK_SD_MIN_DF && sdMs < LOCK_SD_MAX_MS
      ? `Hits land within ${sdMs.toFixed(1)} ms of the centre (SD over ${hits} hits in ${recent.length} runs)`
      : null;
  const review =
    streak >= LOCK_STREAK_REVIEW ? `${streak} hits in a row within ${LOCK_NEAR_MS} ms of the centre` : null;
  return { runs: recent.length, df, sdMs, flag, review, streak };
}
