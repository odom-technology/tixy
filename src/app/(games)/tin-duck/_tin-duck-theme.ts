/* ──────────────────────────────────────────────────────────────────────────
   Tin Duck Gallery cosmetic theme.

   The canvas paints with plain hex literals pulled from a TinDuckTheme object.
   DEFAULT_TIN_DUCK_THEME is the rev. 2 tixy palette. An equipped slot first
   takes its fields from LEGACY_TIN_DUCK_THEME, the old Midway palette its
   skins were made for, so it looks as it did when it was sold. Equipped
   store cosmetics overlay onto a copy of the default per slot:

     duck  → the scrolling tin ducks (body/belly/beak/eye) + the knock-down flip
     sight → the crosshair / gun sight (ring + accent) + the muzzle flash + the
             hit spark burst
     booth → the framing curtains, valance, backboard enamel + the counter rail

   The GOLDEN bonus pop-up duck stays a fixed enamel gold (a special target, like
   Gopher's golden critter) so it always reads as the jackpot regardless of the
   equipped regular-duck skin.

   buildTinDuckTheme(response) folds response.equipped onto the default, reading
   each asset_ref field by name with a fallback to the current value, so partial
   skins (one field) behave gracefully.
   ────────────────────────────────────────────────────────────────────────── */

import { fillSlotFromLegacy } from '@/features/arcade/lib/midway-three';
import {
  contrastRatio,
  findEquippedSkinSet,
  mixHex,
  type SkinMaterialOf,
  type SkinSet,
  type SkinShapeOf,
  type SkinSoundTint,
} from '@/features/arcade/lib/skins/skin-set';

export type TinDuckTheme = {
  /** Rows wear their own colours until a duck skin is equipped. */
  rowTint: boolean;
  // Booth backdrop (booth slot).
  skyTop: string;
  skyBottom: string;
  backboard: string;
  backboardLine: string;
  curtainA: string;
  curtainB: string;
  curtainShade: string;
  valance: string;
  rail: string;
  railHi: string;
  // Scrolling tin ducks (duck slot).
  duckBody: string;
  duckBodyHi: string;
  duckBodyLo: string;
  duckBelly: string;
  duckBeak: string;
  duckEye: string;
  duckEdge: string;
  // Golden bonus pop-up (fixed enamel gold — no slot).
  goldBody: string;
  goldBodyHi: string;
  goldBodyLo: string;
  goldEdge: string;
  // Crosshair + gun feedback (sight slot).
  sight: string;
  sightAccent: string;
  muzzle: string;
  muzzleHot: string;
  spark: string;
  sparkHot: string;
  // Ink + cream (UI chrome on the canvas).
  ink: string;
  cream: string;
  creamDim: string;
  // Optional, neutral-by-default duck glow (duck slot effect).
  duckGlowEnabled: boolean;
  duckGlowColor: string;
  // A skin set (SKINS.md): what the scene draws on top of the colours above.
  // Absent for the house look and for older one-slot skins.
  skin?: TinDuckSkin;
};

/** What a skin set adds to the colours: the backboard's material, the
 *  target's shape, the counter and bullseye colours and the sound tint. */
export type TinDuckSkin = {
  material: SkinMaterialOf<'tin-duck'>;
  shape: SkinShapeOf<'tin-duck'>;
  sound: SkinSoundTint;
  /** The backboard's second tone and its seams. */
  boothAlt: string;
  boothLine: string;
  /** The counter the gun rests on. */
  counter: string;
  /** The plates' centre ring. */
  bull: string;
};

// The rev. 2 default: the tixy palette. Equipped slots fill their fields from
// LEGACY_TIN_DUCK_THEME first, so a skin looks as it did when it was sold.
export const DEFAULT_TIN_DUCK_THEME: TinDuckTheme = {
  rowTint: true,
  skyTop: '#2a221d',
  skyBottom: '#1f1a16',
  backboard: '#2b231d',
  backboardLine: '#3b3028',
  curtainA: '#b83627',
  curtainB: '#f4ebdc',
  curtainShade: '#8f281c',
  valance: '#f2a33c',
  rail: '#6b4a2e',
  railHi: '#8a6340',
  duckBody: '#f4ebdc',
  duckBodyHi: '#ffffff',
  duckBodyLo: '#cbbda5',
  duckBelly: '#f2a33c',
  duckBeak: '#b83627',
  duckEye: '#1f1a16',
  duckEdge: '#54483d',
  goldBody: '#f2a33c',
  goldBodyHi: '#ffd48a',
  goldBodyLo: '#c78d1f',
  goldEdge: '#8a5c10',
  sight: '#f4ebdc',
  sightAccent: '#b83627',
  muzzle: '#f2a33c',
  muzzleHot: '#fff1cf',
  spark: '#f4ebdc',
  sparkHot: '#fff1cf',
  ink: '#1f1a16',
  cream: '#f4ebdc',
  creamDim: '#cdbfa6',
  duckGlowEnabled: false,
  duckGlowColor: '#f4ebdc',
};

/** The pre rev. 2 defaults the store skins were made against. Never edit. */
export const LEGACY_TIN_DUCK_THEME: Readonly<TinDuckTheme> = Object.freeze({
  rowTint: false,
  skyTop: '#1c6f5c',
  skyBottom: '#0c3a30',
  backboard: '#123c2e',
  backboardLine: '#0b271d',
  curtainA: '#c33b3c',
  curtainB: '#9e2c2d',
  curtainShade: '#6f1e1f',
  valance: '#e8a23c',
  rail: '#5a3a20',
  railHi: '#7c5230',
  duckBody: '#e7edf2',
  duckBodyHi: '#ffffff',
  duckBodyLo: '#aeb9c4',
  duckBelly: '#f6c862',
  duckBeak: '#e8863a',
  duckEye: '#20140a',
  duckEdge: '#4b525c',
  goldBody: '#f2b93f',
  goldBodyHi: '#ffe08a',
  goldBodyLo: '#c78d1f',
  goldEdge: '#8a5c10',
  sight: '#f7eedd',
  sightAccent: '#c33b3c',
  muzzle: '#f8c45f',
  muzzleHot: '#fff1cf',
  spark: '#f8c45f',
  sparkHot: '#fff1cf',
  ink: '#08110c',
  cream: '#f7eedd',
  creamDim: '#cdbfa6',
  duckGlowEnabled: false,
  duckGlowColor: '#e7edf2',
});

const SLOT_FIELDS: Record<string, readonly (keyof TinDuckTheme)[]> = {
  duck: [
    'rowTint', 'duckBody', 'duckBodyHi', 'duckBodyLo', 'duckBelly', 'duckBeak',
    'duckEye', 'duckEdge', 'duckGlowEnabled', 'duckGlowColor',
  ],
  sight: ['sight', 'sightAccent', 'muzzle', 'muzzleHot', 'spark', 'sparkHot'],
  booth: [
    'skyTop', 'skyBottom', 'backboard', 'backboardLine', 'curtainA', 'curtainB',
    'curtainShade', 'valance', 'rail', 'railHi',
  ],
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

const readAssetBool = (
  assetRef: Record<string, unknown> | null | undefined,
  key: string,
  fallback: boolean,
) => {
  const value = assetRef?.[key];
  return typeof value === 'boolean' ? value : fallback;
};

/* A skin set fills every slot at once. The booth is the backboard (in the
   skin's material) and the awning stripes; the water is the row shelves the
   targets ride on; the target takes its colour and shape, with the sight as
   its accent and the mark as its eye. Rows share one colour: the rows' sizes
   and speeds tell them apart. The gold bonus target stays gold. The hit box,
   the flips and the plates' rings are the game's. */
export const applyTinDuckSkinSet = (
  base: TinDuckTheme,
  skin: SkinSet<'tin-duck'>,
): TinDuckTheme => {
  const p = skin.palette;
  const ink = base.ink;
  return {
    ...base,
    rowTint: false,
    skyTop: mixHex(p.booth, ink, 0.5),
    skyBottom: mixHex(p.booth, ink, 0.65),
    backboard: p.booth,
    backboardLine: p.boothAlt,
    curtainA: p.booth,
    curtainB: p.boothAlt,
    curtainShade: mixHex(p.booth, ink, 0.3),
    valance: p.target,
    rail: p.water,
    railHi: mixHex(p.water, '#ffffff', 0.2),
    duckBody: p.target,
    duckBodyHi: mixHex(p.target, '#ffffff', 0.4),
    duckBodyLo: mixHex(p.target, '#000000', 0.25),
    duckBelly: mixHex(p.target, p.targetMark, 0.2),
    duckBeak: p.sight,
    duckEye: p.targetMark,
    duckEdge: mixHex(p.target, ink, 0.6),
    sight: p.sight,
    sightAccent: p.target,
    muzzle: p.target,
    muzzleHot: mixHex(p.target, '#ffffff', 0.7),
    spark: p.target,
    sparkHot: mixHex(p.target, '#ffffff', 0.8),
    duckGlowEnabled: false,
    skin: {
      material: skin.material,
      shape: skin.shape,
      sound: skin.sound,
      // The backboard's second tone stays well apart from the targets: where
      // the palette's boothAlt is close to the target, it is only a step.
      boothAlt: mixHex(p.booth, p.boothAlt, contrastRatio(p.target, p.boothAlt) >= 2.5 ? 1 : 0.4),
      boothLine: mixHex(p.booth, ink, 0.4),
      counter: mixHex(p.booth, ink, 0.45),
      bull: p.sight,
    },
  };
};

export const buildTinDuckTheme = (
  response: InventoryCosmeticResponse,
): TinDuckTheme => {
  const skinSet = findEquippedSkinSet(response.equipped, 'tin-duck');
  if (skinSet) return applyTinDuckSkinSet({ ...DEFAULT_TIN_DUCK_THEME }, skinSet);
  const theme: TinDuckTheme = { ...DEFAULT_TIN_DUCK_THEME };
  for (const equipped of response.equipped ?? []) {
    const slot = equipped?.slot;
    const assetRef = equipped?.item?.assetRef ?? null;
    if (!slot || !assetRef) continue;
    fillSlotFromLegacy(theme, LEGACY_TIN_DUCK_THEME, SLOT_FIELDS[slot]);

    if (slot === 'duck') {
      theme.duckBody = readAssetColor(assetRef, 'duckColor', theme.duckBody);
      theme.duckBodyHi = readAssetColor(assetRef, 'duckHi', theme.duckBodyHi);
      theme.duckBodyLo = readAssetColor(assetRef, 'duckLo', theme.duckBodyLo);
      theme.duckBelly = readAssetColor(assetRef, 'bellyColor', theme.duckBelly);
      theme.duckBeak = readAssetColor(assetRef, 'beakColor', theme.duckBeak);
      theme.duckEye = readAssetColor(assetRef, 'eyeColor', theme.duckEye);
      theme.duckEdge = readAssetColor(assetRef, 'duckEdge', theme.duckEdge);
      theme.duckGlowEnabled = readAssetBool(
        assetRef,
        'duckGlowEnabled',
        theme.duckGlowEnabled,
      );
      theme.duckGlowColor = readAssetColor(
        assetRef,
        'duckGlowColor',
        theme.duckBody,
      );
    } else if (slot === 'sight') {
      theme.sight = readAssetColor(assetRef, 'sightColor', theme.sight);
      theme.sightAccent = readAssetColor(assetRef, 'sightAccent', theme.sightAccent);
      theme.muzzle = readAssetColor(assetRef, 'muzzleColor', theme.muzzle);
      theme.muzzleHot = readAssetColor(assetRef, 'muzzleHot', theme.muzzleHot);
      theme.spark = readAssetColor(assetRef, 'sparkColor', theme.spark);
      theme.sparkHot = readAssetColor(assetRef, 'sparkHot', theme.sparkHot);
    } else if (slot === 'booth') {
      theme.curtainA = readAssetColor(assetRef, 'curtainColor', theme.curtainA);
      theme.curtainB = readAssetColor(assetRef, 'curtainLo', theme.curtainB);
      theme.curtainShade = readAssetColor(assetRef, 'curtainShade', theme.curtainShade);
      theme.valance = readAssetColor(assetRef, 'valanceColor', theme.valance);
      theme.skyTop = readAssetColor(assetRef, 'skyTop', theme.skyTop);
      theme.skyBottom = readAssetColor(assetRef, 'skyBottom', theme.skyBottom);
      theme.backboard = readAssetColor(assetRef, 'backboardColor', theme.backboard);
      theme.backboardLine = readAssetColor(assetRef, 'backboardLine', theme.backboardLine);
      theme.rail = readAssetColor(assetRef, 'railColor', theme.rail);
      theme.railHi = readAssetColor(assetRef, 'railHi', theme.railHi);
    }
  }
  return theme;
};
