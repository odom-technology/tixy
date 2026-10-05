/* The pictures a skee-ball skin set paints (SKINS.md): the lane's material
   as a repeating tile and the ball's markings as one wrap-around map. Flat
   fills and hard edges only. Decoration, so the client paints these after the
   first frame. Nothing here touches the lane's shape, the ball's size or the
   physics. */

import * as THREE from 'three';

import { MATERIAL_TILE, paintMaterialTile } from '@/features/arcade/lib/skins/skin-material-canvas';
import { mixHex } from '@/features/arcade/lib/skins/skin-set';

import type { SkeeBallCosmeticTheme } from './_skee-ball-theme';

const canvasOf = (width: number, height: number) => {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
};

/** The lane: one tile across its width, repeating down its length. */
export function makeLaneSkinTexture(theme: SkeeBallCosmeticTheme): THREE.CanvasTexture | null {
  const skin = theme.skin;
  if (!skin) return null;
  const canvas = canvasOf(MATERIAL_TILE, MATERIAL_TILE);
  paintMaterialTile(canvas, skin.material, { base: theme.woodMid, alt: skin.laneAlt, line: skin.laneLine }, 'v');
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

const ellipse = (ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number) => {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
};

/** The ball: its colour with the skin's markings, on a 2 : 1 wrap-around map. */
export function makeBallSkinTexture(theme: SkeeBallCosmeticTheme): THREE.CanvasTexture | null {
  const skin = theme.skin;
  if (!skin) return null;
  const w = 256;
  const h = 128;
  const canvas = canvasOf(w, h);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const mark = skin.ballMark;
  ctx.fillStyle = theme.ball;
  ctx.fillRect(0, 0, w, h);
  if (skin.shape === 'striped') {
    // Two wide stripes from pole to pole, opposite each other, with a
    // pinstripe either side.
    for (const centre of [0.25, 0.75]) {
      ctx.fillStyle = mark;
      ctx.fillRect(w * centre - 13, 0, 26, h);
      ctx.fillStyle = theme.ball;
      ctx.fillRect(w * centre - 19, 0, 3, h);
      ctx.fillRect(w * centre + 16, 0, 3, h);
    }
  } else if (skin.shape === 'dotted') {
    // Eight dots round the equator and six on each side, offset. A circle on
    // the ball is wider on the map away from the equator, so those are too.
    ctx.fillStyle = mark;
    for (const [lat, count, offset] of [
      [0, 8, 0],
      [0.21, 6, 0.5],
      [-0.21, 6, 0.5],
    ] as const) {
      const spread = 1 / Math.cos(lat * Math.PI);
      for (let i = 0; i < count; i += 1) {
        ellipse(ctx, ((i + offset) / count) * w + w / (count * 2), h * (0.5 + lat), 9 * spread, 9);
      }
    }
  } else if (skin.shape === 'ringed') {
    // A broad band round the middle with a thin ring either side.
    ctx.fillStyle = mark;
    ctx.fillRect(0, h * 0.5 - 11, w, 22);
    ctx.fillRect(0, h * 0.5 - 33, w, 3);
    ctx.fillRect(0, h * 0.5 + 30, w, 3);
  } else {
    // Plain: one moulding seam round the equator and a maker's dot, so the
    // spin still reads.
    ctx.fillStyle = mixHex(theme.ball, '#000000', 0.35);
    ctx.fillRect(0, h * 0.5 - 1.5, w, 3);
    ellipse(ctx, w * 0.25, h * 0.27, 9, 9);
    ellipse(ctx, w * 0.75, h * 0.73, 6, 6);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}
