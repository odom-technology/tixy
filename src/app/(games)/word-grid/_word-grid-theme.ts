import type { CSSProperties } from 'react';

import {
  findEquippedSkinSet,
  mixHex,
  readableOn,
  type SkinMaterial,
  type SkinSet,
} from '@/features/arcade/lib/skins/skin-set';

/* ──────────────────────────────────────────────────────────────────────
   Word Grid (Wordle-style) cosmetic theme.

   Word Grid is DOM/CSS-rendered. The base look lives in the route-scoped
   ./_word-grid-midway.css file (imported by page.tsx), scoped to
   `.word-grid-root`, which defines the graded-tile palette as CSS variables:

       --wg-correct / --wg-correct-on
       --wg-present / --wg-present-on / --wg-absent / --wg-absent-on

   Equipped cosmetics overlay by setting `--wg-*` variables inline on the
   board frame and the keyboard wrapper (inline wins over the stylesheet
   defaults). An empty loadout emits NO variables, so the tixy palette
   shows.

   Slots:
     tiles    → guess tiles: correct/present/absent enamel faces, base tile
                border + base tile text.
     keyboard → on-screen key bg / text / active (focus) color.
     accent   → primary accent (typed-tile border + key focus-ring fallback).
   ────────────────────────────────────────────────────────────────────── */

export type WordGridCosmeticTheme = {
  // tiles slot
  correctColor: string;
  presentColor: string;
  absentColor: string;
  tileBorder: string;
  tileText: string;
  // keyboard slot
  keyBg: string;
  keyText: string;
  keyActive: string;
  // accent slot
  accentColor: string;
  // A skin set (SKINS.md): the page's material and the tiles' shape, read by
  // the CSS through data attributes. Null is the house look.
  skin: WordGridSkinLook | null;
};

export type WordGridSkinLook = {
  material: SkinMaterial;
  shape: 'square' | 'stub' | 'round' | 'tag';
  ground: string;
  tile: string;
  tileInk: string;
  miss: string;
};

/* Literals mirror the tixy defaults in _word-grid-midway.css EXACTLY. An
   empty loadout emits zero CSS-variable overrides (see
   wordGridThemeToCssVars), so the default render is unchanged. */
export const DEFAULT_WORD_GRID_THEME: WordGridCosmeticTheme = {
  correctColor: '#538d4e', // --wg-correct (Wordle green, dark surface)
  presentColor: '#b59f3b', // --wg-present (Wordle yellow, dark surface)
  absentColor: '#3a3a3c', // --wg-absent (Wordle grey, dark surface)
  tileBorder: '#6b5e51', // --wg-empty-edge (ink 3)
  tileText: '#f4ebdc', // --wg-tile-text (paper)
  keyBg: '#818384', // --wg-key-bg (Wordle key grey)
  keyText: '#ffffff', // --wg-key-text (white)
  keyActive: '#f4ebdc', // --wg-key-active (paper)
  accentColor: '#b0a89d', // --wg-typed-edge (on ink 3)
  skin: null,
};

type InventoryCosmeticResponse = {
  equipped?: Array<{
    slot?: string;
    item?: {
      assetRef?: Record<string, unknown> | null;
    } | null;
  }>;
};

const readAssetColor = (
  assetRef: Record<string, unknown> | null | undefined,
  keys: string | string[],
  fallback: string,
) => {
  for (const key of Array.isArray(keys) ? keys : [keys]) {
    const value = assetRef?.[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  return fallback;
};

const parseHex = (hex: string): [number, number, number] | null => {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
};

/* Pick a readable text color (near-black or near-white) for a filled tile. */
const contrastOn = (hex: string): string => {
  const rgb = parseHex(hex);
  if (!rgb) return '#1b140d';
  const [r, g, b] = rgb;
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.6 ? '#1b140d' : '#fdf7ea';
};

/* A skin set fills tiles, keyboard and accent at once. The three results take
   the palette's hit, near and miss, and their letters take ink or paper,
   whichever reads better. The rules, the flip and the grid are the game's. */
const INK = '#1f1a16';
const PAPER = '#f4ebdc';

export const applyWordGridSkinSet = (skin: SkinSet<'word-grid'>): WordGridCosmeticTheme => {
  const p = skin.palette;
  return {
    ...DEFAULT_WORD_GRID_THEME,
    correctColor: p.hit,
    presentColor: p.near,
    absentColor: p.miss,
    tileBorder: mixHex(p.tile, p.tileInk, 0.45),
    tileText: p.tileInk,
    keyBg: p.tile,
    keyText: p.tileInk,
    keyActive: p.tileInk,
    accentColor: p.tileInk,
    skin: { material: skin.material, shape: skin.shape, ground: p.ground, tile: p.tile, tileInk: p.tileInk, miss: p.miss },
  };
};

/* The variables a skin sets beyond the key colours. */
const skinVars = (skin: WordGridSkinLook): Record<string, string> => {
  const dark = readableOn(skin.ground, INK, PAPER) === PAPER;
  const absentKey = mixHex(skin.ground, skin.miss, 0.5);
  return {
    '--wg-ground': skin.ground,
    '--wg-ground-2': mixHex(skin.ground, dark ? '#ffffff' : '#000000', 0.07),
    '--wg-line': mixHex(skin.ground, '#000000', dark ? 0.35 : 0.14),
    '--wg-tile-fill': skin.tile,
    '--wg-key-absent-bg': absentKey,
    '--wg-key-absent-on': readableOn(absentKey, INK, PAPER),
  };
};

/* The data attributes the stylesheet reads for a skin's material and shape. */
export const wordGridSkinAttrs = (
  theme: WordGridCosmeticTheme,
): { 'data-skin-material'?: string; 'data-skin-shape'?: string } =>
  theme.skin ? { 'data-skin-material': theme.skin.material, 'data-skin-shape': theme.skin.shape } : {};

export const buildWordGridTheme = (
  response: InventoryCosmeticResponse,
): WordGridCosmeticTheme => {
  const skinSet = findEquippedSkinSet(response.equipped, 'word-grid');
  if (skinSet) return applyWordGridSkinSet(skinSet);
  const theme: WordGridCosmeticTheme = { ...DEFAULT_WORD_GRID_THEME };
  for (const equipped of response.equipped ?? []) {
    const slot = equipped?.slot;
    const assetRef = equipped?.item?.assetRef ?? null;
    if (!slot || !assetRef) continue;
    if (slot === 'tiles') {
      theme.correctColor = readAssetColor(
        assetRef,
        ['correctColor', 'greenColor'],
        theme.correctColor,
      );
      theme.presentColor = readAssetColor(
        assetRef,
        ['presentColor', 'yellowColor'],
        theme.presentColor,
      );
      theme.absentColor = readAssetColor(
        assetRef,
        ['absentColor', 'grayColor'],
        theme.absentColor,
      );
      theme.tileBorder = readAssetColor(assetRef, 'tileBorder', theme.tileBorder);
      theme.tileText = readAssetColor(assetRef, 'tileText', theme.tileText);
    } else if (slot === 'keyboard') {
      theme.keyBg = readAssetColor(assetRef, 'keyBg', theme.keyBg);
      theme.keyText = readAssetColor(assetRef, 'keyText', theme.keyText);
      theme.keyActive = readAssetColor(assetRef, 'keyActive', theme.keyActive);
    } else if (slot === 'accent') {
      theme.accentColor = readAssetColor(
        assetRef,
        'accentColor',
        theme.accentColor,
      );
    }
  }
  return theme;
};

/* Emit ONLY the CSS variables that differ from default. For graded faces we
   derive the readable text colour from the single equipped base colour. */
export const wordGridThemeToCssVars = (
  theme: WordGridCosmeticTheme,
): CSSProperties => {
  const vars: Record<string, string> = {};
  const d = DEFAULT_WORD_GRID_THEME;

  if (theme.skin) {
    // A skin sets every result and every key, and their letters read 4.5:1.
    vars['--wg-correct'] = theme.correctColor;
    vars['--wg-correct-on'] = readableOn(theme.correctColor, INK, PAPER);
    vars['--wg-present'] = theme.presentColor;
    vars['--wg-present-on'] = readableOn(theme.presentColor, INK, PAPER);
    vars['--wg-absent'] = theme.absentColor;
    vars['--wg-absent-on'] = readableOn(theme.absentColor, INK, PAPER);
    vars['--wg-tile-border'] = theme.tileBorder;
    vars['--wg-tile-text'] = theme.tileText;
    vars['--wg-key-bg'] = theme.keyBg;
    vars['--wg-key-text'] = theme.keyText;
    vars['--wg-key-active'] = theme.keyActive;
    vars['--wg-accent'] = theme.accentColor;
    return { ...vars, ...skinVars(theme.skin) } as CSSProperties;
  }

  if (theme.correctColor !== d.correctColor) {
    vars['--wg-correct'] = theme.correctColor;
    vars['--wg-correct-on'] = contrastOn(theme.correctColor);
  }
  if (theme.presentColor !== d.presentColor) {
    vars['--wg-present'] = theme.presentColor;
    vars['--wg-present-on'] = contrastOn(theme.presentColor);
  }
  if (theme.absentColor !== d.absentColor) {
    vars['--wg-absent'] = theme.absentColor;
    vars['--wg-absent-on'] = contrastOn(theme.absentColor);
  }
  if (theme.tileBorder !== d.tileBorder) vars['--wg-tile-border'] = theme.tileBorder;
  if (theme.tileText !== d.tileText) vars['--wg-tile-text'] = theme.tileText;

  if (theme.keyBg !== d.keyBg) vars['--wg-key-bg'] = theme.keyBg;
  if (theme.keyText !== d.keyText) vars['--wg-key-text'] = theme.keyText;
  if (theme.keyActive !== d.keyActive) vars['--wg-key-active'] = theme.keyActive;

  if (theme.accentColor !== d.accentColor) vars['--wg-accent'] = theme.accentColor;

  return vars as CSSProperties;
};
