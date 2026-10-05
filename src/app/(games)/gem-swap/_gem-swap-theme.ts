// ──────────────────────────────────────────────────────────────────────────
// Gem Swap cosmetic theme. The game is 2D-canvas rendered, so the theme is a
// flat bag of hex-string colours folded over a faithful default palette.
// DEFAULT_GEM_THEME matches the hardcoded canvas palette in _gem-swap-client.tsx
// exactly, so the idle look is unchanged until an equipped skin overlays on top.
//
// Slots (defined in the shared registry — not edited here):
//   gems       → the NUM_COLORS gem colours (color0..color5)
//   board      → the board panel + grid line colours (boardColor, gridColor, ...)
//   background → the stage backdrop behind the board (bgColor)
// ──────────────────────────────────────────────────────────────────────────

import { NUM_COLORS } from '@/server/arcade/gem-swap-replay';

export type GemCosmeticTheme = {
  // ── gems slot ── one colour per gem id (length === NUM_COLORS) ──
  gemColors: string[];
  // ── board slot ──
  boardColor: string; // the board panel behind the gems
  gridColor: string; // the cell grid lines
  cellColor: string; // the recessed cell wells
  selectColor: string; // the selection / swap highlight
  // ── background slot ──
  bgColor: string; // stage backdrop behind the board
};

// The default jewel palette. The client renders entirely from this theme (it is
// the single source of truth for gem colours), so the canvas look follows any
// change here in lockstep. Tones are lacquered warm-CARNIVAL enamels (not the
// old neon candy blue/pink) picked to read as DISTINCT jewels on the near-black
// Midway felt. Gems carry NO shape/symbol cue, so distinguishability rides
// entirely on hue AND value — the six are deliberately spread across the
// lightness range (gold lightest → cobalt darkest) so colour-blind players can
// still tell adjacent runs apart on value alone.
export const DEFAULT_GEM_THEME: GemCosmeticTheme = {
  gemColors: [
    '#d8383c', // 0 — ruby (warm lacquer red)
    '#3f6bc4', // 1 — cobalt (deep enamel blue, darkest — not candy sky)
    '#f2b23a', // 2 — topaz (carnival gold, lightest)
    '#48ab5f', // 3 — emerald (lacquer green)
    '#9b55c6', // 4 — amethyst (enamel grape)
    '#ee6d84', // 5 — coral (warm carnival rose)
  ],
  boardColor: '#241a0f',
  gridColor: '#4a3118',
  cellColor: '#17100a',
  selectColor: '#f3e6cb',
  bgColor: '#1b130b',
};

// Minimal shape of the /api/store/inventory?gameType=gem-swap payload.
export type GemInventoryResponse = {
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
export const buildGemTheme = (
  response: GemInventoryResponse,
): GemCosmeticTheme => {
  const theme: GemCosmeticTheme = {
    ...DEFAULT_GEM_THEME,
    gemColors: [...DEFAULT_GEM_THEME.gemColors],
  };
  for (const equipped of response.equipped ?? []) {
    const slot = equipped?.slot;
    const assetRef = equipped?.item?.assetRef ?? null;
    if (!slot || !assetRef) continue;

    if (slot === 'gems') {
      // Either an explicit palette array, or per-index colorN keys.
      const palette = assetRef.palette;
      if (Array.isArray(palette)) {
        for (let i = 0; i < NUM_COLORS; i += 1) {
          const c = palette[i];
          if (typeof c === 'string' && c.trim().length > 0) {
            theme.gemColors[i] = c.trim();
          }
        }
      }
      for (let i = 0; i < NUM_COLORS; i += 1) {
        theme.gemColors[i] = readColor(
          assetRef,
          `color${i}`,
          theme.gemColors[i]!,
        );
      }
    } else if (slot === 'board') {
      theme.boardColor = readColor(assetRef, 'boardColor', theme.boardColor);
      theme.gridColor = readColor(assetRef, 'gridColor', theme.gridColor);
      theme.cellColor = readColor(assetRef, 'cellColor', theme.cellColor);
      theme.selectColor = readColor(assetRef, 'selectColor', theme.selectColor);
    } else if (slot === 'background') {
      theme.bgColor = readColor(assetRef, 'bgColor', theme.bgColor);
    }
  }
  return theme;
};
