/* Drawing a snake skin set's signature shape (SKINS.md, snake). The body is
   still the same path of pearls the tube follows, so where the snake is, how
   wide it is and when it moves never change; only what each cell of it looks
   like does. Flat fills and one hard drop shadow, no glow. */

import type { SnakeCosmeticTheme, SnakeSkinLook } from './_snake-types';

type Point = { x: number; y: number };

/* Points along the pearl path every `spacing` px from the head, with the
   direction of travel at each. */
function sampleBody(pearls: readonly Point[], dists: readonly number[], spacing: number) {
  const out: Array<{ x: number; y: number; angle: number; index: number; pearl: number }> = [];
  if (pearls.length === 0) return out;
  const total = dists[dists.length - 1] ?? 0;
  let j = 1;
  for (let d = spacing * 0.5, index = 0; d <= total + 0.01; d += spacing, index++) {
    while (j < pearls.length - 1 && (dists[j] ?? 0) < d) j++;
    const a = pearls[j - 1] ?? pearls[0]!;
    const b = pearls[j] ?? a;
    const da = dists[j - 1] ?? 0;
    const db = dists[j] ?? da;
    const t = db > da ? (d - da) / (db - da) : 0;
    const angle = Math.atan2(a.y - b.y, a.x - b.x);
    out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, angle, index, pearl: j });
  }
  return out;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

export function drawSkinBody(
  ctx: CanvasRenderingContext2D,
  look: SnakeSkinLook,
  theme: SnakeCosmeticTheme,
  pearls: readonly Point[],
  dists: readonly number[],
  radiusAt: (index: number) => number,
  cell: number,
  shadowY: number,
  groundAt: (cellX: number, cellY: number) => string,
) {
  const samples = sampleBody(pearls, dists, cell);
  // Draw tail to head so the head end sits on top.
  const drawPass = (shadow: boolean) => {
    for (let k = samples.length - 1; k >= 0; k--) {
      const s = samples[k]!;
      // The bulge from swallowing, read at the nearest pearl.
      const scale = radiusAt(s.pearl) / (cell * 0.35);
      const fill = shadow ? 'rgba(0, 0, 0, 0.32)' : s.index % 2 ? theme.bodySecondary : theme.bodyPrimary;
      ctx.save();
      ctx.translate(s.x, s.y + (shadow ? shadowY : 0));
      ctx.rotate(s.angle);
      ctx.scale(scale, scale);
      if (look.shape === 'beads') {
        ctx.fillStyle = fill;
        ctx.beginPath();
        ctx.arc(0, 0, cell * 0.38, 0, Math.PI * 2);
        ctx.fill();
        if (!shadow) {
          ctx.fillStyle = look.mark;
          ctx.globalAlpha = 0.5;
          ctx.beginPath();
          ctx.arc(-cell * 0.1, -cell * 0.12, cell * 0.09, 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (look.shape === 'blocks') {
        const size = cell * 0.82;
        ctx.fillStyle = fill;
        roundRect(ctx, -size / 2, -size / 2, size, size, cell * 0.14);
        ctx.fill();
        if (!shadow) {
          // A darker lip on one side, so the blocks read as stacked wood.
          ctx.fillStyle = look.mark;
          ctx.globalAlpha = 0.22;
          roundRect(ctx, -size / 2, size / 2 - cell * 0.16, size, cell * 0.16, cell * 0.08);
          ctx.fill();
        }
      } else if (look.shape === 'tickets') {
        const w = cell * 0.9;
        const h = cell * 0.7;
        ctx.fillStyle = fill;
        roundRect(ctx, -w / 2, -h / 2, w, h, cell * 0.12);
        ctx.fill();
        if (!shadow) {
          // Notches on the long sides, cut back to the board under them.
          ctx.fillStyle = groundAt(Math.floor(s.x / cell), Math.floor(s.y / cell));
          ctx.beginPath();
          ctx.arc(0, -h / 2, cell * 0.12, 0, Math.PI * 2);
          ctx.arc(0, h / 2, cell * 0.12, 0, Math.PI * 2);
          ctx.fill();
          // The perforation.
          ctx.strokeStyle = look.mark;
          ctx.lineWidth = Math.max(1, cell * 0.05);
          ctx.setLineDash([cell * 0.08, cell * 0.08]);
          ctx.beginPath();
          ctx.moveTo(w * 0.22, -h * 0.32);
          ctx.lineTo(w * 0.22, h * 0.32);
          ctx.stroke();
        }
      } else {
        // links: chain rings
        ctx.strokeStyle = fill;
        ctx.lineWidth = cell * 0.18;
        ctx.beginPath();
        ctx.ellipse(0, 0, cell * 0.38, cell * 0.28, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }
  };
  drawPass(true);
  drawPass(false);
}

export function drawSkinFood(
  ctx: CanvasRenderingContext2D,
  look: SnakeSkinLook,
  x: number,
  y: number,
  r: number,
  theme: SnakeCosmeticTheme,
  ground: string,
) {
  ctx.save();
  ctx.fillStyle = 'rgba(0, 0, 0, 0.32)';
  ctx.beginPath();
  ctx.arc(x, y + r * 0.18, r * 0.9, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = theme.foodPrimary;
  if (look.shape === 'beads') {
    // A gumball.
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = look.foodMark;
    ctx.beginPath();
    ctx.arc(x - r * 0.32, y - r * 0.32, r * 0.28, 0, Math.PI * 2);
    ctx.fill();
  } else if (look.shape === 'blocks') {
    // A sugar cube with a pip.
    roundRect(ctx, x - r * 0.9, y - r * 0.9, r * 1.8, r * 1.8, r * 0.3);
    ctx.fill();
    ctx.fillStyle = look.foodMark;
    ctx.beginPath();
    ctx.arc(x, y, r * 0.26, 0, Math.PI * 2);
    ctx.fill();
  } else if (look.shape === 'tickets') {
    // A ticket stub, tipped.
    ctx.translate(x, y);
    ctx.rotate(-0.18);
    roundRect(ctx, -r * 1.3, -r * 0.82, r * 2.6, r * 1.64, r * 0.25);
    ctx.fill();
    ctx.fillStyle = ground;
    ctx.beginPath();
    ctx.arc(-r * 1.3, 0, r * 0.32, 0, Math.PI * 2);
    ctx.arc(r * 1.3, 0, r * 0.32, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = look.foodMark;
    ctx.lineWidth = Math.max(1, r * 0.12);
    ctx.setLineDash([r * 0.2, r * 0.2]);
    ctx.beginPath();
    ctx.moveTo(r * 0.5, -r * 0.6);
    ctx.lineTo(r * 0.5, r * 0.6);
    ctx.stroke();
  } else {
    // links: a coin
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = look.foodMark;
    ctx.lineWidth = Math.max(1, r * 0.16);
    ctx.beginPath();
    ctx.arc(x, y, r * 0.6, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}
