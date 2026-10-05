/* Flappy bird's painter: the pier, the posts and the flyer, flat, in the
   400 x 600 play space. Everything here draws what it is given and keeps no
   state of its own; the client hands it interpolated positions and times.

   The layers that repeat (the far boardwalk, the rail, the boards, a post's
   material) are drawn once into small canvases per look and per pixel
   scale, then copied each frame, so a frame is a handful of image copies
   and a few paths whatever the material. */

import {
  FLAPPY_BIRD_SIZE,
  FLAPPY_GROUND_HEIGHT,
  FLAPPY_GROUND_Y,
  FLAPPY_HEIGHT,
  FLAPPY_PIPE_GAP,
  FLAPPY_PIPE_WIDTH,
  FLAPPY_WIDTH,
} from './_flappy-sim';
import type { FlappyLook, FlappyShape } from './_flappy-theme';

export const CAP_HEIGHT = 24;
/** The cap's overhang each side. Drawn only: the hitbox is the post. */
export const CAP_OVERHANG = 4;
const FAR_CYCLE = 720;
const RAIL_CYCLE = 144;
const BOARD_CYCLE = 48;
const RAIL_TOP = FLAPPY_GROUND_Y - 38;
/** How fast each layer moves against the world: far, rail, boards. */
export const PARALLAX = { far: 0.12, rail: 0.45, ground: 1 } as const;

type Sprite = HTMLCanvasElement | OffscreenCanvas;

export type FlappySprites = {
  scale: number;
  look: FlappyLook;
  pipe: Sprite;
  cap: Sprite;
  far: Sprite;
  rail: Sprite;
  ground: Sprite;
};

function makeCanvas(w: number, h: number, scale: number) {
  const width = Math.max(1, Math.ceil(w * scale));
  const height = Math.max(1, Math.ceil(h * scale));
  let canvas: Sprite;
  if (typeof OffscreenCanvas !== 'undefined') {
    canvas = new OffscreenCanvas(width, height);
  } else {
    canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
  }
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (ctx) ctx.scale(scale, scale);
  return { canvas, ctx };
}

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/* ── the posts ─────────────────────────────────────────────────────────── */

function paintPipeBody(ctx: Ctx2D, look: FlappyLook) {
  const w = FLAPPY_PIPE_WIDTH;
  const h = FLAPPY_HEIGHT;
  ctx.fillStyle = look.pipe;
  ctx.fillRect(0, 0, w, h);
  switch (look.material) {
    case 'planks': {
      // Three boards, staggered butt joints.
      ctx.fillStyle = look.pipeLight;
      ctx.fillRect(20, 0, 20, h);
      ctx.fillStyle = look.pipeMark;
      ctx.fillRect(19.25, 0, 1.5, h);
      ctx.fillRect(39.25, 0, 1.5, h);
      for (let y = 30; y < h; y += 90) {
        ctx.fillRect(0, y, 20, 1.5);
        ctx.fillRect(20, y + 45, 20, 1.5);
        ctx.fillRect(40, y + 20, 20, 1.5);
      }
      break;
    }
    case 'paper': {
      ctx.fillStyle = look.pipeMark;
      for (let y = 9; y < h; y += 12) ctx.fillRect(0, y, w, 1.2);
      ctx.fillRect(10, 0, 1.2, h);
      break;
    }
    case 'tin': {
      ctx.fillStyle = look.pipeLight;
      ctx.fillRect(4, 0, 10, h);
      ctx.fillStyle = look.pipeMark;
      for (let y = 6; y < h; y += 12) {
        for (let x = 8 + ((y / 12) % 2) * 6; x < w; x += 12) {
          ctx.beginPath();
          ctx.arc(x, y, 1.8, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      break;
    }
    case 'brass': {
      ctx.fillStyle = look.pipeLight;
      ctx.fillRect(6, 0, 12, h);
      ctx.fillStyle = look.pipeCap;
      ctx.fillRect(0, 0, 3, h);
      ctx.fillRect(w - 3, 0, 3, h);
      ctx.fillStyle = look.pipeMark;
      for (let y = 10; y < h; y += 20) {
        for (const x of [7, w - 7]) {
          ctx.beginPath();
          ctx.arc(x, y, 1.7, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      break;
    }
    case 'ink': {
      // The house cabinet: a faint tone step, a keyline inside the edge.
      ctx.fillStyle = look.pipeLight;
      ctx.fillRect(0, 0, 14, h);
      ctx.strokeStyle = look.pipeMark;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(4.75, -2, w - 9.5, h + 4);
      break;
    }
    case 'enamel':
    default: {
      // Painted metal: a lit edge and one pinstripe.
      ctx.fillStyle = look.pipeLight;
      ctx.fillRect(6, 0, 10, h);
      ctx.fillStyle = look.pipeMark;
      ctx.fillRect(22, 0, 2, h);
      break;
    }
  }
}

function paintCap(ctx: Ctx2D, look: FlappyLook) {
  const w = FLAPPY_PIPE_WIDTH + CAP_OVERHANG * 2;
  const h = CAP_HEIGHT;
  ctx.fillStyle = look.pipeCap;
  ctx.beginPath();
  ctx.roundRect(0, 0, w, h, 4);
  ctx.fill();
  // A band of the post's colour through the cap, so cap and post read as one.
  ctx.fillStyle = look.pipe;
  ctx.fillRect(0, h / 2 - 2, w, 4);
  if (look.material === 'brass' || look.material === 'planks') {
    ctx.fillStyle = look.pipeMark;
    for (const x of [8, w / 2, w - 8]) {
      ctx.beginPath();
      ctx.arc(x, 6, 1.8, 0, Math.PI * 2);
      ctx.arc(x, h - 6, 1.8, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/* ── the boardwalk ─────────────────────────────────────────────────────── */

function paintFar(ctx: Ctx2D, look: FlappyLook) {
  const base = RAIL_TOP + 6;
  ctx.fillStyle = look.far;
  ctx.strokeStyle = look.far;
  // The wheel: a rim, eight spokes, an A-frame.
  const wx = 150;
  const wr = 70;
  const wy = base - wr - 34;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(wx, wy, wr, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 2.5;
  for (let i = 0; i < 8; i += 1) {
    const a = (Math.PI * 2 * i) / 8;
    ctx.beginPath();
    ctx.moveTo(wx, wy);
    ctx.lineTo(wx + Math.cos(a) * wr, wy + Math.sin(a) * wr);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(wx + Math.cos(a) * wr, wy + Math.sin(a) * wr, 6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(wx - 34, base);
  ctx.lineTo(wx, wy);
  ctx.lineTo(wx + 34, base);
  ctx.stroke();
  // Two tents with flags.
  const tent = (x: number, w: number, h: number) => {
    ctx.beginPath();
    ctx.moveTo(x - w / 2, base);
    ctx.lineTo(x, base - h);
    ctx.lineTo(x + w / 2, base);
    ctx.closePath();
    ctx.fill();
    ctx.fillRect(x - 1.5, base - h - 14, 3, 14);
    ctx.beginPath();
    ctx.moveTo(x + 1.5, base - h - 14);
    ctx.lineTo(x + 13, base - h - 10);
    ctx.lineTo(x + 1.5, base - h - 6);
    ctx.fill();
  };
  tent(330, 96, 58);
  tent(420, 70, 42);
  // Booth roofs and a coaster's lift hill.
  ctx.fillRect(480, base - 40, 56, 40);
  ctx.fillRect(546, base - 28, 40, 28);
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(600, base);
  ctx.lineTo(660, base - 118);
  ctx.quadraticCurveTo(676, base - 136, 690, base - 110);
  ctx.lineTo(712, base);
  ctx.stroke();
  for (let x = 610; x < 704; x += 14) {
    ctx.beginPath();
    ctx.moveTo(x, base);
    const top = x < 660 ? base - (x - 600) * (118 / 60) : base - 110 + (x - 690) * (110 / 22);
    ctx.lineTo(x, Math.min(base, top + 4));
    ctx.stroke();
  }
}

function paintRail(ctx: Ctx2D, look: FlappyLook) {
  ctx.fillStyle = look.rail;
  ctx.fillRect(0, RAIL_TOP, RAIL_CYCLE, 5);
  ctx.fillRect(0, RAIL_TOP + 18, RAIL_CYCLE, 3);
  for (let x = 6; x < RAIL_CYCLE; x += 48) ctx.fillRect(x, RAIL_TOP, 6, FLAPPY_GROUND_Y - RAIL_TOP);
  // A string of lights from post to post, sagging between.
  ctx.strokeStyle = look.rail;
  ctx.lineWidth = 1;
  for (let x = 9; x < RAIL_CYCLE + 48; x += 48) {
    ctx.beginPath();
    ctx.moveTo(x, RAIL_TOP - 30);
    ctx.quadraticCurveTo(x + 24, RAIL_TOP - 16, x + 48, RAIL_TOP - 30);
    ctx.stroke();
  }
  for (let x = 6; x < RAIL_CYCLE + 6; x += 48) ctx.fillRect(x, RAIL_TOP - 34, 6, 34);
  ctx.fillStyle = look.bulb;
  for (let x = 9; x < RAIL_CYCLE; x += 48) {
    for (const t of [0.25, 0.5, 0.75]) {
      const bx = x + 48 * t;
      const by = RAIL_TOP - 30 + 2 * t * (1 - t) * 14 * 2 + 2.5;
      ctx.beginPath();
      ctx.arc(bx, by, 2.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function paintGround(ctx: Ctx2D, look: FlappyLook) {
  const y = FLAPPY_GROUND_Y;
  ctx.fillStyle = look.ground;
  ctx.fillRect(0, y, BOARD_CYCLE, FLAPPY_GROUND_HEIGHT);
  ctx.fillStyle = look.groundAlt;
  ctx.fillRect(0, y + 10, BOARD_CYCLE / 2, FLAPPY_GROUND_HEIGHT - 10);
  ctx.fillStyle = look.groundMark;
  // The board's front edge, then seams.
  ctx.fillRect(0, y, BOARD_CYCLE, 2);
  ctx.fillRect(0, y + 9, BOARD_CYCLE, 1.5);
  ctx.fillRect(BOARD_CYCLE / 2 - 0.75, y + 10, 1.5, FLAPPY_GROUND_HEIGHT - 10);
  ctx.fillRect(BOARD_CYCLE - 0.75, y + 10, 1.5, FLAPPY_GROUND_HEIGHT - 10);
  // Nail heads.
  ctx.beginPath();
  ctx.arc(6, y + 16, 1.4, 0, Math.PI * 2);
  ctx.arc(30, y + 16, 1.4, 0, Math.PI * 2);
  ctx.fill();
}

export function createFlappySprites(look: FlappyLook, scale: number): FlappySprites | null {
  if (typeof document === 'undefined' && typeof OffscreenCanvas === 'undefined') return null;
  const pipe = makeCanvas(FLAPPY_PIPE_WIDTH, FLAPPY_HEIGHT, scale);
  const cap = makeCanvas(FLAPPY_PIPE_WIDTH + CAP_OVERHANG * 2, CAP_HEIGHT, scale);
  const far = makeCanvas(FAR_CYCLE, FLAPPY_GROUND_Y, scale);
  const rail = makeCanvas(RAIL_CYCLE, FLAPPY_GROUND_Y, scale);
  const ground = makeCanvas(BOARD_CYCLE, FLAPPY_HEIGHT, scale);
  if (!pipe.ctx || !cap.ctx || !far.ctx || !rail.ctx || !ground.ctx) return null;
  paintPipeBody(pipe.ctx, look);
  paintCap(cap.ctx, look);
  paintFar(far.ctx, look);
  paintRail(rail.ctx, look);
  paintGround(ground.ctx, look);
  return { scale, look, pipe: pipe.canvas, cap: cap.canvas, far: far.canvas, rail: rail.canvas, ground: ground.canvas };
}

/* Copy a horizontally repeating strip, scrolled by `offset` play units. */
function drawStrip(
  ctx: CanvasRenderingContext2D,
  sprite: Sprite,
  scale: number,
  cycle: number,
  offset: number,
  y: number,
  h: number,
) {
  const start = -(((offset % cycle) + cycle) % cycle);
  for (let x = start; x < FLAPPY_WIDTH; x += cycle) {
    ctx.drawImage(sprite, 0, y * scale, cycle * scale, h * scale, x, y, cycle, h);
  }
}

/** Sky, the far boardwalk and the rail. The boards come after the posts. */
export function drawBackdrop(ctx: CanvasRenderingContext2D, sprites: FlappySprites, scroll: number) {
  ctx.fillStyle = sprites.look.sky;
  ctx.fillRect(0, 0, FLAPPY_WIDTH, FLAPPY_HEIGHT);
  drawStrip(ctx, sprites.far, sprites.scale, FAR_CYCLE, scroll * PARALLAX.far, 0, FLAPPY_GROUND_Y);
  drawStrip(ctx, sprites.rail, sprites.scale, RAIL_CYCLE, scroll * PARALLAX.rail, RAIL_TOP - 40, FLAPPY_GROUND_Y - RAIL_TOP + 40);
}

export function drawGround(ctx: CanvasRenderingContext2D, sprites: FlappySprites, scroll: number) {
  drawStrip(ctx, sprites.ground, sprites.scale, BOARD_CYCLE, scroll * PARALLAX.ground, FLAPPY_GROUND_Y, FLAPPY_GROUND_HEIGHT);
}

/** One pair of posts at `x`, the gap's top at `top`. `lit` (0 to 1) flashes
 *  the caps on a near miss. */
export function drawPipePair(ctx: CanvasRenderingContext2D, sprites: FlappySprites, x: number, top: number, lit = 0) {
  const s = sprites.scale;
  const w = FLAPPY_PIPE_WIDTH;
  const topBody = Math.max(0, top - CAP_HEIGHT);
  if (topBody > 0) ctx.drawImage(sprites.pipe, 0, 0, w * s, topBody * s, x, 0, w, topBody);
  const bottomCap = top + FLAPPY_PIPE_GAP;
  const bottomBody = bottomCap + CAP_HEIGHT;
  const bodyH = FLAPPY_GROUND_Y - bottomBody;
  if (bodyH > 0) ctx.drawImage(sprites.pipe, 0, bottomBody * s, w * s, bodyH * s, x, bottomBody, w, bodyH);
  const cw = w + CAP_OVERHANG * 2;
  ctx.drawImage(sprites.cap, x - CAP_OVERHANG, top - CAP_HEIGHT, cw, CAP_HEIGHT);
  ctx.drawImage(sprites.cap, x - CAP_OVERHANG, bottomCap, cw, CAP_HEIGHT);
  if (lit > 0) {
    ctx.save();
    ctx.globalAlpha = lit * 0.85;
    ctx.fillStyle = sprites.look.eye;
    ctx.fillRect(x - CAP_OVERHANG, top - 6, cw, 6);
    ctx.fillRect(x - CAP_OVERHANG, bottomCap, cw, 6);
    ctx.restore();
  }
}

/* ── the flyer ─────────────────────────────────────────────────────────── */

export type BirdPose = {
  x: number;
  y: number;
  /** Radians, nose down positive. */
  rot: number;
  scaleX: number;
  scaleY: number;
  /** Wing angle in radians: negative up, positive down. */
  wing: number;
  /** For the plane: the propeller's turn, any number. */
  spin: number;
  dead: boolean;
};

const R = FLAPPY_BIRD_SIZE / 2;

function eye(ctx: CanvasRenderingContext2D, look: FlappyLook, x: number, y: number, r: number, dead: boolean) {
  ctx.fillStyle = look.eye;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  if (dead) {
    ctx.strokeStyle = look.pupil;
    ctx.lineWidth = 1.8;
    ctx.lineCap = 'round';
    const d = r * 0.5;
    ctx.beginPath();
    ctx.moveTo(x - d, y - d);
    ctx.lineTo(x + d, y + d);
    ctx.moveTo(x + d, y - d);
    ctx.lineTo(x - d, y + d);
    ctx.stroke();
    return;
  }
  ctx.fillStyle = look.pupil;
  ctx.beginPath();
  ctx.arc(x + r * 0.35, y, r * 0.5, 0, Math.PI * 2);
  ctx.fill();
}

function wingPath(ctx: CanvasRenderingContext2D, angle: number, pivotX: number, pivotY: number, len: number, thick: number) {
  ctx.save();
  ctx.translate(pivotX, pivotY);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.ellipse(-len * 0.45, 0, len * 0.55, thick, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawShape(ctx: CanvasRenderingContext2D, look: FlappyLook, shape: FlappyShape, pose: BirdPose) {
  const wing = pose.wing;
  switch (shape) {
    case 'gull': {
      // A herring gull: long white body, grey wing with a dark tip, amber bill.
      ctx.fillStyle = look.bird;
      ctx.beginPath();
      ctx.ellipse(-1, 1, R + 2, R * 0.72, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(9, -4, 7.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = look.beak;
      ctx.beginPath();
      ctx.moveTo(15, -4);
      ctx.lineTo(25, -1.5);
      ctx.lineTo(15, 0.5);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = look.wing;
      ctx.save();
      ctx.translate(-2, -1);
      ctx.rotate(wing);
      ctx.beginPath();
      ctx.moveTo(6, 0);
      ctx.lineTo(-20, -3);
      ctx.lineTo(-14, 5);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = look.pupil;
      ctx.beginPath();
      ctx.moveTo(-20, -3);
      ctx.lineTo(-14, -1.5);
      ctx.lineTo(-16, 2);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      eye(ctx, look, 10.5, -6, 2.6, pose.dead);
      return;
    }
    case 'stub': {
      // A ticket stub with wings: notched ends, a perforation, one eye.
      const w = 30;
      const h = 21;
      const n = 4.5;
      ctx.fillStyle = look.wing;
      wingPath(ctx, wing - 0.2, -3, -h / 2 + 2, 16, 5);
      ctx.fillStyle = look.bird;
      ctx.beginPath();
      ctx.moveTo(-w / 2 + 3, -h / 2);
      ctx.lineTo(w / 2 - 3, -h / 2);
      ctx.arcTo(w / 2, -h / 2, w / 2, -h / 2 + 3, 3);
      ctx.lineTo(w / 2, -n);
      ctx.arc(w / 2, 0, n, -Math.PI / 2, Math.PI / 2, true);
      ctx.lineTo(w / 2, h / 2 - 3);
      ctx.arcTo(w / 2, h / 2, w / 2 - 3, h / 2, 3);
      ctx.lineTo(-w / 2 + 3, h / 2);
      ctx.arcTo(-w / 2, h / 2, -w / 2, h / 2 - 3, 3);
      ctx.lineTo(-w / 2, n);
      ctx.arc(-w / 2, 0, n, Math.PI / 2, -Math.PI / 2, true);
      ctx.lineTo(-w / 2, -h / 2 + 3);
      ctx.arcTo(-w / 2, -h / 2, -w / 2 + 3, -h / 2, 3);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = look.beak;
      ctx.lineWidth = 1.4;
      ctx.setLineDash([2.4, 2]);
      ctx.beginPath();
      ctx.moveTo(-5, -h / 2 + 2.5);
      ctx.lineTo(-5, h / 2 - 2.5);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = look.beak;
      ctx.beginPath();
      ctx.arc(6, 4, 2.2, 0, Math.PI * 2);
      ctx.fill();
      eye(ctx, look, 6, -3, 3.4, pose.dead);
      return;
    }
    case 'duck': {
      // A tin gallery duck: flat profile, a round head, a flat bill.
      ctx.fillStyle = look.bird;
      ctx.beginPath();
      ctx.moveTo(-R, -2);
      ctx.quadraticCurveTo(-R - 4, -10, -R + 2, -8);
      ctx.quadraticCurveTo(-4, 2, 4, -1);
      ctx.quadraticCurveTo(R + 2, 0, R - 2, 7);
      ctx.quadraticCurveTo(0, R - 1, -R + 2, 8);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.arc(7, -7, 7.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = look.beak;
      ctx.beginPath();
      ctx.ellipse(17, -5, 6, 2.6, 0.1, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = look.wing;
      wingPath(ctx, wing * 0.8 - 0.1, 4, 1, 15, 5);
      eye(ctx, look, 9, -9, 2.4, pose.dead);
      return;
    }
    case 'owl': {
      // A round owl: ear tufts, two big eyes, a small beak.
      ctx.fillStyle = look.bird;
      ctx.beginPath();
      ctx.moveTo(-9, -R + 3);
      ctx.lineTo(-7, -R - 4);
      ctx.lineTo(-2, -R + 2);
      ctx.lineTo(4, -R + 2);
      ctx.lineTo(9, -R - 4);
      ctx.lineTo(11, -R + 3);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(1, 1, R, R - 1.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = look.wing;
      wingPath(ctx, wing - 0.1, -3, 3, 15, 5.5);
      eye(ctx, look, -2, -3, 4.6, pose.dead);
      eye(ctx, look, 8, -3, 4.6, pose.dead);
      ctx.fillStyle = look.beak;
      ctx.beginPath();
      ctx.moveTo(1.5, 0);
      ctx.lineTo(5.5, 0);
      ctx.lineTo(3.5, 5);
      ctx.closePath();
      ctx.fill();
      return;
    }
    case 'plane': {
      // A banner plane: a short fuselage, two wings, a tail, a propeller, and
      // the banner it tows (drawn only; the hitbox is the bird's).
      ctx.fillStyle = look.pupil;
      ctx.fillRect(-24, -1, 10, 1);
      ctx.fillStyle = look.eye;
      ctx.fillRect(-42, -5, 18, 9);
      ctx.fillStyle = look.wing;
      ctx.fillRect(-42, -1.5, 18, 2);
      ctx.fillStyle = look.wing;
      ctx.fillRect(-14, -5, 6, 3);
      ctx.beginPath();
      ctx.moveTo(-15, -2);
      ctx.lineTo(-11, -11);
      ctx.lineTo(-7, -2);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = look.bird;
      ctx.beginPath();
      ctx.moveTo(-15, -2);
      ctx.lineTo(10, -6);
      ctx.quadraticCurveTo(17, -5, 17, 0);
      ctx.quadraticCurveTo(17, 5, 10, 5);
      ctx.lineTo(-13, 3);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = look.wing;
      const tilt = wing * 0.25;
      ctx.save();
      ctx.rotate(tilt);
      ctx.fillRect(-6, -10, 14, 3.5);
      ctx.fillRect(-6, 4, 14, 3.5);
      ctx.restore();
      ctx.fillStyle = look.beak;
      ctx.fillRect(16, -1.5, 3, 3);
      const blade = Math.abs(Math.cos(pose.spin)) * 11 + 2;
      ctx.fillRect(19, -blade, 2.2, blade * 2);
      eye(ctx, look, 6, -2, 2.6, pose.dead);
      return;
    }
    case 'bird':
    default: {
      // The house bird: a round ticket-amber body, a wing, an eye, a beak.
      ctx.fillStyle = look.bird;
      ctx.beginPath();
      ctx.ellipse(0, 0, R, R / 1.25, 0, 0, Math.PI * 2);
      ctx.fill();
      if (look.outline) {
        ctx.strokeStyle = look.outline.colour;
        ctx.lineWidth = look.outline.width;
        ctx.stroke();
      }
      ctx.fillStyle = look.beak;
      ctx.beginPath();
      ctx.moveTo(12, -1);
      ctx.lineTo(24, 2.5);
      ctx.lineTo(12, 6);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = look.wing;
      wingPath(ctx, wing, 3, 2, 17, 6.5);
      eye(ctx, look, 7, -4.5, 5.6, pose.dead);
      return;
    }
  }
}

/** The flyer is drawn a little larger than its hitbox (a 24 px circle), so a
 *  graze that looks like a touch still flies: about 2 px of grace above and
 *  below, and the beak and tail are never solid. */
export const BIRD_DRAW_SCALE = 1.12;

export function drawBird(ctx: CanvasRenderingContext2D, look: FlappyLook, pose: BirdPose) {
  ctx.save();
  ctx.translate(pose.x, pose.y);
  ctx.rotate(pose.rot);
  ctx.scale(pose.scaleX * BIRD_DRAW_SCALE, pose.scaleY * BIRD_DRAW_SCALE);
  drawShape(ctx, look, look.shape, pose);
  ctx.restore();
}

/* ── type and effects ──────────────────────────────────────────────────── */

let numberFamily: string | null = null;

/** Big Shoulders, through the next/font variable on <html>. */
export function numberFont(px: number) {
  if (numberFamily === null && typeof document !== 'undefined') {
    numberFamily = getComputedStyle(document.documentElement).getPropertyValue('--font-big-shoulders').trim();
  }
  return `800 ${px}px ${numberFamily ? `${numberFamily}, ` : ''}'Big Shoulders', Gabarito, system-ui, sans-serif`;
}

/** The score at the top: paper on one hard ink shadow, punched by `pop`. */
export function drawScore(ctx: CanvasRenderingContext2D, look: FlappyLook, score: number, pop: number) {
  ctx.save();
  ctx.translate(FLAPPY_WIDTH / 2, 84);
  const s = 1 + pop * 0.28;
  ctx.scale(s, s);
  ctx.font = numberFont(64);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  const text = String(score);
  ctx.fillStyle = look.scoreShadow;
  ctx.fillText(text, 3, 4);
  ctx.fillStyle = look.score;
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

export type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** px per ms², down. */
  g: number;
  r: number;
  colour: string;
  born: number;
  life: number;
};

/** Particles move on time, not frames: position from age alone. */
export function drawParticles(ctx: CanvasRenderingContext2D, particles: Particle[], now: number) {
  let alive = 0;
  for (const p of particles) {
    const age = now - p.born;
    if (age < 0 || age > p.life) continue;
    alive += 1;
    const k = 1 - age / p.life;
    ctx.globalAlpha = Math.min(1, k * 1.6);
    ctx.fillStyle = p.colour;
    ctx.beginPath();
    ctx.arc(p.x + p.vx * age, p.y + p.vy * age + 0.5 * p.g * age * age, p.r * (0.5 + 0.5 * k), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  return alive;
}

/** Three short lines streaming off the bird's tail after a near miss. */
export function drawSpeedLines(ctx: CanvasRenderingContext2D, look: FlappyLook, x: number, y: number, t: number) {
  if (t < 0 || t >= 1) return;
  ctx.save();
  ctx.globalAlpha = 1 - t;
  ctx.fillStyle = look.eye;
  const drift = t * 26;
  for (const [dy, len] of [[-8, 22], [0, 30], [8, 18]] as const) {
    ctx.fillRect(x - R - 8 - drift - len, y + dy - 1, len, 2);
  }
  ctx.restore();
}
