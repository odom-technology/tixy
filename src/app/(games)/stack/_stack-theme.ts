/* ──────────────────────────────────────────────────────────────────────────
   STACK cosmetic theme — equipped-skin pipeline (mirrors the Snake pattern in
   src/app/(games)/snake/_snake-theme.ts).

   Slots:
     blocks     → the tower-block palette (two alternating enamel tones + a
                  "perfect drop" accent) + an optional block glow.
     background → the recessed-cabinet screen backdrop (top/bottom + accent).
     effects    → slice/placement feedback (slice + perfect-flash + particle).

   DEFAULT_STACK_THEME reproduces the previous hardcoded Midway look EXACTLY.
   At runtime resolveMidwayStackTheme() folds in the live Midway CSS tokens so
   the default look tracks the active sub-theme; equipped skins overlay on top.
   ────────────────────────────────────────────────────────────────────────── */

import { findEquippedSkinSet, mixHex, type SkinSet } from '@/features/arcade/lib/skins/skin-set';

import { buildStackSkinLook, type StackSkinLook } from './_stack-skin-draw';

export type StackCosmeticTheme = {
  // background slot
  screenTop: string;
  screenBottom: string;
  bgAccent: string; // '' = none (subtle top glow when set)
  // blocks slot
  toneAFace: string;
  toneAEdge: string;
  toneBFace: string;
  toneBEdge: string;
  perfectColor: string; // palette accent; default drives the placement flash
  ink: string;
  cream: string;
  blockGlowEnabled: boolean;
  blockGlowColor: string;
  blockGlowSize: number;
  // effects slot
  sliceColor: string; // '' = use the block face
  perfectFlashColor: string;
  particleColor: string; // '' = use the block face
  // A skin set (SKINS.md), in both modes. Null draws the house look.
  skin: StackSkinLook | null;
};

export const DEFAULT_STACK_THEME: StackCosmeticTheme = {
  // background
  screenTop: '#1c2a22',
  screenBottom: '#0f1512',
  bgAccent: '',
  // blocks
  toneAFace: '#f2a33c',
  toneAEdge: '#c47c1f',
  toneBFace: '#2fb8a6',
  toneBEdge: '#1d8579',
  perfectColor: '#f6eddc',
  ink: '#0f0a06',
  cream: '#f6eddc',
  blockGlowEnabled: false,
  blockGlowColor: '#f2a33c',
  blockGlowSize: 18,
  // effects
  sliceColor: '',
  perfectFlashColor: '#f6eddc',
  particleColor: '',
  skin: null,
};

export type InventoryCosmeticResponse = {
  wallet?: {
    credits?: number;
  };
  dailyGameCredits?: {
    earned?: number;
    cap?: number;
  };
  equipped?: Array<{
    slot?: string;
    item?: {
      assetRef?: Record<string, unknown> | null;
    } | null;
  }>;
};

/* Read a Midway CSS custom property off :root. Returns the trimmed value or the
   fallback when unavailable (SSR, missing token). */
const readToken = (name: string, fallback: string): string => {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return fallback;
  }
  try {
    const value = getComputedStyle(document.documentElement)
      .getPropertyValue(name)
      .trim();
    return value.length > 0 ? value : fallback;
  } catch {
    return fallback;
  }
};

export const resolveMidwayStackTheme = (): StackCosmeticTheme => ({
  ...DEFAULT_STACK_THEME,
  screenTop: readToken('--screen-well', DEFAULT_STACK_THEME.screenTop),
  toneAFace: readToken('--enamel-tickets', DEFAULT_STACK_THEME.toneAFace),
  toneAEdge: readToken('--enamel-tickets-edge', DEFAULT_STACK_THEME.toneAEdge),
  toneBFace: readToken('--enamel-prize', DEFAULT_STACK_THEME.toneBFace),
  toneBEdge: readToken('--enamel-prize-edge', DEFAULT_STACK_THEME.toneBEdge),
  ink: readToken('--border-ink', DEFAULT_STACK_THEME.ink),
  cream: readToken('--key-face', DEFAULT_STACK_THEME.cream),
  perfectColor: readToken('--key-face', DEFAULT_STACK_THEME.perfectColor),
  perfectFlashColor: readToken(
    '--key-face',
    DEFAULT_STACK_THEME.perfectFlashColor,
  ),
});

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

const readAssetNumber = (
  assetRef: Record<string, unknown> | null | undefined,
  key: string,
  fallback: number,
  min: number,
  max: number,
) => {
  const value = assetRef?.[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
};

/* A skin set fills blocks, background and effects at once and is drawn flat:
   no glow, no gradient, no hue drift. Endless alternates `block` with a
   step toward `blockAlt` row by row and sweeps the same two; the cabinet
   draws the tower in `block` and the moving row in `blockAlt`. Rules,
   timing and the replayed timeline are the game's. */
export const applyStackSkinSet = (
  base: StackCosmeticTheme,
  skin: SkinSet<'stack'>,
): StackCosmeticTheme => {
  const look = buildStackSkinLook(skin);
  const p = skin.palette;
  return {
    ...base,
    screenTop: p.ground,
    screenBottom: p.ground,
    bgAccent: '',
    toneAFace: p.block,
    toneAEdge: mixHex(p.block, '#000000', 0.25),
    toneBFace: mixHex(p.block, p.blockAlt, 0.45),
    toneBEdge: mixHex(p.block, '#000000', 0.25),
    perfectColor: look.hot,
    blockGlowEnabled: false,
    sliceColor: '',
    perfectFlashColor: look.hot,
    particleColor: '',
    skin: look,
  };
};

export const buildStackTheme = (
  response: InventoryCosmeticResponse,
): StackCosmeticTheme => {
  const theme = resolveMidwayStackTheme();
  const skinSet = findEquippedSkinSet(response.equipped, 'stack');
  if (skinSet) return applyStackSkinSet(theme, skinSet);
  for (const equipped of response.equipped ?? []) {
    const slot = equipped?.slot;
    const assetRef = equipped?.item?.assetRef ?? null;
    if (!slot || !assetRef) continue;

    if (slot === 'blocks') {
      // Accept both blockBase/blockTop aliases and the explicit tone keys.
      theme.toneAFace = readAssetColor(
        assetRef,
        'toneAFace',
        readAssetColor(assetRef, 'blockBase', theme.toneAFace),
      );
      theme.toneAEdge = readAssetColor(
        assetRef,
        'toneAEdge',
        readAssetColor(assetRef, 'blockBaseEdge', theme.toneAEdge),
      );
      theme.toneBFace = readAssetColor(
        assetRef,
        'toneBFace',
        readAssetColor(assetRef, 'blockTop', theme.toneBFace),
      );
      theme.toneBEdge = readAssetColor(
        assetRef,
        'toneBEdge',
        readAssetColor(assetRef, 'blockTopEdge', theme.toneBEdge),
      );
      theme.perfectColor = readAssetColor(
        assetRef,
        'perfectColor',
        theme.perfectColor,
      );
      if (typeof assetRef.blockGlowEnabled === 'boolean') {
        theme.blockGlowEnabled = assetRef.blockGlowEnabled;
      }
      theme.blockGlowColor = readAssetColor(
        assetRef,
        'blockGlowColor',
        theme.blockGlowColor,
      );
      theme.blockGlowSize = readAssetNumber(
        assetRef,
        'blockGlowSize',
        theme.blockGlowSize,
        0,
        60,
      );
    } else if (slot === 'background') {
      theme.screenTop = readAssetColor(
        assetRef,
        'bgTop',
        readAssetColor(assetRef, 'screenTop', theme.screenTop),
      );
      theme.screenBottom = readAssetColor(
        assetRef,
        'bgBottom',
        readAssetColor(assetRef, 'screenBottom', theme.screenBottom),
      );
      theme.bgAccent = readAssetColor(assetRef, 'accent', theme.bgAccent);
    } else if (slot === 'effects') {
      theme.sliceColor = readAssetColor(assetRef, 'sliceColor', theme.sliceColor);
      theme.perfectFlashColor = readAssetColor(
        assetRef,
        'perfectFlashColor',
        theme.perfectFlashColor,
      );
      theme.particleColor = readAssetColor(
        assetRef,
        'particleColor',
        theme.particleColor,
      );
    }
  }
  return theme;
};
