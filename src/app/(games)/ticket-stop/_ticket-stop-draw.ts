/* Ticket stop: drawing only. Takes the engine's view of a moment and paints
   the ring of bulbs. Nothing here decides a score or reads the clock; the
   client passes the view (ticketStopView) and an effects time. */

import {
  TICKET_STOP_BULBS,
  ticketStopBulbAngle,
  ticketStopBulbDistance,
  type TicketStopView,
} from '@/server/arcade/ticket-stop-engine';

export const TS_COLORS = {
  ink: '#1F1A16',
  face: '#2A231D',
  socket: '#14110E',
  off: '#4A3D33',
  amber: '#F2A33C',
  amberGlow: 'rgba(242, 163, 60, 0.32)',
  red: '#B83627',
  redCore: '#F0634A',
  redGlow: 'rgba(240, 99, 74, 0.5)',
  lit: '#F7E7C6',
} as const;

/** Where things sit on a screen of `width` × `height` CSS px. */
export type TicketStopGeometry = {
  width: number;
  height: number;
  cx: number;
  cy: number;
  /** Ring radius, through the bulb centres. */
  ringR: number;
  bulbR: number;
  /** The button in the middle. */
  buttonR: number;
  /** The round row: its top and height. */
  hudTop: number;
  hudH: number;
};

export function ticketStopGeometry(width: number, height: number): TicketStopGeometry {
  const hudH = Math.max(56, Math.min(80, height * 0.1));
  const gap = 6;
  const areaH = Math.max(1, height - hudH - gap);
  // The face disc reaches 1.2 ring radii; keep it inside the screen.
  const ringR = Math.max(56, Math.min((width - 16) / 2.4, areaH / 2.4));
  const bulbR = Math.max(4, ringR * 0.072);
  // On a tall phone the round row and the ring sit together in the middle.
  const hudTop = Math.max(0, (height - (hudH + gap + ringR * 2.4)) / 2);
  return {
    width,
    height,
    cx: width / 2,
    cy: hudTop + hudH + gap + ringR * 1.2,
    ringR,
    bulbR,
    buttonR: ringR * 0.46,
    hudTop,
    hudH,
  };
}

const bulbPoint = (g: TicketStopGeometry, bulb: number) => {
  const a = ticketStopBulbAngle(bulb);
  return { x: g.cx + Math.cos(a) * g.ringR, y: g.cy + Math.sin(a) * g.ringR, a };
};

function glow(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string) {
  const gradient = ctx.createRadialGradient(x, y, 0, x, y, r);
  gradient.addColorStop(0, color);
  gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

function disc(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

function litBulb(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  const gradient = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
  gradient.addColorStop(0, TS_COLORS.redCore);
  gradient.addColorStop(1, TS_COLORS.red);
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

export type TicketStopEffects = {
  /** ms of effect time since the result on screen landed, or null. Holds
   *  still through a hit-stop. */
  resultMs: number | null;
  reducedMotion: boolean;
};

/** Paint one frame. `view` null is the ring before a seed has loaded. */
export function drawTicketStop(
  ctx: CanvasRenderingContext2D,
  g: TicketStopGeometry,
  view: TicketStopView | null,
  effects: TicketStopEffects,
): void {
  ctx.fillStyle = TS_COLORS.ink;
  ctx.fillRect(0, 0, g.width, g.height);

  // The machine's face: a disc behind the ring.
  disc(ctx, g.cx, g.cy, g.ringR * 1.2, TS_COLORS.face);

  const inWindow = (bulb: number) =>
    view != null && ticketStopBulbDistance(bulb, view.centre) <= view.reach;

  // Window glow first, so bulbs sit on it.
  if (view) {
    for (let b = 0; b < TICKET_STOP_BULBS; b += 1) {
      if (!inWindow(b)) continue;
      const p = bulbPoint(g, b);
      glow(ctx, p.x, p.y, g.bulbR * 2.6, TS_COLORS.amberGlow);
    }
  }

  for (let b = 0; b < TICKET_STOP_BULBS; b += 1) {
    const p = bulbPoint(g, b);
    disc(ctx, p.x, p.y, g.bulbR * 1.28, TS_COLORS.socket);
    disc(ctx, p.x, p.y, g.bulbR, inWindow(b) ? TS_COLORS.amber : TS_COLORS.off);
  }

  if (!view) return;

  // The window's centre: a tick outside the ring pointing at it.
  {
    const p = bulbPoint(g, view.centre);
    const out = g.ringR + g.bulbR * 2.4;
    const tip = g.ringR + g.bulbR * 1.6;
    const half = g.bulbR * 0.7;
    const cos = Math.cos(p.a);
    const sin = Math.sin(p.a);
    ctx.fillStyle = TS_COLORS.amber;
    ctx.beginPath();
    ctx.moveTo(g.cx + cos * tip, g.cy + sin * tip);
    ctx.lineTo(g.cx + cos * out - sin * half, g.cy + sin * out + cos * half);
    ctx.lineTo(g.cx + cos * out + sin * half, g.cy + sin * out - cos * half);
    ctx.closePath();
    ctx.fill();
  }

  // The trail (motion only; the engine leaves it empty under reduced motion).
  for (const step of view.trail) {
    const p = bulbPoint(g, step.bulb);
    ctx.globalAlpha = step.glow;
    glow(ctx, p.x, p.y, g.bulbR * 2.4, TS_COLORS.redGlow);
    litBulb(ctx, p.x, p.y, g.bulbR);
    ctx.globalAlpha = 1;
  }

  // The light.
  const light = bulbPoint(g, view.bulb);
  glow(ctx, light.x, light.y, g.bulbR * 3.2, TS_COLORS.redGlow);
  litBulb(ctx, light.x, light.y, g.bulbR);

  // A stop: the bulb is marked with a red ring. A perfect bursts.
  if ((view.phase === 'result' || view.phase === 'done') && view.result) {
    ctx.strokeStyle = TS_COLORS.red;
    ctx.lineWidth = Math.max(2, g.bulbR * 0.34);
    ctx.beginPath();
    ctx.arc(light.x, light.y, g.bulbR * 1.85, 0, Math.PI * 2);
    ctx.stroke();

    const t = effects.resultMs;
    if (view.result.perfect && t != null && !effects.reducedMotion && t < 520) {
      const k = t / 520;
      const ease = 1 - (1 - k) ** 3;
      ctx.strokeStyle = TS_COLORS.lit;
      ctx.globalAlpha = 1 - k;
      ctx.lineWidth = Math.max(2, g.bulbR * 0.5 * (1 - k));
      ctx.beginPath();
      ctx.arc(light.x, light.y, g.bulbR * (1.9 + 3.6 * ease), 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    if (view.result.perfect && t != null && t < 90) {
      // The flash holds through the hit-stop: the effect clock is frozen.
      disc(ctx, light.x, light.y, g.bulbR, TS_COLORS.lit);
    }
  }
}
