/* Quality tiers, the adaptive tier controller, WebGL detection and reduced
   motion for the 3D boardwalk games. No three.js import, so pages can check
   WebGL or pick a tier without loading the renderer. midway-three.ts
   re-exports everything here; games import from there.

   The rules are in docs/design/tixy-rebrand/THREE.md. */

import {
  recordArcadePerformanceMetric,
  reportArcadeQuality,
} from './arcade-performance';
import { gameCanvasDpr } from './game-frame-loop';

/* ── Tiers ── */

export type MidwayTier = 'low' | 'medium' | 'high';

export const MIDWAY_TIER_ORDER: readonly MidwayTier[] = ['low', 'medium', 'high'];

export interface MidwayTierSettings {
  /** Upper bound on the canvas pixel ratio. gameCanvasDpr can only lower it. */
  maxPixelRatio: number;
  /** MSAA. Fixed when the context is created, so only the start tier sets it. */
  antialias: boolean;
  /** Key light shadow map edge in texels. 0 turns shadows off. */
  shadowMapSize: number;
  /** Share of a bulb string's bulbs to build. Read once, at scene build. */
  bulbScale: number;
  /** Share of a burst's particles to emit. Read at every emit. */
  particleScale: number;
}

/** There are no post effects in the kit at any tier. */
export const MIDWAY_TIERS: Readonly<Record<MidwayTier, Readonly<MidwayTierSettings>>> = {
  low: {
    maxPixelRatio: 1,
    antialias: false,
    shadowMapSize: 0,
    bulbScale: 0.5,
    particleScale: 0.4,
  },
  medium: {
    maxPixelRatio: 1.5,
    antialias: true,
    shadowMapSize: 1024,
    bulbScale: 1,
    particleScale: 0.75,
  },
  high: {
    maxPixelRatio: 2,
    antialias: true,
    shadowMapSize: 2048,
    bulbScale: 1,
    particleScale: 1,
  },
};

const tierIndex = (tier: MidwayTier) => MIDWAY_TIER_ORDER.indexOf(tier);
const lowerTier = (a: MidwayTier, b: MidwayTier) => (tierIndex(a) <= tierIndex(b) ? a : b);

function isTier(value: unknown): value is MidwayTier {
  return value === 'low' || value === 'medium' || value === 'high';
}

const ceilingKey = (game: string) => `midway-tier:${game}`;

function readCeiling(game: string): MidwayTier | null {
  try {
    const value = window.sessionStorage.getItem(ceilingKey(game));
    return isTier(value) ? value : null;
  } catch {
    return null;
  }
}

function writeCeiling(game: string, tier: MidwayTier): void {
  try {
    window.sessionStorage.setItem(ceilingKey(game), tier);
  } catch {
    // Private mode or storage off: the drop still holds for this page.
  }
}

/** `?midwayTier=low|medium|high` pins a tier for QA and turns adaptation off. */
function pinnedTier(): MidwayTier | null {
  if (typeof window === 'undefined') return null;
  try {
    const value = new URLSearchParams(window.location.search).get('midwayTier');
    return isTier(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * The tier a game starts on. Low on a touch screen with 4 GB of memory or
 * 4 cores or fewer, medium everywhere else. High is never a start tier: the
 * controller promotes to it once the game has shown headroom. A tier the
 * controller dropped to earlier in this browser session is a ceiling.
 */
export function pickMidwayStartTier(game: string): MidwayTier {
  if (typeof window === 'undefined') return 'medium';
  const pinned = pinnedTier();
  if (pinned) return pinned;
  const nav = navigator as Navigator & { deviceMemory?: number };
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  const smallMemory = nav.deviceMemory != null && nav.deviceMemory <= 4;
  const fewCores = nav.hardwareConcurrency != null && nav.hardwareConcurrency <= 4;
  const hinted: MidwayTier = coarse && (smallMemory || fewCores) ? 'low' : 'medium';
  const ceiling = readCeiling(game);
  return ceiling ? lowerTier(hinted, ceiling) : hinted;
}

/** Canvas pixel ratio for a tier: the shared DPR rule, capped by the tier. */
export function midwayPixelRatio(tier: MidwayTier, cssWidth: number, cssHeight: number): number {
  return Math.min(gameCanvasDpr(cssWidth, cssHeight), MIDWAY_TIERS[tier].maxPixelRatio);
}

/** Bulbs to build for a string that would have `count` at full quality. */
export function midwayBulbCount(count: number, tier: MidwayTier): number {
  return Math.max(3, Math.round(count * MIDWAY_TIERS[tier].bulbScale));
}

/** Particles to emit for a burst that would be `count` at full quality. */
export function midwayParticleCount(count: number, tier: MidwayTier): number {
  if (count <= 0) return 0;
  return Math.max(1, Math.round(count * MIDWAY_TIERS[tier].particleScale));
}

/* ── Adaptive controller ── */

export interface MidwayFrameStats {
  samples: number;
  p50FrameMs: number | null;
  p90FrameMs: number | null;
}

export interface MidwayQualityController {
  readonly game: string;
  readonly startTier: MidwayTier;
  /**
   * The tier the controller has decided on. Particle budgets read this, so a
   * drop cuts particles at once, even mid-round.
   */
  tier(): MidwayTier;
  /** The tier last handed to onChange listeners: what the scene is drawn at. */
  appliedTier(): MidwayTier;
  settings(): Readonly<MidwayTierSettings>;
  /**
   * Feed one painted frame with its rAF timestamp. Returns the decided tier
   * when this frame changed it, else null. Pass `deltaMs: 0` (what
   * createGameFrameLoop reports on the first frame after start) to restart
   * the clock and the window without a sample.
   */
  frame(nowMs: number, deltaMs?: number): MidwayTier | null;
  /**
   * Hold tier changes while a decision is live (the player is aiming, timing
   * a swing, steering a claw). A decided change waits, and no further change
   * is decided, until hold(false); then listeners run at once.
   */
  hold(held: boolean): void;
  /** Stop sampling while deferred textures upload. Calls nest. */
  pauseSampling(): void;
  /** Resume sampling; frames in the next `graceMs` are still ignored. */
  resumeSampling(graceMs?: number): void;
  /** Forget the clock and the window, after the loop parks or the tab hides. */
  reset(): void;
  /** Runs when a change is applied: at once, or when the hold is released. */
  onChange(listener: (tier: MidwayTier, previous: MidwayTier) => void): () => void;
  stats(): MidwayFrameStats;
  dispose(): void;
}

export interface MidwayQualityOptions {
  game: string;
  /** Defaults to pickMidwayStartTier(game). */
  start?: MidwayTier;
  /** Drop a tier when the window's p90 stays above this. */
  budgetMs?: number;
  /** How long p90 must stay over budget before a drop. */
  dropAfterMs?: number;
  /** Rolling window the percentiles are taken over. */
  windowMs?: number;
  /** Medium climbs to high once p90 stays under this... */
  headroomMs?: number;
  /** ...for this long, and only if nothing dropped this session. */
  promoteAfterMs?: number;
}

const EVALUATE_EVERY_MS = 250;
const MIN_WINDOW_SAMPLES = 8;
/** Gaps longer than this are a parked loop or a hidden tab, not a frame. */
const MAX_SAMPLE_MS = 1000;
/** Frames ignored after deferred textures finish uploading. */
export const MIDWAY_SAMPLING_GRACE_MS = 500;

function percentile(sorted: number[], q: number): number | null {
  if (sorted.length === 0) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * q) - 1));
  return sorted[index] ?? null;
}

function clockNow(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/**
 * Measures frame time over a rolling window and drops one tier when the p90
 * stays over 18 ms for a second. It never climbs back after a drop in the same
 * browser session; the dropped tier is remembered per game in sessionStorage,
 * and a game that dropped on an earlier visit can't climb either. The only
 * climb is medium to high, after 3 s of p90 under 12 ms with no drop. Changes
 * wait while the game holds them (a live decision). Every change, and the
 * frame times, go to the arcade performance overlay.
 */
export function createMidwayQualityController(
  options: MidwayQualityOptions,
): MidwayQualityController {
  const game = options.game;
  const budgetMs = options.budgetMs ?? 18;
  const dropAfterMs = options.dropAfterMs ?? 1000;
  const windowMs = options.windowMs ?? 1000;
  const headroomMs = options.headroomMs ?? 12;
  const promoteAfterMs = options.promoteAfterMs ?? 3000;
  const pinned = pinnedTier();
  const startTier = options.start ?? pickMidwayStartTier(game);

  let tier: MidwayTier = startTier;
  let applied: MidwayTier = startTier;
  // A drop earlier in this session counts: no climbing on a later visit.
  let dropped = readCeiling(game) !== null;
  let held = false;
  let paused = 0;
  let ignoreUntil = 0;
  let previousNow: number | null = null;
  let lastEvaluation = 0;
  let overSince: number | null = null;
  let underSince: number | null = null;
  let disposed = false;
  const times: number[] = [];
  const deltas: number[] = [];
  let last: MidwayFrameStats = { samples: 0, p50FrameMs: null, p90FrameMs: null };
  const listeners = new Set<(tier: MidwayTier, previous: MidwayTier) => void>();

  const clearWindow = () => {
    times.length = 0;
    deltas.length = 0;
    overSince = null;
    underSince = null;
  };

  const publish = (reason: string | null) => {
    reportArcadeQuality({
      game,
      tier,
      startTier,
      p50FrameMs: last.p50FrameMs,
      p90FrameMs: last.p90FrameMs,
      samples: last.samples,
    });
    if (reason) {
      recordArcadePerformanceMetric('quality', game, 0, {
        tier,
        startTier,
        reason,
        p50FrameMs: last.p50FrameMs === null ? null : Math.round(last.p50FrameMs * 10) / 10,
        p90FrameMs: last.p90FrameMs === null ? null : Math.round(last.p90FrameMs * 10) / 10,
      });
    }
  };

  const deliver = () => {
    if (held || disposed || tier === applied) return;
    const previous = applied;
    applied = tier;
    // The window measured the old tier; start fresh on the new one.
    clearWindow();
    for (const listener of listeners) listener(tier, previous);
  };

  const change = (next: MidwayTier, reason: string) => {
    tier = next;
    clearWindow();
    publish(reason);
    deliver();
  };

  publish(pinned ? 'pinned' : 'start');

  return {
    game,
    startTier,
    tier: () => tier,
    appliedTier: () => applied,
    settings: () => MIDWAY_TIERS[tier],
    frame(nowMs, deltaMs) {
      if (disposed) return null;
      if (deltaMs === 0 || previousNow === null) {
        previousNow = nowMs;
        clearWindow();
        return null;
      }
      const delta = nowMs - previousNow;
      previousNow = nowMs;
      if (!(delta > 0) || delta > MAX_SAMPLE_MS) return null;
      if (paused > 0 || nowMs < ignoreUntil) return null;
      // A decided change still waiting on the hold: these frames show the old
      // tier, so judging them would drop a second time for the same cause.
      if (tier !== applied) return null;

      times.push(nowMs);
      deltas.push(delta);
      // Keep at least the last few frames, so a very slow game (a frame every
      // 150 ms) still has a window to judge.
      while (times.length > MIN_WINDOW_SAMPLES && nowMs - times[0]! > windowMs) {
        times.shift();
        deltas.shift();
      }
      if (nowMs - lastEvaluation < EVALUATE_EVERY_MS) return null;
      lastEvaluation = nowMs;
      if (deltas.length < MIN_WINDOW_SAMPLES) return null;

      const sorted = [...deltas].sort((a, b) => a - b);
      last = {
        samples: sorted.length,
        p50FrameMs: percentile(sorted, 0.5),
        p90FrameMs: percentile(sorted, 0.9),
      };
      publish(null);
      if (pinned) return null;

      const p90 = last.p90FrameMs ?? 0;
      if (p90 > budgetMs) {
        underSince = null;
        overSince ??= nowMs;
        if (nowMs - overSince >= dropAfterMs && tier !== 'low') {
          const next = MIDWAY_TIER_ORDER[tierIndex(tier) - 1]!;
          dropped = true;
          writeCeiling(game, next);
          change(next, `p90 ${p90.toFixed(1)} ms over ${budgetMs} ms`);
          return next;
        }
        return null;
      }
      overSince = null;
      if (!dropped && tier === 'medium' && p90 < headroomMs) {
        underSince ??= nowMs;
        if (nowMs - underSince >= promoteAfterMs) {
          change('high', `p90 ${p90.toFixed(1)} ms under ${headroomMs} ms`);
          return 'high';
        }
      } else {
        underSince = null;
      }
      return null;
    },
    hold(next) {
      if (held === next) return;
      held = next;
      deliver();
    },
    pauseSampling() {
      paused += 1;
      clearWindow();
    },
    resumeSampling(graceMs = MIDWAY_SAMPLING_GRACE_MS) {
      paused = Math.max(0, paused - 1);
      if (paused === 0) {
        ignoreUntil = clockNow() + graceMs;
        clearWindow();
      }
    },
    reset() {
      previousNow = null;
      clearWindow();
    },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    stats: () => last,
    dispose() {
      disposed = true;
      listeners.clear();
    },
  };
}

/* ── First frame ── */

const firstFrameMarked = new Set<string>();

/**
 * Record the first frame a game drew, measured from navigation start, once
 * per page load. Call it right after the first renderer.render().
 */
export function markMidwayFirstFrame(game: string, tier: MidwayTier): void {
  if (firstFrameMarked.has(game) || typeof performance === 'undefined') return;
  firstFrameMarked.add(game);
  recordArcadePerformanceMetric('game-ready', `${game} first frame`, performance.now(), {
    stage: 'first-frame',
    tier,
  }, 0);
}

/* ── WebGL ── */

let webglSeen = false;

/**
 * True when this browser can create the WebGL 2 context three.js needs. For
 * pages that want to know without building a scene (a floor tile choosing a
 * poster). Games don't call it: createMidwayRenderer returning null is the
 * answer, and it costs no extra context. Only a success is cached, since a
 * failure can be a one-off (too many live contexts). False on the server.
 */
export function detectWebGL(): boolean {
  if (typeof document === 'undefined') return false;
  if (webglSeen) return true;
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2');
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    webglSeen = Boolean(gl);
  } catch {
    return false;
  }
  return webglSeen;
}

/* ── Reduced motion ── */

let motionQuery: MediaQueryList | null = null;

/**
 * Live reduced-motion preference. The kit reads it every frame for the motion
 * it owns: bulb chase and flicker, and ambient particles, both stop.
 */
export function midwayReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  motionQuery ??= window.matchMedia('(prefers-reduced-motion: reduce)');
  return motionQuery.matches;
}
