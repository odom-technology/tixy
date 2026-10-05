/* How a callout moves, as numbers. The one place the timing lives: the
   DOM callouts get it from `tx-callout` in gameplay-feedback.css (same
   stops), the canvas ones from `calloutFrameAt` below, and
   scripts/verify-feel-kit.ts keeps the two from drifting. */

import { cubicBezier, springEase } from '@/features/arcade/lib/game-feel';

/** How long a callout shows when its game doesn't say (the CSS default). */
export const CALLOUT_MS = 760;

/** Under reduced motion a callout holds at most this long. */
export const CALLOUT_REDUCED_MS = 500;

/** How long a default callout lives. */
export function calloutLifeMs(reducedMotion: boolean, requested = CALLOUT_MS): number {
  return reducedMotion ? Math.min(CALLOUT_REDUCED_MS, requested) : requested;
}

/** Keyframe stops of `tx-callout`, as fractions of the duration. In is
 *  120 ms of the default 760. */
export const CALLOUT_STOPS = { in: 0.16, hold: 0.78 } as const;

/* The way out: the keyframe's ease-in. */
const easeIn = cubicBezier(0.55, 0, 1, 0.45);

export type CalloutFrame = {
  opacity: number;
  /** Vertical offset from the resting place, in plate heights. Positive is
   *  down, so it starts below, rests at 0 and drifts up. */
  lift: number;
  scale: number;
};

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);

/** The plate at `u`, 0 to 1 through its life. */
export function calloutFrameAt(u: number, reducedMotion = false): CalloutFrame {
  const t = clamp01(u);
  if (reducedMotion) {
    // arc-reduced-fade: 0, 1 at 20%, 0 at the end. No move.
    return { opacity: t < 0.2 ? t / 0.2 : 1 - (t - 0.2) / 0.8, lift: 0, scale: 1 };
  }
  if (t < CALLOUT_STOPS.in) {
    const k = springEase(t / CALLOUT_STOPS.in);
    // translateY -30% to -50%, scale 0.86 to 1, opacity 0 to 1 (clamped).
    return { opacity: clamp01(k), lift: 0.2 - 0.2 * k, scale: 0.86 + 0.14 * k };
  }
  if (t < CALLOUT_STOPS.hold) {
    const k = (t - CALLOUT_STOPS.in) / (CALLOUT_STOPS.hold - CALLOUT_STOPS.in);
    // -50% to -56%.
    return { opacity: 1, lift: -0.06 * k, scale: 1 };
  }
  const k = easeIn((t - CALLOUT_STOPS.hold) / (1 - CALLOUT_STOPS.hold));
  // -56% to -78%, opacity 1 to 0.
  return { opacity: 1 - k, lift: -0.06 - 0.22 * k, scale: 1 };
}

/** A label that is only a number is set in the number face. */
export const NUMERIC_LABEL = /^[+\-−×x]?\s?[\d.,]+\s?[×x%]?$/;

export function isNumericLabel(label: unknown): boolean {
  return (typeof label === 'string' && NUMERIC_LABEL.test(label.trim())) || typeof label === 'number';
}

/** The callout's type size in CSS px: the CSS clamp() for the viewport. */
export function calloutFontPx(numeric: boolean, viewportWidth: number): number {
  const vw = viewportWidth / 100;
  return numeric
    ? Math.min(26, Math.max(20, 16 + 0.9 * vw))
    : Math.min(20, Math.max(16, 13.6 + 0.6 * vw));
}
