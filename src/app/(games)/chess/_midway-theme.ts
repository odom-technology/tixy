// ---------------------------------------------------------------------------
// Chess DEFAULT look: the base, unskinned board and pieces, in the tixy
// palette (docs/design/tixy-rebrand/PLAN.md): paper, ink, ticket amber.
//
// This is only the default cosmetic. Equipped inventory skins still flow
// through `composeChessTheme()` and override these values; we fall back to
// this look when nothing is equipped (see `resolveBaseChessTheme`). Keeping
// them chess-local means we never touch the shared
// `@/features/arcade/lib/chess/theme` defaults.
// ---------------------------------------------------------------------------

import {
  DEFAULT_CHESS_BOARD_THEME,
  DEFAULT_CHESS_PIECES_THEME,
  type ChessBoardTheme,
  type ChessPiecesTheme,
  type ChessTheme,
} from '@/features/arcade/lib/chess/theme';

/** Default board, from the tixy palette: paper squares told apart by tone,
 *  an ink frame, amber for the last move and your selection. Felt is for the
 *  pool table only, so nothing here is green. Equipped skins override it. */
export const MIDWAY_CHESS_BOARD_THEME: ChessBoardTheme = {
  lightColor: '#f4ebdc', // paper
  darkColor: '#cdbd9f', // paper 3, darkened a step so the squares read apart
  borderColor: '#1f1a16', // ink
  // last move: ticket amber wash
  highlightColor: 'rgba(242, 163, 60, 0.45)',
  // your selection: ticket amber
  selectedColor: '#f2a33c',
  // legal targets: ink 2, which holds on both square tones
  legalMoveColor: '#54483d',
};

/** Default pieces: paper against ink. */
export const MIDWAY_CHESS_PIECES_THEME: ChessPiecesTheme = {
  whiteColor: '#fbf6ec', // paper, a touch lighter so it lifts off a paper square
  blackColor: '#1f1a16', // ink
  whiteShadow: 'rgba(31, 26, 22, 0.35)',
  blackShadow: 'rgba(244, 235, 220, 0.2)',
  fontFamily: DEFAULT_CHESS_PIECES_THEME.fontFamily,
};

/** Outline colours for the SVG pieces under the default look. Skins drive
 *  their own outline via the white/black piece colours upstream; these are
 *  only used when we render with the default. */
export const MIDWAY_PIECE_STROKE = {
  white: '#1f1a16',
  black: '#f4ebdc',
} as const;

/** True when an equipped board/pieces theme is just the shared default (i.e.
 *  the player has no chess board/piece skin equipped), so we can substitute
 *  the Midway base look without clobbering a real skin. */
function isDefaultBoard(b: ChessBoardTheme): boolean {
  return (
    b.lightColor === DEFAULT_CHESS_BOARD_THEME.lightColor &&
    b.darkColor === DEFAULT_CHESS_BOARD_THEME.darkColor &&
    b.borderColor === DEFAULT_CHESS_BOARD_THEME.borderColor
  );
}

function isDefaultPieces(p: ChessPiecesTheme): boolean {
  return (
    p.whiteColor === DEFAULT_CHESS_PIECES_THEME.whiteColor &&
    p.blackColor === DEFAULT_CHESS_PIECES_THEME.blackColor
  );
}

/**
 * Resolve the effective board/pieces theme for rendering: if the composed
 * theme is still the shared default (no skin equipped), swap in the Midway
 * base look; otherwise pass the equipped skin through untouched.
 *
 * This keeps the skin pipeline fully intact — equipped cosmetics always win.
 */
export function resolveBaseChessTheme(theme: ChessTheme): {
  board: ChessBoardTheme;
  pieces: ChessPiecesTheme;
  /** Whether we're rendering the Midway base (so callers can pick base strokes). */
  isBaseBoard: boolean;
  isBasePieces: boolean;
} {
  const baseBoard = isDefaultBoard(theme.board);
  const basePieces = isDefaultPieces(theme.pieces);
  return {
    board: baseBoard ? MIDWAY_CHESS_BOARD_THEME : theme.board,
    pieces: basePieces ? MIDWAY_CHESS_PIECES_THEME : theme.pieces,
    isBaseBoard: baseBoard,
    isBasePieces: basePieces,
  };
}
