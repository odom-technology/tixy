// ---------------------------------------------------------------------------
// Reversi/Othello rules engine. Pure + isomorphic (no Node-only imports) so the
// server match module and the client board can share it.
//
// Board encoding: a 64-char string, row-major with the TOP row first.
//   index = row * 8 + col,  row 0 = top, row 7 = bottom, col 0 = left.
//   '.' = empty, 'B' = black (first), 'W' = white.
//
// A legal move places your disc on an empty cell that flanks ≥1 contiguous line
// of opponent discs ending in one of your own discs, in any of the 8 directions.
// Placing flips every flanked disc on every flanking line.
//
// If a player has no legal move their turn is skipped. If NEITHER player has a
// legal move (which includes a full board) the game ends; the winner has more
// discs (equal counts → draw).
// ---------------------------------------------------------------------------

import {
  REVERSI_COLS,
  REVERSI_ROWS,
  REVERSI_CELLS,
  STARTING_BOARD,
  type Color,
  type GameResult,
  type WinReason,
} from './types';

export type Cell = '.' | 'B' | 'W';

export type GameEndResult =
  | {
      over: true;
      winnerColor: Color | null;
      result: GameResult;
      reason: WinReason;
    }
  | { over: false };

export type AppliedMoveResult = {
  /** New 64-char board string after the placement + flips. */
  board: string;
  /** Indices (0-63) of every opponent disc that was flipped. */
  flipped: number[];
  /** Human-readable notation for the move, e.g. "B-d3". */
  moveNotation: string;
  /** Color that just moved. */
  moverColor: Color;
  /** 0-63 cell index the disc was placed on. */
  cell: number;
};

const cellFor = (color: Color): Cell => (color === 'black' ? 'B' : 'W');
const colorForCell = (cell: Cell): Color | null =>
  cell === 'B' ? 'black' : cell === 'W' ? 'white' : null;

export const opposite = (color: Color): Color =>
  color === 'black' ? 'white' : 'black';

const rowOf = (index: number): number => Math.floor(index / REVERSI_COLS);
const colOf = (index: number): number => index % REVERSI_COLS;

/** The 8 ray directions as [dRow, dCol]. */
const DIRECTIONS: ReadonlyArray<readonly [number, number]> = [
  [-1, -1], [-1, 0], [-1, 1],
  [0, -1],           [0, 1],
  [1, -1],  [1, 0],  [1, 1],
];

/** Validate the board string is well-formed (length + alphabet). */
function assertValidBoard(board: string): void {
  if (typeof board !== 'string' || board.length !== REVERSI_CELLS) {
    throw new Error(`Invalid move: malformed board (expected ${REVERSI_CELLS} cells).`);
  }
  for (let i = 0; i < board.length; i++) {
    const ch = board[i];
    if (ch !== '.' && ch !== 'B' && ch !== 'W') {
      throw new Error(`Invalid move: malformed board cell '${ch}'.`);
    }
  }
}

/** Parse a cell index from arbitrary input (number or numeric string). Returns
 *  null when the value isn't a clean integer cell token. */
export function parseCell(value: unknown): number | null {
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

/**
 * The opponent discs that would be flipped if `color` placed on `cell`.
 * Returns an empty array when the move is illegal (cell occupied, off-board, or
 * flanks nothing). Pure — no board mutation.
 */
export function flipsForMove(board: string, cell: number, color: Color): number[] {
  if (cell < 0 || cell >= REVERSI_CELLS) return [];
  if (board[cell] !== '.') return [];

  const me = cellFor(color);
  const opp = cellFor(opposite(color));
  const startRow = rowOf(cell);
  const startCol = colOf(cell);
  const flipped: number[] = [];

  for (const [dr, dc] of DIRECTIONS) {
    let r = startRow + dr;
    let c = startCol + dc;
    const line: number[] = [];
    while (r >= 0 && r < REVERSI_ROWS && c >= 0 && c < REVERSI_COLS) {
      const i = r * REVERSI_COLS + c;
      const ch = board[i];
      if (ch === opp) {
        line.push(i);
      } else if (ch === me) {
        // A flanking line is only valid if it captured ≥1 opponent disc.
        if (line.length > 0) flipped.push(...line);
        break;
      } else {
        // Empty cell or off-alphabet — this ray contributes nothing.
        break;
      }
      r += dr;
      c += dc;
    }
  }

  return flipped;
}

/** Every legal cell index (0-63) for `color`. */
export function legalMoves(board: string, color: Color): number[] {
  assertValidBoard(board);
  const moves: number[] = [];
  for (let i = 0; i < REVERSI_CELLS; i++) {
    if (board[i] !== '.') continue;
    if (flipsForMove(board, i, color).length > 0) moves.push(i);
  }
  return moves;
}

/** Does `color` have at least one legal move? */
export function hasAnyMove(board: string, color: Color): boolean {
  for (let i = 0; i < REVERSI_CELLS; i++) {
    if (board[i] !== '.') continue;
    if (flipsForMove(board, i, color).length > 0) return true;
  }
  return false;
}

const FILE_LETTERS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const;

/** Notation like "B-d3": mover initial + algebraic cell coordinate. */
function notate(moverColor: Color, cell: number): string {
  const initial = moverColor === 'black' ? 'B' : 'W';
  const file = FILE_LETTERS[colOf(cell)] ?? String(colOf(cell) + 1);
  const rank = rowOf(cell) + 1; // 1 = top row
  return `${initial}-${file}${rank}`;
}

/**
 * Apply a placement for `color` on `cell`. Returns the new board + flipped
 * discs + notation. Throws `Invalid move: ...` on malformed input and
 * `Illegal move: ...` when the cell is occupied, off-board, or flanks nothing.
 * (The move route maps both message prefixes to HTTP 400.)
 */
export function applyMove(board: string, cell: number, color: Color): AppliedMoveResult {
  assertValidBoard(board);
  const idx = parseCell(cell);
  if (idx === null) {
    throw new Error(`Invalid move: cell '${String(cell)}' is not an integer.`);
  }
  if (idx < 0 || idx >= REVERSI_CELLS) {
    throw new Error(`Illegal move: cell ${idx} is out of range (0-${REVERSI_CELLS - 1}).`);
  }
  if (board[idx] !== '.') {
    throw new Error(`Illegal move: cell ${idx} is already occupied.`);
  }
  const flipped = flipsForMove(board, idx, color);
  if (flipped.length === 0) {
    throw new Error(`Illegal move: cell ${idx} flanks no opponent discs.`);
  }

  const chars = board.split('');
  chars[idx] = cellFor(color);
  for (const i of flipped) chars[i] = cellFor(color);

  return {
    board: chars.join(''),
    flipped,
    moveNotation: notate(color, idx),
    moverColor: color,
    cell: idx,
  };
}

/** Count the discs of each color on the board. */
export function countDiscs(board: string): { black: number; white: number } {
  let black = 0;
  let white = 0;
  for (let i = 0; i < board.length; i++) {
    const ch = board[i];
    if (ch === 'B') black++;
    else if (ch === 'W') white++;
  }
  return { black, white };
}

/** Board is full when no cell is empty. */
export function isBoardFull(board: string): boolean {
  return !board.includes('.');
}

/**
 * Evaluate whether the position is terminal. The game ends when NEITHER color
 * has a legal move (a superset of "board full"). The winner is whoever has more
 * discs; equal counts are a draw.
 */
export function detectGameEnd(board: string): GameEndResult {
  assertValidBoard(board);
  if (hasAnyMove(board, 'black') || hasAnyMove(board, 'white')) {
    return { over: false };
  }
  const { black, white } = countDiscs(board);
  if (black === white) {
    return { over: true, winnerColor: null, result: '1/2-1/2', reason: 'draw_full_board' };
  }
  const winnerColor: Color = black > white ? 'black' : 'white';
  return {
    over: true,
    winnerColor,
    result: winnerColor === 'black' ? '1-0' : '0-1',
    reason: 'disc_majority',
  };
}

/** The empty starting board with the four centre discs seeded. */
export function initialBoard(): string {
  return STARTING_BOARD;
}

/** Which color is the given user in this match? */
export function colorForPlayer(
  match: { blackId: string | null; whiteId: string | null },
  userId: string,
): Color | null {
  if (match.blackId === userId) return 'black';
  if (match.whiteId === userId) return 'white';
  return null;
}

/** Turn the board string into an 8×8 grid of cells (row 0 = top) for the UI. */
export function boardToGrid(board: string): Cell[][] {
  assertValidBoard(board);
  const grid: Cell[][] = [];
  for (let row = 0; row < REVERSI_ROWS; row++) {
    const r: Cell[] = [];
    for (let col = 0; col < REVERSI_COLS; col++) {
      r.push(board[row * REVERSI_COLS + col] as Cell);
    }
    grid.push(r);
  }
  return grid;
}

export { colorForCell, STARTING_BOARD };
