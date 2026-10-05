/* ──────────────────────────────────────────────────────────────────────────
   SEQUENCE MEMORY cosmetic theme — equipped-skin pipeline (mirrors the Snake
   pattern in src/app/(games)/snake/_snake-theme.ts).

   This game is CSS-driven: the panel paints from _sequence-midway.css. The
   theme below is emitted as CSS custom properties on the .sequence-midway root
   (see toSequenceCssVars), so equipped skins recolor the pads + bezel without
   touching the deterministic sim.

   Slots:
     pads       → the four enamel pad colors (pad1..pad4) + an optional active
                  glow (OFF by default — nothing glows in the stock look).
     background → the cream bezel gradient (bgTop/bgBottom) + accent (the
                  "watch" hub readout color).

   DEFAULT_SEQUENCE_THEME reproduces the previous hardcoded look EXACTLY.
   ────────────────────────────────────────────────────────────────────────── */

import type { CSSProperties } from 'react';

export type PadColors = {
  hi: string;
  base: string;
  edge: string;
};

export type SequenceCosmeticTheme = {
  // pads slot
  pads: [PadColors, PadColors, PadColors, PadColors];
  padGlowEnabled: boolean;
  padGlowColor: string;
  padGlowSize: number; // px; 0 = none
  // background slot
  bezelTop: string;
  bezelBottom: string;
  accent: string; // the "watch" hub numeral color
};

export const DEFAULT_SEQUENCE_THEME: SequenceCosmeticTheme = {
  pads: [
    // red
    { hi: '#d34b4e', base: '#c73538', edge: '#7e2225' },
    // amber
    { hi: '#f7bd5e', base: '#f2a33c', edge: '#9a621a' },
    // teal
    { hi: '#46cdbb', base: '#2fb8a6', edge: '#1b7466' },
    // blue
    { hi: '#88a6ee', base: '#6c8fe0', edge: '#3d5694' },
  ],
  padGlowEnabled: false,
  padGlowColor: '#f2a33c',
  padGlowSize: 0,
  bezelTop: '#f6eddc',
  bezelBottom: '#e4d6bb',
  accent: '#f2a33c',
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

/* Lighten (amount > 0) or darken (amount < 0) a #rrggbb color by a fraction.
   Used to synthesize a glossy hi/edge pair when a skin supplies only a base. */
const shade = (hex: string, amount: number): string => {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return hex;
  const int = parseInt(m[1]!, 16);
  let r = (int >> 16) & 0xff;
  let g = (int >> 8) & 0xff;
  let b = int & 0xff;
  const t = amount < 0 ? 0 : 255;
  const p = Math.abs(amount);
  r = Math.round((t - r) * p) + r;
  g = Math.round((t - g) * p) + g;
  b = Math.round((t - b) * p) + b;
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
};

// Resolve a single pad's hi/base/edge from an assetRef, given a default chip.
// Accepts an explicit { hi, base, edge } trio or just a base color (the gloss
// pair is then synthesized so any flat color reads as a painted enamel key).
const readPad = (
  raw: unknown,
  fallback: PadColors,
): PadColors => {
  if (typeof raw === 'string' && raw.trim().length > 0) {
    const base = raw.trim();
    return { hi: shade(base, 0.18), base, edge: shade(base, -0.42) };
  }
  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    const base = readAssetColor(obj, 'base', fallback.base);
    const hasExplicit = typeof obj.hi === 'string' || typeof obj.edge === 'string';
    return {
      base,
      hi: readAssetColor(obj, 'hi', hasExplicit ? base : shade(base, 0.18)),
      edge: readAssetColor(obj, 'edge', hasExplicit ? base : shade(base, -0.42)),
    };
  }
  return fallback;
};

export const buildSequenceTheme = (
  response: InventoryCosmeticResponse,
): SequenceCosmeticTheme => {
  // Clone defaults (deep enough for the pad trios).
  const theme: SequenceCosmeticTheme = {
    ...DEFAULT_SEQUENCE_THEME,
    pads: DEFAULT_SEQUENCE_THEME.pads.map((p) => ({ ...p })) as [
      PadColors,
      PadColors,
      PadColors,
      PadColors,
    ],
  };

  for (const equipped of response.equipped ?? []) {
    const slot = equipped?.slot;
    const assetRef = equipped?.item?.assetRef ?? null;
    if (!slot || !assetRef) continue;

    if (slot === 'pads') {
      // padColors: [..] array, or pad1..pad4 individual keys.
      const arr = Array.isArray(assetRef.padColors)
        ? (assetRef.padColors as unknown[])
        : null;
      for (let i = 0; i < 4; i += 1) {
        const fromArr = arr?.[i];
        const fromKey = assetRef[`pad${i + 1}`];
        const raw = fromArr ?? fromKey;
        if (raw !== undefined) {
          theme.pads[i] = readPad(raw, theme.pads[i]!);
        }
      }
      if (typeof assetRef.padGlowEnabled === 'boolean') {
        theme.padGlowEnabled = assetRef.padGlowEnabled;
      }
      theme.padGlowColor = readAssetColor(
        assetRef,
        'padActiveColor',
        readAssetColor(assetRef, 'padGlowColor', theme.padGlowColor),
      );
      theme.padGlowSize = readAssetNumber(
        assetRef,
        'padGlowSize',
        theme.padGlowEnabled ? Math.max(14, theme.padGlowSize) : theme.padGlowSize,
        0,
        48,
      );
    } else if (slot === 'background') {
      theme.bezelTop = readAssetColor(
        assetRef,
        'bgTop',
        readAssetColor(assetRef, 'bezelTop', theme.bezelTop),
      );
      theme.bezelBottom = readAssetColor(
        assetRef,
        'bgBottom',
        readAssetColor(assetRef, 'bezelBottom', theme.bezelBottom),
      );
      theme.accent = readAssetColor(assetRef, 'accent', theme.accent);
    }
  }

  return theme;
};

/* Flatten the theme into the CSS custom properties consumed by
   _sequence-midway.css. Applied as an inline style on the .sequence-midway
   root. Always emitted (defaults equal the stock literals), so the look is
   unchanged until a skin overrides a value. */
export const toSequenceCssVars = (
  theme: SequenceCosmeticTheme,
): CSSProperties => {
  const names = ['red', 'amber', 'teal', 'blue'] as const;
  const vars: Record<string, string> = {
    '--seq-bezel-top': theme.bezelTop,
    '--seq-bezel-bottom': theme.bezelBottom,
    '--seq-accent': theme.accent,
    '--seq-glow-color': theme.padGlowEnabled
      ? theme.padGlowColor
      : 'transparent',
    '--seq-glow-size': `${theme.padGlowEnabled ? theme.padGlowSize : 0}px`,
  };
  names.forEach((name, i) => {
    const pad = theme.pads[i]!;
    vars[`--seq-pad-${name}-hi`] = pad.hi;
    vars[`--seq-pad-${name}-base`] = pad.base;
    vars[`--seq-pad-${name}-edge`] = pad.edge;
  });
  return vars as CSSProperties;
};
