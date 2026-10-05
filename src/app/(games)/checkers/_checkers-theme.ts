// ---------------------------------------------------------------------------
// Checkers cosmetic theme.
//
// The draughts board (see `_board.tsx` + `_checkers.css`) is DOM/SVG-rendered
// and already drives its palette from `--ck-*` CSS custom properties declared on
// the `.checkers-arcade` wrapper. Cosmetics flow in by OVERRIDING those vars
// inline. DEFAULT_CHECKERS_THEME reproduces the original `--ck-*` literals
// exactly, so an empty loadout renders identically to the pre-cosmetic look.
//
// Equipped skins overlay on top of the default via buildCheckersTheme():
//   - slot "pieces" → disc colors (light/dark) + their edges/highlights + crown
//                     (king accent) + optional crown-shimmer fx
//   - slot "board"  → light/dark square colors, board border, legal-move accent,
//                     last-move wash
// ---------------------------------------------------------------------------

export type InventoryCosmeticResponse = {
  equipped?: Array<{
    slot?: string;
    item?: {
      assetRef?: Record<string, unknown> | null;
    } | null;
  }>;
};

export type CheckersCosmeticTheme = {
  // pieces — light ("cream"/white) disc: body, edge, top highlight.
  lightPieceColor: string;
  lightPieceEdge: string;
  lightPieceHi: string;
  // pieces — dark ("red") disc: body, edge, top highlight.
  darkPieceColor: string;
  darkPieceEdge: string;
  darkPieceHi: string;
  // pieces — king crown fill + stroke.
  crownColor: string;
  crownStroke: string;
  // optional king crown shimmer (off by default).
  kingShimmer: boolean;
  // board — square fills, frame border, legal-move accent, last-move wash.
  lightSquareColor: string;
  darkSquareColor: string;
  boardBorder: string;
  highlightColor: string;
  lastMoveColor: string;
};

/* DEFAULT look — values match the original `--ck-*` literals and the inline
   SVG/gradient stops in `_checkers.css` / `_board.tsx` exactly, so an empty
   loadout is visually unchanged. */
export const DEFAULT_CHECKERS_THEME: CheckersCosmeticTheme = {
  lightPieceColor: '#f3e7cf',
  lightPieceEdge: '#b9a274',
  lightPieceHi: '#fff7e8',
  darkPieceColor: '#c43a36',
  darkPieceEdge: '#7c1f1d',
  darkPieceHi: '#d8514c',
  crownColor: '#e8b23a',
  crownStroke: '#7a5a14',
  kingShimmer: false,
  lightSquareColor: '#e9d3a8',
  darkSquareColor: '#a06a3f',
  boardBorder: '#1c130a',
  highlightColor: '#2fb8a6',
  lastMoveColor: 'rgba(242, 163, 60, 0.42)',
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

export const buildCheckersTheme = (
  response: InventoryCosmeticResponse,
): CheckersCosmeticTheme => {
  const theme: CheckersCosmeticTheme = { ...DEFAULT_CHECKERS_THEME };
  for (const equipped of response.equipped ?? []) {
    const slot = equipped?.slot;
    const assetRef = equipped?.item?.assetRef ?? null;
    if (!slot || !assetRef) continue;

    if (slot === 'pieces') {
      theme.lightPieceColor = readAssetColor(assetRef, 'lightPieceColor', theme.lightPieceColor);
      theme.lightPieceEdge = readAssetColor(assetRef, 'lightPieceEdge', theme.lightPieceEdge);
      theme.lightPieceHi = readAssetColor(assetRef, 'lightPieceHi', theme.lightPieceHi);
      theme.darkPieceColor = readAssetColor(assetRef, 'darkPieceColor', theme.darkPieceColor);
      theme.darkPieceEdge = readAssetColor(assetRef, 'darkPieceEdge', theme.darkPieceEdge);
      theme.darkPieceHi = readAssetColor(assetRef, 'darkPieceHi', theme.darkPieceHi);
      // crownColor / kingAccent are accepted as aliases.
      theme.crownColor = readAssetColor(
        assetRef,
        'crownColor',
        readAssetColor(assetRef, 'kingAccent', theme.crownColor),
      );
      theme.crownStroke = readAssetColor(assetRef, 'crownStroke', theme.crownStroke);
      if (typeof assetRef.kingShimmer === 'boolean') {
        theme.kingShimmer = assetRef.kingShimmer;
      }
    } else if (slot === 'board') {
      theme.lightSquareColor = readAssetColor(assetRef, 'lightSquareColor', theme.lightSquareColor);
      theme.darkSquareColor = readAssetColor(assetRef, 'darkSquareColor', theme.darkSquareColor);
      theme.boardBorder = readAssetColor(assetRef, 'boardBorder', theme.boardBorder);
      theme.highlightColor = readAssetColor(assetRef, 'highlightColor', theme.highlightColor);
      theme.lastMoveColor = readAssetColor(assetRef, 'lastMoveColor', theme.lastMoveColor);
    }
  }
  return theme;
};

/* Map the theme onto the `--ck-*` CSS custom properties consumed by
   `_checkers.css`, plus the crown/highlight extensions. Returned as a
   React.CSSProperties for inline application on the `.checkers-arcade` wrapper
   (inline vars override the rule-declared defaults). */
export const checkersThemeVars = (
  theme: CheckersCosmeticTheme,
): React.CSSProperties =>
  ({
    '--ck-light': theme.lightSquareColor,
    '--ck-dark': theme.darkSquareColor,
    '--ck-frame': theme.boardBorder,
    '--ck-teal': theme.highlightColor,
    '--ck-amber': theme.lastMoveColor,
    '--ck-red': theme.darkPieceColor,
    '--ck-red-edge': theme.darkPieceEdge,
    '--ck-red-hi': theme.darkPieceHi,
    '--ck-cream': theme.lightPieceColor,
    '--ck-cream-edge': theme.lightPieceEdge,
    '--ck-cream-hi': theme.lightPieceHi,
    '--ck-crown': theme.crownColor,
    '--ck-crown-stroke': theme.crownStroke,
  } as React.CSSProperties);
