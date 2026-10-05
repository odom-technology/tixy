/* Derby's look, and a skin set's (SKINS.md, "derby"). The house look is a
   walnut booth in the palette; a skin recolours the rails the horses run
   on, their lines and trims, the backboard and target wall, the counter
   and the water gun, lays a material on the rails, and changes how the toy
   horses are made. Lane silks, lane numbers, the target's rings, the water
   and your ticket ring are game information and never change. Nothing here
   moves anything or touches the race. */

import { findEquippedSkinSet, type SkinMaterial, type SkinSet } from '@/features/arcade/lib/skins/skin-set';
import type { SoundTint } from '@/features/arcade/lib/sound-manager';

export type DerbyHorseMake = 'wheels' | 'rocker' | 'carousel';

export type DerbyLook = {
  /** The rails the horses run on, and the lines along them. */
  band: string;
  bandLine: string;
  /** Trims: the rails' edges, the wire's posts, the target wall's frame. */
  rail: string;
  /** The backboard and the target wall. */
  infield: string;
  /** The counter. */
  board: string;
  /** The water gun. */
  ball: string;
  /** A pattern on the rails, or none (the house look is flat). */
  material: SkinMaterial | null;
  make: DerbyHorseMake;
  tint: SoundTint;
  /** Changes when anything drawn changes. */
  key: string;
};

export const HOUSE_LOOK: DerbyLook = {
  band: '#9a713f',
  bandLine: '#7d5a31',
  rail: '#f4ebdc',
  infield: '#2a231d',
  board: '#5a3a1c',
  ball: '#f4ebdc',
  material: null,
  make: 'wheels',
  tint: 'house',
  key: 'house',
};

export function derbyLookFrom(skin: SkinSet<'derby'> | null): DerbyLook {
  if (!skin) return HOUSE_LOOK;
  const p = skin.palette;
  return {
    band: p.band,
    bandLine: p.bandLine,
    rail: p.rail,
    infield: p.infield,
    board: p.board,
    ball: p.ball,
    material: skin.material,
    make: skin.shape,
    tint: skin.sound,
    key: JSON.stringify(skin),
  };
}

export type DerbyInventoryResponse = {
  equipped?: Array<{ slot?: string; item?: { assetRef?: Record<string, unknown> | null } | null }>;
};

export function derbyLookFromInventory(response: DerbyInventoryResponse | null): DerbyLook {
  return derbyLookFrom(findEquippedSkinSet(response?.equipped, 'derby'));
}
