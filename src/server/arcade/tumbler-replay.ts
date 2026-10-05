/**
 * Tumbler (Pop-the-Lock) — pure, deterministic pin schedule + run validator.
 *
 * This module is the single source of truth for BOTH the client (which renders
 * the orbiting marker + lit notch for instant feedback) and the server score
 * route (which re-derives every pin to validate the submitted taps). Same
 * `(seed, pinIndex)` ⇒ identical notch angle + angular speed + spin direction +
 * window width + sticky flag on both sides, so the client can never choose an
 * easier lock.
 *
 * Mechanic: a marker dot orbits a circular lock ring at a steady angular speed.
 * One lit "notch" sits at a seed-derived angle. The player taps when the marker
 * is within the hit-window of the notch to click that pin, which spawns a new
 * notch at a new seed-derived angle and steps the speed up slightly
 * (occasionally reversing direction on deeper pins). A tap when the marker is
 * NOT inside the window ends the run.
 *
 * Depth mechanics (all seeded, all replay-checked):
 *  - PRECISION GRADING: a tap inside the inner TUMBLER_CLEAN_FRACTION of the
 *    window is a CLEAN PICK worth 2 points (3 while a clean streak of 3+ is
 *    alive); an edge graze is worth 1. Score = points, not pins.
 *  - WINDOW JITTER: each pin's hit-window gets a seeded ±jitter around the
 *    depth ramp, so no two locks feel identical.
 *  - STICKY (double-tap) PINS: past TUMBLER_STICKY_MIN_INDEX a small seeded
 *    fraction of pins need TWO hits — the main notch, then a second notch
 *    farther along the same sweep (the marker does NOT reset between the two).
 *    Completing one pays a +1 bonus on top of the grade of the setting tap.
 *  - LAYERS: every TUMBLER_PINS_PER_LAYER set pins opens a lock layer. Purely
 *    presentational (client flourish) but the boundary is defined here so both
 *    sides agree on when a layer opens.
 *
 * Anti-cheat model (single-POST, no WebSocket — mirrors Mental Math Sprint):
 *  - The authoritative score is recomputed by replaying the recorded taps
 *    through the same pure state machine the client ran (`tumblerApplyTap`).
 *    For each tap we reconstruct the marker angle from ONLY the tap's `t`
 *    (ms since that pin began) and the deterministic angular speed, then check
 *    it fell inside the current target's window. The first tap that misses ends
 *    the run; everything after it is ignored.
 *  - We trust ONLY the tap timestamp — never a client-supplied angle. A minimum
 *    interval between counted clicks caps how fast a precomputing cheater could
 *    fire; under-cadence taps are deterministically IGNORED on both sides (they
 *    neither score nor end the run), so an accidental double-tap can never
 *    desync the client from the validator.
 *
 * Everything here is pure: no Date.now(), no Math.random(), no I/O.
 */

const TAU = Math.PI * 2;

// ---------------------------------------------------------------------------
// Tunable constants (exported so the route + client agree on the same bounds)
// ---------------------------------------------------------------------------

/** Base angular speed of the marker at pin 0, in radians / second. ~0.55 rev/s. */
export const TUMBLER_BASE_SPEED = 3.45;

/** Added to angular speed per pin clicked (the lock spins faster as you go). */
export const TUMBLER_SPEED_STEP = 0.085;

/** Hard ceiling on angular speed (rad/s) so deep pins stay humanly possible. */
export const TUMBLER_MAX_SPEED = 8.4;

/** Half-width of the notch hit-window, in radians, at pin 0 (fair-but-tense).
 *  The full acceptance arc is 2× this. ~0.30 rad ⇒ ~17° each side at the start. */
export const TUMBLER_BASE_WINDOW = 0.3;

/** The hit-window narrows by this many radians per pin (tension ramps up)... */
export const TUMBLER_WINDOW_STEP = 0.0075;

/** ...but never tighter than this half-width (keeps the deepest pins clickable). */
export const TUMBLER_MIN_WINDOW = 0.16;

/** Seeded per-pin window variation: the ramped width is scaled by a factor in
 *  [1 - JITTER, 1 + JITTER] so pins read wide/narrow rather than uniform. */
export const TUMBLER_WINDOW_JITTER = 0.2;

/** Absolute floor for a jittered window half-width (fairness backstop). */
export const TUMBLER_WINDOW_FLOOR = 0.13;

/** A tap within this inner fraction of the window is a CLEAN PICK. */
export const TUMBLER_CLEAN_FRACTION = 0.45;

/** Points: edge graze, clean pick, clean pick while a hot streak is alive. */
export const TUMBLER_POINTS_GRAZE = 1;
export const TUMBLER_POINTS_CLEAN = 2;
export const TUMBLER_POINTS_CLEAN_STREAK = 3;

/** Consecutive clean picks needed before cleans start paying the streak rate. */
export const TUMBLER_CLEAN_STREAK_MIN = 3;

/** Sticky (double-tap) pins: earliest index + seeded chance + completion bonus. */
export const TUMBLER_STICKY_MIN_INDEX = 6;
export const TUMBLER_STICKY_CHANCE = 0.16;
export const TUMBLER_STICKY_BONUS = 1;

/** A lock LAYER opens every N set pins (presentation milestone, shared here so
 *  client + any server messaging agree on the boundary). */
export const TUMBLER_PINS_PER_LAYER = 5;

/** Minimum spacing between consecutive COUNTED clicks (ms). A human cannot tap
 *  two distinct targets faster than this; tighter taps are IGNORED (not counted,
 *  not fatal) on both sides, which protects the time-bounded ceiling. */
export const TUMBLER_MIN_CLICK_INTERVAL_MS = 110;

/** A single pin cannot legitimately take longer than this to click (ms). Past
 *  it the marker has lapped the ring many times; we treat the tap's `t` as
 *  out-of-bounds and end the run. Generous so slow-but-honest play is fine. */
export const TUMBLER_MAX_PIN_T_MS = 60_000;

/** Absolute ceiling on how many pins we will ever score for one run. */
export const TUMBLER_MAX_PINS = 1_000;

/** Highest points a single pin can pay (clean-streak grade + sticky bonus). */
export const TUMBLER_MAX_POINTS_PER_PIN =
  TUMBLER_POINTS_CLEAN_STREAK + TUMBLER_STICKY_BONUS;

/** Absolute ceiling on the score of one run (coarse plausibility bound). */
export const TUMBLER_MAX_SCORE = TUMBLER_MAX_PINS * TUMBLER_MAX_POINTS_PER_PIN;

/** Absolute ceiling on the tap payload (2 taps per sticky pin + headroom). */
export const TUMBLER_MAX_TAPS = TUMBLER_MAX_PINS * 2 + 8;

// ---------------------------------------------------------------------------
// PRNG — mulberry32. Byte-identical to the repo's seededRandom (math-sprint,
// typing-words, sequence-replay). Returns a function producing floats in [0, 1).
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
 * Derive a stable per-pin RNG from (seed, index). Mixing the index into the seed
 * makes `tumblerPinFor` O(1) and pure — we do NOT have to replay the whole stream
 * to get pin N, and there is no cross-index state to drift between client and
 * server. The two 32-bit mixes spread adjacent indices apart so consecutive pins
 * don't correlate (and notches don't cluster at the same angle).
 */
function rngForIndex(seed: number, index: number): () => number {
  let mixed = (seed ^ Math.imul(index + 1, 0x9e3779b1)) | 0;
  mixed = (mixed + 0x6d2b79f5) | 0;
  return mulberry32(mixed);
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

/** Normalize any angle into [0, TAU). */
function norm(angle: number): number {
  let a = angle % TAU;
  if (a < 0) a += TAU;
  return a;
}

/** Smallest absolute angular distance between two angles, in [0, PI]. */
export function tumblerAngularDelta(a: number, b: number): number {
  const d = Math.abs(norm(a) - norm(b));
  return d > Math.PI ? TAU - d : d;
}

// ---------------------------------------------------------------------------
// Pin schedule (deterministic difficulty ramp)
// ---------------------------------------------------------------------------

export interface TumblerPin {
  /** 0-based position in the deterministic stream. */
  index: number;
  /** Notch center angle, radians in [0, TAU). */
  notch: number;
  /** Angular speed magnitude of the marker for this pin, rad/s. */
  speed: number;
  /** Spin direction: +1 clockwise (increasing angle), -1 counter-clockwise. */
  dir: 1 | -1;
  /** Half-width of the accept arc, radians (full window = 2× this). */
  window: number;
  /** Sticky (double-tap) pin: hit `notch`, then `notch2`, on ONE marker sweep. */
  sticky: boolean;
  /** Second target angle for sticky pins (== notch for normal pins). */
  notch2: number;
}

/** Angular speed magnitude for a given pin index (ramps, then clamps). */
export function tumblerSpeedFor(index: number): number {
  const i = index < 0 ? 0 : Math.floor(index);
  return Math.min(TUMBLER_MAX_SPEED, TUMBLER_BASE_SPEED + i * TUMBLER_SPEED_STEP);
}

/** Hit-window half-width RAMP for a given pin index (narrows, then clamps).
 *  The actual per-pin window applies a seeded jitter on top — see tumblerPinFor. */
export function tumblerWindowFor(index: number): number {
  const i = index < 0 ? 0 : Math.floor(index);
  return Math.max(TUMBLER_MIN_WINDOW, TUMBLER_BASE_WINDOW - i * TUMBLER_WINDOW_STEP);
}

/** Which lock layer a given count of SET pins sits in (layer 0 = the first). */
export function tumblerLayerFor(pinsSet: number): number {
  const p = pinsSet < 0 ? 0 : Math.floor(pinsSet);
  return Math.floor(p / TUMBLER_PINS_PER_LAYER);
}

/**
 * Pure, deterministic pin for a given seed + index. Identical output on the
 * client and the server.
 *
 * The marker ALWAYS begins each pin at angle 0 (top of the ring). The notch is
 * placed at a seed-derived angle that is never so close to 0 that the pin is
 * instantly clickable (we keep it at least one window-width away from the start).
 * Direction occasionally reverses on deeper pins; with a -1 (counter-clockwise)
 * spin the marker sweeps the other way, so the same notch is approached from the
 * opposite side.
 *
 * RNG draw order is FIXED (dir, offset, jitter, sticky, sticky-offset) — never
 * reorder or skip draws, or client and server pins diverge.
 */
export function tumblerPinFor(seed: number, index: number): TumblerPin {
  const safeSeed = seed | 0;
  const safeIndex = index < 0 ? 0 : Math.floor(index);
  const rng = rngForIndex(safeSeed, safeIndex);

  const speed = tumblerSpeedFor(safeIndex);

  // Reversal only kicks in past a few pins, and even then only sometimes, so the
  // early game reads as a steady one-way spin and the twist arrives later.
  const dir: 1 | -1 = safeIndex >= 4 && rng() < 0.22 ? -1 : 1;

  // Seeded window: the depth ramp scaled by ±TUMBLER_WINDOW_JITTER, floored.
  const ramp = tumblerWindowFor(safeIndex);
  const offsetRoll = rng(); // drawn BEFORE jitter to keep legacy notch spread
  const jitter = 1 + (rng() * 2 - 1) * TUMBLER_WINDOW_JITTER;

  // Sticky (double-tap) pins arrive past the early game, rarely.
  const sticky = safeIndex >= TUMBLER_STICKY_MIN_INDEX && rng() < TUMBLER_STICKY_CHANCE;

  // Sticky pins get a slightly wider window — two hits on one sweep is hard.
  const window = Math.max(TUMBLER_WINDOW_FLOOR, ramp * jitter) * (sticky ? 1.2 : 1);

  // Place the notch in the reachable arc. We avoid a dead-zone of `window + pad`
  // radians on the approaching side of 0 so the marker always has to travel to
  // the notch (no zero-distance gimme) regardless of spin direction.
  const pad = 0.22;
  const deadZone = window + pad;
  const span = TAU - deadZone * 2;
  const offset = deadZone + offsetRoll * span; // [deadZone, TAU - deadZone]
  // For a clockwise spin the marker increases from 0, so the notch sits at
  // +offset; for counter-clockwise it decreases, so mirror it to -offset.
  const notch = dir === 1 ? norm(offset) : norm(-offset);

  // Second sticky target: 1.1–2.5 rad FARTHER along the sweep. At the speed
  // ceiling (8.4 rad/s) 1.1 rad is ~131 ms — always beyond the 110 ms cadence
  // floor, so a perfect double-tap is never forced to wait an extra lap.
  const stickyGap = 1.1 + rng() * 1.4;
  const notch2 = sticky ? norm(notch + dir * stickyGap) : notch;

  return { index: safeIndex, notch, speed, dir, window, sticky, notch2 };
}

/**
 * The marker angle at time `t` (ms since the pin began), for a given pin. Pure
 * mirror of the client's per-frame integration: angle = dir * speed * seconds,
 * wrapped into [0, TAU). Exposed so the client can render an identical orbit.
 * NOTE: sticky pins do NOT reset this clock between their two hits.
 */
export function tumblerMarkerAngle(pin: TumblerPin, tMs: number): number {
  const seconds = (tMs > 0 ? tMs : 0) / 1000;
  return norm(pin.dir * pin.speed * seconds);
}

// ---------------------------------------------------------------------------
// Shared tap state machine — the ONE sim both the client and validator run.
// ---------------------------------------------------------------------------

export interface TumblerSimState {
  /** Index of the pin currently being picked. */
  pinIndex: number;
  /** 0 = aiming at `notch`; 1 = sticky pin, first hit landed, aiming `notch2`. */
  stage: 0 | 1;
  /** Pins fully set so far. */
  pins: number;
  /** Authoritative score (points, not pins). */
  score: number;
  /** Consecutive clean picks (resets on any graze). */
  cleanStreak: number;
  /** Sum of the final `t` of every COMPLETED pin — the absolute-timeline anchor. */
  timeline: number;
  /** Absolute timeline of the last counted tap (cadence floor), -Infinity if none. */
  lastCountedAbs: number;
}

export function tumblerInitialState(): TumblerSimState {
  return {
    pinIndex: 0,
    stage: 0,
    pins: 0,
    score: 0,
    cleanStreak: 0,
    timeline: 0,
    lastCountedAbs: -Infinity,
  };
}

export type TumblerTapEvent =
  /** Tap arrived under the cadence floor — deterministically a no-op. */
  | { type: 'ignored' }
  /** Tap `t` was malformed / past the per-pin ceiling — run ends (bounds). */
  | { type: 'bounds' }
  /** Tap landed outside the window — run ends. `nearMiss` = grazed just outside. */
  | { type: 'miss'; delta: number; window: number; target: number; nearMiss: boolean }
  /** Tap landed. `pinComplete` false only for a sticky pin's FIRST hit. */
  | {
      type: 'hit';
      /** Inside the clean inner fraction of the window. */
      clean: boolean;
      /** Points paid by THIS tap (0 for a sticky first hit). */
      points: number;
      /** True when the pin fully set (advance to the next pin). */
      pinComplete: boolean;
      /** True when this was a sticky pin's first (non-scoring) hit. */
      stickyStage: boolean;
      /** True when completing this pin also opened a lock layer. */
      layerOpened: boolean;
      /** Clean streak AFTER this tap. */
      cleanStreak: number;
      delta: number;
      target: number;
    };

/**
 * Apply one tap (t = ms since the CURRENT pin began) to a sim state. Pure:
 * returns a NEW state plus the event describing what happened. This exact
 * function runs on the client per real tap and on the server per recorded tap,
 * so the two can never disagree.
 */
export function tumblerApplyTap(
  seed: number,
  state: TumblerSimState,
  t: number,
): { state: TumblerSimState; event: TumblerTapEvent } {
  if (!Number.isFinite(t) || t < 0 || t > TUMBLER_MAX_PIN_T_MS) {
    return { state, event: { type: 'bounds' } };
  }

  const absT = state.timeline + t;

  // Cadence floor: too-soon taps are ignored on BOTH sides (never fatal, never
  // scoring) so accidental double-taps cannot desync client from validator.
  if (
    state.lastCountedAbs !== -Infinity &&
    absT - state.lastCountedAbs < TUMBLER_MIN_CLICK_INTERVAL_MS
  ) {
    return { state, event: { type: 'ignored' } };
  }

  const pin = tumblerPinFor(seed | 0, state.pinIndex);
  const target = state.stage === 1 ? pin.notch2 : pin.notch;
  const markerAngle = tumblerMarkerAngle(pin, t);
  const delta = tumblerAngularDelta(markerAngle, target);

  if (delta > pin.window) {
    return {
      state,
      event: {
        type: 'miss',
        delta,
        window: pin.window,
        target,
        nearMiss: delta <= pin.window * 1.6,
      },
    };
  }

  const clean = delta <= pin.window * TUMBLER_CLEAN_FRACTION;

  // Sticky pin, first hit: arm the second notch. No points yet; the pin's clock
  // keeps running (the marker does NOT reset), so the next tap's `t` is still
  // relative to this same pin start. A grazed arming hit still breaks the clean
  // streak ("resets on any graze") — a clean one neither breaks nor extends it
  // (only setting taps extend, since only they score).
  if (pin.sticky && state.stage === 0) {
    const armStreak = clean ? state.cleanStreak : 0;
    return {
      state: {
        ...state,
        stage: 1,
        cleanStreak: armStreak,
        lastCountedAbs: absT,
      },
      event: {
        type: 'hit',
        clean,
        points: 0,
        pinComplete: false,
        stickyStage: true,
        layerOpened: false,
        cleanStreak: armStreak,
        delta,
        target,
      },
    };
  }

  // Pin fully set — grade the setting tap.
  const cleanStreak = clean ? state.cleanStreak + 1 : 0;
  let points: number = clean
    ? cleanStreak >= TUMBLER_CLEAN_STREAK_MIN
      ? TUMBLER_POINTS_CLEAN_STREAK
      : TUMBLER_POINTS_CLEAN
    : TUMBLER_POINTS_GRAZE;
  if (pin.sticky) points += TUMBLER_STICKY_BONUS;

  const pins = state.pins + 1;
  const layerOpened = pins % TUMBLER_PINS_PER_LAYER === 0;

  return {
    state: {
      pinIndex: state.pinIndex + 1,
      stage: 0,
      pins,
      score: state.score + points,
      cleanStreak,
      timeline: absT,
      lastCountedAbs: absT,
    },
    event: {
      type: 'hit',
      clean,
      points,
      pinComplete: true,
      stickyStage: false,
      layerOpened,
      cleanStreak,
      delta,
      target,
    },
  };
}

// ---------------------------------------------------------------------------
// Run validation (server-authoritative scoring)
// ---------------------------------------------------------------------------

/** One recorded tap from the client. `t` = ms since the CURRENT pin began
 *  (client clock — used to reconstruct the marker angle and to enforce the
 *  cadence floor). The client never sends an angle; the server derives it. */
export interface TumblerTap {
  /** ms since the current pin's notch first appeared. */
  t: number;
}

export interface TumblerRunResult {
  /** Authoritative score (points) before the first fatal tap. */
  score: number;
  /** Pins fully set before the first fatal tap. */
  pins: number;
  /** How many taps were inspected before scoring stopped. */
  inspected: number;
  /** Why scoring stopped: 'miss' (a tap fell outside the window), 'bounds' (a
   *  tap's `t` was non-finite/negative/over the per-pin ceiling), 'cap' (hit
   *  TUMBLER_MAX_PINS), or 'end' (ran out of taps with no miss). */
  stop: 'miss' | 'bounds' | 'cap' | 'end';
  /** Absolute-timeline ms of every COUNTED tap, for anti-cheat action streams. */
  clickTimesAbs: number[];
}

/**
 * Re-derive the authoritative run from a submitted tap list by replaying every
 * tap through the same `tumblerApplyTap` state machine the client ran. The
 * FIRST fatal tap (miss / bounds) ends the run; under-cadence taps are skipped
 * exactly as the client skips them. Pure and never throws — bad input simply
 * stops scoring.
 */
export function validateTumblerRun(
  seed: number,
  taps: readonly TumblerTap[],
): TumblerRunResult {
  if (!Array.isArray(taps) || taps.length === 0) {
    return { score: 0, pins: 0, inspected: 0, stop: 'end', clickTimesAbs: [] };
  }

  let state = tumblerInitialState();
  let inspected = 0;
  const clickTimesAbs: number[] = [];

  for (let i = 0; i < taps.length && i < TUMBLER_MAX_TAPS; i += 1) {
    if (state.pinIndex >= TUMBLER_MAX_PINS) {
      return { score: state.score, pins: state.pins, inspected, stop: 'cap', clickTimesAbs };
    }
    inspected = i + 1;

    const tap = taps[i];
    const t = typeof tap?.t === 'number' ? tap.t : NaN;
    const applied = tumblerApplyTap(seed, state, t);

    if (applied.event.type === 'bounds') {
      return { score: state.score, pins: state.pins, inspected, stop: 'bounds', clickTimesAbs };
    }
    if (applied.event.type === 'miss') {
      return { score: state.score, pins: state.pins, inspected, stop: 'miss', clickTimesAbs };
    }
    if (applied.event.type === 'hit') {
      clickTimesAbs.push(applied.state.lastCountedAbs);
    }
    state = applied.state;
  }

  return { score: state.score, pins: state.pins, inspected, stop: 'end', clickTimesAbs };
}
