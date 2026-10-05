/* ──────────────────────────────────────────────────────────────────────
   FREECELL SPRINT cosmetic theme. Mirrors the sudoku pattern: a DEFAULT theme
   matching the current Midway look EXACTLY, read helpers, and
   buildFreecellTheme(response) overlaying equipped skins by slot.

   The card FACES themselves are physical red/black ink (the shared
   PlayingCardFace primitive), constant across cabinet themes. Cosmetics recolor
   only the TABLE around the cards:

   Slots:
     felt    → table felt gradient + rails (feltTop, feltBottom, railColor)
     cards   → empty-slot frames + foundation / free-cell tint + the card-back
               medallion shown in the win cascade (slotFrame, foundationTint,
               freeCellTint, backTheme)
     cascade → the auto-complete win burst (burstColor + optional winGlow)

   freecellThemeCssVars() emits a variable ONLY when the built theme differs from
   DEFAULT, so an empty loadout emits nothing and renders byte-identically.
   ────────────────────────────────────────────────────────────────────── */

import type { PlayingCardBackTheme } from '@/features/arcade/components/ui/playing-card';

export type FreecellCosmeticTheme = {
  // felt slot
  feltTop: string;
  feltBottom: string;
  railColor: string;
  // cards slot
  slotFrame: string;
  foundationTint: string;
  freeCellTint: string;
  backTheme: PlayingCardBackTheme;
  // cascade slot
  burstColor: string;
  winGlow: boolean;
};

/* Current Midway look — warm carnival enamel: deep teal-green felt in a
   lacquered espresso rail, with amber accents. Kept in lockstep with the
   client's CSS-var fallbacks so an empty loadout is unchanged. */
export const DEFAULT_FREECELL_THEME: FreecellCosmeticTheme = {
  feltTop: '#14322b',
  feltBottom: '#0c211d',
  railColor: '#2c2013',
  slotFrame: '#3c2c1a',
  foundationTint: '#1d8579',
  freeCellTint: '#7a5532',
  backTheme: 'emerald',
  burstColor: '#f2a33c',
  winGlow: false,
};

export type InventoryCosmeticResponse = {
  wallet?: { credits?: number };
  dailyGameCredits?: { earned?: number; cap?: number };
  equipped?: Array<{
    slot?: string;
    item?: { assetRef?: Record<string, unknown> | null } | null;
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

const BACK_THEMES: readonly PlayingCardBackTheme[] = ['fuchsia', 'emerald'];

export const buildFreecellTheme = (
  response: InventoryCosmeticResponse,
): FreecellCosmeticTheme => {
  const theme: FreecellCosmeticTheme = { ...DEFAULT_FREECELL_THEME };
  for (const equipped of response.equipped ?? []) {
    const slot = equipped?.slot;
    const assetRef = equipped?.item?.assetRef ?? null;
    if (!slot || !assetRef) continue;

    if (slot === 'felt') {
      theme.feltTop = readAssetColor(assetRef, 'feltTop', theme.feltTop);
      theme.feltBottom = readAssetColor(assetRef, 'feltBottom', theme.feltBottom);
      theme.railColor = readAssetColor(assetRef, 'railColor', theme.railColor);
    } else if (slot === 'cards') {
      theme.slotFrame = readAssetColor(assetRef, 'slotFrame', theme.slotFrame);
      theme.foundationTint = readAssetColor(
        assetRef,
        'foundationTint',
        theme.foundationTint,
      );
      theme.freeCellTint = readAssetColor(
        assetRef,
        'freeCellTint',
        theme.freeCellTint,
      );
      const back = assetRef.backTheme;
      if (typeof back === 'string' && (BACK_THEMES as readonly string[]).includes(back)) {
        theme.backTheme = back as PlayingCardBackTheme;
      }
    } else if (slot === 'cascade') {
      theme.burstColor = readAssetColor(assetRef, 'burstColor', theme.burstColor);
      if (typeof assetRef.winGlow === 'boolean') {
        theme.winGlow = assetRef.winGlow;
      }
    }
  }
  return theme;
};

/* Emit ONLY the CSS vars that differ from DEFAULT, so an empty loadout renders
   exactly as the hardcoded CSS fallbacks in the client. */
export const freecellThemeCssVars = (
  theme: FreecellCosmeticTheme,
): React.CSSProperties => {
  const vars: Record<string, string> = {};
  if (theme.feltTop !== DEFAULT_FREECELL_THEME.feltTop) {
    vars['--fc-felt-top'] = theme.feltTop;
  }
  if (theme.feltBottom !== DEFAULT_FREECELL_THEME.feltBottom) {
    vars['--fc-felt-bottom'] = theme.feltBottom;
  }
  if (theme.railColor !== DEFAULT_FREECELL_THEME.railColor) {
    vars['--fc-rail'] = theme.railColor;
  }
  if (theme.slotFrame !== DEFAULT_FREECELL_THEME.slotFrame) {
    vars['--fc-slot-frame'] = theme.slotFrame;
  }
  if (theme.foundationTint !== DEFAULT_FREECELL_THEME.foundationTint) {
    vars['--fc-foundation-tint'] = theme.foundationTint;
  }
  if (theme.freeCellTint !== DEFAULT_FREECELL_THEME.freeCellTint) {
    vars['--fc-freecell-tint'] = theme.freeCellTint;
  }
  if (theme.burstColor !== DEFAULT_FREECELL_THEME.burstColor) {
    vars['--fc-burst'] = theme.burstColor;
  }
  if (theme.winGlow) {
    vars['--fc-win-glow'] = theme.burstColor;
  }
  return vars as React.CSSProperties;
};
