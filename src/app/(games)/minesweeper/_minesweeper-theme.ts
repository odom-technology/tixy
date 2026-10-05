/* ──────────────────────────────────────────────────────────────────────
   MINESWEEPER cosmetic theme. Mirrors the Sudoku pattern exactly: a DEFAULT
   theme that matches the hardcoded Midway look, read helpers, and
   buildMinesweeperTheme(response) that overlays equipped skins by slot.

   The DOM/CSS layer (_minesweeper-midway.css) reads each themeable value
   through a CSS custom property whose fallback is the *current literal*, e.g.
     background: var(--ms-cover-bg, linear-gradient(180deg,#cfd6e2,#aab4c6));
   minesweeperThemeCssVars() only emits a variable when the built theme differs
   from DEFAULT, so an empty loadout emits nothing and renders identically.

   Slots:
     board    → field / cover colors (coverBg, revealedBg, gridLineColor,
                boxBorderColor)
     numbers  → revealed digit color + mine/flag colors + font family
     accent   → hover / pressed accent + optional revealHighlight (OFF default)
   ────────────────────────────────────────────────────────────────────── */

export type MinesweeperFontFamily = 'mono' | 'sans' | 'serif';

export type MinesweeperCosmeticTheme = {
  // board slot
  coverBg: string;
  revealedBg: string;
  gridLineColor: string;
  boxBorderColor: string;
  // numbers slot
  revealedDigitColor: string;
  mineColor: string;
  flagColor: string;
  fontFamily: MinesweeperFontFamily;
  // accent slot
  accentColor: string;
  hoverHighlight: string;
  // optional effect (OFF by default)
  revealGlow: boolean;
};

/* Current Midway look — kept in lockstep with the literals in
   _minesweeper-midway.css so an empty loadout is byte-identical. */
export const DEFAULT_MINESWEEPER_THEME: MinesweeperCosmeticTheme = {
  coverBg: '#e9d7ac',
  revealedBg: '#ede1c6',
  gridLineColor: '#1c160d',
  boxBorderColor: '#0f0a06',
  revealedDigitColor: '#2a2114',
  mineColor: '#3a2a1a',
  flagColor: '#c73538',
  fontFamily: 'mono',
  accentColor: '#b46b16',
  hoverHighlight: '#f2e6cc',
  revealGlow: false,
};

/* Inventory shape returned by /api/store/inventory (same contract Sudoku uses). */
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

const FONT_FAMILIES: readonly MinesweeperFontFamily[] = ['mono', 'sans', 'serif'];

export const buildMinesweeperTheme = (
  response: InventoryCosmeticResponse,
): MinesweeperCosmeticTheme => {
  const theme: MinesweeperCosmeticTheme = { ...DEFAULT_MINESWEEPER_THEME };
  for (const equipped of response.equipped ?? []) {
    const slot = equipped?.slot;
    const assetRef = equipped?.item?.assetRef ?? null;
    if (!slot || !assetRef) continue;

    if (slot === 'board') {
      theme.coverBg = readAssetColor(assetRef, 'coverBg', theme.coverBg);
      theme.revealedBg = readAssetColor(assetRef, 'revealedBg', theme.revealedBg);
      theme.gridLineColor = readAssetColor(
        assetRef,
        'gridLineColor',
        theme.gridLineColor,
      );
      theme.boxBorderColor = readAssetColor(
        assetRef,
        'boxBorderColor',
        theme.boxBorderColor,
      );
    } else if (slot === 'numbers') {
      theme.revealedDigitColor = readAssetColor(
        assetRef,
        'revealedDigitColor',
        theme.revealedDigitColor,
      );
      theme.mineColor = readAssetColor(assetRef, 'mineColor', theme.mineColor);
      theme.flagColor = readAssetColor(assetRef, 'flagColor', theme.flagColor);
      const font = assetRef.fontFamily;
      if (
        typeof font === 'string' &&
        (FONT_FAMILIES as readonly string[]).includes(font)
      ) {
        theme.fontFamily = font as MinesweeperFontFamily;
      }
    } else if (slot === 'accent') {
      theme.accentColor = readAssetColor(
        assetRef,
        'accentColor',
        theme.accentColor,
      );
      theme.hoverHighlight = readAssetColor(
        assetRef,
        'hoverHighlight',
        theme.hoverHighlight,
      );
      if (typeof assetRef.revealGlow === 'boolean') {
        theme.revealGlow = assetRef.revealGlow;
      }
    }
  }
  return theme;
};

const FONT_STACKS: Record<MinesweeperFontFamily, string> = {
  mono: 'var(--font-mono-arcade, ui-monospace, monospace)',
  sans: 'ui-sans-serif, system-ui, sans-serif',
  serif: 'ui-serif, Georgia, "Times New Roman", serif',
};

/* Build a beveled top→bottom gradient from a single base color so skinned
   cells keep the lacquered keycap feel of the default look. */
const toCellGradient = (base: string) =>
  `linear-gradient(180deg, ${base} 0%, color-mix(in srgb, ${base} 85%, #000) 100%)`;

/* Emit ONLY the CSS vars that differ from DEFAULT, so an empty loadout (and any
   slot left at its default) renders exactly as the hardcoded CSS. */
export const minesweeperThemeCssVars = (
  theme: MinesweeperCosmeticTheme,
): React.CSSProperties => {
  const vars: Record<string, string> = {};
  if (theme.coverBg !== DEFAULT_MINESWEEPER_THEME.coverBg) {
    vars['--ms-cover-bg'] = toCellGradient(theme.coverBg);
  }
  if (theme.revealedBg !== DEFAULT_MINESWEEPER_THEME.revealedBg) {
    vars['--ms-revealed-bg'] = theme.revealedBg;
  }
  if (theme.gridLineColor !== DEFAULT_MINESWEEPER_THEME.gridLineColor) {
    vars['--ms-board-bg'] = theme.gridLineColor;
  }
  if (theme.boxBorderColor !== DEFAULT_MINESWEEPER_THEME.boxBorderColor) {
    vars['--ms-box-border'] = theme.boxBorderColor;
  }
  if (theme.revealedDigitColor !== DEFAULT_MINESWEEPER_THEME.revealedDigitColor) {
    vars['--ms-revealed-digit'] = theme.revealedDigitColor;
  }
  if (theme.mineColor !== DEFAULT_MINESWEEPER_THEME.mineColor) {
    vars['--ms-mine'] = theme.mineColor;
  }
  if (theme.flagColor !== DEFAULT_MINESWEEPER_THEME.flagColor) {
    vars['--ms-flag'] = theme.flagColor;
  }
  if (theme.fontFamily !== DEFAULT_MINESWEEPER_THEME.fontFamily) {
    vars['--ms-font'] = FONT_STACKS[theme.fontFamily];
  }
  if (theme.accentColor !== DEFAULT_MINESWEEPER_THEME.accentColor) {
    vars['--ms-accent'] = theme.accentColor;
  }
  if (theme.hoverHighlight !== DEFAULT_MINESWEEPER_THEME.hoverHighlight) {
    vars['--ms-hover-highlight'] = toCellGradient(theme.hoverHighlight);
  }
  // Optional effect: a soft glow on freshly revealed cells. OFF by default
  // (transparent renders nothing). When on, it tracks the active accent.
  if (theme.revealGlow) {
    vars['--ms-reveal-glow'] = theme.accentColor;
  }
  return vars as React.CSSProperties;
};
