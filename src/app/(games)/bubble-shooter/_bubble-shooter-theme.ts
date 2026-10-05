// ──────────────────────────────────────────────────────────────────────────
// Gumball Drop cosmetic theme. The game is 2D-canvas rendered, so the theme is a
// flat bag of hex-string colours folded over a faithful default palette.
// DEFAULT_GUMBALL_THEME matches the hardcoded canvas palette in
// _bubble-shooter-client.tsx exactly, so the idle look is unchanged until an
// equipped skin overlays on top.
//
// The slug stays 'bubble-shooter', so the SHARED cosmetic registry still exposes
// the legacy slots 'bubbles' / 'launcher' / 'background'. We keep reading those
// exact slots (so any equipped bubble-shooter skin still applies) but reinterpret
// them for the merge game:
//   bubbles    → the gumball tier colours (palette / color0..colorN override the
//                 first tiers; higher tiers keep their default candy gradient)
//   launcher   → the dropper / spout at the top of the jar
//   background → the stage backdrop + jar body + rim + fill-line
// ──────────────────────────────────────────────────────────────────────────

import { TIER_COUNT } from '@/server/arcade/bubble-shooter-replay';

export type GumballCosmeticTheme = {
  // ── bubbles slot ── one colour per gumball tier (length === TIER_COUNT) ──
  tierColors: string[];
  // ── launcher slot ── the dropper that holds the current gumball ──
  dropperBody: string;
  dropperAccent: string;
  // ── background slot ──
  bgColor: string; // stage backdrop behind the jar
  jarColor: string; // the jar interior fill
  rimColor: string; // jar walls / rim / frame
  glassColor: string; // glass highlight sheen on the jar
  guideColor: string; // the faint drop-guide line
  fillLineColor: string; // the overflow / danger line near the top
};

// Matches the canvas literals in _bubble-shooter-client.tsx byte-for-byte.
// A dark Midway carnival palette: near-black bg, warm cream + gold jar, candy
// gumball gradients, enamel-red danger line.
export const DEFAULT_GUMBALL_THEME: GumballCosmeticTheme = {
  tierColors: [
    '#e2504c', // 0 — cherry red
    '#ef8b3c', // 1 — orange
    '#f2c33c', // 2 — gold
    '#7bc043', // 3 — lime
    '#3fb9a0', // 4 — teal
    '#3aa0d6', // 5 — blue
    '#7a6fd6', // 6 — grape
    '#c266c9', // 7 — violet
    '#e86fa0', // 8 — bubblegum pink
    '#cf3b34', // 9 — watermelon (drawn with a green rind)
  ],
  dropperBody: '#caa86a',
  dropperAccent: '#f3e6cb',
  bgColor: '#160f08',
  jarColor: '#241a0f',
  rimColor: '#caa86a',
  glassColor: '#f3e6cb',
  guideColor: '#f3e6cb',
  fillLineColor: '#c4413f',
};

// Minimal shape of the /api/store/inventory?gameType=bubble-shooter payload.
export type GumballInventoryResponse = {
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
export const buildGumballTheme = (
  response: GumballInventoryResponse,
): GumballCosmeticTheme => {
  const theme: GumballCosmeticTheme = {
    ...DEFAULT_GUMBALL_THEME,
    tierColors: [...DEFAULT_GUMBALL_THEME.tierColors],
  };
  for (const equipped of response.equipped ?? []) {
    const slot = equipped?.slot;
    const assetRef = equipped?.item?.assetRef ?? null;
    if (!slot || !assetRef) continue;

    if (slot === 'bubbles') {
      // Either an explicit palette array, or per-index colorN keys. Only the
      // tiers a skin specifies are overridden; the rest keep their candy default.
      const palette = assetRef.palette;
      if (Array.isArray(palette)) {
        for (let i = 0; i < TIER_COUNT; i += 1) {
          const c = palette[i];
          if (typeof c === 'string' && c.trim().length > 0) {
            theme.tierColors[i] = c.trim();
          }
        }
      }
      for (let i = 0; i < TIER_COUNT; i += 1) {
        theme.tierColors[i] = readColor(
          assetRef,
          `color${i}`,
          theme.tierColors[i]!,
        );
      }
    } else if (slot === 'launcher') {
      theme.dropperBody = readColor(assetRef, 'launcherBody', theme.dropperBody);
      theme.dropperAccent = readColor(
        assetRef,
        'launcherAccent',
        theme.dropperAccent,
      );
    } else if (slot === 'background') {
      theme.bgColor = readColor(assetRef, 'bgColor', theme.bgColor);
      theme.jarColor = readColor(assetRef, 'fieldColor', theme.jarColor);
      theme.rimColor = readColor(assetRef, 'wallColor', theme.rimColor);
      theme.guideColor = readColor(assetRef, 'aimColor', theme.guideColor);
      theme.fillLineColor = readColor(
        assetRef,
        'deathLineColor',
        theme.fillLineColor,
      );
    }
  }
  return theme;
};
