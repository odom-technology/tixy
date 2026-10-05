/* ──────────────────────────────────────────────────────────────────────
   PACKS — Midway rarity enamels (presentation only).

   Drop tables, RNG, the 5-card draw, holo flags and the collection ledger
   live untouched in `_packs-client.tsx` + the frozen `PACK_RARITY_STYLES`
   module. This file maps each PackRarity to an ENAMEL paint chip for the
   Midway look: flat saturated lacquer with a hard bevel, NO glow. Rarity
   climbs slate → blue → violet → magenta → amber → teal → red.

   Holo is rendered as an iridescent MATTE paint (a fixed multi-hue
   diagonal sheen baked into the face), never an animated glow.
   ────────────────────────────────────────────────────────────────────── */

import type { CSSProperties } from 'react';
import type { PackRarity } from '@/features/arcade/lib/loot-rarity';

export type PackEnamel = {
  /** Lighter enamel face (gradient top). */
  hi: string;
  /** Flat enamel face (gradient base). */
  base: string;
  /** Darker enamel (gradient bottom + recessed chip). */
  deep: string;
  /** Hard painted edge. */
  edge: string;
  /** Ink that reads on the enamel face. */
  on: string;
  /** Muted ink for secondary labels. */
  onMuted: string;
};

/* Enamel ladder — warm-lacquer-friendly paints that sit on wood without
   glowing. dud/common stay slate-cool; higher tiers climb the ladder. */
export const PACK_ENAMELS: Record<PackRarity, PackEnamel> = {
  dud: {
    hi: '#404a52', base: '#333c44', deep: '#1f262c',
    edge: '#161c21', on: '#c7d0d6', onMuted: '#8b97a0',
  },
  common: {
    hi: '#4a86c2', base: '#3a6fa8', deep: '#1f4a78',
    edge: '#163a5e', on: '#e8f1fb', onMuted: '#a9c8e6',
  },
  uncommon: {
    hi: '#8a64cc', base: '#714fb0', deep: '#492f86',
    edge: '#32205e', on: '#f1e9ff', onMuted: '#c6b1ec',
  },
  rare: {
    hi: '#cc4f8e', base: '#b03a74', deep: '#7e2050',
    edge: '#5a1539', on: '#ffe9f4', onMuted: '#ecaecb',
  },
  epic: {
    hi: '#cc7a3a', base: '#b25f24', deep: '#7e3f12',
    edge: '#5a2c0d', on: '#ffeede', onMuted: '#e8c39a',
  },
  legendary: {
    hi: '#e0a23a', base: '#c4841f', deep: '#8a5b15',
    edge: '#63420f', on: '#fff5dd', onMuted: '#ecd09a',
  },
  ultra: {
    hi: '#3aaeb8', base: '#2491a0', deep: '#155f6e',
    edge: '#0f4450', on: '#e3fbff', onMuted: '#a0dce6',
  },
  mythic: {
    hi: '#d34b4e', base: '#c03538', deep: '#7e2225',
    edge: '#5a181b', on: '#ffece8', onMuted: '#ecaaa6',
  },
};

/** CSS custom properties the scoped stylesheet reads off the enamel chip. */
export function packTierVars(rarity: PackRarity): CSSProperties {
  const c = PACK_ENAMELS[rarity];
  return {
    '--pk-tier-hi': c.hi,
    '--pk-tier': c.base,
    '--pk-tier-deep': c.deep,
    '--pk-tier-edge': c.edge,
    '--pk-tier-on': c.on,
    '--pk-tier-on-muted': c.onMuted,
  } as CSSProperties;
}
