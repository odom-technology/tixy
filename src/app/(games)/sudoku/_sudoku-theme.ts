/* ──────────────────────────────────────────────────────────────────────
   SUDOKU cosmetic theme. Mirrors the canonical snake pattern: a DEFAULT
   theme that matches the current hardcoded Midway look EXACTLY, read helpers,
   and buildSudokuTheme(response) that overlays equipped skins by slot.

   The DOM/CSS layer (_sudoku-midway.css) reads each themeable value through a
   CSS custom property with the *current literal* as its fallback, e.g.
     background: var(--sk-cell-bg, linear-gradient(180deg,#f6eddc,#ece0c6));
   sudokuThemeCssVars() only emits a variable when the built theme differs from
   DEFAULT, so an empty loadout emits nothing and renders byte-identically.

   Slots:
     board   → cell / grid colors (cellBg, givenCellBg, gridLineColor,
               boxBorderColor, selectedCellColor)
     numbers → digit colors (givenDigitColor, enteredDigitColor, conflictColor)
               + optional fontFamily (mono | sans | serif)
     accent  → highlight / peer-highlight + active accent (accentColor,
               peerHighlight) + optional selectedGlow effect (OFF by default)
   ────────────────────────────────────────────────────────────────────── */

export type SudokuFontFamily = 'mono' | 'sans' | 'serif';

export type SudokuCosmeticTheme = {
  // board slot
  cellBg: string;
  givenCellBg: string;
  gridLineColor: string;
  boxBorderColor: string;
  selectedCellColor: string;
  // numbers slot
  givenDigitColor: string;
  enteredDigitColor: string;
  conflictColor: string;
  fontFamily: SudokuFontFamily;
  // accent slot
  accentColor: string;
  peerHighlight: string;
  // optional effect (OFF by default)
  selectedGlow: boolean;
};

/* Current Midway look — kept in lockstep with the literals in
   _sudoku-midway.css so an empty loadout is unchanged. Gradient cells store
   their dominant (top) color here; the CSS fallback owns the exact gradient. */
export const DEFAULT_SUDOKU_THEME: SudokuCosmeticTheme = {
  cellBg: '#f6eddc',
  givenCellBg: '#e7dabd',
  gridLineColor: '#1c160d',
  boxBorderColor: '#0f0a06',
  selectedCellColor: '#f7d79a',
  givenDigitColor: '#14100a',
  enteredDigitColor: '#b46b16',
  conflictColor: '#c73538',
  fontFamily: 'mono',
  accentColor: '#2fb8a6',
  peerHighlight: '#f1e6cd',
  selectedGlow: false,
};

/* Inventory shape returned by /api/store/inventory (same contract snake uses). */
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

const FONT_FAMILIES: readonly SudokuFontFamily[] = ['mono', 'sans', 'serif'];

export const buildSudokuTheme = (
  response: InventoryCosmeticResponse,
): SudokuCosmeticTheme => {
  const theme: SudokuCosmeticTheme = { ...DEFAULT_SUDOKU_THEME };
  for (const equipped of response.equipped ?? []) {
    const slot = equipped?.slot;
    const assetRef = equipped?.item?.assetRef ?? null;
    if (!slot || !assetRef) continue;

    if (slot === 'board') {
      theme.cellBg = readAssetColor(assetRef, 'cellBg', theme.cellBg);
      theme.givenCellBg = readAssetColor(
        assetRef,
        'givenCellBg',
        theme.givenCellBg,
      );
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
      theme.selectedCellColor = readAssetColor(
        assetRef,
        'selectedCellColor',
        theme.selectedCellColor,
      );
    } else if (slot === 'numbers') {
      theme.givenDigitColor = readAssetColor(
        assetRef,
        'givenDigitColor',
        theme.givenDigitColor,
      );
      theme.enteredDigitColor = readAssetColor(
        assetRef,
        'enteredDigitColor',
        theme.enteredDigitColor,
      );
      theme.conflictColor = readAssetColor(
        assetRef,
        'conflictColor',
        theme.conflictColor,
      );
      const font = assetRef.fontFamily;
      if (
        typeof font === 'string' &&
        (FONT_FAMILIES as readonly string[]).includes(font)
      ) {
        theme.fontFamily = font as SudokuFontFamily;
      }
    } else if (slot === 'accent') {
      theme.accentColor = readAssetColor(
        assetRef,
        'accentColor',
        theme.accentColor,
      );
      theme.peerHighlight = readAssetColor(
        assetRef,
        'peerHighlight',
        theme.peerHighlight,
      );
      if (typeof assetRef.selectedGlow === 'boolean') {
        theme.selectedGlow = assetRef.selectedGlow;
      }
    }
  }
  return theme;
};

const FONT_STACKS: Record<SudokuFontFamily, string> = {
  mono: 'var(--font-mono-arcade, ui-monospace, monospace)',
  sans: 'ui-sans-serif, system-ui, sans-serif',
  serif: 'ui-serif, Georgia, "Times New Roman", serif',
};

/* Build a beveled top→bottom gradient from a single base color so skinned
   cells keep the lacquered keycap feel of the default look. */
const toCellGradient = (base: string) =>
  `linear-gradient(180deg, ${base} 0%, color-mix(in srgb, ${base} 85%, #000) 100%)`;

/* Emit ONLY the CSS vars that differ from DEFAULT, so an empty loadout (and
   any slot left at its default) renders exactly as the hardcoded CSS. */
export const sudokuThemeCssVars = (
  theme: SudokuCosmeticTheme,
): React.CSSProperties => {
  const vars: Record<string, string> = {};
  if (theme.cellBg !== DEFAULT_SUDOKU_THEME.cellBg) {
    vars['--sk-cell-bg'] = toCellGradient(theme.cellBg);
  }
  if (theme.givenCellBg !== DEFAULT_SUDOKU_THEME.givenCellBg) {
    vars['--sk-given-cell-bg'] = toCellGradient(theme.givenCellBg);
  }
  if (theme.gridLineColor !== DEFAULT_SUDOKU_THEME.gridLineColor) {
    vars['--sk-board-bg'] = theme.gridLineColor;
  }
  if (theme.boxBorderColor !== DEFAULT_SUDOKU_THEME.boxBorderColor) {
    vars['--sk-box-border'] = theme.boxBorderColor;
  }
  if (theme.selectedCellColor !== DEFAULT_SUDOKU_THEME.selectedCellColor) {
    vars['--sk-selected-cell'] = toCellGradient(theme.selectedCellColor);
  }
  if (theme.givenDigitColor !== DEFAULT_SUDOKU_THEME.givenDigitColor) {
    vars['--sk-given-digit'] = theme.givenDigitColor;
  }
  if (theme.enteredDigitColor !== DEFAULT_SUDOKU_THEME.enteredDigitColor) {
    vars['--sk-entered-digit'] = theme.enteredDigitColor;
  }
  if (theme.conflictColor !== DEFAULT_SUDOKU_THEME.conflictColor) {
    vars['--sk-conflict'] = theme.conflictColor;
  }
  if (theme.fontFamily !== DEFAULT_SUDOKU_THEME.fontFamily) {
    vars['--sk-font'] = FONT_STACKS[theme.fontFamily];
  }
  if (theme.accentColor !== DEFAULT_SUDOKU_THEME.accentColor) {
    vars['--sk-accent'] = theme.accentColor;
  }
  if (theme.peerHighlight !== DEFAULT_SUDOKU_THEME.peerHighlight) {
    vars['--sk-peer-highlight'] = toCellGradient(theme.peerHighlight);
  }
  // Optional effect: a soft glow ring around the selected cell. OFF by default
  // (transparent renders nothing). When on, it tracks the active accent.
  if (theme.selectedGlow) {
    vars['--sk-selected-glow'] = theme.accentColor;
  }
  return vars as React.CSSProperties;
};
