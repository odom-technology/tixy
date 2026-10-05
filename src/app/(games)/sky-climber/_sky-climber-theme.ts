// ──────────────────────────────────────────────────────────────────────────
// Sky Climber cosmetic theme. The game is 2D-canvas rendered, so the theme is a
// flat bag of hex-string BASE colours. The client derives every gradient,
// highlight, shadow and parallax tint procedurally from these (see the shade()/
// mix() helpers in _sky-climber-client.tsx), so a single base hex per slot is
// enough to repaint the whole look and equipped skins still just override hexes.
//
// Slots (defined in the shared registry — not edited here):
//   climber    → the jumper body + accent (climberBody, climberAccent)
//   platforms  → one colour per platform type (normal/moving/breakable/spring)
//   background → the sky gradient + horizon haze (skyTop, skyBottom, hazeColor)
// ──────────────────────────────────────────────────────────────────────────

import type { PlatformType } from '@/server/arcade/sky-climber-replay';

export type SkyCosmeticTheme = {
  // ── climber slot ──
  climberBody: string;
  climberAccent: string;
  // ── platforms slot ── one colour per platform type ──
  platformColors: Record<PlatformType, string>;
  platformEdge: string; // shared bottom-edge shade for every platform
  springColor: string; // the little spring coil drawn on spring platforms
  // ── background slot ──
  skyTop: string; // gradient colour at the top of the view
  skyBottom: string; // gradient colour at the bottom of the view
  hazeColor: string; // soft horizon band drawn behind the tower
};

// Default carnival palette: warm tin-toy jumper, enamel/wood planks, dusk sky.
export const DEFAULT_SKY_THEME: SkyCosmeticTheme = {
  climberBody: '#f4c542', // warm tin yellow
  climberAccent: '#231a12', // dark ink for outline/eyes
  platformColors: {
    normal: '#c98a3c', // varnished wood plank
    moving: '#3fc4c4', // teal enamel (the sheen reads on this)
    breakable: '#d9694f', // terracotta — looks cracked
    spring: '#4ade80', // springboard green
  },
  platformEdge: '#241608', // shared dark plank shadow
  springColor: '#d9f7c4', // the coil + striker plate
  skyTop: '#0b1022', // deep dusk at the top of the view
  skyBottom: '#37265a', // warmer carnival purple near the ground
  hazeColor: '#ff9e5e', // warm horizon glow (alpha applied procedurally)
};

// Minimal shape of the /api/store/inventory?gameType=sky-climber payload.
export type SkyInventoryResponse = {
  wallet?: { credits?: number };
  dailyGameCredits?: { earned?: number; cap?: number };
  equipped?: Array<{
    slot?: string;
    item?: {
      assetRef?: Record<string, unknown> | null;
    } | null;
  }>;
};

const readColor = (
  assetRef: Record<string, unknown> | null | undefined,
  key: string,
  fallback: string,
): string => {
  const value = assetRef?.[key];
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : fallback;
};

// Fold the equipped cosmetics over the default look. Equipped skins overlay the
// defaults (so an unequipped slot keeps the exact current palette).
export const buildSkyTheme = (
  response: SkyInventoryResponse,
): SkyCosmeticTheme => {
  const theme: SkyCosmeticTheme = {
    ...DEFAULT_SKY_THEME,
    platformColors: { ...DEFAULT_SKY_THEME.platformColors },
  };
  for (const equipped of response.equipped ?? []) {
    const slot = equipped?.slot;
    const assetRef = equipped?.item?.assetRef ?? null;
    if (!slot || !assetRef) continue;

    if (slot === 'climber') {
      theme.climberBody = readColor(assetRef, 'climberBody', theme.climberBody);
      theme.climberAccent = readColor(
        assetRef,
        'climberAccent',
        theme.climberAccent,
      );
    } else if (slot === 'platforms') {
      theme.platformColors.normal = readColor(
        assetRef,
        'normal',
        theme.platformColors.normal,
      );
      theme.platformColors.moving = readColor(
        assetRef,
        'moving',
        theme.platformColors.moving,
      );
      theme.platformColors.breakable = readColor(
        assetRef,
        'breakable',
        theme.platformColors.breakable,
      );
      theme.platformColors.spring = readColor(
        assetRef,
        'spring',
        theme.platformColors.spring,
      );
      theme.platformEdge = readColor(assetRef, 'platformEdge', theme.platformEdge);
      theme.springColor = readColor(assetRef, 'springColor', theme.springColor);
    } else if (slot === 'background') {
      theme.skyTop = readColor(assetRef, 'skyTop', theme.skyTop);
      theme.skyBottom = readColor(assetRef, 'skyBottom', theme.skyBottom);
      theme.hazeColor = readColor(assetRef, 'hazeColor', theme.hazeColor);
    }
  }
  return theme;
};
