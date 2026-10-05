// ---------------------------------------------------------------------------
// Reversi/Othello pure engine entry point.
//
// The canonical implementation lives in the isomorphic lib at
// `@/features/arcade/lib/reversi` (shared verbatim with the client board). This
// module re-exports the pure engine API under the stable names the server match
// + bot modules import:
//
//   initialBoard()                          -> 64-char starting board string
//   legalMoves(board, color): number[]      -> legal cell indices (0-63)
//   applyMove(board, cell, color)           -> { board, flipped, ... }  (throws on illegal)
//   hasAnyMove(board, color): boolean
//   detectGameEnd(board): GameEndResult     -> over when neither side can move
//   countDiscs(board): { black, white }
//
// Encoding: '.' empty, 'B' black (moves first), 'W' white. Index = row*8 + col.
// ---------------------------------------------------------------------------

export {
  initialBoard,
  legalMoves,
  hasAnyMove,
  applyMove,
  detectGameEnd,
  countDiscs,
  flipsForMove,
  isBoardFull,
  colorForPlayer,
  boardToGrid,
  opposite,
  parseCell,
  STARTING_BOARD,
  type Cell,
  type GameEndResult,
  type AppliedMoveResult,
} from '@/features/arcade/lib/reversi';

export type {
  Color,
  GameResult,
  MatchStatus,
  WinReason,
  ReversiMatch,
} from '@/features/arcade/lib/reversi/types';
