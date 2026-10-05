import type { CSSProperties } from 'react';

/* ──────────────────────────────────────────────────────────────────────
   Pangram (spelling-bee honeycomb) cosmetic theme.

   Pangram is DOM/CSS-rendered. The base look lives in the route-scoped
   `_pangram-midway.css` file (imported by page.tsx), scoped to `.pangram-root`, painted from Midway tokens
   via `var(--token, #fallback)`. Equipped cosmetics overlay by setting
   pangram-specific `--pg-*` variables on the `.pangram-root` wrapper via
   inline style; each themed CSS usage falls back to the existing token
   expression, so an empty loadout emits NO variables and renders identical
   to today (still tracking the live Midway tokens).

   Slots:
     honeycomb  → hex cells: center cell, outer cells, cell text, press/drag
                  highlight.
     accent     → progress bar fill + caret/center-letter accent, and the
                  rank tier label color.
     background → the recessed panel wells (found-words + input line).
   ────────────────────────────────────────────────────────────────────── */

export type PangramCosmeticTheme = {
  // honeycomb slot
  centerCellColor: string;
  outerCellColor: string;
  cellText: string;
  cellPressColor: string;
  // accent slot
  accentColor: string;
  rankColor: string;
  // background slot
  bgTop: string;
  bgBottom: string;
};

/* Literals mirror the current hardcoded fallbacks in page.tsx EXACTLY. An
   empty loadout emits zero CSS-variable overrides (see pangramThemeToCssVars),
   so the default render is unchanged. */
export const DEFAULT_PANGRAM_THEME: PangramCosmeticTheme = {
  centerCellColor: '#f2a33c', // --enamel-tickets
  outerCellColor: '#f6eddc', // --key-face
  cellText: '#1b140d', // --key-face-on (outer cell letters)
  cellPressColor: '#f2a33c', // --enamel-tickets (active/drag highlight)
  accentColor: '#f2a33c', // --enamel-tickets (rank fill / caret)
  rankColor: '#f2a33c', // --enamel-tickets (rank tier label)
  bgTop: '#17110a', // panel well top
  bgBottom: '#0a0705', // panel well bottom
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
  key: string,
  fallback: string,
) => {
  const value = assetRef?.[key];
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : fallback;
};

const clampByte = (c: number) => Math.max(0, Math.min(255, Math.round(c)));
const to2 = (c: number) => clampByte(c).toString(16).padStart(2, '0');

const parseHex = (hex: string): [number, number, number] | null => {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
};

const lighten = (hex: string, amt: number): string => {
  const rgb = parseHex(hex);
  if (!rgb) return hex;
  const [r, g, b] = rgb;
  return `#${to2(r + (255 - r) * amt)}${to2(g + (255 - g) * amt)}${to2(b + (255 - b) * amt)}`;
};

const darken = (hex: string, amt: number): string => {
  const rgb = parseHex(hex);
  if (!rgb) return hex;
  const [r, g, b] = rgb;
  return `#${to2(r * (1 - amt))}${to2(g * (1 - amt))}${to2(b * (1 - amt))}`;
};

const contrastOn = (hex: string): string => {
  const rgb = parseHex(hex);
  if (!rgb) return '#2a1b06';
  const [r, g, b] = rgb;
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.6 ? '#2a1b06' : '#fdf7ea';
};

export const buildPangramTheme = (
  response: InventoryCosmeticResponse,
): PangramCosmeticTheme => {
  const theme: PangramCosmeticTheme = { ...DEFAULT_PANGRAM_THEME };
  for (const equipped of response.equipped ?? []) {
    const slot = equipped?.slot;
    const assetRef = equipped?.item?.assetRef ?? null;
    if (!slot || !assetRef) continue;
    if (slot === 'honeycomb') {
      theme.centerCellColor = readAssetColor(
        assetRef,
        'centerCellColor',
        theme.centerCellColor,
      );
      theme.outerCellColor = readAssetColor(
        assetRef,
        'outerCellColor',
        theme.outerCellColor,
      );
      theme.cellText = readAssetColor(assetRef, 'cellText', theme.cellText);
      theme.cellPressColor = readAssetColor(
        assetRef,
        'cellPressColor',
        theme.cellPressColor,
      );
    } else if (slot === 'accent') {
      theme.accentColor = readAssetColor(
        assetRef,
        'accentColor',
        theme.accentColor,
      );
      theme.rankColor = readAssetColor(assetRef, 'rankColor', theme.rankColor);
    } else if (slot === 'background') {
      theme.bgTop = readAssetColor(assetRef, 'bgTop', theme.bgTop);
      theme.bgBottom = readAssetColor(assetRef, 'bgBottom', theme.bgBottom);
    }
  }
  return theme;
};

/* Emit ONLY the CSS variables that differ from default. For gradient/enamel
   surfaces we derive the hi/edge/on companions from the single equipped base
   color so the bevel + readable text are preserved. */
export const pangramThemeToCssVars = (
  theme: PangramCosmeticTheme,
): CSSProperties => {
  const vars: Record<string, string> = {};
  const d = DEFAULT_PANGRAM_THEME;

  if (theme.centerCellColor !== d.centerCellColor) {
    vars['--pg-center-bg'] = theme.centerCellColor;
    vars['--pg-center-bg-hi'] = lighten(theme.centerCellColor, 0.18);
    vars['--pg-center-edge'] = darken(theme.centerCellColor, 0.4);
    vars['--pg-center-text'] = contrastOn(theme.centerCellColor);
  }
  if (theme.outerCellColor !== d.outerCellColor) {
    vars['--pg-outer-bg'] = theme.outerCellColor;
    vars['--pg-outer-bg-hi'] = lighten(theme.outerCellColor, 0.14);
  }
  if (theme.cellText !== d.cellText) vars['--pg-cell-text'] = theme.cellText;
  if (theme.cellPressColor !== d.cellPressColor) {
    vars['--pg-press'] = theme.cellPressColor;
    vars['--pg-press-hi'] = lighten(theme.cellPressColor, 0.18);
  }

  if (theme.accentColor !== d.accentColor) {
    vars['--pg-accent'] = theme.accentColor;
    vars['--pg-accent-hi'] = lighten(theme.accentColor, 0.18);
  }
  if (theme.rankColor !== d.rankColor) vars['--pg-rank-color'] = theme.rankColor;

  if (theme.bgTop !== d.bgTop) vars['--pg-bg-top'] = theme.bgTop;
  if (theme.bgBottom !== d.bgBottom) vars['--pg-bg-bottom'] = theme.bgBottom;

  return vars as CSSProperties;
};
