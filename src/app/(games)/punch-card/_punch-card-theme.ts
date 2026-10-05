/* ──────────────────────────────────────────────────────────────────────
   PUNCH CARD cosmetic theme. Mirrors the canonical sudoku pattern: a DEFAULT
   theme matching the hardcoded Midway look EXACTLY, read helpers, and
   buildPunchCardTheme(response) that overlays equipped skins by slot.

   The DOM/CSS layer (_punch-card-midway.css) reads each themeable value through
   a CSS custom property with the *current literal* as its fallback, e.g.
     background: var(--pc-cell-bg, linear-gradient(180deg,#f6eddc,#ece0c6));
   punchCardThemeCssVars() only emits a variable when the built theme differs
   from DEFAULT, so an empty loadout renders byte-identically.

   Slots:
     paper  → grid papers (cellBg, boardBg, gridLineColor, clueBg, clueColor)
     ink    → marker inks (fillColor, fillEdge, xColor)
     reveal → highlight + solved-reveal palette (accentColor, revealColor)
              + optional solvedGlow effect (OFF by default)
   ────────────────────────────────────────────────────────────────────── */

export type PunchCardCosmeticTheme = {
  // paper slot
  cellBg: string;
  boardBg: string;
  gridLineColor: string;
  clueBg: string;
  clueColor: string;
  // ink slot
  fillColor: string;
  fillEdge: string;
  xColor: string;
  // reveal slot
  accentColor: string;
  revealColor: string;
  solvedGlow: boolean;
};

/* Current Midway look — kept in lockstep with the literals in
   _punch-card-midway.css so an empty loadout is unchanged. */
export const DEFAULT_PUNCH_CARD_THEME: PunchCardCosmeticTheme = {
  cellBg: '#f4ead4',
  boardBg: '#1c160d',
  gridLineColor: '#d3bd93',
  clueBg: '#e6d8b8',
  clueColor: '#4a3922',
  fillColor: '#2c2114',
  fillEdge: '#120c06',
  xColor: '#b0703f',
  accentColor: '#2fb8a6',
  revealColor: '#c8791f',
  solvedGlow: false,
};

/* Inventory shape returned by /api/store/inventory (same contract sudoku uses). */
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

export const buildPunchCardTheme = (
  response: InventoryCosmeticResponse,
): PunchCardCosmeticTheme => {
  const theme: PunchCardCosmeticTheme = { ...DEFAULT_PUNCH_CARD_THEME };
  for (const equipped of response.equipped ?? []) {
    const slot = equipped?.slot;
    const assetRef = equipped?.item?.assetRef ?? null;
    if (!slot || !assetRef) continue;

    if (slot === 'paper') {
      theme.cellBg = readAssetColor(assetRef, 'cellBg', theme.cellBg);
      theme.boardBg = readAssetColor(assetRef, 'boardBg', theme.boardBg);
      theme.gridLineColor = readAssetColor(
        assetRef,
        'gridLineColor',
        theme.gridLineColor,
      );
      theme.clueBg = readAssetColor(assetRef, 'clueBg', theme.clueBg);
      theme.clueColor = readAssetColor(assetRef, 'clueColor', theme.clueColor);
    } else if (slot === 'ink') {
      theme.fillColor = readAssetColor(assetRef, 'fillColor', theme.fillColor);
      theme.fillEdge = readAssetColor(assetRef, 'fillEdge', theme.fillEdge);
      theme.xColor = readAssetColor(assetRef, 'xColor', theme.xColor);
    } else if (slot === 'reveal') {
      theme.accentColor = readAssetColor(
        assetRef,
        'accentColor',
        theme.accentColor,
      );
      theme.revealColor = readAssetColor(
        assetRef,
        'revealColor',
        theme.revealColor,
      );
      if (typeof assetRef.solvedGlow === 'boolean') {
        theme.solvedGlow = assetRef.solvedGlow;
      }
    }
  }
  return theme;
};

/* Beveled top→bottom gradient from one base color so skinned cells keep the
   lacquered feel of the default look. */
const toCellGradient = (base: string) =>
  `linear-gradient(180deg, ${base} 0%, color-mix(in srgb, ${base} 86%, #000) 100%)`;

/* Emit ONLY the CSS vars that differ from DEFAULT, so an empty loadout (and any
   slot left at its default) renders exactly as the hardcoded CSS. */
export const punchCardThemeCssVars = (
  theme: PunchCardCosmeticTheme,
): React.CSSProperties => {
  const vars: Record<string, string> = {};
  if (theme.cellBg !== DEFAULT_PUNCH_CARD_THEME.cellBg) {
    vars['--pc-cell-bg'] = toCellGradient(theme.cellBg);
  }
  if (theme.boardBg !== DEFAULT_PUNCH_CARD_THEME.boardBg) {
    vars['--pc-board-bg'] = theme.boardBg;
  }
  if (theme.gridLineColor !== DEFAULT_PUNCH_CARD_THEME.gridLineColor) {
    vars['--pc-grid-line'] = theme.gridLineColor;
  }
  if (theme.clueBg !== DEFAULT_PUNCH_CARD_THEME.clueBg) {
    vars['--pc-clue-bg'] = theme.clueBg;
  }
  if (theme.clueColor !== DEFAULT_PUNCH_CARD_THEME.clueColor) {
    vars['--pc-clue-color'] = theme.clueColor;
  }
  if (theme.fillColor !== DEFAULT_PUNCH_CARD_THEME.fillColor) {
    vars['--pc-fill'] = toCellGradient(theme.fillColor);
    vars['--pc-fill-solid'] = theme.fillColor;
  }
  if (theme.fillEdge !== DEFAULT_PUNCH_CARD_THEME.fillEdge) {
    vars['--pc-fill-edge'] = theme.fillEdge;
  }
  if (theme.xColor !== DEFAULT_PUNCH_CARD_THEME.xColor) {
    vars['--pc-x-color'] = theme.xColor;
  }
  if (theme.accentColor !== DEFAULT_PUNCH_CARD_THEME.accentColor) {
    vars['--pc-accent'] = theme.accentColor;
  }
  if (theme.revealColor !== DEFAULT_PUNCH_CARD_THEME.revealColor) {
    vars['--pc-reveal'] = theme.revealColor;
  }
  if (theme.solvedGlow) {
    vars['--pc-solved-glow'] = theme.accentColor;
  }
  return vars as React.CSSProperties;
};
