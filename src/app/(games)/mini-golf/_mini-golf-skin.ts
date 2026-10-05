/* Mini golf skin sets (SKINS.md, "Mini golf"). A skin recolours the felt,
   the rails and their caps, the deck, the ball and the flag, paints the
   putting surface's material as a repeating tile and the ball's markings
   as its wrap-around map, and tints the sounds. It never moves a rail, the
   cup or the ball: the course is the engine's, whatever it looks like. The
   windmill and the loop keep the house look. Flat fills and hard edges. */

import * as THREE from 'three';

import { MATERIAL_TILE, paintMaterialTile } from '@/features/arcade/lib/skins/skin-material-canvas';
import { findEquippedSkinSet, mixHex, type SkinSet } from '@/features/arcade/lib/skins/skin-set';

import { HOUSE_LOOK, type MgLook } from './_mini-golf-scene';

export type MgSkinLook = {
  look: MgLook;
  skin: SkinSet<'mini-golf'> | null;
};

export type MgInventory = {
  wallet?: { credits?: number };
  equipped?: Array<{ slot?: string; item?: { assetRef?: Record<string, unknown> | null } | null }>;
};

/** The house look, or the equipped skin's. */
export function miniGolfLookFrom(inventory: MgInventory | null): MgSkinLook {
  const skin = inventory ? findEquippedSkinSet(inventory.equipped, 'mini-golf') : null;
  if (!skin) return { look: HOUSE_LOOK, skin: null };
  const p = skin.palette;
  return {
    skin,
    look: {
      ...HOUSE_LOOK,
      felt: p.felt,
      feltHi: p.feltAlt,
      rail: p.rail,
      railTop: p.railTop,
      deck: p.deck,
      ball: p.ball,
      ballMark: p.ballMark,
      flag: p.flag,
    },
  };
}

/** The putting surface's material, one tile every half metre. Null for the
 *  house felt, which stays a flat colour. */
export function makeFeltSkinTexture(look: MgSkinLook): THREE.CanvasTexture | null {
  const skin = look.skin;
  if (!skin) return null;
  const canvas = document.createElement('canvas');
  canvas.width = MATERIAL_TILE;
  canvas.height = MATERIAL_TILE;
  const p = skin.palette;
  paintMaterialTile(canvas, skin.material, { base: p.felt, alt: p.feltAlt, line: mixHex(p.feltAlt, '#000000', 0.25) }, 'v');
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  // The felt's UVs are metres: two tiles a metre.
  tex.repeat.set(2, 2);
  tex.anisotropy = 4;
  return tex;
}

const ellipse = (ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number) => {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
};

/** The ball's markings on a 2 : 1 wrap-around map, so the roll reads. */
export function makeBallSkinTexture(look: MgSkinLook): THREE.CanvasTexture {
  const w = 256;
  const h = 128;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  const shape = look.skin?.shape ?? 'house';
  if (ctx) {
    ctx.fillStyle = look.look.ball;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = look.look.ballMark;
    if (shape === 'dots') {
      // Eight dots round the equator, six above and below, offset; wider on
      // the map away from the equator, as a circle on the ball is.
      for (const [lat, count, offset] of [
        [0, 8, 0],
        [0.22, 6, 0.5],
        [-0.22, 6, 0.5],
      ] as const) {
        const spread = 1 / Math.cos(lat * Math.PI);
        for (let i = 0; i < count; i += 1) {
          ellipse(ctx, ((i + offset) / count) * w + w / (count * 2), h * (0.5 + lat), 8 * spread, 8);
        }
      }
    } else if (shape === 'band') {
      // One broad band round the equator.
      ctx.fillRect(0, h * 0.5 - 14, w, 28);
    } else if (shape === 'ringed') {
      // Two stripes from pole to pole, opposite each other.
      for (const centre of [0.25, 0.75]) ctx.fillRect(w * centre - 12, 0, 24, h);
    } else if (shape === 'star') {
      // A five-point star on each side.
      for (const cx of [w * 0.25, w * 0.75]) {
        ctx.beginPath();
        for (let i = 0; i < 10; i += 1) {
          const r = i % 2 === 0 ? 26 : 11;
          const a = -Math.PI / 2 + (i * Math.PI) / 5;
          const x = cx + Math.cos(a) * r * 0.6;
          const y = h * 0.5 + Math.sin(a) * r;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.fill();
      }
    } else {
      // The house ball: one band and two dots.
      ctx.fillRect(0, h * 0.44, w, h * 0.12);
      ellipse(ctx, w * 0.25, h * 0.2, 9, 9);
      ellipse(ctx, w * 0.75, h * 0.8, 9, 9);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}
