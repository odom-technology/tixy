// ---------------------------------------------------------------------------
// Baccarat cosmetic theme — built from the user's equipped inventory items.
//
// The table is DOM (the cards are the shared PlayingCard primitives); the client
// feeds these values into scoped CSS custom properties. Defaults reference the
// Midway enamel tokens (var(--…)) where sensible so the felt tracks the cabinet
// sub-theme; equipped skins overlay concrete hex colours on top.
//
// Slots (registered in the shared reward-slot registry — rewards.ts):
//   felt   → the table felt backdrop + rail
//   zones  → the Player / Banker / Tie bet-zone enamels
//   accent → the winning-zone glow + house card-back deck ('fuchsia'|'emerald')
// ---------------------------------------------------------------------------

import type { PlayingCardBackTheme } from '@/features/arcade/components/ui/playing-card';

export type BaccaratCosmeticTheme = {
  // felt slot
  feltTop: string;
  feltBottom: string;
  rail: string;
  // zones slot — Player
  playerBg: string;
  playerHi: string;
  playerOn: string;
  // zones slot — Banker
  bankerBg: string;
  bankerHi: string;
  bankerOn: string;
  // zones slot — Tie
  tieBg: string;
  tieHi: string;
  tieOn: string;
  // accent slot
  accent: string;
  backTheme: PlayingCardBackTheme;
};

/**
 * Stock baccarat look — a classic green felt with blue/red/gold bet zones.
 * Bet-zone enamels reference Midway tokens so they track the cabinet sub-theme;
 * the felt uses concrete greens (baccarat's signature table colour).
 */
export const DEFAULT_BACCARAT_THEME: BaccaratCosmeticTheme = {
  feltTop: '#12513a',
  feltBottom: '#0a3325',
  rail: '#0a2419',
  playerBg: 'var(--enamel-info)',
  playerHi: 'var(--enamel-info-hi, var(--enamel-info))',
  playerOn: 'var(--enamel-info-on, #f0f8ff)',
  bankerBg: 'var(--enamel-primary)',
  bankerHi: 'var(--enamel-primary-hi, var(--enamel-primary))',
  bankerOn: 'var(--enamel-primary-on, #ffffff)',
  tieBg: 'var(--enamel-tickets)',
  tieHi: 'var(--enamel-tickets-hi, var(--enamel-tickets))',
  tieOn: 'var(--enamel-tickets-on, #2a1b06)',
  // the side that won wears this ring: red, the colour of a win
  accent: 'var(--tixy-red)',
  backTheme: 'emerald',
};

const str = (
  ref: Record<string, unknown> | null | undefined,
  key: string,
  fallback: string,
): string => {
  const v = ref?.[key];
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : fallback;
};

export type InventoryCosmeticResponse = {
  wallet?: { credits?: number };
  dailyGameCredits?: { earned?: number; cap?: number };
  equipped?: Array<{
    slot?: string;
    item?: { assetRef?: Record<string, unknown> | null } | null;
  }>;
};

export function buildBaccaratTheme(
  response: InventoryCosmeticResponse,
): BaccaratCosmeticTheme {
  const theme: BaccaratCosmeticTheme = { ...DEFAULT_BACCARAT_THEME };

  for (const equipped of response.equipped ?? []) {
    const slot = equipped?.slot;
    const ref = equipped?.item?.assetRef ?? null;
    if (!slot || !ref) continue;

    if (slot === 'felt') {
      theme.feltTop = str(ref, 'feltTop', str(ref, 'feltColor', theme.feltTop));
      theme.feltBottom = str(ref, 'feltBottom', theme.feltBottom);
      theme.rail = str(ref, 'rail', str(ref, 'railColor', theme.rail));
    } else if (slot === 'zones') {
      theme.playerBg = str(ref, 'playerColor', str(ref, 'playerBg', theme.playerBg));
      theme.playerHi = str(ref, 'playerHi', theme.playerBg);
      theme.playerOn = str(ref, 'playerOn', theme.playerOn);
      theme.bankerBg = str(ref, 'bankerColor', str(ref, 'bankerBg', theme.bankerBg));
      theme.bankerHi = str(ref, 'bankerHi', theme.bankerBg);
      theme.bankerOn = str(ref, 'bankerOn', theme.bankerOn);
      theme.tieBg = str(ref, 'tieColor', str(ref, 'tieBg', theme.tieBg));
      theme.tieHi = str(ref, 'tieHi', theme.tieBg);
      theme.tieOn = str(ref, 'tieOn', theme.tieOn);
    } else if (slot === 'accent') {
      theme.accent = str(ref, 'accent', str(ref, 'accentColor', theme.accent));
      const back = ref['backTheme'];
      if (back === 'fuchsia' || back === 'emerald') theme.backTheme = back;
    }
  }

  return theme;
}
