/* ──────────────────────────────────────────────────────────────────────────
   High Striker cosmetic theme.

   The three.js scene builds its materials from plain hex literals pulled from a
   HighStrikerCosmeticTheme object. DEFAULT_HIGH_STRIKER_THEME takes the
   tower, rails, lights and night from the 3D kit's palette (MIDWAY_PALETTE).
   An equipped slot fills its missing fields from LEGACY_HIGH_STRIKER_THEME,
   the pre rev. 2 defaults its skins were made for. Equipped store cosmetics
   overlay onto a copy of the default per slot:

     tower      → the walnut striker board + channel + ticks + brass bell
                  (towerColor, towerLo, channelColor, tickColor, bellColor)
     puck       → the enamel puck + the hammer
                  (puckColor, puckHi, hammerColor)
     background → the night-midway sky, ground, and string-light bulbs
                  (bgTop, bgBottom, accent, groundColor)

   buildHighStrikerTheme(response) folds response.equipped onto the default,
   reading each asset_ref field by name with a fallback to the current value,
   so partial skins (one field) behave gracefully.
   ────────────────────────────────────────────────────────────────────────── */

import { MIDWAY_PALETTE as P, fillSlotFromLegacy } from '@/features/arcade/lib/midway-three';
import {
  contrastRatio,
  findEquippedSkinSet,
  mixHex,
  readableOn,
  type SkinMaterialOf,
  type SkinSet,
  type SkinShapeOf,
  type SkinSoundTint,
} from '@/features/arcade/lib/skins/skin-set';

export type HighStrikerCosmeticTheme = {
  // Night-midway backdrop (background slot).
  skyTop: string;
  skyBottom: string;
  groundColor: string;
  // String-light bulbs across the top of the scene (background slot accent).
  bulbAmber: string;
  bulbRed: string;
  bulbTeal: string;
  // Walnut striker tower (tower slot).
  woodHi: string;
  woodMid: string;
  woodLo: string;
  channel: string;
  tick: string;
  trim: string;
  // Brass bell (tower slot accent).
  bellHi: string;
  bell: string;
  bellLo: string;
  // Enamel puck (puck slot).
  puckHi: string;
  puck: string;
  puckLo: string;
  // Hammer + base pad (puck slot).
  hammerWood: string;
  hammerHead: string;
  pad: string;
  // A skin set (SKINS.md): what the scene draws on top of the colours above.
  // Absent for the house look and for older one-slot skins.
  skin?: HighStrikerSkin;
};

/** What a skin set adds to the colours: the tower face's material, the
 *  puck's shape, the scale's colours and the sound tint. */
export type HighStrikerSkin = {
  material: SkinMaterialOf<'high-striker'>;
  shape: SkinShapeOf<'high-striker'>;
  sound: SkinSoundTint;
  /** The face's ground, its second tone and its seams. */
  face: { base: string; alt: string; line: string };
  /** The inset on the puck's face (a star, a perforation). */
  puckMark: string;
};

// The empty loadout: the kit palette for the tower, lights and night. The
// bell, puck and hammer are game art. bulbTeal is a stored skin field; by
// default that bulb is paper.
export const DEFAULT_HIGH_STRIKER_THEME: HighStrikerCosmeticTheme = {
  skyTop: P.nightTop,
  skyBottom: P.nightBottom,
  groundColor: P.deck,
  bulbAmber: P.ticket,
  bulbRed: P.red,
  bulbTeal: P.paper,
  woodHi: P.woodHi,
  woodMid: P.wood,
  woodLo: P.woodLo,
  channel: P.ink,
  tick: P.paper,
  trim: P.rail,
  bellHi: '#f6e09a',
  bell: '#c19a44',
  bellLo: '#7c5d24',
  puckHi: '#ec7a7c',
  puck: '#cb3a3b',
  puckLo: '#5e1a1c',
  hammerWood: '#8a5a2b',
  hammerHead: '#6b4423',
  pad: P.rail,
};

/**
 * The defaults before rev. 2, frozen. Every skin in the store was designed
 * against these, and the store previews fall back to them, so an equipped
 * slot fills its missing fields from here rather than from the palette.
 * Never change these values.
 */
export const LEGACY_HIGH_STRIKER_THEME: Readonly<HighStrikerCosmeticTheme> = Object.freeze({
  skyTop: '#241408',
  skyBottom: '#120904',
  groundColor: '#1b1006',
  bulbAmber: '#e3a52e',
  bulbRed: '#c33a2b',
  bulbTeal: '#2bb2a0',
  woodHi: '#6e4a26',
  woodMid: '#5a3a1c',
  woodLo: '#3a2412',
  channel: '#140a04',
  tick: '#e8dcc0',
  trim: '#241505',
  bellHi: '#f6e09a',
  bell: '#c19a44',
  bellLo: '#7c5d24',
  puckHi: '#ec7a7c',
  puck: '#cb3a3b',
  puckLo: '#5e1a1c',
  hammerWood: '#8a5a2b',
  hammerHead: '#6b4423',
  pad: '#241505',
});

/** The fields each cosmetic slot owns. */
const SLOT_FIELDS: Record<string, readonly (keyof HighStrikerCosmeticTheme)[]> = {
  tower: ['woodMid', 'woodHi', 'woodLo', 'channel', 'tick', 'trim', 'bell', 'bellHi', 'bellLo'],
  puck: ['puck', 'puckHi', 'puckLo', 'hammerWood', 'hammerHead'],
  background: ['skyTop', 'skyBottom', 'groundColor', 'bulbAmber', 'bulbRed', 'bulbTeal'],
};

export type InventoryCosmeticResponse = {
  wallet?: { credits?: number };
  dailyGameCredits?: { earned?: number; cap?: number };
  equipped?: Array<{
    slot?: string;
    item?: {
      assetRef?: Record<string, unknown> | null;
    } | null;
  }>;
};

const readAssetColor = (
  assetRef: Record<string, unknown> | null | undefined,
  key: string,
  fallback: string,
) => {
  const value = assetRef?.[key];
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : fallback;
};

/* A skin set fills every slot at once. The tower is the body and the face
   (drawn in the skin's material, its second tone leaning toward the scale
   colour); the height ticks take the scale colour where it reads against the
   tower, else ink or paper; the channel is whichever of ink and paper the
   puck reads against; the bell and the puck take their colours and the puck
   its shape. The hammer, the rails and
   the night keep the house look. Travel, heights and timing are the
   game's. */
export const applyHighStrikerSkinSet = (
  base: HighStrikerCosmeticTheme,
  skin: SkinSet<'high-striker'>,
): HighStrikerCosmeticTheme => {
  const p = skin.palette;
  return {
    ...base,
    woodMid: p.tower,
    woodHi: mixHex(p.tower, '#ffffff', 0.25),
    woodLo: mixHex(p.tower, '#000000', 0.35),
    channel: readableOn(p.puck, P.ink, P.paper),
    tick: contrastRatio(p.scale, p.tower) >= 3 ? p.scale : readableOn(p.tower, P.ink, P.paper),
    trim: mixHex(p.tower, P.ink, 0.45),
    pad: mixHex(p.tower, P.ink, 0.6),
    bell: p.bell,
    bellHi: mixHex(p.bell, '#ffffff', 0.45),
    bellLo: mixHex(p.bell, '#000000', 0.4),
    puck: p.puck,
    puckHi: mixHex(p.puck, '#ffffff', 0.4),
    puckLo: mixHex(p.puck, '#000000', 0.5),
    groundColor: p.ground,
    skin: {
      material: skin.material,
      shape: skin.shape,
      sound: skin.sound,
      face: {
        base: p.tower,
        alt: mixHex(p.tower, p.scale, 0.3),
        line: mixHex(p.tower, p.mark, 0.5),
      },
      puckMark: mixHex(p.puck, p.mark, 0.6),
    },
  };
};

export const buildHighStrikerTheme = (
  response: InventoryCosmeticResponse,
): HighStrikerCosmeticTheme => {
  const skinSet = findEquippedSkinSet(response.equipped, 'high-striker');
  if (skinSet) return applyHighStrikerSkinSet({ ...DEFAULT_HIGH_STRIKER_THEME }, skinSet);
  const theme: HighStrikerCosmeticTheme = { ...DEFAULT_HIGH_STRIKER_THEME };
  for (const equipped of response.equipped ?? []) {
    const slot = equipped?.slot;
    const assetRef = equipped?.item?.assetRef ?? null;
    if (!slot || !assetRef) continue;
    fillSlotFromLegacy(theme, LEGACY_HIGH_STRIKER_THEME, SLOT_FIELDS[slot]);

    if (slot === 'tower') {
      theme.woodMid = readAssetColor(assetRef, 'towerColor', theme.woodMid);
      theme.woodHi = readAssetColor(assetRef, 'towerHi', theme.woodHi);
      theme.woodLo = readAssetColor(assetRef, 'towerLo', theme.woodLo);
      theme.channel = readAssetColor(assetRef, 'channelColor', theme.channel);
      theme.tick = readAssetColor(assetRef, 'tickColor', theme.tick);
      theme.trim = readAssetColor(assetRef, 'trimColor', theme.trim);
      // A single accent recolors the bell; mids/lows keep the default shading
      // unless explicitly overridden.
      theme.bell = readAssetColor(
        assetRef,
        'bellColor',
        readAssetColor(assetRef, 'towerAccent', theme.bell),
      );
      theme.bellHi = readAssetColor(assetRef, 'bellHi', theme.bellHi);
      theme.bellLo = readAssetColor(assetRef, 'bellLo', theme.bellLo);
    } else if (slot === 'puck') {
      theme.puck = readAssetColor(assetRef, 'puckColor', theme.puck);
      theme.puckHi = readAssetColor(assetRef, 'puckHi', theme.puckHi);
      theme.puckLo = readAssetColor(assetRef, 'puckLo', theme.puckLo);
      theme.hammerWood = readAssetColor(assetRef, 'hammerColor', theme.hammerWood);
      theme.hammerHead = readAssetColor(assetRef, 'hammerHead', theme.hammerHead);
    } else if (slot === 'background') {
      theme.skyTop = readAssetColor(assetRef, 'bgTop', theme.skyTop);
      theme.skyBottom = readAssetColor(assetRef, 'bgBottom', theme.skyBottom);
      theme.groundColor = readAssetColor(assetRef, 'groundColor', theme.groundColor);
      // A single accent recolors the leading bulb; the others keep the default
      // carnival rotation unless explicitly overridden.
      const accent = readAssetColor(assetRef, 'accent', '');
      if (accent) theme.bulbAmber = accent;
      theme.bulbAmber = readAssetColor(assetRef, 'accentAmber', theme.bulbAmber);
      theme.bulbRed = readAssetColor(assetRef, 'accentRed', theme.bulbRed);
      theme.bulbTeal = readAssetColor(assetRef, 'accentTeal', theme.bulbTeal);
    }
  }
  return theme;
};
