/* Ricochet's drawing: the field, the walls and their teeth, the bird and its
   effects. Pure canvas, no React, no sim. Everything is flat: fills, no
   gradients, no glow, one hard offset at most.

   Motion runs on `fx.now`, a clock in ms that the client advances by real
   frame time minus any hit-stop, so a squash, a spark or a slide takes the
   same time at 60, 120 and 144 Hz. The bird's own place is the sim's, drawn
   between two steps (the client lerps it); this file never moves it. */

import {
  RICOCHET_BASE_HEIGHT,
  RICOCHET_BASE_WIDTH,
  RICOCHET_BIRD_RADIUS,
  RICOCHET_LEFT_FACE,
  RICOCHET_RIGHT_FACE,
  RICOCHET_WALL_THICKNESS,
  ricochetGapFor,
  type RicochetGap,
} from '@/server/arcade/ricochet-replay';
import { cubicBezier, squashAt } from '@/features/arcade/lib/game-feel';
import { mixHex } from '@/features/arcade/lib/skins/skin-set';

import type { RicochetLook } from './_ricochet-theme';

const W = RICOCHET_BASE_WIDTH;
const H = RICOCHET_BASE_HEIGHT;
/** The bird is drawn a little larger than its 14 px hit circle. */
const BIRD_R = 16;
const TOOTH_COUNT = 33;
const TOOTH_PITCH = H / TOOTH_COUNT;
const TOOTH_REACH = 15;
/** The rim that ends the field above and below. */
const RIM = 4;

export const REKEY_MS = 280;
export const SQUASH_FORCE = 0.55;
export const POP_MS = 180;
export const FLAP_MS = 200;
export const DEATH_HOLD_MS = 700;

const settle = cubicBezier(0.15, 0.8, 0.25, 1);
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export type RicochetFonts = { num: string; text: string };

export type Spark = {
  x: number;
  y: number;
  /** px per second at the start; the spark slows to a stop over its life. */
  vx: number;
  vy: number;
  at: number;
  life: number;
  size: number;
  kind: 'chip' | 'puff' | 'feather';
  color: string;
};

type Slide = { from: RicochetGap; to: RicochetGap; at: number };

export type DeathFx = {
  at: number;
  cause: 'spike' | 'floor' | 'ceiling' | 'cap';
  side: 'left' | 'right' | 'top' | 'bottom';
  x: number;
  y: number;
  dir: 1 | -1;
};

export type RicochetFx = {
  now: number;
  reduced: boolean;
  flapAt: number;
  bounce: { at: number; side: 'left' | 'right'; y: number } | null;
  scoreAt: number;
  slides: { left: Slide | null; right: Slide | null };
  sparks: Spark[];
  death: DeathFx | null;
  /** The bird's lean, eased toward its climb or fall. */
  tilt: number;
  trail: Array<{ x: number; y: number; at: number }>;
};

export const freshFx = (): RicochetFx => ({
  now: 0,
  reduced: false,
  flapAt: -1e6,
  bounce: null,
  scoreAt: -1e6,
  slides: { left: null, right: null },
  sparks: [],
  death: null,
  tilt: 0,
  trail: [],
});

export type RicochetView = {
  x: number;
  y: number;
  vy: number;
  dir: 1 | -1;
  /** The wall the bird is flying toward. */
  wall: number;
  score: number;
  phase: 'ready' | 'playing' | 'dying' | 'over';
  seed: number;
};

/* ── effects ──────────────────────────────────────────────────────────── */

/** A wall met: a squash into the face and a few chips off it. */
export function spawnBounce(fx: RicochetFx, side: 'left' | 'right', y: number, look: RicochetLook) {
  if (fx.reduced) return;
  fx.bounce = { at: fx.now, side, y };
  const face = side === 'right' ? RICOCHET_RIGHT_FACE : RICOCHET_LEFT_FACE;
  const away = side === 'right' ? -1 : 1;
  for (let i = 0; i < 5; i += 1) {
    const spread = (i - 2) / 2;
    fx.sparks.push({
      x: face + away * 3,
      y: y + spread * 5,
      vx: away * (90 + Math.abs(spread) * 30),
      vy: spread * 150,
      at: fx.now,
      life: 260,
      size: 3.4 - Math.abs(spread) * 0.8,
      kind: 'chip',
      color: look.mark,
    });
  }
}

/** A flap: two puffs under the wing, thrown down and back. */
export function spawnFlap(fx: RicochetFx, x: number, y: number, dir: 1 | -1, look: RicochetLook) {
  fx.flapAt = fx.now;
  if (fx.reduced) return;
  for (let i = 0; i < 2; i += 1) {
    fx.sparks.push({
      x: x - dir * (6 + i * 5),
      y: y + 9,
      vx: -dir * (40 + i * 25),
      vy: 90 + i * 40,
      at: fx.now,
      life: 190,
      size: 3.2 - i * 0.8,
      kind: 'puff',
      color: look.mark,
    });
  }
}

/** The run ends: the bird comes off its spot and a few feathers scatter. */
export function spawnDeath(
  fx: RicochetFx,
  death: Omit<DeathFx, 'at'>,
  look: RicochetLook,
) {
  fx.death = { ...death, at: fx.now };
  if (fx.reduced) return;
  const away = death.side === 'right' ? -1 : death.side === 'left' ? 1 : death.dir * -1;
  for (let i = 0; i < 6; i += 1) {
    const a = (i / 6) * Math.PI * 2 + 0.4;
    fx.sparks.push({
      x: death.x,
      y: death.y,
      vx: away * 60 + Math.cos(a) * 130,
      vy: -90 + Math.sin(a) * 130,
      at: fx.now,
      life: 520,
      size: 4.6,
      kind: 'feather',
      color: i % 2 === 0 ? look.bird : look.birdAlt,
    });
  }
}

/* ── the static layer: field, walls and their material ────────────────── */

const strokeLine = (ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, color: string, width = 1) => {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
};

function drawFieldMaterial(ctx: CanvasRenderingContext2D, look: RicochetLook) {
  const x0 = RICOCHET_LEFT_FACE;
  const x1 = RICOCHET_RIGHT_FACE;
  ctx.fillStyle = look.ground;
  ctx.fillRect(0, 0, W, H);
  switch (look.material) {
    case 'planks': {
      // Boards run across the field, seams every 80 px, ends staggered.
      for (let y = 80, row = 0; y < H; y += 80, row += 1) {
        strokeLine(ctx, x0, y + 0.5, x1, y + 0.5, look.groundAlt, 1.5);
        const cut = row % 2 === 0 ? 150 : 310;
        strokeLine(ctx, x0 + cut - 100, y - 79.5, x0 + cut - 100, y - 0.5, look.groundAlt, 1.5);
      }
      break;
    }
    case 'paper': {
      for (let y = 32; y < H; y += 32) strokeLine(ctx, x0, y + 0.5, x1, y + 0.5, look.groundAlt, 1);
      break;
    }
    case 'enamel': {
      ctx.strokeStyle = look.groundAlt;
      ctx.lineWidth = 2;
      ctx.strokeRect(x0 + 12, 14, x1 - x0 - 24, H - 28);
      break;
    }
    case 'tin': {
      ctx.fillStyle = look.groundAlt;
      for (let y = 18; y < H; y += 30) {
        for (let x = x0 + 18 + ((y / 30) % 2) * 15; x < x1 - 8; x += 30) {
          ctx.beginPath();
          ctx.arc(x, y, 2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      break;
    }
    case 'brass':
      break;
    default: {
      // The house screen: a faint step in tone down the middle of the lane.
      ctx.fillStyle = look.groundAlt;
      ctx.fillRect(x0 + 100, 0, x1 - x0 - 200, H);
    }
  }
}

function drawWallMaterial(ctx: CanvasRenderingContext2D, look: RicochetLook, side: 'left' | 'right') {
  const x = side === 'left' ? 0 : W - RICOCHET_WALL_THICKNESS;
  const t = RICOCHET_WALL_THICKNESS;
  const face = side === 'left' ? RICOCHET_LEFT_FACE : RICOCHET_RIGHT_FACE;
  ctx.fillStyle = look.wall;
  ctx.fillRect(x, 0, t, H);
  switch (look.material) {
    case 'planks': {
      for (let y = 64, row = 0; y < H; y += 64, row += 1) {
        strokeLine(ctx, x, y + 0.5, x + t, y + 0.5, look.wallAlt, 2);
        const cut = row % 2 === 0 ? t * 0.35 : t * 0.7;
        strokeLine(ctx, x + cut, y - 63.5, x + cut, y - 0.5, look.wallAlt, 2);
      }
      break;
    }
    case 'paper': {
      // Ticket stock: a row of punched holes along the face.
      ctx.fillStyle = look.ground;
      for (let y = 20; y < H; y += 40) {
        ctx.beginPath();
        ctx.arc(face + (side === 'left' ? -5 : 5), y, 3.4, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'brass': {
      ctx.fillStyle = look.wallAlt;
      for (let y = 32; y < H; y += 64) {
        ctx.beginPath();
        ctx.arc(x + t / 2, y, 3, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'enamel': {
      const inset = side === 'left' ? 8 : t - 8;
      strokeLine(ctx, x + inset, 0, x + inset, H, look.wallAlt, 2);
      break;
    }
    case 'tin': {
      ctx.fillStyle = look.wallAlt;
      for (let y = 12; y < H; y += 24) {
        for (const dx of [9, 25]) {
          ctx.beginPath();
          ctx.arc(x + dx, y + (dx === 25 ? 12 : 0), 2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      break;
    }
    default: {
      // The house wall: one lighter band along the outer edge.
      ctx.fillStyle = look.wallAlt;
      ctx.fillRect(side === 'left' ? x : x + t - 6, 0, 6, H);
    }
  }
}

/** The field, the two walls and the rim, drawn once and blitted each frame.
 *  `scale` is css px times device pixels per logical unit. */
export function buildStaticLayer(look: RicochetLook, scale: number): HTMLCanvasElement {
  const layer = document.createElement('canvas');
  layer.width = Math.max(1, Math.round(W * scale));
  layer.height = Math.max(1, Math.round(H * scale));
  const ctx = layer.getContext('2d');
  if (!ctx) return layer;
  ctx.scale(scale, scale);
  drawFieldMaterial(ctx, look);
  drawWallMaterial(ctx, look, 'left');
  drawWallMaterial(ctx, look, 'right');
  // The top and the bottom are lethal too: a rim in the wall's colour.
  ctx.fillStyle = look.wall;
  ctx.fillRect(RICOCHET_LEFT_FACE, 0, RICOCHET_RIGHT_FACE - RICOCHET_LEFT_FACE, RIM);
  ctx.fillRect(RICOCHET_LEFT_FACE, H - RIM, RICOCHET_RIGHT_FACE - RICOCHET_LEFT_FACE, RIM);
  return layer;
}

/* ── walls: slot and teeth ────────────────────────────────────────────── */

const sameGap = (a: RicochetGap, b: RicochetGap) => a.start === b.start && a.height === b.height;

/** The gap each wall shows. The wall the bird is flying toward shows its gap;
 *  the one behind it shows the gap after, so the next opening is always on
 *  screen. When a wall's gap changes, the opening slides to the new one. */
function shownGaps(view: RicochetView, fx: RicochetFx) {
  const target = {
    right: ricochetGapFor(view.seed, view.dir > 0 ? view.wall : view.wall + 1),
    left: ricochetGapFor(view.seed, view.dir < 0 ? view.wall : view.wall + 1),
  };
  const out = {} as { left: RicochetGap; right: RicochetGap };
  for (const side of ['left', 'right'] as const) {
    const to = target[side];
    const slide = fx.slides[side];
    if (!slide) {
      fx.slides[side] = { from: to, to, at: -1e6 };
      out[side] = to;
      continue;
    }
    if (!sameGap(slide.to, to)) {
      // The opening slides from where it is now (which may be mid-slide).
      const current = gapAt(slide, fx);
      fx.slides[side] = { from: current, to, at: fx.reduced || view.phase === 'ready' ? -1e6 : fx.now };
    }
    out[side] = gapAt(fx.slides[side]!, fx);
  }
  return out;
}

function gapAt(slide: Slide, fx: RicochetFx): RicochetGap {
  const u = settle(clamp01((fx.now - slide.at) / REKEY_MS));
  if (u >= 1) return slide.to;
  const start = lerp(slide.from.start, slide.to.start, u);
  const height = lerp(slide.from.height, slide.to.height, u);
  return { start, end: start + height, height };
}

function drawWallFurniture(ctx: CanvasRenderingContext2D, look: RicochetLook, side: 'left' | 'right', gap: RicochetGap) {
  const left = side === 'left';
  const face = left ? RICOCHET_LEFT_FACE : RICOCHET_RIGHT_FACE;
  const inward = left ? 1 : -1;

  // The safe slot: a lit lane cut into the face where the bird may cross.
  ctx.fillStyle = look.mark;
  const slotW = 6;
  const r = 3;
  const x = left ? face - slotW : face;
  ctx.beginPath();
  ctx.roundRect(x, gap.start, slotW, gap.end - gap.start, r);
  ctx.fill();

  // Teeth along the face, drawn out of the opening: each grows with its
  // distance from the slot, so a slide ripples instead of popping.
  ctx.fillStyle = look.spike;
  const half = TOOTH_PITCH / 2;
  for (let i = 0; i < TOOTH_COUNT; i += 1) {
    const y = (i + 0.5) * TOOTH_PITCH;
    const outside = y < gap.start ? gap.start - y : y > gap.end ? y - gap.end : 0;
    const ext = clamp01((outside - 2) / (TOOTH_PITCH * 0.9));
    if (ext <= 0.02) continue;
    ctx.beginPath();
    ctx.moveTo(face, y - half * (0.4 + 0.6 * ext));
    ctx.lineTo(face + inward * TOOTH_REACH * ext, y);
    ctx.lineTo(face, y + half * (0.4 + 0.6 * ext));
    ctx.closePath();
    ctx.fill();
  }
}

/* ── the bird ─────────────────────────────────────────────────────────── */

type Pose = {
  x: number;
  y: number;
  rot: number;
  face: 1 | -1;
  /** Wing lift, 0 at rest to 1 at the top of a stroke. */
  wing: number;
  alpha: number;
};

function drawBirdShape(ctx: CanvasRenderingContext2D, look: RicochetLook, pose: Pose) {
  const R = BIRD_R;
  const f = pose.face;
  ctx.save();
  ctx.translate(pose.x, pose.y);
  ctx.rotate(pose.rot);
  ctx.globalAlpha = pose.alpha;
  const belly = mixHex(look.bird, look.mark, 0.6);

  if (look.shape === 'plane') {
    // A paper dart: two folded halves meeting on a crease.
    const lift = pose.wing * 4;
    ctx.fillStyle = look.birdAlt;
    ctx.beginPath();
    ctx.moveTo(f * R * 1.45, 0);
    ctx.lineTo(-f * R * 0.95, R * 0.6);
    ctx.lineTo(-f * R * 0.5, 0);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = look.bird;
    ctx.beginPath();
    ctx.moveTo(f * R * 1.45, 0);
    ctx.lineTo(-f * R * 0.95, -R * 0.78 - lift);
    ctx.lineTo(-f * R * 0.5, 0);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    return;
  }

  // Tail.
  ctx.fillStyle = look.birdAlt;
  ctx.beginPath();
  ctx.moveTo(-f * R * 0.75, -R * 0.3);
  ctx.lineTo(-f * R * 1.45, look.shape === 'chick' ? -R * 0.1 : 0);
  ctx.lineTo(-f * R * 0.75, R * 0.32);
  ctx.closePath();
  ctx.fill();

  // Ears and tuft sit behind the body.
  if (look.shape === 'owl') {
    ctx.fillStyle = look.birdAlt;
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(f * R * 0.1 + s * R * 0.62, -R * 0.62);
      ctx.lineTo(f * R * 0.1 + s * R * 0.78, -R * 1.28);
      ctx.lineTo(f * R * 0.1 + s * R * 0.12, -R * 0.9);
      ctx.closePath();
      ctx.fill();
    }
  } else if (look.shape === 'chick') {
    ctx.fillStyle = look.birdAlt;
    for (const [dx, h] of [[-0.18, 0.5], [0.12, 0.7], [0.42, 0.45]] as const) {
      ctx.beginPath();
      ctx.moveTo(f * R * dx - R * 0.16, -R * 0.82);
      ctx.lineTo(f * R * dx - R * 0.02, -R * (0.82 + h));
      ctx.lineTo(f * R * dx + R * 0.14, -R * 0.82);
      ctx.closePath();
      ctx.fill();
    }
  }

  // Body.
  ctx.fillStyle = look.bird;
  ctx.beginPath();
  ctx.ellipse(0, 0, R * 1.04, R, 0, 0, Math.PI * 2);
  ctx.fill();

  // Belly.
  ctx.fillStyle = belly;
  ctx.beginPath();
  ctx.ellipse(f * R * 0.16, R * 0.34, R * 0.62, R * 0.5, 0, 0, Math.PI * 2);
  ctx.fill();

  // Wing: lifts and drops with the flap.
  ctx.save();
  ctx.translate(-f * R * 0.08, -R * 0.04);
  ctx.rotate(f * (0.1 - pose.wing * 1.05));
  ctx.fillStyle = look.birdAlt;
  ctx.beginPath();
  ctx.ellipse(-f * R * 0.24, 0, R * (look.shape === 'chick' ? 0.5 : 0.62), R * 0.36, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Beak.
  ctx.fillStyle = look.birdAlt;
  ctx.beginPath();
  const beakY = look.shape === 'owl' ? R * 0.02 : -R * 0.06;
  ctx.moveTo(f * R * 0.92, beakY - R * 0.16);
  ctx.lineTo(f * R * (look.shape === 'chick' ? 1.38 : 1.5), beakY + R * 0.04);
  ctx.lineTo(f * R * 0.92, beakY + R * 0.2);
  ctx.closePath();
  ctx.fill();

  // Eye.
  if (look.shape === 'owl') {
    for (const s of [0, 1]) {
      const ex = f * R * (0.2 + s * 0.46);
      ctx.fillStyle = look.mark;
      ctx.beginPath();
      ctx.arc(ex, -R * 0.26, R * 0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#1F1A16';
      ctx.beginPath();
      ctx.arc(ex + f * R * 0.06, -R * 0.26, R * 0.14, 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    ctx.fillStyle = look.eye;
    ctx.beginPath();
    ctx.arc(f * R * 0.46, -R * 0.26, R * 0.17, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/* ── the frame ────────────────────────────────────────────────────────── */

const numeral = (fonts: RicochetFonts, size: number) => `800 ${size}px ${fonts.num}`;

export type RicochetDrawOptions = {
  layer: HTMLCanvasElement | null;
  fonts: RicochetFonts;
};

/** One frame, in logical units (the caller has set the scale). */
export function drawRicochet(
  ctx: CanvasRenderingContext2D,
  view: RicochetView,
  look: RicochetLook,
  fx: RicochetFx,
  options: RicochetDrawOptions,
) {
  // Field and walls.
  if (options.layer) {
    ctx.drawImage(options.layer, 0, 0, W, H);
  } else {
    drawFieldMaterial(ctx, look);
    drawWallMaterial(ctx, look, 'left');
    drawWallMaterial(ctx, look, 'right');
  }

  // The slot and teeth on each wall.
  const gaps = shownGaps(view, fx);
  drawWallFurniture(ctx, look, 'left', gaps.left);
  drawWallFurniture(ctx, look, 'right', gaps.right);

  // The wall that was hit lights along its face for a moment.
  const death = fx.death;
  if (death && !fx.reduced) {
    const u = clamp01((fx.now - death.at) / 160);
    if (u < 1) {
      ctx.fillStyle = look.mark;
      if (death.side === 'left' || death.side === 'right') {
        const h = 56 * (1 - u);
        const x = death.side === 'left' ? RICOCHET_LEFT_FACE - 5 : RICOCHET_RIGHT_FACE;
        ctx.fillRect(x, death.y - h / 2, 5, h);
      } else {
        const w = 90 * (1 - u);
        ctx.fillRect(death.x - w / 2, death.side === 'top' ? 0 : H - RIM - 2, w, RIM + 2);
      }
    }
  }

  // Score.
  const popU = clamp01((fx.now - fx.scoreAt) / POP_MS);
  const pop = fx.reduced ? 1 : 1 + 0.24 * (1 - settle(popU));
  ctx.save();
  ctx.translate(W / 2, 70);
  ctx.scale(pop, pop);
  ctx.font = numeral(options.fonts, 60);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = look.mark;
  ctx.fillText(String(view.score), 0, 0);
  ctx.restore();

  // Older trail skin: a few dots behind the bird.
  if (look.trail && !fx.reduced && fx.trail.length > 1) {
    ctx.fillStyle = look.trail.color;
    for (let i = 0; i < fx.trail.length - 1; i += 1) {
      const p = fx.trail[i]!;
      const age = clamp01((fx.now - p.at) / 260);
      if (age >= 1) continue;
      ctx.beginPath();
      ctx.arc(p.x, p.y, BIRD_R * 0.55 * (1 - age), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Sparks, puffs and feathers.
  for (let i = fx.sparks.length - 1; i >= 0; i -= 1) {
    const s = fx.sparks[i]!;
    const age = fx.now - s.at;
    if (age >= s.life) {
      fx.sparks.splice(i, 1);
      continue;
    }
    const u = age / s.life;
    ctx.fillStyle = s.color;
    if (s.kind === 'feather') {
      // Thrown, then pulled down.
      const t = age / 1000;
      const x = s.x + s.vx * t;
      const y = s.y + s.vy * t + 0.5 * 1500 * t * t;
      const k = 1 - u * u;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(u * 7 * (s.vx < 0 ? -1 : 1));
      ctx.beginPath();
      ctx.moveTo(0, -s.size * k);
      ctx.lineTo(s.size * 0.6 * k, s.size * k);
      ctx.lineTo(-s.size * 0.6 * k, s.size * k);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    } else {
      // Slows to a stop: displacement follows an ease-out of its speed.
      const travel = (1 - (1 - u) * (1 - u)) * (s.life / 2000);
      const k = s.kind === 'puff' ? 1 - u : 1 - u * u;
      const size = s.size * k;
      if (size < 0.2) continue;
      const x = s.x + s.vx * travel * 2;
      const y = s.y + s.vy * travel * 2;
      if (s.kind === 'puff') {
        ctx.beginPath();
        ctx.arc(x, y, size, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillRect(x - size / 2, y - size / 2, size, size);
      }
    }
  }

  // The bird.
  drawBird(ctx, view, look, fx);
}

function drawBird(ctx: CanvasRenderingContext2D, view: RicochetView, look: RicochetLook, fx: RicochetFx) {
  const death = fx.death;
  const face = view.dir;
  const flapU = clamp01((fx.now - fx.flapAt) / FLAP_MS);
  // A stroke: up fast, then back down on the settle curve.
  const wing = fx.reduced ? 0 : flapU < 0.25 ? flapU / 0.25 : 1 - settle((flapU - 0.25) / 0.75);

  if (death && view.phase !== 'playing' && view.phase !== 'ready') {
    // The bird comes off its spot and falls, turning, then is gone.
    const t = Math.max(0, fx.now - death.at) / 1000;
    if (fx.reduced) return;
    const away = death.side === 'right' ? -1 : death.side === 'left' ? 1 : -death.dir;
    const x = death.x + away * 110 * t;
    // Off a wall it is thrown up and out; off the floor it bounces higher so
    // it is seen going; off the ceiling it drops.
    const kick = death.side === 'bottom' ? 400 : death.side === 'top' ? -60 : 170;
    const y = death.y - kick * t + 0.5 * 1700 * t * t;
    const fade = 1 - clamp01((t * 1000 - 320) / 220);
    if (fade <= 0) return;
    drawBirdShape(ctx, look, {
      x,
      y,
      rot: t * 11 * (away > 0 ? 1 : -1),
      face: view.dir,
      wing: 0.7,
      alpha: 1,
    });
    return;
  }

  // Lean toward the climb or the fall (eased on the fx clock); squash into a
  // wall just met.
  const lean = fx.reduced ? 0 : fx.tilt;
  const bounce = fx.bounce;
  let sN = 1;
  let sT = 1;
  let edgeX = view.x;
  if (bounce && !fx.reduced) {
    const age = fx.now - bounce.at;
    const { scaleX, scaleY } = squashAt(age, { force: SQUASH_FORCE, reduced: fx.reduced });
    // Into the wall the bird shortens, along it the bird widens.
    sN = scaleY;
    sT = scaleX;
    edgeX = bounce.side === 'right' ? view.x + RICOCHET_BIRD_RADIUS : view.x - RICOCHET_BIRD_RADIUS;
  }
  const stretch = fx.reduced ? 0 : (1 - flapU) * (1 - flapU) * 0.14;

  ctx.save();
  ctx.translate(edgeX, view.y);
  ctx.scale(sN, sT * (1 + stretch));
  ctx.translate(-edgeX, -view.y);
  drawBirdShape(ctx, look, { x: view.x, y: view.y, rot: lean, face, wing, alpha: 1 });
  ctx.restore();
}

/** Ease the bird's lean and keep the older trail's samples, each frame. */
export function advanceFx(fx: RicochetFx, view: RicochetView, dtMs: number) {
  fx.now += dtMs;
  const target = Math.max(-0.5, Math.min(0.6, view.vy * 0.045)) * view.dir;
  fx.tilt += (target - fx.tilt) * (1 - Math.exp(-dtMs / 90));
  if (view.phase === 'playing') {
    const last = fx.trail[fx.trail.length - 1];
    if (!last || fx.now - last.at >= 28) {
      fx.trail.push({ x: view.x, y: view.y, at: fx.now });
      while (fx.trail.length > 12) fx.trail.shift();
    }
  } else if (view.phase === 'ready') {
    fx.trail.length = 0;
  }
}
