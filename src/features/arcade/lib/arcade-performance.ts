/**
 * Tiny, opt-in performance instrumentation for arcade routes and games.
 *
 * The module is safe to import during SSR. Until explicitly enabled every
 * public recording API is a cheap no-op, so games can add instrumentation
 * without paying for an always-on frame observer or event stream.
 */

export type ArcadePerformanceMetricKind =
  | 'navigation'
  | 'game-ready'
  | 'input'
  | 'quality';

export type ArcadePerformanceDetail = Readonly<
  Record<string, string | number | boolean | null | undefined>
>;

export type ArcadePerformanceMetric = Readonly<{
  id: number;
  kind: ArcadePerformanceMetricKind;
  label: string;
  startTime: number;
  durationMs: number;
  detail?: ArcadePerformanceDetail;
}>;

export type ArcadeFrameSummary = Readonly<{
  sampleCount: number;
  averageFps: number | null;
  p95FrameMs: number | null;
  worstFrameMs: number | null;
  longFramePercent: number | null;
}>;

/** The 3D kit's quality tier and the game's own frame times (midway-quality.ts). */
export type ArcadeQualityState = Readonly<{
  game: string;
  tier: string;
  startTier: string;
  p50FrameMs: number | null;
  p90FrameMs: number | null;
  samples: number;
}>;

export type ArcadePerformanceSnapshot = Readonly<{
  enabled: boolean;
  metrics: readonly ArcadePerformanceMetric[];
  frames: ArcadeFrameSummary;
  quality: ArcadeQualityState | null;
}>;

export type ArcadePerformanceSpan = Readonly<{
  startedAt: number | null;
  end: (detail?: ArcadePerformanceDetail) => ArcadePerformanceMetric | null;
  cancel: () => void;
}>;

export type ArcadeFrameMonitor = Readonly<{
  /** Call once per painted frame, ideally with the RAF timestamp. */
  frame: (timestamp?: number) => void;
  /** Forget the preceding timestamp after a pause or visibility change. */
  reset: () => void;
  dispose: () => void;
}>;

const MAX_METRICS = 80;
const MAX_FRAME_SAMPLES = 240;
const FRAME_NOTIFY_INTERVAL_MS = 250;
const LONG_FRAME_MS = 1000 / 30;

const EMPTY_FRAMES: ArcadeFrameSummary = Object.freeze({
  sampleCount: 0,
  averageFps: null,
  p95FrameMs: null,
  worstFrameMs: null,
  longFramePercent: null,
});

const SERVER_SNAPSHOT: ArcadePerformanceSnapshot = Object.freeze({
  enabled: false,
  metrics: Object.freeze([]),
  frames: EMPTY_FRAMES,
  quality: null,
});

let enabled = false;
let metricSequence = 0;
let metrics: ArcadePerformanceMetric[] = [];
let frameSamples: number[] = [];
const listeners = new Set<() => void>();
let lastFrameNotification = 0;
let quality: ArcadeQualityState | null = null;
let lastQualityNotification = 0;
let snapshot: ArcadePerformanceSnapshot = SERVER_SNAPSHOT;

function clockNow(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function frameSummary(): ArcadeFrameSummary {
  if (frameSamples.length === 0) return EMPTY_FRAMES;

  const sorted = [...frameSamples].sort((a, b) => a - b);
  const total = frameSamples.reduce((sum, sample) => sum + sample, 0);
  const averageMs = total / frameSamples.length;
  const p95Index = Math.min(
    sorted.length - 1,
    Math.ceil(sorted.length * 0.95) - 1,
  );
  const longFrames = frameSamples.filter((sample) => sample > LONG_FRAME_MS).length;

  return Object.freeze({
    sampleCount: frameSamples.length,
    averageFps: averageMs > 0 ? 1000 / averageMs : null,
    p95FrameMs: sorted[p95Index] ?? null,
    worstFrameMs: sorted.at(-1) ?? null,
    longFramePercent: (longFrames / frameSamples.length) * 100,
  });
}

function publish(): void {
  snapshot = Object.freeze({
    enabled,
    metrics: Object.freeze([...metrics]),
    frames: frameSummary(),
    quality,
  });
  for (const listener of listeners) listener();
}

function writePerformanceMeasure(metric: ArcadePerformanceMetric): void {
  if (typeof performance === 'undefined' || !performance.measure) return;

  const name = `arcade:${metric.kind}`;
  try {
    // Retain only the latest entry of each semantic kind. PerformanceObserver
    // clients still receive every measure without an ever-growing buffer.
    performance.clearMeasures(name);
    performance.measure(name, {
      start: metric.startTime,
      duration: metric.durationMs,
      detail: { label: metric.label, ...metric.detail },
    });
  } catch {
    // Some older engines support measure(), but not its options object. The
    // bounded in-memory metric remains available to the overlay/subscribers.
  }
}

/** Enable/disable collection. Disabling also releases retained samples. */
export function setArcadePerformanceEnabled(nextEnabled: boolean): void {
  if (enabled === nextEnabled) return;
  enabled = nextEnabled;
  if (!enabled) {
    metrics = [];
    frameSamples = [];
    lastFrameNotification = 0;
    quality = null;
  }
  publish();
}

/**
 * Games mount before the shell's controller turns collection on (child
 * effects run first), so a metric recorded on the first frame would be lost.
 * When the URL asks for `?arcadePerf=1`, the first record turns it on.
 */
let requestedSearch: string | null = null;
let requestedResult = false;

function enableIfRequested(): boolean {
  if (enabled) return true;
  if (typeof window === 'undefined') return false;
  const search = window.location.search;
  if (search !== requestedSearch) {
    requestedSearch = search;
    const requested = new URLSearchParams(search).get('arcadePerf');
    requestedResult = requested === '1' || requested === 'true';
  }
  if (!requestedResult) return false;
  setArcadePerformanceEnabled(true);
  return true;
}

export function isArcadePerformanceEnabled(): boolean {
  return enabled;
}

export function getArcadePerformanceSnapshot(): ArcadePerformanceSnapshot {
  return snapshot;
}

/** Stable SSR snapshot for useSyncExternalStore consumers. */
export function getArcadePerformanceServerSnapshot(): ArcadePerformanceSnapshot {
  return SERVER_SNAPSHOT;
}

export function subscribeArcadePerformance(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Record a completed semantic metric and mirror it to the Performance API. */
export function recordArcadePerformanceMetric(
  kind: ArcadePerformanceMetricKind,
  label: string,
  durationMs = 0,
  detail?: ArcadePerformanceDetail,
  startedAt?: number,
): ArcadePerformanceMetric | null {
  if (!enableIfRequested()) return null;

  const endTime = clockNow();
  const safeDuration = Number.isFinite(durationMs) ? Math.max(0, durationMs) : 0;
  const metric = Object.freeze({
    id: ++metricSequence,
    kind,
    label,
    startTime: startedAt ?? Math.max(0, endTime - safeDuration),
    durationMs: safeDuration,
    detail,
  });
  metrics = [...metrics.slice(-(MAX_METRICS - 1)), metric];
  writePerformanceMeasure(metric);
  publish();
  return metric;
}

const NOOP_SPAN: ArcadePerformanceSpan = Object.freeze({
  startedAt: null,
  end: () => null,
  cancel: () => undefined,
});

/**
 * Begin a metric whose completion may happen on another frame or route.
 * Calling end/cancel more than once is harmless.
 */
export function beginArcadePerformanceSpan(
  kind: ArcadePerformanceMetricKind,
  label: string,
  detail?: ArcadePerformanceDetail,
): ArcadePerformanceSpan {
  if (!enabled) return NOOP_SPAN;

  const startedAt = clockNow();
  let active = true;
  return Object.freeze({
    startedAt,
    end(endDetail?: ArcadePerformanceDetail) {
      if (!active) return null;
      active = false;
      const completedAt = clockNow();
      return recordArcadePerformanceMetric(
        kind,
        label,
        completedAt - startedAt,
        endDetail ? { ...detail, ...endDetail } : detail,
        startedAt,
      );
    },
    cancel() {
      active = false;
    },
  });
}

export function beginArcadeNavigation(
  destination: string,
  detail?: ArcadePerformanceDetail,
): ArcadePerformanceSpan {
  return beginArcadePerformanceSpan('navigation', destination, detail);
}

/** Begin navigation/game-bootstrap-to-ready timing for a specific game. */
export function beginArcadeGameLoad(
  gameId: string,
  detail?: ArcadePerformanceDetail,
): ArcadePerformanceSpan {
  return beginArcadePerformanceSpan('game-ready', gameId, detail);
}

/** Mark game readiness, optionally relative to a captured start timestamp. */
export function markArcadeGameReady(
  gameId: string,
  startedAt?: number,
  detail?: ArcadePerformanceDetail,
): ArcadePerformanceMetric | null {
  const completedAt = clockNow();
  return recordArcadePerformanceMetric(
    'game-ready',
    gameId,
    startedAt === undefined ? 0 : completedAt - startedAt,
    detail,
    startedAt,
  );
}

/** Begin measuring input-to-visual-response latency. End after the response paints. */
export function beginArcadeInput(
  input: string,
  detail?: ArcadePerformanceDetail,
): ArcadePerformanceSpan {
  return beginArcadePerformanceSpan('input', input, detail);
}

function recordFrameDuration(durationMs: number): void {
  if (!enabled || !Number.isFinite(durationMs) || durationMs <= 0) return;
  frameSamples.push(durationMs);
  if (frameSamples.length > MAX_FRAME_SAMPLES) frameSamples.shift();

  const now = clockNow();
  if (now - lastFrameNotification >= FRAME_NOTIFY_INTERVAL_MS) {
    lastFrameNotification = now;
    publish();
  }
}

/** Create an independent frame channel so unrelated game loops never mix deltas. */
export function createArcadeFrameMonitor(_label = 'game'): ArcadeFrameMonitor {
  let previousTimestamp: number | null = null;
  let disposed = false;

  return Object.freeze({
    frame(timestamp = clockNow()) {
      if (disposed || !enabled) {
        previousTimestamp = null;
        return;
      }
      if (previousTimestamp !== null) {
        recordFrameDuration(timestamp - previousTimestamp);
      }
      previousTimestamp = timestamp;
    },
    reset() {
      previousTimestamp = null;
    },
    dispose() {
      disposed = true;
      previousTimestamp = null;
    },
  });
}

/**
 * Latest tier and frame times from a 3D game's quality controller. Tier
 * changes publish at once; frame time updates at most every 250 ms. Tier
 * changes are also recorded as `quality` metrics by the caller.
 */
export function reportArcadeQuality(next: ArcadeQualityState): void {
  if (!enableIfRequested()) return;
  const tierChanged = quality?.tier !== next.tier || quality?.game !== next.game;
  quality = Object.freeze({ ...next });
  const now = clockNow();
  if (tierChanged || now - lastQualityNotification >= FRAME_NOTIFY_INTERVAL_MS) {
    lastQualityNotification = now;
    publish();
  }
}
