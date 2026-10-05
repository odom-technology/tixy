/* ──────────────────────────────────────────────────────────────────────
   CASES — Midway rarity enamels (presentation only).

   The underlying rarity/drop tables and RNG live untouched in
   `_cases-client.tsx` + the shared `CASE_RARITY_COLORS` module (frozen).
   This file maps each CaseRarity to an ENAMEL paint chip for the Midway
   look: flat saturated lacquer with a hard bevel, NO glow. Rarity climbs
   slate → teal → violet → amber → red, the Midway enamel ladder.

   Two consumers:
   1. The reel <canvas> (needs plain color strings each frame).
   2. The DOM result plate + reward tiles (consume the same chip as
      CSS custom properties via `caseTierVars`).
   ────────────────────────────────────────────────────────────────────── */

import type { CSSProperties } from 'react';
import type { CaseRarity } from '@/features/arcade/lib/loot-rarity';

export type EnamelChip = {
  /** Flat enamel face (gradient bottom). */
  base: string;
  /** Lighter enamel face (gradient top). */
  hi: string;
  /** Darker enamel — recessed chip fill behind the multiplier. */
  deep: string;
  /** Hard painted edge. */
  edge: string;
  /** Ink that reads on the enamel face. */
  on: string;
  /** Dashed-perforation tint on the enamel. */
  perf: string;
};

/* Enamel ladder. Values are warm-lacquer-friendly paints (mirror the
   Midway --enamel-* family tone-for-tone) so they sit on the wood without
   glowing. Bust/common stay slate; higher tiers climb the enamel ladder. */
export const CASE_ENAMELS: Record<CaseRarity, EnamelChip> = {
  loss: {
    base: '#3a444c', hi: '#4c5862', deep: '#222a30',
    edge: '#1a2228', on: '#dfe6ea', perf: '#ffffff30',
  },
  common: {
    base: '#46525c', hi: '#5a6772', deep: '#2a333a',
    edge: '#202a31', on: '#e7eef2', perf: '#ffffff33',
  },
  uncommon: {
    base: '#2fb8a6', hi: '#46cdbb', deep: '#1b7466',
    edge: '#145a51', on: '#04231e', perf: '#ffffff45',
  },
  rare: {
    base: '#3a86c4', hi: '#5aa0db', deep: '#1f547e',
    edge: '#163e5e', on: '#04161f', perf: '#ffffff45',
  },
  mythic: {
    base: '#8a52c4', hi: '#a268d6', deep: '#5a2e94',
    edge: '#3a1d66', on: '#f3e9ff', perf: '#ffffff45',
  },
  legendary: {
    base: '#e0a23a', hi: '#f4c057', deep: '#9a621a',
    edge: '#7a4e16', on: '#2a1b06', perf: '#00000040',
  },
  covert: {
    base: '#c73538', hi: '#d34b4e', deep: '#7e2225',
    edge: '#5a181b', on: '#ffefe4', perf: '#ffffff40',
  },
};

/** CSS custom properties the scoped stylesheet reads off the enamel chip. */
export function caseTierVars(rarity: CaseRarity): CSSProperties {
  const c = CASE_ENAMELS[rarity];
  return {
    '--cases-tier': c.base,
    '--cases-tier-hi': c.hi,
    '--cases-tier-deep': c.deep,
    '--cases-tier-edge': c.edge,
    '--cases-tier-on': c.on,
    '--cases-tier-perf': c.perf,
  } as CSSProperties;
}

/* ── Reel canvas palette ─────────────────────────────────────────────── */

export type ReelPalette = {
  wellTop: string;
  wellBottom: string;
  shelf: string;
  fade: string;
  ticker: string;
  cellTrack: string;
};

/* Default boardwalk wood tones; overridden at runtime by `readReelPalette`
   so the canvas tracks whichever of the four sub-themes is active. */
export const DEFAULT_REEL_PALETTE: ReelPalette = {
  wellTop: '#15110d',
  wellBottom: '#0c0907',
  shelf: '#1a130b',
  fade: '#0c0907',
  ticker: '#f2a33c',
  cellTrack: '#ffffff10',
};

/** Read the live Midway tokens so the canvas tracks the active sub-theme.
   Falls back to the boardwalk defaults if a token is missing. */
export function readReelPalette(el: Element | null): ReelPalette {
  if (typeof window === 'undefined' || !el) return DEFAULT_REEL_PALETTE;
  const s = getComputedStyle(el);
  const v = (name: string, fallback: string) =>
    s.getPropertyValue(name).trim() || fallback;
  return {
    wellTop: v('--screen-well', DEFAULT_REEL_PALETTE.wellTop),
    wellBottom: v('--bg', DEFAULT_REEL_PALETTE.wellBottom),
    shelf: v('--surface-well', DEFAULT_REEL_PALETTE.shelf),
    fade: v('--bg', DEFAULT_REEL_PALETTE.fade),
    ticker: v('--enamel-tickets', DEFAULT_REEL_PALETTE.ticker),
    cellTrack: DEFAULT_REEL_PALETTE.cellTrack,
  };
}

/** Parse a #rrggbb (or #rgb) hex into [r,g,b]. Tolerates rgb() passthrough. */
export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.trim();
  if (h.startsWith('rgb')) {
    const m = h.match(/\d+/g);
    if (m && m.length >= 3) return [Number(m[0]), Number(m[1]), Number(m[2])];
    return [128, 128, 128];
  }
  let c = h.replace('#', '');
  if (c.length === 3) c = c.split('').map((x) => x + x).join('');
  return [
    parseInt(c.slice(0, 2), 16) || 0,
    parseInt(c.slice(2, 4), 16) || 0,
    parseInt(c.slice(4, 6), 16) || 0,
  ];
}
