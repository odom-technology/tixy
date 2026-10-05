// ---------------------------------------------------------------------------
// Connect Four rules engine. Pure + isomorphic (no Node-only imports) so the
// server match module and the client board can share it. Hand-written legality
// + win detection — there is no third-party helper (the chess stack leans on
// chess.js here; we implement the equivalent surface ourselves).
//
// Board encoding: a 42-char string, row-major with the TOP row first.
//   index = row * 7 + col,  row 0 = top, row 5 = bottom, col 0 = left.
//   '.' = empty, '1' = red (slot 1, first), '2' = yellow (slot 2).
// A disc dropped in a column falls to the lowest empty cell in that column.
// ---------------------------------------------------------------------------

import {
  C4_COLS,
  C4_ROWS,
  C4_CELLS,
  STARTING_BOARD,
  type Color,
  type GameResult,
  type WinReason,
} from './types';

export type Cell = '.' | '1' | '2';

export type GameEndResult =
  | {
      over: true;
      winnerColor: Color | null;
      result: GameResult;
      reason: WinReason;
    }
  | { over: false };

export type AppliedMoveResult = {
  /** New 42-char board string after the drop. */
  board: string;
  /** Human-readable notation for the move, e.g. "R-c4" (red, col c, row 4). */
  moveNotation: string;
  /** Color that just moved. */
  moverColor: Color;
  /** 0-based column the disc was dropped into. */
  column: number;
  /** 0-based row (from top) the disc settled in. */
  row: number;
};

const cellFor = (turn: Color): Cell => (turn === 'red' ? '1' : '2');
const colorForCell = (cell: Cell): Color | null =>
  cell === '1' ? 'red' : cell === '2' ? 'yellow' : null;

const idx = (row: number, col: number): number => row * C4_COLS + col;

/** Validate the board string is well-formed (length + alphabet). */
function assertValidBoard(board: string): void {
  if (typeof board !== 'string' || board.length !== C4_CELLS) {
    throw new Error(`Invalid move: malformed board (expected ${C4_CELLS} cells).`);
  }
  for (let i = 0; i < board.length; i++) {
    const ch = board[i];
    if (ch !== '.' && ch !== '1' && ch !== '2') {
      throw new Error(`Invalid move: malformed board cell '${ch}'.`);
    }
  }
}

/** Parse a column from arbitrary input (number or numeric string). Returns
 *  null when the value isn't a clean integer column token. */
export function parseColumn(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isInteger(value) ? value : null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!/^-?\d+$/.test(trimmed)) return null;
    return Number.parseInt(trimmed, 10);
  }
  return null;
}

/** Lowest empty row (from top, so the largest row index) in a column, or -1
 *  if the column is full. */
function lowestEmptyRow(board: string, col: number): number {
  for (let row = C4_ROWS - 1; row >= 0; row--) {
    if (board[idx(row, col)] === '.') return row;
  }
  return -1;
}

/** Columns (0-6) that can still accept a disc. */
export function legalMovesFrom(board: string): number[] {
  const moves: number[] = [];
  for (let col = 0; col < C4_COLS; col++) {
    if (board[idx(0, col)] === '.') moves.push(col);
  }
  return moves;
}

/** Board is full when no top cell is empty. */
export function isBoardFull(board: string): boolean {
  for (let col = 0; col < C4_COLS; col++) {
    if (board[idx(0, col)] === '.') return false;
  }
  return true;
}

const FILE_LETTERS = ['a', 'b', 'c', 'd', 'e', 'f', 'g'] as const;

/** Notation like "R-d3": mover initial, column letter, and the row number
 *  counted from the BOTTOM (1 = bottom) so it reads like a stacked column. */
function notate(moverColor: Color, column: number, rowFromTop: number): string {
  const initial = moverColor === 'red' ? 'R' : 'Y';
  const file = FILE_LETTERS[column] ?? String(column + 1);
  const rowFromBottom = C4_ROWS - rowFromTop; // 1..6
  return `${initial}-${file}${rowFromBottom}`;
}

/**
 * Apply a disc drop for `turn` into `column`. Returns the new board + notation.
 * Throws `Invalid move: ...` on malformed input and `Illegal move: ...` when
 * the column is out of range or already full. (The move route maps both
 * message prefixes to HTTP 400.)
 */
export function applyMove(
  board: string,
  column: number,
  turn: Color,
): AppliedMoveResult {
  assertValidBoard(board);
  const col = parseColumn(column);
  if (col === null) {
    throw new Error(`Invalid move: column '${String(column)}' is not an integer.`);
  }
  if (col < 0 || col >= C4_COLS) {
    throw new Error(`Illegal move: column ${col} is out of range (0-${C4_COLS - 1}).`);
  }
  const row = lowestEmptyRow(board, col);
  if (row < 0) {
    throw new Error(`Illegal move: column ${col} is full.`);
  }
  const i = idx(row, col);
  const next = board.slice(0, i) + cellFor(turn) + board.slice(i + 1);
  return {
    board: next,
    moveNotation: notate(turn, col, row),
    moverColor: turn,
    column: col,
    row,
  };
}

const DIRECTIONS: ReadonlyArray<readonly [number, number]> = [
  [0, 1], // horizontal →
  [1, 0], // vertical ↓
  [1, 1], // diagonal ↘
  [1, -1], // diagonal ↙
];

/**
 * Find the winning color on the board, if any side has four-in-a-row. Returns
 * the color or null. Scans every cell as an anchor in four directions.
 */
export function findWinner(board: string): Color | null {
  for (let row = 0; row < C4_ROWS; row++) {
    for (let col = 0; col < C4_COLS; col++) {
      const cell = board[idx(row, col)] as Cell;
      if (cell === '.') continue;
      for (const [dr, dc] of DIRECTIONS) {
        let count = 1;
        let r = row + dr;
        let c = col + dc;
        while (
          r >= 0 &&
          r < C4_ROWS &&
          c >= 0 &&
          c < C4_COLS &&
          board[idx(r, c)] === cell
        ) {
          count++;
          if (count >= 4) return colorForCell(cell);
          r += dr;
          c += dc;
        }
      }
    }
  }
  return null;
}

/**
 * Evaluate whether the position is terminal. `_lastMove` is accepted for
 * signature parity with the chess engine (which uses it for repetition); the
 * Connect Four win check is a full-board scan so the argument is unused.
 *
 *   - four-in-a-row  → win for that color (reason 'four_in_a_row')
 *   - full board     → draw           (reason 'draw_full_board')
 *   - otherwise      → not over
 */
export function detectGameEnd(board: string, _lastMove?: number): GameEndResult {
  assertValidBoard(board);
  const winner = findWinner(board);
  if (winner) {
    return {
      over: true,
      winnerColor: winner,
      result: winner === 'red' ? '1-0' : '0-1',
      reason: 'four_in_a_row',
    };
  }
  if (isBoardFull(board)) {
    return { over: true, winnerColor: null, result: '1/2-1/2', reason: 'draw_full_board' };
  }
  return { over: false };
}

/** Which color is the given user in this match? */
export function colorForPlayer(
  match: { redId: string | null; yellowId: string | null },
  userId: string,
): Color | null {
  if (match.redId === userId) return 'red';
  if (match.yellowId === userId) return 'yellow';
  return null;
}

/** Turn the board string into a 6×7 grid of cells (row 0 = top) for the UI. */
export function boardToGrid(board: string): Cell[][] {
  assertValidBoard(board);
  const grid: Cell[][] = [];
  for (let row = 0; row < C4_ROWS; row++) {
    const r: Cell[] = [];
    for (let col = 0; col < C4_COLS; col++) {
      r.push(board[idx(row, col)] as Cell);
    }
    grid.push(r);
  }
  return grid;
}

/**
 * The set of cell indexes (0-41) that form the winning line, or null. Used by
 * the board UI to highlight the four connected discs.
 */
export function winningLine(board: string): number[] | null {
  for (let row = 0; row < C4_ROWS; row++) {
    for (let col = 0; col < C4_COLS; col++) {
      const cell = board[idx(row, col)] as Cell;
      if (cell === '.') continue;
      for (const [dr, dc] of DIRECTIONS) {
        const line = [idx(row, col)];
        let r = row + dr;
        let c = col + dc;
        while (
          r >= 0 &&
          r < C4_ROWS &&
          c >= 0 &&
          c < C4_COLS &&
          board[idx(r, c)] === cell
        ) {
          line.push(idx(r, c));
          if (line.length >= 4) return line;
          r += dr;
          c += dc;
        }
      }
    }
  }
  return null;
}

export { STARTING_BOARD };
