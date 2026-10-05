/* Stacker's skin set, drawn (docs/design/tixy-rebrand/SKINS.md). Both modes
   read the same look: the cabinet draws it per lamp, endless draws it on the
   front face of each iso block.

   Palette roles: `ground` is the cabinet's backing, `block` the tower,
   `blockAlt` the moving row (and endless's second course), `mark` the seams
   and straps on a piece, `prize` the marks at rows 11 and 15.
   Material: the backing, drawn flat and hard-edged.
   Shape: block (a lip), stub (a notched ticket), brick (courses), crate
   (a frame and a brace). Every piece fills the same cell the house lamp or
   block fills. Nothing here moves anything or takes any time of its own. */

import {
  contrastRatio,
  luminance,
  mixHex,
  type SkinMaterial,
  type SkinSet,
  type SkinSoundTint,
} from '@/features/arcade/lib/skins/skin-set';

export type StackSkinLook = {
  material: SkinMaterial;
  shape: 'block' | 'stub' | 'brick' | 'crate';
  sound: SkinSoundTint;
  ground: string;
  /** A faint tone step from the ground, for panels and alternate boards. */
  ground2: string;
  /** Seams and joints in the material. */
  line: string;
  /** An empty lamp socket. */
  unlit: string;
  block: string;
  blockAlt: string;
  mark: string;
  prize: string;
  /** A flash: the block colour at heat. */
  hot: string;
};

export function buildStackSkinLook(skin: SkinSet<'stack'>): StackSkinLook {
  const p = skin.palette;
  const dark = luminance(p.ground) < 0.3;
  const toward = dark ? '#ffffff' : '#000000';
  return {
    material: skin.material,
    shape: skin.shape,
    sound: skin.sound,
    ground: p.ground,
    ground2: mixHex(p.ground, toward, 0.06),
    line: mixHex(p.ground, dark ? '#000000' : '#ffffff', 0.4),
    unlit: mixHex(p.ground, toward, 0.18),
    block: p.block,
    blockAlt: p.blockAlt,
    mark: p.mark,
    prize: p.prize,
    hot: mixHex(p.block, '#ffffff', 0.6),
  };
}

/** The colour of a piece's seams and straps: the skin's mark when it shows,
 *  else the ground. */
const detailOn = (look: StackSkinLook, fill: string) => (contrastRatio(fill, look.mark) >= 1.6 ? look.mark : look.ground);

/* ── the piece ───────────────────────────────────────────────────────── */

/** One piece in its shape, into the rect `x, y, w, h`. `w` may be a few cells
 *  wide (an endless block); `h` is one cell. Flat fills, no light, no glow.
 *  `details: false` draws a bare socket. */
export function drawSkinPiece(
  ctx: CanvasRenderingContext2D,
  look: StackSkinLook,
  x: number,
  y: number,
  w: number,
  h: number,
  fill: string,
  details = true,
) {
  const r = Math.max(1, h * 0.09);
  const lw = Math.max(1, h * 0.07);
  ctx.fillStyle = fill;
  if (look.shape === 'stub') {
    const n = Math.max(1.5, h * 0.16);
    const m = y + h / 2;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, m - n);
    ctx.arc(x + w, m, n, -Math.PI / 2, Math.PI / 2, true);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, m + n);
    ctx.arc(x, m, n, Math.PI / 2, -Math.PI / 2, true);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
    ctx.fill();
    if (details) {
      // The perforation: a dashed tear line a quarter of a cell from the end,
      // and one at every cell edge across a wider piece.
      ctx.strokeStyle = detailOn(look, fill);
      ctx.lineWidth = lw;
      ctx.setLineDash([Math.max(1.5, h * 0.12), Math.max(1.5, h * 0.1)]);
      const units = Math.max(1, Math.round(w / h));
      const tears = units === 1 ? [x + h * 0.3] : Array.from({ length: units - 1 }, (_, i) => x + (w / units) * (i + 1));
      ctx.beginPath();
      for (const tear of tears) {
        const px = Math.round(tear) + 0.5;
        ctx.moveTo(px, y + h * 0.16);
        ctx.lineTo(px, y + h * 0.84);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }
    return;
  }
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, look.shape === 'brick' ? r * 0.6 : r);
  ctx.fill();
  if (!details) return;
  const detail = detailOn(look, fill);
  if (look.shape === 'block') {
    // A lip along the bottom.
    ctx.fillStyle = mixHex(fill, '#000000', 0.22);
    ctx.beginPath();
    ctx.roundRect(x, y + h * 0.84, w, h * 0.16, [0, 0, r, r]);
    ctx.fill();
    return;
  }
  ctx.strokeStyle = detail;
  ctx.lineWidth = lw;
  ctx.lineCap = 'butt';
  if (look.shape === 'brick') {
    // Three courses: the top and bottom ones in halves, the middle one whole,
    // so the joints run in bond from one piece to the next.
    const units = Math.max(1, Math.round(w / h));
    const unit = w / units;
    const c1 = Math.round(y + h / 3) + 0.5;
    const c2 = Math.round(y + (h * 2) / 3) + 0.5;
    ctx.beginPath();
    ctx.moveTo(x, c1);
    ctx.lineTo(x + w, c1);
    ctx.moveTo(x, c2);
    ctx.lineTo(x + w, c2);
    for (let i = 0; i < units; i += 1) {
      const jx = Math.round(x + unit * (i + 0.5)) + 0.5;
      ctx.moveTo(jx, y);
      ctx.lineTo(jx, c1);
      ctx.moveTo(jx, c2);
      ctx.lineTo(jx, y + h);
      if (i > 0) {
        const ex = Math.round(x + unit * i) + 0.5;
        ctx.moveTo(ex, c1);
        ctx.lineTo(ex, c2);
      }
    }
    ctx.stroke();
    return;
  }
  // crate: a frame inset from the edge, and a brace corner to corner.
  const units = Math.max(1, Math.round(w / h));
  const unit = w / units;
  const inset = h * 0.16;
  for (let i = 0; i < units; i += 1) {
    const ux = x + unit * i;
    ctx.strokeRect(Math.round(ux + inset) + 0.5, Math.round(y + inset) + 0.5, Math.round(unit - inset * 2), Math.round(h - inset * 2));
    ctx.beginPath();
    ctx.moveTo(ux + inset, y + inset);
    ctx.lineTo(ux + unit - inset, y + h - inset);
    ctx.stroke();
  }
}

/* ── the material ────────────────────────────────────────────────────── */

type Panel = { x: number; y: number; w: number; h: number };

/** The backing, over the whole canvas. `cell` and `ox, oy` align the pattern
 *  to the lamp grid; `panel` is the grid's rect, which the ink and brass
 *  materials frame. Hard-edged fills and lines only. */
export function drawSkinMaterial(
  ctx: CanvasRenderingContext2D,
  look: StackSkinLook,
  width: number,
  height: number,
  cell: number,
  ox: number,
  oy: number,
  panel: Panel,
) {
  ctx.fillStyle = look.ground;
  ctx.fillRect(0, 0, width, height);
  const lw = Math.max(1, Math.round(cell * 0.09));
  if (look.material === 'planks') {
    // Boards two cells tall with a seam each, and joints that stagger.
    const board = Math.max(10, Math.round(cell * 1.5));
    const start = oy - Math.ceil(oy / board) * board;
    let index = 0;
    for (let y = start; y < height; y += board, index += 1) {
      if (index % 2) {
        ctx.fillStyle = look.ground2;
        ctx.fillRect(0, y, width, board);
      }
      ctx.fillStyle = look.line;
      ctx.fillRect(0, y + board - lw, width, lw);
      const run = board * 5;
      const offset = ((index * 37) % 100) / 100 * run;
      for (let jx = -offset; jx < width; jx += run) {
        ctx.fillRect(Math.round(jx), y, lw, board);
      }
    }
    return;
  }
  if (look.material === 'tile') {
    const startX = ox - Math.ceil(ox / cell) * cell;
    const startY = oy - Math.ceil(oy / cell) * cell;
    ctx.fillStyle = look.ground2;
    for (let y = startY, row = 0; y < height; y += cell, row += 1) {
      for (let x = startX, col = 0; x < width; x += cell, col += 1) {
        if ((row + col) % 2 === 0) ctx.fillRect(x, y, cell, cell);
      }
    }
    return;
  }
  // ink and brass frame the grid on a panel.
  ctx.fillStyle = look.ground2;
  ctx.fillRect(panel.x, panel.y, panel.w, panel.h);
  if (look.material === 'brass') {
    const band = mixHex(look.block, look.ground, 0.5);
    const rim = Math.max(3, Math.round(cell * 0.3));
    ctx.fillStyle = band;
    ctx.fillRect(panel.x - rim, panel.y - rim, panel.w + rim * 2, rim);
    ctx.fillRect(panel.x - rim, panel.y + panel.h, panel.w + rim * 2, rim);
    ctx.fillRect(panel.x - rim, panel.y, rim, panel.h);
    ctx.fillRect(panel.x + panel.w, panel.y, rim, panel.h);
    // Rivets on the band, at the corners and between.
    ctx.fillStyle = mixHex(band, '#ffffff', 0.35);
    const rr = Math.max(1, rim * 0.22);
    const dot = (cx: number, cy: number) => {
      ctx.beginPath();
      ctx.arc(cx, cy, rr, 0, Math.PI * 2);
      ctx.fill();
    };
    const half = rim / 2;
    const xs = [panel.x - half, panel.x + panel.w + half];
    const stepY = Math.max(cell * 3, 24);
    for (const rx of xs) {
      for (let ry = panel.y - half; ry <= panel.y + panel.h + half + 1; ry += stepY) dot(rx, ry);
      dot(rx, panel.y + panel.h + half);
    }
    const stepX = Math.max(cell * 3, 24);
    for (let rx = panel.x; rx <= panel.x + panel.w; rx += stepX) {
      dot(rx, panel.y - half);
      dot(rx, panel.y + panel.h + half);
    }
  }
}
