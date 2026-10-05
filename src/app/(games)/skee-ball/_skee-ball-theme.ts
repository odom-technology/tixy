/* ──────────────────────────────────────────────────────────────────────────
   Skee-Ball cosmetic theme.

   The three.js scene builds its materials from plain hex literals pulled from
   a SkeeBallCosmeticTheme object. DEFAULT_SKEE_BALL_THEME takes the cabinet,
   rails, lights and night from the 3D kit's palette (MIDWAY_PALETTE); the
   rings and the ball are game art. An equipped slot fills its missing fields
   from LEGACY_SKEE_BALL_THEME, the pre rev. 2 defaults its skins were made
   for. Equipped store cosmetics overlay onto a copy of the default per slot:

     lane       → the walnut lane + kicker ramp + side rails + trim
                  (laneColor, laneHi, laneLo, railColor, trimColor)
     rings      → the enamel ring board + corner pockets + the ball
                  (fieldColor, ring10..ring50, pocketColor, ballColor, ballHi)
     background → the night-midway sky, ground, and string-light bulbs
                  (bgTop, bgBottom, groundColor, accent*)

   buildSkeeBallTheme(response) folds response.equipped onto the default,
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

export type SkeeBallCosmeticTheme = {
  // Night-midway backdrop (background slot).
  skyTop: string;
  skyBottom: string;
  groundColor: string;
  // String-light bulbs (background slot accents). The keys are stored skin
  // fields; by default the third bulb is paper, not teal.
  bulbAmber: string;
  bulbRed: string;
  bulbTeal: string;
  // Walnut lane + kicker ramp (lane slot).
  woodHi: string;
  woodMid: string;
  woodLo: string;
  rail: string;
  trim: string;
  // Ring board backing (rings slot).
  field: string;
  // Enamel scoring rings, 10 outer → 50 center (rings slot).
  ring10: string;
  ring20: string;
  ring30: string;
  ring40: string;
  ring50: string;
  // Corner pockets (rings slot accent).
  pocket: string;
  // Cream enamel ball (rings slot).
  ballHi: string;
  ball: string;
  ballLo: string;
  // A skin set (SKINS.md): what the scene draws on top of the colours above.
  // Absent for the house look and for older one-slot skins.
  skin?: SkeeBallSkin;
};

/** What a skin set adds to the colours: the lane's material, the ball's
 *  markings, the marking colour and the sound tint. */
export type SkeeBallSkin = {
  material: SkinMaterialOf<'skee-ball'>;
  shape: SkinShapeOf<'skee-ball'>;
  sound: SkinSoundTint;
  /** The lane's second tone: the other board, the grain, the dimple. */
  laneAlt: string;
  /** Seams and grain lines on the lane. */
  laneLine: string;
  /** The ball's markings, picked to read against the ball. */
  ballMark: string;
};

// The empty loadout: the kit palette for the cabinet, lights and night.
export const DEFAULT_SKEE_BALL_THEME: SkeeBallCosmeticTheme = {
  skyTop: P.nightTop,
  skyBottom: P.nightBottom,
  groundColor: P.deck,
  bulbAmber: P.ticket,
  bulbRed: P.red,
  bulbTeal: P.paper,
  woodHi: P.woodHi,
  woodMid: P.wood,
  woodLo: P.woodLo,
  rail: P.rail,
  trim: P.woodHi,
  field: P.rail,
  ring10: '#2bb2a0',
  ring20: '#e8dcc0',
  ring30: '#e3a52e',
  ring40: '#c33a2b',
  ring50: '#f2e5c8',
  pocket: '#f8c45f',
  ballHi: '#fdf6e7',
  ball: '#f2e5c8',
  ballLo: '#b8a67e',
};

/**
 * The defaults before rev. 2, frozen. Every skin in the store was designed
 * against these, and the store previews fall back to them, so an equipped
 * slot fills its missing fields from here rather than from the palette.
 * Never change these values.
 */
export const LEGACY_SKEE_BALL_THEME: Readonly<SkeeBallCosmeticTheme> = Object.freeze({
  skyTop: '#241408',
  skyBottom: '#120904',
  groundColor: '#1b1006',
  bulbAmber: '#e3a52e',
  bulbRed: '#c33a2b',
  bulbTeal: '#2bb2a0',
  woodHi: '#6e4a26',
  woodMid: '#5a3a1c',
  woodLo: '#3a2412',
  rail: '#241505',
  trim: '#8a5a2b',
  field: '#241505',
  ring10: '#2bb2a0',
  ring20: '#e8dcc0',
  ring30: '#e3a52e',
  ring40: '#c33a2b',
  ring50: '#f2e5c8',
  pocket: '#f8c45f',
  ballHi: '#fdf6e7',
  ball: '#f2e5c8',
  ballLo: '#b8a67e',
});

/** The fields each cosmetic slot owns. */
const SLOT_FIELDS: Record<string, readonly (keyof SkeeBallCosmeticTheme)[]> = {
  lane: ['woodMid', 'woodHi', 'woodLo', 'rail', 'trim'],
  rings: ['field', 'ring10', 'ring20', 'ring30', 'ring40', 'ring50', 'pocket', 'ball', 'ballHi', 'ballLo'],
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

/* A skin set fills every slot at once. The palette's lane and laneAlt are the
   lane's two tones and the ring board's field; rings and ringMark alternate
   on the scoring bands; the ball takes its own colour and markings. The
   cabinet, the ring walls and the night keep the house look. Sizes, the
   ring radii and the ball's radius are the engine's. */
export const applySkeeBallSkinSet = (
  base: SkeeBallCosmeticTheme,
  skin: SkinSet<'skee-ball'>,
): SkeeBallCosmeticTheme => {
  const p = skin.palette;
  const field = p.laneAlt;
  // The pocket rim and the 100 sit against the field: take whichever of the
  // two ring colours reads better there.
  const pocket = contrastRatio(p.rings, field) >= contrastRatio(p.ringMark, field) ? p.rings : p.ringMark;
  const ballMark =
    contrastRatio(p.ringMark, p.ball) >= 1.5 ? p.ringMark : readableOn(p.ball, P.ink, P.paper);
  return {
    ...base,
    woodMid: p.lane,
    woodHi: p.laneAlt,
    woodLo: p.cabinet,
    rail: p.cabinet,
    trim: mixHex(p.cabinet, p.lane, 0.45),
    field,
    ring10: p.rings,
    ring20: p.rings,
    ring30: p.ringMark,
    ring40: p.rings,
    ring50: p.ringMark,
    pocket,
    ball: p.ball,
    ballHi: mixHex(p.ball, '#ffffff', 0.4),
    ballLo: mixHex(p.ball, '#000000', 0.3),
    skin: {
      material: skin.material,
      shape: skin.shape,
      sound: skin.sound,
      laneAlt: p.laneAlt,
      laneLine: mixHex(p.lane, p.cabinet, 0.55),
      ballMark,
    },
  };
};

export const buildSkeeBallTheme = (
  response: InventoryCosmeticResponse,
): SkeeBallCosmeticTheme => {
  const skinSet = findEquippedSkinSet(response.equipped, 'skee-ball');
  if (skinSet) return applySkeeBallSkinSet({ ...DEFAULT_SKEE_BALL_THEME }, skinSet);
  const theme: SkeeBallCosmeticTheme = { ...DEFAULT_SKEE_BALL_THEME };
  for (const equipped of response.equipped ?? []) {
    const slot = equipped?.slot;
    const assetRef = equipped?.item?.assetRef ?? null;
    if (!slot || !assetRef) continue;
    fillSlotFromLegacy(theme, LEGACY_SKEE_BALL_THEME, SLOT_FIELDS[slot]);

    if (slot === 'lane') {
      theme.woodMid = readAssetColor(assetRef, 'laneColor', theme.woodMid);
      theme.woodHi = readAssetColor(assetRef, 'laneHi', theme.woodHi);
      theme.woodLo = readAssetColor(assetRef, 'laneLo', theme.woodLo);
      theme.rail = readAssetColor(assetRef, 'railColor', theme.rail);
      theme.trim = readAssetColor(assetRef, 'trimColor', theme.trim);
    } else if (slot === 'rings') {
      theme.field = readAssetColor(assetRef, 'fieldColor', theme.field);
      // A single accent recolors the whole ring set; individual rings keep
      // the default enamel rotation unless explicitly overridden.
      const accent = readAssetColor(assetRef, 'ringColor', '');
      if (accent) {
        theme.ring10 = accent;
        theme.ring30 = accent;
        theme.ring50 = accent;
      }
      theme.ring10 = readAssetColor(assetRef, 'ring10', theme.ring10);
      theme.ring20 = readAssetColor(assetRef, 'ring20', theme.ring20);
      theme.ring30 = readAssetColor(assetRef, 'ring30', theme.ring30);
      theme.ring40 = readAssetColor(assetRef, 'ring40', theme.ring40);
      theme.ring50 = readAssetColor(assetRef, 'ring50', theme.ring50);
      theme.pocket = readAssetColor(
        assetRef,
        'pocketColor',
        readAssetColor(assetRef, 'ringAccent', theme.pocket),
      );
      theme.ball = readAssetColor(assetRef, 'ballColor', theme.ball);
      theme.ballHi = readAssetColor(assetRef, 'ballHi', theme.ballHi);
      theme.ballLo = readAssetColor(assetRef, 'ballLo', theme.ballLo);
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
