/* The tixy callout, drawn on a canvas.

   `ArcadeGameplayCallouts` is DOM, so a game that draws its floating "+10"
   inside its own canvas (or a canvas texture) can't use it. This draws the
   same plate with the same tokens and the same curve, so the two read as
   one thing: a flat plate on screen 2 (paper for a combo), Gabarito words,
   Big Shoulders numbers, in on the spring, a hold with a small drift, out
   upward. The curve is `calloutFrameAt` in callout-motion.ts, the
   `tx-callout` keyframe in gameplay-feedback.css stop for stop. Under reduced motion it shows, holds and fades
   without moving, like `arc-reduced-fade`. */

import { calloutFontPx, calloutFrameAt, NUMERIC_LABEL } from './callout-motion';

export type CanvasCalloutTone = 'score' | 'combo' | 'warning';

export type CanvasCalloutLook = {
  plate: Record<CanvasCalloutTone, string>;
  on: Record<CanvasCalloutTone, string>;
  text: string;
  num: string;
  textWeight: string;
  numWeight: string;
};

const FALLBACK_LOOK: CanvasCalloutLook = {
  plate: { score: '#2e2924', combo: '#f4ebdc', warning: '#2e2924' },
  on: { score: '#f4ebdc', combo: '#1f1a16', warning: '#ff8f7e' },
  text: "'Gabarito', system-ui, sans-serif",
  num: "'Big Shoulders', 'Gabarito', system-ui, sans-serif",
  textWeight: '800',
  numWeight: '800',
};

const looks = new WeakMap<Element, CanvasCalloutLook>();

/**
 * The look the callout has where `from` sits: plates and ink from the
 * element's own tokens (so an ink stage gets screen 2 and paper text), the
 * faces and weights from the root. Read once per element.
 */
export function readCanvasCalloutLook(from: Element): CanvasCalloutLook {
  const cached = looks.get(from);
  if (cached) return cached;
  if (typeof getComputedStyle !== 'function') return FALLBACK_LOOK;
  const style = getComputedStyle(from);
  const get = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  const look: CanvasCalloutLook = {
    plate: {
      score: get('--surface-raised', FALLBACK_LOOK.plate.score),
      combo: get('--enamel-primary', FALLBACK_LOOK.plate.combo),
      warning: get('--surface-raised', FALLBACK_LOOK.plate.warning),
    },
    on: {
      score: get('--text-strong', FALLBACK_LOOK.on.score),
      combo: get('--enamel-primary-on', FALLBACK_LOOK.on.combo),
      warning: get('--enamel-danger-text', FALLBACK_LOOK.on.warning),
    },
    text: get('--tixy-font-text', FALLBACK_LOOK.text),
    num: get('--tixy-font-num', FALLBACK_LOOK.num),
    textWeight: get('--tixy-weight-heading', FALLBACK_LOOK.textWeight),
    numWeight: get('--tixy-weight-num', FALLBACK_LOOK.numWeight),
  };
  looks.set(from, look);
  return look;
}

/** Canvas units per CSS pixel under the context's current transform. */
export function ctxUnitsPerCssPx(ctx: CanvasRenderingContext2D): number {
  const canvas = ctx.canvas;
  const t = ctx.getTransform();
  const deviceScale = Math.hypot(t.a, t.b);
  const cssPerDevice = canvas.clientWidth > 0 && canvas.width > 0 ? canvas.clientWidth / canvas.width : 1;
  const cssPerUnit = deviceScale * cssPerDevice;
  return cssPerUnit > 0 ? 1 / cssPerUnit : 1;
}

export type DrawCanvasCallout = {
  text: string;
  /** Where the plate rests, centre, in canvas units. */
  x: number;
  y: number;
  /** 0 to 1 through its life. */
  u: number;
  tone?: CanvasCalloutTone;
  reducedMotion?: boolean;
  /** Canvas units per CSS px. Defaults to `ctxUnitsPerCssPx(ctx)`. */
  unit?: number;
  /** Keep the plate inside these canvas bounds. */
  within?: { left: number; top: number; right: number; bottom: number };
};

/** The plate's size in canvas units, for a game that needs to place it. */
export function measureCanvasCallout(
  ctx: CanvasRenderingContext2D,
  look: CanvasCalloutLook,
  text: string,
  unit: number,
) {
  const numeric = NUMERIC_LABEL.test(text.trim());
  const px = calloutFontPx(numeric, typeof window === 'undefined' ? 1280 : window.innerWidth) * unit;
  ctx.font = `${numeric ? look.numWeight : look.textWeight} ${px}px ${numeric ? look.num : look.text}`;
  return {
    numeric,
    px,
    width: ctx.measureText(text).width + 20 * unit,
    height: px + 11 * unit,
  };
}

/** Draws one callout plate. Leaves the context's state as it found it. */
export function drawCanvasCallout(
  ctx: CanvasRenderingContext2D,
  look: CanvasCalloutLook,
  opts: DrawCanvasCallout,
) {
  const unit = opts.unit ?? ctxUnitsPerCssPx(ctx);
  const frame = calloutFrameAt(opts.u, opts.reducedMotion);
  if (frame.opacity <= 0.003) return;
  const tone = opts.tone ?? 'score';

  ctx.save();
  const { numeric, px, width, height } = measureCanvasCallout(ctx, look, opts.text, unit);
  let x = opts.x;
  let y = opts.y;
  if (opts.within) {
    x = Math.min(Math.max(x, opts.within.left + width / 2), opts.within.right - width / 2);
    y = Math.min(Math.max(y, opts.within.top + height / 2), opts.within.bottom - height / 2);
  }
  ctx.translate(x, y + frame.lift * height);
  ctx.scale(frame.scale, frame.scale);
  ctx.globalAlpha *= frame.opacity;

  // The plate: a flat rounded rectangle, 8 px radius, no border, no shadow.
  const r = 8 * unit;
  const left = -width / 2;
  const top = -height / 2;
  ctx.beginPath();
  ctx.moveTo(left + r, top);
  ctx.arcTo(left + width, top, left + width, top + height, r);
  ctx.arcTo(left + width, top + height, left, top + height, r);
  ctx.arcTo(left, top + height, left, top, r);
  ctx.arcTo(left, top, left + width, top, r);
  ctx.closePath();
  ctx.fillStyle = look.plate[tone];
  ctx.fill();

  ctx.fillStyle = look.on[tone];
  ctx.font = `${numeric ? look.numWeight : look.textWeight} ${px}px ${numeric ? look.num : look.text}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const spaced = ctx as CanvasRenderingContext2D & { letterSpacing?: string };
  if ('letterSpacing' in spaced) spaced.letterSpacing = `${(numeric ? 0.01 : -0.01) * px}px`;
  // The plate pads 5 above and 6 below, so the line sits half a pixel high.
  ctx.fillText(opts.text, 0, -0.5 * unit);
  ctx.restore();
}
