/**
 * High-refresh display helpers for arcade game loops.
 *
 * Design:
 * - **Physics / sim stay at 60 Hz fixed** so anti-cheat, replays, and server
 *   parity keep working (flappy, stack, ricochet, etc.).
 * - **Paint runs every `requestAnimationFrame`** so ProMotion / 120 Hz panels
 *   get a frame every ~8.3ms instead of repeating a 60 Hz sample twice.
 * - **Interpolation** between the previous and current sim snapshot turns
 *   those extra paints into smooth motion (lerp with the leftover accumulator).
 *
 * Do not raise PHYSICS_HZ without updating matching server replay constants.
 */

/** Authoritative sim rate shared with server replay for skill games. */
export const PHYSICS_HZ = 60;
export const PHYSICS_DT_MS = 1000 / PHYSICS_HZ;

/** Cap catch-up so a long tab-hide cannot spiral the sim. */
export const MAX_PHYSICS_STEPS_PER_FRAME = 4;

/** Max frame delta before we treat it as a hitch (ms). */
export const MAX_FRAME_DELTA_MS = 100;

/** A single painted frame as observed by the shared runtime. */
export type GameFrameInfo = {
  nowMs: number;
  deltaMs: number;
  simulationSteps: number;
  /** True when the delta had to be clamped after a hitch/tab resume. */
  hitched: boolean;
  /** True while a hit-stop holds the simulation still. Paint still runs. */
  frozen: boolean;
};

/**
 * What the loop reads from a hit-stop (`createHitStop()` in game-feel.ts, or
 * `useGameFeedback().hitStop`). Time inside the freeze never reaches the
 * accumulator, so the sim pauses and resumes without a catch-up burst.
 */
export type GameFrameHitStop = {
  isFrozen: (nowMs: number) => boolean;
  frozenWithin: (fromMs: number, toMs: number) => number;
  /** Changes when a freeze is requested; the loop stops stepping at once. */
  readonly frozenUntil: number;
};

export type GameFrameLoopOptions = {
  /** Fixed deterministic simulation step. Defaults to 60 Hz. */
  stepMs?: number;
  /** Maximum simulations performed before dropping stale accumulated time. */
  maxStepsPerFrame?: number;
  /** Largest wall-clock delta admitted to the accumulator. */
  maxDeltaMs?: number;
  /** Snapshot interpolated entities immediately before each simulation step. */
  beforeSimulate?: () => void;
  /** Return false to stop the loop after the current simulation step. */
  simulate: (stepMs: number) => boolean | void;
  /** Paint the latest state. Alpha is the remaining fixed-step fraction. */
  render: (alpha: number, frame: GameFrameInfo) => void;
  /** Optional low-overhead hook used by the opt-in performance monitor. */
  onFrame?: (frame: GameFrameInfo) => void;
  /** Suspend fully while the document is hidden. Defaults to true. */
  pauseWhenHidden?: boolean;
  /** Optional hit-stop. Frozen wall time is not simulated. */
  hitStop?: GameFrameHitStop;
};

export type GameFrameLoop = {
  start: () => void;
  stop: () => void;
  destroy: () => void;
  resetClock: () => void;
  isRunning: () => boolean;
};

export function clampFrameDelta(deltaMs: number, max = MAX_FRAME_DELTA_MS): number {
  if (!Number.isFinite(deltaMs) || deltaMs < 0) return PHYSICS_DT_MS;
  return Math.min(deltaMs, max);
}

/**
 * Interpolation alpha in [0, 1) from leftover accumulator after fixed steps.
 * 0 = fully previous state, approaching 1 = fully current state.
 */
export function physicsAlpha(accumulatorMs: number, stepMs = PHYSICS_DT_MS): number {
  if (stepMs <= 0) return 0;
  return Math.min(1, Math.max(0, accumulatorMs / stepMs));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Preferred 2D canvas context flags for smooth high-refresh play.
 * `desynchronized` reduces input→paint latency on supporting browsers
 * (Safari/Chrome on macOS); falls back cleanly when unsupported.
 */
export function getGame2dContext(
  canvas: HTMLCanvasElement,
  opts?: { alpha?: boolean },
): CanvasRenderingContext2D | null {
  const alpha = opts?.alpha ?? false;
  try {
    const ctx = canvas.getContext('2d', {
      alpha,
      desynchronized: true,
      // willReadFrequently false — we are write-heavy game loops
      willReadFrequently: false,
    } as CanvasRenderingContext2DSettings);
    if (ctx) return ctx;
  } catch {
    /* older engines reject the options bag */
  }
  return canvas.getContext('2d', { alpha });
}

/**
 * Cap devicePixelRatio for large canvases so 120 Hz paint stays cheap.
 * Small stages (≤480 CSS px) keep full DPR; larger stages soft-cap at 1.75.
 */
export function gameCanvasDpr(cssWidth: number, cssHeight: number): number {
  const raw = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  const longEdge = Math.max(cssWidth, cssHeight);
  const cap = longEdge > 720 ? 1.5 : longEdge > 480 ? 1.75 : 2;
  // High-DPR canvases grow quadratically. A DPR of 3 asks a phone to shade
  // nine times as many pixels as DPR 1, which is rarely visible in motion.
  // Bias constrained devices toward a stable frame rate while retaining full
  // resolution on compact stages and capable hardware.
  const nav = typeof navigator !== 'undefined'
    ? (navigator as Navigator & {
        deviceMemory?: number;
        connection?: { saveData?: boolean };
      })
    : null;
  const constrained = Boolean(
    nav &&
      ((nav.deviceMemory != null && nav.deviceMemory <= 4) ||
        (nav.hardwareConcurrency != null && nav.hardwareConcurrency <= 4) ||
        nav.connection?.saveData),
  );
  return Math.min(raw, constrained ? Math.min(cap, 1.5) : cap);
}

/**
 * Shared deterministic game-loop lifecycle.
 *
 * The runtime deliberately owns only clocks and scheduling. Game state stays
 * in each game's refs/pure engine, so adopting this cannot change replay or
 * anti-cheat payloads. It also stops scheduling while hidden and resets the
 * accumulator on resume, avoiding both timer work and a catch-up explosion.
 */
export function createGameFrameLoop(options: GameFrameLoopOptions): GameFrameLoop {
  const stepMs = options.stepMs ?? PHYSICS_DT_MS;
  const maxSteps = options.maxStepsPerFrame ?? MAX_PHYSICS_STEPS_PER_FRAME;
  const maxDelta = options.maxDeltaMs ?? MAX_FRAME_DELTA_MS;
  const pauseWhenHidden = options.pauseWhenHidden ?? true;

  let running = false;
  let destroyed = false;
  let rafId: number | null = null;
  let previousNow: number | null = null;
  let accumulatorMs = 0;

  const cancelScheduledFrame = () => {
    if (rafId != null && typeof cancelAnimationFrame !== 'undefined') {
      cancelAnimationFrame(rafId);
    }
    rafId = null;
  };

  const resetClock = () => {
    previousNow = null;
    accumulatorMs = 0;
  };

  const schedule = () => {
    if (
      !running ||
      destroyed ||
      rafId != null ||
      typeof requestAnimationFrame === 'undefined'
    ) {
      return;
    }
    rafId = requestAnimationFrame(tick);
  };

  const tick = (nowMs: number) => {
    rafId = null;
    if (!running || destroyed) return;

    if (pauseWhenHidden && typeof document !== 'undefined' && document.hidden) {
      resetClock();
      return;
    }

    // The first paint establishes the clock. It must not invent a simulation
    // step; existing games start from an explicit state and advance only after
    // real wall time has elapsed.
    const rawDelta = previousNow == null ? 0 : nowMs - previousNow;
    const frozenMs =
      options.hitStop && previousNow != null
        ? options.hitStop.frozenWithin(previousNow, nowMs)
        : 0;
    const frozen = options.hitStop?.isFrozen(nowMs) ?? false;
    previousNow = nowMs;
    const deltaMs = clampFrameDelta(rawDelta, maxDelta);
    const hitched = rawDelta > maxDelta;
    // Clamp what is left after the freeze, so a long frame that held a
    // hit-stop still simulates the time around it.
    accumulatorMs += clampFrameDelta(Math.max(0, rawDelta - frozenMs), maxDelta);

    let simulationSteps = 0;
    let keepRunning = true;
    const freezeMark = options.hitStop?.frozenUntil;
    while (!frozen && accumulatorMs >= stepMs && simulationSteps < maxSteps) {
      options.beforeSimulate?.();
      if (options.simulate(stepMs) === false) {
        keepRunning = false;
        accumulatorMs = 0;
        break;
      }
      accumulatorMs -= stepMs;
      simulationSteps += 1;
      // A step that requested a freeze ends stepping now. The time still in
      // the accumulator is simulated after the freeze.
      if (options.hitStop && options.hitStop.frozenUntil !== freezeMark) break;
    }

    // Do not carry an unbounded backlog into the next paint. The deterministic
    // sim still receives at most maxSteps identical fixed steps this frame.
    if (simulationSteps >= maxSteps && accumulatorMs >= stepMs) {
      accumulatorMs = 0;
    }

    const frame: GameFrameInfo = {
      nowMs,
      deltaMs,
      simulationSteps,
      hitched,
      frozen,
    };
    if (keepRunning) {
      options.render(physicsAlpha(accumulatorMs, stepMs), frame);
      options.onFrame?.(frame);
      schedule();
    } else {
      running = false;
    }
  };

  const onVisibilityChange = () => {
    if (!pauseWhenHidden || !running) return;
    resetClock();
    if (document.hidden) cancelScheduledFrame();
    else schedule();
  };

  if (pauseWhenHidden && typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisibilityChange);
  }

  return {
    start() {
      if (destroyed || running) return;
      running = true;
      resetClock();
      schedule();
    },
    stop() {
      running = false;
      cancelScheduledFrame();
      resetClock();
    },
    destroy() {
      if (destroyed) return;
      running = false;
      destroyed = true;
      cancelScheduledFrame();
      resetClock();
      if (pauseWhenHidden && typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibilityChange);
      }
    },
    resetClock,
    isRunning() {
      return running;
    },
  };
}

export type AdaptiveGameQuality = {
  /** Feed one measured paint duration/delta. Returns true when tier changes. */
  sample: (frameMs: number, nowMs?: number) => boolean;
  tier: () => 'high' | 'medium' | 'low';
  dprScale: () => number;
  particleScale: () => number;
  reset: () => void;
};

/**
 * Slow-moving quality governor. It requires sustained pressure before stepping
 * down and sustained headroom before stepping back up, preventing visual tier
 * oscillation during a single explosion or browser hitch.
 */
export function createAdaptiveGameQuality(): AdaptiveGameQuality {
  let quality: 0 | 1 | 2 = 2;
  let averageMs = PHYSICS_DT_MS;
  let samples = 0;
  let lastChangeMs = 0;

  const reset = () => {
    quality = 2;
    averageMs = PHYSICS_DT_MS;
    samples = 0;
    lastChangeMs = 0;
  };

  return {
    sample(frameMs, nowMs = typeof performance !== 'undefined' ? performance.now() : 0) {
      if (!Number.isFinite(frameMs) || frameMs <= 0 || frameMs > 250) return false;
      averageMs += (frameMs - averageMs) * 0.05;
      samples += 1;
      if (samples < 90 || nowMs - lastChangeMs < 3000) return false;

      const previous = quality;
      if (averageMs > 22 && quality > 0) quality = (quality - 1) as 0 | 1;
      else if (averageMs < 15 && quality < 2) quality = (quality + 1) as 1 | 2;
      if (quality !== previous) {
        lastChangeMs = nowMs;
        samples = 0;
        return true;
      }
      return false;
    },
    tier: () => (quality === 2 ? 'high' : quality === 1 ? 'medium' : 'low'),
    dprScale: () => (quality === 2 ? 1 : quality === 1 ? 0.82 : 0.68),
    particleScale: () => (quality === 2 ? 1 : quality === 1 ? 0.65 : 0.35),
    reset,
  };
}
