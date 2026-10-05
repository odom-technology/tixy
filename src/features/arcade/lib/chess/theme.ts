// ---------------------------------------------------------------------------
// Chess cosmetic theme. Shape of the `assetRef` JSON persisted on store items
// in the `pieces`, `board`, and `clock` slots for gameType 'chess'.
// ---------------------------------------------------------------------------

export type ChessBoardTheme = {
  /** Light square fill (hex or rgba). */
  lightColor: string;
  /** Dark square fill. */
  darkColor: string;
  /** Board outer border color. */
  borderColor: string;
  /** Last-move highlight. */
  highlightColor: string;
  /** Selected square ring. */
  selectedColor: string;
  /** Legal-target dot color. */
  legalMoveColor: string;
};

export type ChessPiecesTheme = {
  /** Color for white pieces. */
  whiteColor: string;
  /** Color for black pieces. */
  blackColor: string;
  /** Drop shadow color for white pieces. */
  whiteShadow: string;
  /** Drop shadow color for black pieces. */
  blackShadow: string;
  /** Font family (Unicode chess glyphs). */
  fontFamily?: string;
};

type ChessClockTheme = {
  /** Active clock accent color (when it's that player's turn). */
  activeColor: string;
  /** Background when active. */
  activeBg: string;
  /** Low-time warning color (< 10 seconds). */
  warningColor: string;
};

export type ChessTheme = {
  board: ChessBoardTheme;
  pieces: ChessPiecesTheme;
  clock: ChessClockTheme;
};

export const DEFAULT_CHESS_BOARD_THEME: ChessBoardTheme = {
  lightColor: '#f0d9b5',
  darkColor: '#b58863',
  borderColor: '#3d2817',
  highlightColor: '#fbbf2470',
  selectedColor: '#22c55e',
  legalMoveColor: '#22c55e',
};

export const DEFAULT_CHESS_PIECES_THEME: ChessPiecesTheme = {
  whiteColor: '#f8fafc',
  blackColor: '#0f172a',
  whiteShadow: 'rgba(0, 0, 0, 0.7)',
  blackShadow: 'rgba(255, 255, 255, 0.2)',
  fontFamily: '"Noto Sans Symbols 2", "Segoe UI Symbol", sans-serif',
};

const DEFAULT_CHESS_CLOCK_THEME: ChessClockTheme = {
  activeColor: '#34d399',
  activeBg: 'rgba(16, 185, 129, 0.1)',
  warningColor: '#ef4444',
};

export const DEFAULT_CHESS_THEME: ChessTheme = {
  board: DEFAULT_CHESS_BOARD_THEME,
  pieces: DEFAULT_CHESS_PIECES_THEME,
  clock: DEFAULT_CHESS_CLOCK_THEME,
};

/** Compose a ChessTheme by merging equipped-inventory assetRef fields over defaults. */
export function composeChessTheme(fields: Record<string, unknown>): ChessTheme {
  return {
    board: {
      lightColor: typeof fields.boardLightColor === 'string' ? fields.boardLightColor : DEFAULT_CHESS_BOARD_THEME.lightColor,
      darkColor: typeof fields.boardDarkColor === 'string' ? fields.boardDarkColor : DEFAULT_CHESS_BOARD_THEME.darkColor,
      borderColor: typeof fields.boardBorderColor === 'string' ? fields.boardBorderColor : DEFAULT_CHESS_BOARD_THEME.borderColor,
      highlightColor: typeof fields.boardHighlightColor === 'string' ? fields.boardHighlightColor : DEFAULT_CHESS_BOARD_THEME.highlightColor,
      selectedColor: typeof fields.boardSelectedColor === 'string' ? fields.boardSelectedColor : DEFAULT_CHESS_BOARD_THEME.selectedColor,
      legalMoveColor: typeof fields.boardLegalMoveColor === 'string' ? fields.boardLegalMoveColor : DEFAULT_CHESS_BOARD_THEME.legalMoveColor,
    },
    pieces: {
      whiteColor: typeof fields.piecesWhiteColor === 'string' ? fields.piecesWhiteColor : DEFAULT_CHESS_PIECES_THEME.whiteColor,
      blackColor: typeof fields.piecesBlackColor === 'string' ? fields.piecesBlackColor : DEFAULT_CHESS_PIECES_THEME.blackColor,
      whiteShadow: typeof fields.piecesWhiteShadow === 'string' ? fields.piecesWhiteShadow : DEFAULT_CHESS_PIECES_THEME.whiteShadow,
      blackShadow: typeof fields.piecesBlackShadow === 'string' ? fields.piecesBlackShadow : DEFAULT_CHESS_PIECES_THEME.blackShadow,
      fontFamily: typeof fields.piecesFontFamily === 'string' ? fields.piecesFontFamily : DEFAULT_CHESS_PIECES_THEME.fontFamily,
    },
    clock: {
      activeColor: typeof fields.clockActiveColor === 'string' ? fields.clockActiveColor : DEFAULT_CHESS_CLOCK_THEME.activeColor,
      activeBg: typeof fields.clockActiveBg === 'string' ? fields.clockActiveBg : DEFAULT_CHESS_CLOCK_THEME.activeBg,
      warningColor: typeof fields.clockWarningColor === 'string' ? fields.clockWarningColor : DEFAULT_CHESS_CLOCK_THEME.warningColor,
    },
  };
}
