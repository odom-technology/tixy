// ---------------------------------------------------------------------------
// Shared Reversi/Othello types (usable in server and client).
//
// Mirrors the Connect Four type surface (MatchStatus / WinReason / GameResult /
// Color + the Match domain object) so the server match module and client pages
// stay structurally identical to Connect Four. Reversi runs UNTIMED, so the
// clock fields are dropped entirely; the cloned schema's clock columns go
// unused.
// ---------------------------------------------------------------------------

export type MatchStatus = 'waiting' | 'active' | 'completed' | 'forfeited';

export type WinReason =
  | 'disc_majority' // the game ended (no legal moves) and one side had more discs
  | 'resignation'
  | 'draw_full_board' // game ended with equal discs (tie)
  | 'forfeit';

// Result is kept in the same literal alphabet as Connect Four/chess so the
// cloned match + postgame surfaces ('1/2-1/2' draw checks etc.) work unchanged.
// Black is the first mover, mapped to the "1-0" win, White to "0-1".
export type GameResult = '1-0' | '0-1' | '1/2-1/2';

/**
 * Reversi players. `black` always moves first (board char 'B'); `white` moves
 * second (board char 'W'). Stored on the dedicated black_id / white_id columns
 * of reversi_matches (NOT the generic red/yellow remap Connect Four used).
 */
export type Color = 'black' | 'white';

export type ReversiMatch = {
  id: string;
  player1Id: string;
  player1Name: string;
  player2Id: string | null;
  player2Name: string | null;
  invitedUserId: string | null;
  /** black disc holder (char 'B', moves first). */
  blackId: string | null;
  /** white disc holder (char 'W'). */
  whiteId: string | null;
  status: MatchStatus;
  currentTurn: string;
  /** 64-char board string, '.'=empty 'B'=black 'W'=white. Index 0 is the
   * top-left cell; row-major across 8 columns × 8 rows (top row first). */
  board: string;
  /** Total discs placed (half-moves; passes do not add a ply). */
  ply: number;
  /** Display move count. */
  moveCount: number;
  /** Cell index (0-63) of the most recent placement, as a string, or null. */
  lastMove: string | null;
  result: GameResult | null;
  winnerId: string | null;
  loserId: string | null;
  winReason: WinReason | null;
  tournamentMatchId: string | null;
  wagerAmount: number | null;
  wagerStatus: string | null;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
};

// ---------------------------------------------------------------------------
// Board geometry
// ---------------------------------------------------------------------------

export const REVERSI_COLS = 8;
export const REVERSI_ROWS = 8;
export const REVERSI_CELLS = REVERSI_COLS * REVERSI_ROWS; // 64

/**
 * Standard Othello opening: the four centre cells seeded W/B/B/W.
 *   d4 (idx 27) = W, e4 (idx 28) = B, d5 (idx 35) = B, e5 (idx 36) = W.
 * Black moves first.
 */
function buildStartingBoard(): string {
  const cells = new Array<string>(REVERSI_CELLS).fill('.');
  cells[27] = 'W';
  cells[28] = 'B';
  cells[35] = 'B';
  cells[36] = 'W';
  return cells.join('');
}

export const STARTING_BOARD = buildStartingBoard();
