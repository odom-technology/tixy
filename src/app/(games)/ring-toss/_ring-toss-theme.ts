/* Ring toss's look, and how a skin set (SKINS.md) changes it.

   A new game has no legacy theme: the house look is DEFAULT_RING_TOSS_THEME,
   and an equipped skin set replaces its colours, the crate's material, the
   ring's shape and the sound tint. Nothing here moves anything: the crate,
   the bottles and the ring's collider are the engine's. The gold bottle
   stays gold under every skin. */

import {
  findEquippedSkinSet,
  mixHex,
  type SkinMaterialOf,
  type SkinSet,
  type SkinShapeOf,
  type SkinSoundTint,
} from '@/features/arcade/lib/skins/skin-set';

export type RingShape = SkinShapeOf<'ring-toss'>;

export type RingTossTheme = {
  booth: string;
  boothSeam: string;
  crate: string;
  crateDark: string;
  platform: string;
  platformTop: string;
  counter: string;
  /** Glass by row, front to back. */
  glassRows: [string, string, string, string];
  /** Ring colours in throw order (they repeat). */
  rings: readonly string[];
  /** The tape on the rings. Null: a darker band of the ring's own colour. */
  ringMark: string | null;
  /** The row values beside the crate. */
  mark: string;
  shape: RingShape;
  /** The crate's material; null is the house's flat maple. */
  material: SkinMaterialOf<'ring-toss'> | null;
  sound: SkinSoundTint;
};

export const DEFAULT_RING_TOSS_THEME: RingTossTheme = {
  booth: '#2a211b',
  boothSeam: '#1f1814',
  crate: '#b98d57',
  crateDark: '#8a6338',
  platform: '#6b4a31',
  platformTop: '#7d5a3c',
  counter: '#5a3d28',
  glassRows: ['#9fb7a6', '#3f7f62', '#2f6683', '#7c3a2c'],
  rings: ['#b83627', '#f4ebdc', '#f2a33c'],
  ringMark: null,
  mark: '#f4ebdc',
  shape: 'hoop',
  material: null,
  sound: 'house',
};

const INK = '#1f1a16';

export function applyRingTossSkinSet(base: RingTossTheme, skin: SkinSet<'ring-toss'>): RingTossTheme {
  const p = skin.palette;
  return {
    ...base,
    booth: p.booth,
    boothSeam: mixHex(p.booth, INK, 0.4),
    crate: p.crate,
    crateDark: mixHex(p.crate, INK, 0.3),
    platform: mixHex(p.platform, INK, 0.12),
    platformTop: p.platform,
    counter: mixHex(p.platform, INK, 0.25),
    // Two glasses, each stepped so the four rows still read apart.
    glassRows: [mixHex(p.glass, '#ffffff', 0.18), p.glass, p.glassAlt, mixHex(p.glassAlt, INK, 0.2)],
    rings: [p.ring],
    ringMark: p.ringMark,
    mark: p.mark,
    shape: skin.shape,
    material: skin.material,
    sound: skin.sound,
  };
}

export type InventoryCosmeticResponse = {
  wallet?: { credits?: number };
  equipped?: Array<{ slot?: string; item?: { assetRef?: Record<string, unknown> | null } | null } | null>;
};

/** The theme from an inventory payload: the house look, or the equipped skin set. */
export function buildRingTossTheme(response: InventoryCosmeticResponse | null | undefined): RingTossTheme {
  const skin = findEquippedSkinSet(response?.equipped, 'ring-toss');
  return skin ? applyRingTossSkinSet({ ...DEFAULT_RING_TOSS_THEME }, skin) : { ...DEFAULT_RING_TOSS_THEME };
}
