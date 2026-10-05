/* ---------------------------------------------------------------------------
   The feel kit: hit-stop, shake, squash, the pitch ladder and rolling numbers.

   Everything here is plain TypeScript with no React, so canvas loops, DOM
   games and the verifier (scripts/verify-feel-kit.ts) share one copy. The
   React side lives in use-game-feedback.ts and use-rolling-number.ts. The
   rules for when a game uses each piece are in
   docs/design/tixy-rebrand/FEEL.md.
   ------------------------------------------------------------------------- */

/* ── Timings and curves (PLAN.md, "Motion and sound") ─────────────────── */

export const FEEL = {
  /** Springs overshoot a little. */
  springEase: 'cubic-bezier(.2,1.5,.4,1)',
  /** Anything that slows to a stop. */
  settleEase: 'cubic-bezier(.15,.8,.25,1)',
  /** Press: 40 ms in, 90 ms out. */
  pressInMs: 40,
  pressOutMs: 90,
  /** Hit-stop on the biggest impact in a game: 40 to 60 ms. */
  hitStopMs: 50,
  hitStopMinMs: 40,
  hitStopMaxMs: 60,
  /** Shake: 2 to 4 px, scaled by force. */
  shakeMinPx: 2,
  shakeMaxPx: 4,
  shakeMs: 180,
  /** Landing squash, recovering on the spring curve. */
  squashMs: 220,
  /** The balance counts up over 700 ms. */
  rollMs: 700,
} as const;

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const clampForce = (force: number | undefined) =>
  clamp(Number.isFinite(force) ? (force as number) : 1, 0, 1);

/* ── Curves ───────────────────────────────────────────────────────────── */

/**
 * Evaluate a CSS cubic-bezier for progress x in [0, 1]. y may leave [0, 1]
 * (the spring overshoots), exactly as the browser's easing would.
 */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number) {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sampleX = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sampleY = (t: number) => ((ay * t + by) * t + cy) * t;
  const slopeX = (t: number) => (3 * ax * t + 2 * bx) * t + cx;

  return (x: number): number => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    // Newton first, bisection if the slope is flat.
    let t = x;
    for (let i = 0; i < 6; i += 1) {
      const error = sampleX(t) - x;
      if (Math.abs(error) < 1e-6) return sampleY(t);
      const slope = slopeX(t);
      if (Math.abs(slope) < 1e-6) break;
      t -= error / slope;
    }
    let lo = 0;
    let hi = 1;
    t = x;
    for (let i = 0; i < 30; i += 1) {
      const value = sampleX(t);
      if (Math.abs(value - x) < 1e-6) break;
      if (value < x) lo = t;
      else hi = t;
      t = (lo + hi) / 2;
    }
    return sampleY(t);
  };
}

export const springEase = cubicBezier(0.2, 1.5, 0.4, 1);
export const settleEase = cubicBezier(0.15, 0.8, 0.25, 1);

/* ── Reduced motion, read once and kept live ──────────────────────────── */

let reducedMotionValue: boolean | null = null;
const reducedMotionListeners = new Set<() => void>();

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

function initReducedMotion(): boolean {
  if (reducedMotionValue !== null) return reducedMotionValue;
  // Same check as prefersReducedMotion() in arcade-interactive.tsx, inlined so
  // this module stays free of 'use client' component imports.
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  const query = window.matchMedia(REDUCED_MOTION_QUERY);
  reducedMotionValue = query.matches === true;
  const onChange = (event: { matches: boolean }) => {
    reducedMotionValue = event.matches === true;
    for (const listener of reducedMotionListeners) listener();
  };
  if (typeof query.addEventListener === 'function') {
    query.addEventListener('change', onChange);
  } else if (typeof query.addListener === 'function') {
    query.addListener(onChange);
  }
  return reducedMotionValue;
}

/** The player's reduced-motion setting. Reads the OS once, then follows it.
 *  False on the server. */
export function feelReducedMotion(): boolean {
  return initReducedMotion();
}

/** For useSyncExternalStore: re-render when the OS setting changes. */
export function subscribeReducedMotion(listener: () => void): () => void {
  initReducedMotion();
  reducedMotionListeners.add(listener);
  return () => {
    reducedMotionListeners.delete(listener);
  };
}

/* ── Pitch ladder ─────────────────────────────────────────────────────── */

/**
 * SoundManager's `pitch` is a frequency multiplier (a playback rate for
 * sampled cues, clamped to 0.5 to 2). This converts semitones into it.
 */
export function semitonesToPitch(semitones: number): number {
  return Math.pow(2, semitones / 12);
}

export type PitchLadder = {
  /** Pitch for this success, then step up one rung. First call returns 1. */
  next: () => number;
  /** The run broke: the next success starts from the bottom again. */
  reset: () => void;
  /** Rungs climbed so far (0 after reset). */
  readonly step: number;
};

/**
 * Repeated successes step the sound up a semitone; `reset()` when the run
 * breaks. Stops climbing after `maxSteps` rungs (12 = one octave, which is
 * also the ceiling sampled cues can reach).
 */
export function createPitchLadder(options?: { maxSteps?: number }): PitchLadder {
  const maxSteps = Math.max(0, Math.floor(options?.maxSteps ?? 12));
  let step = 0;
  return {
    next() {
      const pitch = semitonesToPitch(step);
      step = Math.min(step + 1, maxSteps);
      return pitch;
    },
    reset() {
      step = 0;
    },
    get step() {
      return step;
    },
  };
}

/* ── Hit-stop ─────────────────────────────────────────────────────────── */

/**
 * A hit-stop is a `frozenUntil` timestamp on the `performance.now()` clock.
 * Loops consult it and do not advance simulation time while
 * `now < frozenUntil`; they keep painting so shake still shows.
 */
export type HitStop = {
  /** Freeze for `ms` (clamped to 40 to 60; 0 under reduced motion). */
  freeze: (ms?: number, now?: number) => void;
  isFrozen: (now: number) => boolean;
  /** Milliseconds of [fromMs, toMs] that fall inside the freeze. */
  frozenWithin: (fromMs: number, toMs: number) => number;
  readonly frozenFrom: number;
  readonly frozenUntil: number;
  /** True once a loop has called isFrozen or frozenWithin. */
  readonly consulted: boolean;
};

export function hitStopDuration(ms: number | undefined, reduced: boolean): number {
  if (reduced) return 0;
  return clamp(ms ?? FEEL.hitStopMs, FEEL.hitStopMinMs, FEEL.hitStopMaxMs);
}

const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export function createHitStop(options?: { reducedMotion?: () => boolean }): HitStop {
  const reduced = options?.reducedMotion ?? feelReducedMotion;
  let frozenFrom = 0;
  let frozenUntil = 0;
  let consulted = false;
  return {
    freeze(ms, now = nowMs()) {
      const duration = hitStopDuration(ms, reduced());
      if (duration <= 0) return;
      // A second freeze during the first extends it; it never stacks past 60 ms.
      if (now < frozenUntil) {
        frozenUntil = Math.max(frozenUntil, Math.min(now + duration, frozenFrom + FEEL.hitStopMaxMs));
        return;
      }
      frozenFrom = now;
      frozenUntil = now + duration;
    },
    isFrozen(now) {
      consulted = true;
      return now >= frozenFrom && now < frozenUntil;
    },
    frozenWithin(fromMs, toMs) {
      consulted = true;
      return Math.max(0, Math.min(toMs, frozenUntil) - Math.max(fromMs, frozenFrom));
    },
    get frozenFrom() {
      return frozenFrom;
    },
    get frozenUntil() {
      return frozenUntil;
    },
    get consulted() {
      return consulted;
    },
  };
}

/* ── Shake ────────────────────────────────────────────────────────────── */

export type ShakeOffset = { x: number; y: number };

const NO_SHAKE: ShakeOffset = Object.freeze({ x: 0, y: 0 });

/** Peak amplitude for a force in [0, 1]: 2 px at 0, 4 px at 1. */
export function shakeAmplitude(force: number): number {
  return FEEL.shakeMinPx + (FEEL.shakeMaxPx - FEEL.shakeMinPx) * clampForce(force);
}

/** Each jolt holds for two 60 Hz frames, so every paint shows the swing. */
const SHAKE_JOLT_MS = 30;
const SHAKE_Y = [0.5, -0.25, -0.5, 0.25] as const;

/**
 * Offset `elapsedMs` after a kick of `amplitudePx`. Deterministic: six jolts
 * that alternate left and right (with half as much vertical), decaying
 * linearly to rest over `FEEL.shakeMs`.
 */
export function shakeOffsetAt(amplitudePx: number, elapsedMs: number): ShakeOffset {
  if (amplitudePx <= 0 || elapsedMs < 0 || elapsedMs >= FEEL.shakeMs) return NO_SHAKE;
  const decay = 1 - elapsedMs / FEEL.shakeMs;
  const jolt = Math.floor(elapsedMs / SHAKE_JOLT_MS);
  const size = amplitudePx * decay;
  return {
    x: Math.round(size * (jolt % 2 === 0 ? 1 : -1) * 10) / 10,
    y: Math.round(size * SHAKE_Y[jolt % 4]! * 10) / 10,
  };
}

export type Shake = {
  /** Kick with force in [0, 1]. Does nothing under reduced motion. */
  kick: (force?: number, now?: number) => void;
  /** Offset to apply this frame. {0, 0} when still. */
  offset: (now?: number) => ShakeOffset;
  /** True while an offset is still playing. */
  active: (now?: number) => boolean;
  stop: () => void;
};

export function createShake(options?: { reducedMotion?: () => boolean }): Shake {
  const reduced = options?.reducedMotion ?? feelReducedMotion;
  let startedAt = -Infinity;
  let amplitude = 0;
  const remaining = (now: number) => {
    const elapsed = now - startedAt;
    if (elapsed < 0 || elapsed >= FEEL.shakeMs) return 0;
    return amplitude * (1 - elapsed / FEEL.shakeMs);
  };
  return {
    kick(force, now = nowMs()) {
      if (reduced()) return;
      const next = shakeAmplitude(force ?? 1);
      // A weaker hit during a stronger shake does not cut it short.
      if (remaining(now) > next) return;
      startedAt = now;
      amplitude = next;
    },
    offset(now = nowMs()) {
      if (reduced()) return NO_SHAKE;
      return shakeOffsetAt(amplitude, now - startedAt);
    },
    active(now = nowMs()) {
      return !reduced() && remaining(now) > 0;
    },
    stop() {
      startedAt = -Infinity;
      amplitude = 0;
    },
  };
}

/* ── Squash on landing ────────────────────────────────────────────────── */

export type SquashScale = { scaleX: number; scaleY: number };

const NO_SQUASH: SquashScale = Object.freeze({ scaleX: 1, scaleY: 1 });

/** Squash at the moment of contact for a force in [0, 1]. */
export function squashPeak(force = 1): SquashScale {
  const f = clampForce(force);
  return { scaleX: 1 + 0.24 * f, scaleY: 1 - 0.2 * f };
}

/**
 * Scale `elapsedMs` after landing. Starts flat and wide, springs back with a
 * small overshoot (taller than round) on `FEEL.springEase`. Canvas games
 * multiply their sprite scale by this; it is {1, 1} under reduced motion.
 */
export function squashAt(
  elapsedMs: number,
  options?: { force?: number; durationMs?: number; reduced?: boolean },
): SquashScale {
  const reduced = options?.reduced ?? feelReducedMotion();
  const duration = options?.durationMs ?? FEEL.squashMs;
  if (reduced || elapsedMs < 0 || elapsedMs >= duration) return NO_SQUASH;
  const peak = squashPeak(options?.force);
  const left = 1 - springEase(elapsedMs / duration);
  return {
    scaleX: 1 + (peak.scaleX - 1) * left,
    scaleY: 1 + (peak.scaleY - 1) * left,
  };
}

/**
 * Squash a DOM element that just landed. Animates the individual `scale`
 * property with the Web Animations API, so it composes with any `transform`
 * the game writes. Set `transform-origin` (usually `50% 100%`) in the game's
 * CSS. No-op under reduced motion or without WAAPI.
 */
export function squashElement(
  element: Element | null | undefined,
  options?: { force?: number; durationMs?: number },
): void {
  if (!element || typeof (element as HTMLElement).animate !== 'function') return;
  if (feelReducedMotion()) return;
  const peak = squashPeak(options?.force);
  try {
    (element as HTMLElement).animate(
      [{ scale: `${peak.scaleX} ${peak.scaleY}` }, { scale: '1 1' }],
      { duration: options?.durationMs ?? FEEL.squashMs, easing: FEEL.springEase },
    );
  } catch {
    // Motion is enhancement.
  }
}

/* ── Rolling numbers ──────────────────────────────────────────────────── */

/** Roll length after reduced motion: it jumps to the end (0 ms). */
export function rollDuration(
  durationMs: number = FEEL.rollMs,
  reduced: boolean = feelReducedMotion(),
): number {
  return reduced ? 0 : Math.max(0, durationMs);
}

/**
 * The value a roll from `from` to `to` shows `elapsedMs` in, on the settle
 * curve, rounded to `decimals`. Ends exactly on `to`.
 */
export function rollingValueAt(
  from: number,
  to: number,
  elapsedMs: number,
  durationMs: number = FEEL.rollMs,
  decimals = 0,
): number {
  if (durationMs <= 0 || elapsedMs >= durationMs || from === to) return to;
  const progress = settleEase(Math.max(0, elapsedMs) / durationMs);
  const factor = Math.pow(10, decimals);
  const value = Math.round((from + (to - from) * progress) * factor) / factor;
  // The settle curve never overshoots, but rounding must not pass the target.
  return to > from ? Math.min(value, to) : Math.max(value, to);
}

export type NumberRoll = {
  /** Start rolling to `to` from whatever `sample(now)` shows now. */
  retarget: (to: number, now: number, durationMs: number) => void;
  /** The number to show at `now`. */
  sample: (now: number) => number;
  /** True once the roll has reached its target. */
  done: (now: number) => boolean;
};

/**
 * The state behind useRollingNumber. A retarget mid-roll continues from the
 * number on screen, so the display never jumps.
 */
export function createNumberRoll(initial: number, decimals = 0): NumberRoll {
  let from = initial;
  let to = initial;
  let startedAt = 0;
  let duration = 0;
  const sample = (now: number) => rollingValueAt(from, to, now - startedAt, duration, decimals);
  return {
    retarget(next, now, durationMs) {
      from = sample(now);
      to = next;
      startedAt = now;
      duration = !Number.isFinite(from) || !Number.isFinite(next) ? 0 : Math.max(0, durationMs);
    },
    sample,
    done(now) {
      return sample(now) === to;
    },
  };
}
