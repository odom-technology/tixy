/* A skin's material, painted as one square tile that repeats (SKINS.md,
   "Material"). The three.js games lay it on their lane, tower face or booth
   backboard as a canvas texture. Every pattern is flat and hard-edged: fills,
   straight seams, dots. No gradients, no noise, no sheen.

   Client only (it needs a canvas). The tile is seamless: every pattern's
   period divides the tile, so it can repeat at any scale. */

import type { SkinMaterial } from './skin-set';

export type MaterialInks = {
  /* The ground colour of the surface. */
  base: string;
  /* A second tone: the other board, the grain, the dimple. */
  alt: string;
  /* The marking colour: seams, rivets, pinstripes. */
  line: string;
};

/* 'v' runs boards, grain and stripes along the tile's height; 'h' along its
   width. */
export type MaterialOrient = 'v' | 'h';

export const MATERIAL_TILE = 256;

const circle = (ctx: CanvasRenderingContext2D, x: number, y: number, r: number) => {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
};

export function paintMaterialTile(
  canvas: HTMLCanvasElement,
  material: SkinMaterial,
  inks: MaterialInks,
  orient: MaterialOrient = 'v',
): void {
  const S = canvas.width;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.save();
  ctx.clearRect(0, 0, S, S);
  if (orient === 'h') {
    ctx.translate(S, 0);
    ctx.rotate(Math.PI / 2);
  }
  const { base, alt, line } = inks;
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, S, S);

  if (material === 'planks') {
    // Four boards, each in turn base and alt, a seam between them, and an end
    // joint on each board at its own height so the ends stagger.
    const w = S / 4;
    const joints = [0.3, 0.76, 0.12, 0.58];
    for (let i = 0; i < 4; i += 1) {
      ctx.fillStyle = i % 2 === 0 ? base : alt;
      ctx.fillRect(i * w, 0, w, S);
      ctx.fillStyle = line;
      ctx.fillRect(i * w, 0, 2, S);
      const y = joints[i]! * S;
      ctx.fillRect(i * w, y, w, 2);
      circle(ctx, i * w + 9, y - 9, 2);
      circle(ctx, i * w + w - 9, y - 9, 2);
      circle(ctx, i * w + 9, y + 11, 2);
      circle(ctx, i * w + w - 9, y + 11, 2);
    }
  } else if (material === 'maple' || material === 'walnut') {
    // Long grain lines that wander a little, and a few short streaks. Each
    // line's wave repeats a whole number of times down the tile.
    const lines = 9;
    ctx.lineJoin = 'round';
    for (let i = 0; i < lines; i += 1) {
      const x0 = ((i + 0.5) * S) / lines;
      const turns = i % 3 === 0 ? 2 : 1;
      const amp = 4 + (i % 4) * 1.5;
      const phase = i * 1.9;
      ctx.strokeStyle = alt;
      ctx.lineWidth = i % 2 === 0 ? 2.5 : 1.5;
      ctx.beginPath();
      for (let y = 0; y <= S; y += 8) {
        const x = x0 + amp * Math.sin((2 * Math.PI * turns * y) / S + phase);
        if (y === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.fillStyle = line;
    for (const [fx, fy, len] of [
      [0.12, 0.18, 34],
      [0.41, 0.64, 26],
      [0.66, 0.31, 40],
      [0.9, 0.82, 30],
    ] as const) {
      ctx.fillRect(fx * S, fy * S, 1.5, len);
    }
  } else if (material === 'tin') {
    // Stamped dimples on an eight by eight grid, every other row offset.
    const step = S / 8;
    for (let row = 0; row < 8; row += 1) {
      for (let col = 0; col < 8; col += 1) {
        const x = col * step + step / 2 + (row % 2 === 1 ? step / 2 : 0);
        const y = row * step + step / 2;
        ctx.fillStyle = alt;
        circle(ctx, x, y, 8);
        ctx.strokeStyle = line;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, 8, Math.PI * 0.15, Math.PI * 0.85);
        ctx.stroke();
      }
    }
  } else if (material === 'ink') {
    // The house cabinet: bands a faint tone apart, and a hairline between.
    const w = S / 4;
    for (let i = 0; i < 4; i += 1) {
      if (i % 2 === 1) {
        ctx.fillStyle = alt;
        ctx.fillRect(i * w, 0, w, S);
      }
      ctx.fillStyle = line;
      ctx.fillRect(i * w, 0, 1, S);
    }
  } else if (material === 'enamel') {
    // A painted panel with a pinstripe just inside its edge.
    const edge = S * 0.12;
    ctx.fillStyle = alt;
    ctx.fillRect(edge, 0, S - edge * 2, S);
    ctx.fillStyle = line;
    ctx.fillRect(edge, 0, 3, S);
    ctx.fillRect(S - edge - 3, 0, 3, S);
    ctx.fillRect(edge + 8, 0, 1, S);
    ctx.fillRect(S - edge - 9, 0, 1, S);
  } else if (material === 'brass') {
    // Plates two to a tile, a seam between, a rivet at every corner.
    ctx.fillStyle = alt;
    ctx.fillRect(0, S / 2 - 1, S, 2);
    ctx.fillRect(0, 0, S, 1);
    ctx.fillStyle = line;
    ctx.fillRect(0, 0, S, 2);
    ctx.fillRect(0, S / 2 - 1, S, 2);
    for (const x of [0.08, 0.92]) {
      for (const y of [0.08, 0.42, 0.58, 0.92]) circle(ctx, x * S, y * S, 4);
    }
  } else if (material === 'paper') {
    ctx.fillStyle = line;
    for (let i = 1; i <= 8; i += 1) ctx.fillRect(0, (i * S) / 8 - 2, S, 1.5);
  } else if (material === 'tile') {
    ctx.fillStyle = alt;
    ctx.fillRect(0, 0, S / 2, S / 2);
    ctx.fillRect(S / 2, S / 2, S / 2, S / 2);
  } else if (material === 'slate') {
    ctx.strokeStyle = line;
    ctx.globalAlpha = 0.7;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(24, 70);
    ctx.lineTo(120, 56);
    ctx.moveTo(150, 190);
    ctx.lineTo(228, 174);
    ctx.stroke();
    ctx.globalAlpha = 1;
  } else if (material === 'felt') {
    ctx.fillStyle = alt;
    for (let y = 0; y < S; y += 8) {
      for (let x = 0; x < S; x += 8) {
        circle(ctx, x + 2, y + 2, 1.2);
        circle(ctx, x + 6, y + 6, 1.2);
      }
    }
  }
  ctx.restore();
}
