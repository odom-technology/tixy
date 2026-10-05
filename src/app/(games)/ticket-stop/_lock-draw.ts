/* Ticket stop, the lock: drawing only. Takes the engine's view of a moment
   plus the client's effect clocks and paints one frame. Nothing here decides
   a score. Flat shapes, the tixy palette, no gradients except the needle's
   trail. */

import {
  LOCK_DOT_HALF_DEG,
  LOCK_NEEDLE_HALF_DEG,
  type LockView,
} from '@/server/arcade/ticket-stop-lock-engine';
import { settleEase, springEase, squashAt } from '@/features/arcade/lib/game-feel';

export const LOCK_COLORS = {
  ink: '#1F1A16',
  face: '#2A231D',
  track: '#14110E',
  brass: '#C9A15A',
  brassDark: '#9C7A3E',
  amber: '#F2A33C',
  cream: '#F4EBDC',
  creamDim: 'rgba(244, 235, 220, 0.82)',
  red: '#B83627',
  redHot: '#E04A35',
} as const;

const DEG = Math.PI / 180;
/** Engine degrees (clockwise from the top) to canvas radians. */
const rad = (deg: number) => (deg - 90) * DEG;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** How far the shackle lifts when the lock opens, in body radii. */
const SHACKLE_LIFT = 0.32;
/** Room kept above the lock for the open shackle, in body radii. */
const SHACKLE_ROOM = 0.4;
/** The open shackle swings its free leg out by this much, radians. */
const SHACKLE_SWING = 0.38;

export type LockGeometry = {
  width: number;
  height: number;
  cx: number;
  /** The dial's centre. */
  cy: number;
  /** The body's radius. */
  r: number;
  /** The track: inner and outer radius, and the mid radius dots sit on. */
  trackIn: number;
  trackOut: number;
  trackMid: number;
  /** The dot's radius in px: the engine's LOCK_DOT_HALF_DEG on the track. */
  dotR: number;
  /** The needle's width in px. */
  needleW: number;
  /** The shackle: its centre line's radius and stroke width. */
  shackleR: number;
  shackleW: number;
  /** Top of the shackle at rest. */
  shackleTop: number;
};

export function lockGeometry(width: number, height: number): LockGeometry {
  // The lock is 2r wide and 2.9r tall (body plus shackle), with room above
  // for the shackle to lift when it opens.
  const tall = 2.9 + SHACKLE_ROOM;
  const r = Math.max(60, Math.min((width - 24) / 2.15, (height - 24) / tall));
  const cx = width / 2;
  const top = Math.max(8, (height - r * tall) / 2) + r * SHACKLE_ROOM;
  const cy = top + r * 0.9 + r;
  const trackOut = r * 0.88;
  const trackIn = r * 0.56;
  const trackMid = (trackIn + trackOut) / 2;
  const shackleR = r * 0.56;
  const shackleW = r * 0.2;
  return {
    width,
    height,
    cx,
    cy,
    r,
    trackIn,
    trackOut,
    trackMid,
    dotR: trackMid * Math.sin(LOCK_DOT_HALF_DEG * DEG),
    needleW: Math.max(3, 2 * trackMid * Math.sin(LOCK_NEEDLE_HALF_DEG * DEG)),
    shackleR,
    shackleW,
    shackleTop: cy - r - r * 0.9 + shackleW / 2,
  };
}

export type LockFonts = { num: string; text: string };

/** Effect state the client keeps on its own clock (which a hit-stop holds). */
export type LockEffects = {
  /** Effect-clock now, ms. */
  now: number;
  reducedMotion: boolean;
  /** The last hit: when, where (engine degrees), and whether it opened the
   *  lock. */
  hit: { at: number; deg: number; clears: boolean; index: number } | null;
  /** When the current dot appeared. */
  dotAt: number;
  /** The miss, once the client has called it. */
  miss: { at: number } | null;
  /** The level clear: when the shackle popped, and when it drops back. */
  open: { at: number; closeAt: number } | null;
  /** The number in the middle, rolling: from, to, when it changed. */
  count: { from: number; to: number; at: number };
  /** The level label under it, and when it last changed. */
  level: { value: number; at: number };
};

const POP_MS = 340;
const PARTICLE_MS = 460;
const DOT_IN_MS = 240;
const ROLL_MS = 200;
const FLASH_MS = 520;
const SHACKLE_UP_MS = 420;
const SHACKLE_DOWN_MS = 220;

function annulus(ctx: CanvasRenderingContext2D, cx: number, cy: number, rIn: number, rOut: number) {
  ctx.beginPath();
  ctx.arc(cx, cy, rOut, 0, Math.PI * 2);
  ctx.arc(cx, cy, rIn, 0, Math.PI * 2, true);
}

function disc(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.beginPath();
  ctx.arc(x, y, Math.max(0, r), 0, Math.PI * 2);
}

const onTrack = (g: LockGeometry, deg: number, radius = g.trackMid) => ({
  x: Math.cos(rad(deg)) * radius,
  y: Math.sin(rad(deg)) * radius,
});

/** How far the shackle is lifted, 0 (shut) to 1 (open). */
function shackleLift(e: LockEffects): number {
  if (!e.open) return 0;
  const up = e.now - e.open.at;
  if (up < 0) return 0;
  if (e.now >= e.open.closeAt) {
    const down = (e.now - e.open.closeAt) / SHACKLE_DOWN_MS;
    if (e.reducedMotion) return 0;
    // Drops fast, like it is falling shut.
    return down >= 1 ? 0 : 1 - down * down;
  }
  if (e.reducedMotion) return 1;
  return springEase(clamp01(up / SHACKLE_UP_MS));
}

/** Paint one frame. `view` is the engine's view at the drawn time. */
export function drawLock(
  ctx: CanvasRenderingContext2D,
  g: LockGeometry,
  view: LockView,
  e: LockEffects,
  fonts: LockFonts,
): void {
  const C = LOCK_COLORS;
  ctx.fillStyle = C.ink;
  ctx.fillRect(0, 0, g.width, g.height);

  // The whole lock squashes a little on each hit, and harder when the
  // shackle slams shut. Origin: the dial's centre.
  let scaleX = 1;
  let scaleY = 1;
  if (!e.reducedMotion) {
    if (e.hit && !e.hit.clears) {
      const s = squashAt(e.now - e.hit.at, { force: 0.18, reduced: false });
      scaleX = s.scaleX;
      scaleY = s.scaleY;
    }
    if (e.open && e.now >= e.open.closeAt) {
      const s = squashAt(e.now - e.open.closeAt - SHACKLE_DOWN_MS * 0.7, { force: 0.3, reduced: false });
      scaleX *= s.scaleX;
      scaleY *= s.scaleY;
    }
  }

  ctx.save();
  ctx.translate(g.cx, g.cy);
  ctx.scale(scaleX, scaleY);

  // Shackle: a thick brass arch. When the lock opens it lifts clear of the
  // body, then swings its free leg out round the long one.
  const open = shackleLift(e);
  const lift = Math.min(1, open * 1.6) * g.r * SHACKLE_LIFT;
  const swing = Math.max(0, open * 1.6 - 0.6) * SHACKLE_SWING;
  const legBottom = -g.r * 0.55;
  const archY = -g.r - g.r * 0.9 + g.shackleW / 2 + g.shackleR;
  ctx.save();
  ctx.translate(-g.shackleR, legBottom - lift);
  ctx.rotate(-swing);
  ctx.translate(g.shackleR, -legBottom);
  ctx.strokeStyle = C.brassDark;
  ctx.lineWidth = g.shackleW;
  ctx.lineCap = 'butt';
  ctx.beginPath();
  ctx.moveTo(-g.shackleR, legBottom);
  ctx.lineTo(-g.shackleR, archY);
  ctx.arc(0, archY, g.shackleR, Math.PI, 0);
  ctx.lineTo(g.shackleR, legBottom);
  ctx.stroke();
  ctx.restore();

  // Body: a brass rim round an ink face.
  const flashK = e.miss ? 1 - clamp01((e.now - e.miss.at) / (e.reducedMotion ? 200 : FLASH_MS)) : 0;
  const openK = e.open ? 1 - clamp01((e.now - e.open.at) / 420) : 0;
  ctx.fillStyle = flashK > 0.5 ? C.redHot : openK > 0.3 ? C.amber : C.brass;
  disc(ctx, 0, 0, g.r);
  ctx.fill();
  ctx.fillStyle = C.face;
  disc(ctx, 0, 0, g.r * 0.93);
  ctx.fill();

  // Track.
  ctx.fillStyle = C.track;
  annulus(ctx, 0, 0, g.trackIn, g.trackOut);
  ctx.fill();

  // The miss: the track flashes red and fades.
  if (flashK > 0) {
    ctx.globalAlpha = flashK * 0.85;
    ctx.fillStyle = C.red;
    annulus(ctx, 0, 0, g.trackIn, g.trackOut);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // The dot. It springs in when it appears; on a miss it turns red.
  if (view.phase !== 'clear' || (e.open && e.now >= e.open.closeAt)) {
    const p = onTrack(g, view.dot.centreDeg);
    const inK = e.reducedMotion ? 1 : springEase(clamp01((e.now - e.dotAt) / DOT_IN_MS));
    ctx.fillStyle = e.miss ? C.cream : C.amber;
    disc(ctx, p.x, p.y, g.dotR * inK);
    ctx.fill();
  }

  // The hit: the old dot pops (a ring and a scatter of chips).
  if (e.hit) {
    const t = e.now - e.hit.at;
    const p = onTrack(g, e.hit.deg);
    const popMs = e.reducedMotion ? 140 : POP_MS * (e.hit.clears ? 1.3 : 1);
    if (t >= 0 && t < popMs) {
      const k = t / popMs;
      const grow = e.reducedMotion ? 1 : settleEase(k);
      ctx.strokeStyle = C.amber;
      ctx.globalAlpha = 1 - k;
      ctx.lineWidth = Math.max(1.5, g.dotR * 0.45 * (1 - k));
      disc(ctx, p.x, p.y, g.dotR * (1 + (e.hit.clears ? 2.2 : 1.4) * grow));
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    // The dot itself swells then goes.
    if (!e.reducedMotion && t >= 0 && t < 120) {
      const k = t / 120;
      ctx.fillStyle = C.amber;
      disc(ctx, p.x, p.y, g.dotR * (1 + 0.35 * Math.sin(k * Math.PI * 0.5)) * (1 - k * k));
      ctx.fill();
    }
    if (!e.reducedMotion && t >= 0 && t < PARTICLE_MS) {
      const k = t / PARTICLE_MS;
      const n = e.hit.clears ? 14 : 9;
      const reach = g.r * (e.hit.clears ? 0.5 : 0.32) * settleEase(k);
      const size = g.dotR * 0.46 * (1 - k * 0.7);
      ctx.fillStyle = C.amber;
      for (let i = 0; i < n; i += 1) {
        // Spread round the dot, turned a little per hit so no two look alike.
        const a = (i / n) * Math.PI * 2 + e.hit.index * 0.9;
        const spread = 0.75 + 0.5 * (((i * 7 + e.hit.index * 3) % 5) / 4);
        ctx.globalAlpha = 1 - k * k;
        ctx.fillRect(
          p.x + Math.cos(a) * reach * spread - size / 2,
          p.y + Math.sin(a) * reach * spread - size / 2,
          size,
          size,
        );
      }
      ctx.globalAlpha = 1;
    }
  }

  // Needle trail: a short fading wedge behind it while it moves.
  const needle = view.needleDeg;
  if (!e.reducedMotion && view.phase === 'run' && view.needleDir !== 0) {
    const travelled = (view.sinceMs * view.speedDps) / 1000;
    const span = Math.min(34, view.speedDps * 0.085, travelled);
    if (span > 1 && typeof ctx.createConicGradient === 'function') {
      const from = view.needleDir === 1 ? needle - span : needle;
      const to = view.needleDir === 1 ? needle : needle + span;
      const grad = ctx.createConicGradient(rad(from), 0, 0);
      const f = span / 360;
      grad.addColorStop(0, view.needleDir === 1 ? 'rgba(244,235,220,0)' : 'rgba(244,235,220,0.32)');
      grad.addColorStop(f, view.needleDir === 1 ? 'rgba(244,235,220,0.32)' : 'rgba(244,235,220,0)');
      grad.addColorStop(Math.min(1, f + 0.0001), 'rgba(244,235,220,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(0, 0, g.trackOut - 2, rad(from), rad(to));
      ctx.arc(0, 0, g.trackIn + 2, rad(to), rad(from), true);
      ctx.closePath();
      ctx.fill();
    }
  }

  // Needle: a rounded bar across the track.
  {
    const a = rad(needle);
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    ctx.strokeStyle = e.miss ? C.redHot : C.cream;
    ctx.lineWidth = g.needleW;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cos * (g.trackIn + g.needleW * 0.2), sin * (g.trackIn + g.needleW * 0.2));
    ctx.lineTo(cos * (g.trackOut - g.needleW * 0.2), sin * (g.trackOut - g.needleW * 0.2));
    ctx.stroke();
    ctx.lineCap = 'butt';
  }

  // The count in the middle, rolling down a slot.
  {
    const size = g.trackIn * 0.92;
    const k = e.reducedMotion ? 1 : settleEase(clamp01((e.now - e.count.at) / ROLL_MS));
    const dirY = e.count.to < e.count.from ? 1 : -1;
    // A slot exactly one digit tall: digits roll through it and never show
    // outside it.
    const base = size * 0.36;
    const cap = size * 0.76;
    ctx.save();
    ctx.beginPath();
    ctx.rect(-g.trackIn, base - cap - 2, g.trackIn * 2, cap + 4);
    ctx.clip();
    ctx.font = `800 ${Math.round(size)}px ${fonts.num}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = C.cream;
    if (k < 1) {
      ctx.globalAlpha = 1 - k;
      ctx.fillText(String(e.count.from), 0, base + dirY * k * cap);
    }
    ctx.globalAlpha = k;
    ctx.fillText(String(e.count.to), 0, base - dirY * (1 - k) * cap);
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // The level, under the count. Punches when it changes.
  {
    const t = e.now - e.level.at;
    const punch = e.reducedMotion || t > 360 ? 1 : 1 + 0.22 * (1 - springEase(clamp01(t / 360)));
    const size = Math.max(15, g.r * 0.14);
    ctx.save();
    ctx.translate(0, g.trackIn * 0.62);
    ctx.scale(punch, punch);
    ctx.font = `700 ${Math.round(size)}px ${fonts.text}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = t < 600 && e.level.value > 1 ? C.amber : C.creamDim;
    ctx.fillText(`level ${e.level.value}`, 0, 0);
    ctx.restore();
  }

  ctx.restore();
}
