// ---------------------------------------------------------------------------
// Shared Connect Four types (usable in server and client).
//
// Mirrors the chess type surface (MatchStatus / WinReason / GameResult / Color
// + the Match domain object) so the server match module and client pages can
// stay structurally identical to chess. Connect Four runs UNTIMED, so the
// chess clock fields (timeFormat / *TimeMs / lastMoveAt) are dropped entirely;
// the cloned matchTable's clock columns simply go unused for this game.
// ---------------------------------------------------------------------------

export type MatchStatus = 'waiting' | 'active' | 'completed' | 'forfeited';

export type WinReason =
  | 'four_in_a_row' // a player connected four discs
  | 'resignation'
  | 'draw_full_board' // board filled with no winner
  | 'forfeit';

export type GameResult = '1-0' | '0-1' | '1/2-1/2';

/**
 * Connect Four players. `red` always drops first (player slot "1" on the
 * board string); `yellow` is player slot "2". Mapped onto the generic
 * `whiteId`/`blackId` match columns so the cloned schema needs no new columns:
 *   red   <-> whiteId  (moves first)
 *   yellow<-> blackId
 */
export type Color = 'red' | 'yellow';

export type ConnectFourMatch = {
  id: string;
  player1Id: string;
  player1Name: string;
  player2Id: string | null;
  player2Name: string | null;
  invitedUserId: string | null;
  /** red disc holder (slot "1", moves first). */
  redId: string | null;
  /** yellow disc holder (slot "2"). */
  yellowId: string | null;
  status: MatchStatus;
  currentTurn: string;
  /** 42-char board string, '.'=empty '1'=red '2'=yellow. Index 0 is the
   * top-left cell; row-major across 7 columns × 6 rows (top row first). */
  board: string;
  /** Total discs dropped (half-moves). */
  ply: number;
  /** Display move count (ceil(ply/2)). */
  moveCount: number;
  /** Column (0-6) of the most recent drop, as a string, or null. */
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

export const C4_COLS = 7;
export const C4_ROWS = 6;
export const C4_CELLS = C4_COLS * C4_ROWS; // 42

/** Empty 6×7 board. 42 dots, row-major (top row first). */
export const STARTING_BOARD = '.'.repeat(C4_CELLS);
