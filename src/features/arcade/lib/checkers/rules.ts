// ---------------------------------------------------------------------------
// Checkers / draughts rules engine (standard American/English 8×8 draughts).
//
// PURE + isomorphic — no Node-only imports — so the client board can reuse it
// for legal-move hints and the server can use the SAME functions to validate
// moves authoritatively. Mirrors the chess `rules.ts` exported surface so the
// cloned `checkers-match.ts` stays structurally identical to `chess-match.ts`.
//
// RULES IMPLEMENTED (server-authoritative; the client board is never trusted):
//   • Men move one square diagonally FORWARD; kings move one square diagonally
//     in any of the four directions.
//   • CAPTURES ARE MANDATORY: if any capture is available for the side to move,
//     a non-capturing move is ILLEGAL and rejected. (Men capture forward AND
//     backward by jumping; kings capture in any diagonal direction.)
//   • A capture jumps an adjacent enemy piece into the empty square beyond it.
//   • Multi-jumps MUST be completed in a single turn: after a jump, if the same
//     piece can jump again it MUST continue until no further jump exists.
//   • A man that reaches the far rank is KINGED. (If a man reaches the back rank
//     as the final landing square of a jump it is crowned and the turn ends —
//     standard English rule: a freshly-crowned king does not keep jumping.)
//   • A player with NO legal move (blocked, or no pieces left) LOSES.
//   • Optional draw: 40 moves by each side with no capture and no man crowned.
// ---------------------------------------------------------------------------

import type { CheckersColor, GameResult, WinReason } from './types';
import { STARTING_BOARD } from './types';

export type Cell = '.' | 'r' | 'R' | 'w' | 'W';

export const BOARD_SIZE = 8;

export type GameEndResult =
  | { over: true; winnerColor: CheckersColor | null; result: GameResult; reason: WinReason }
  | { over: false };

/** A single step of a move: from-square index → to-square index, with the
 *  captured square index (or null for a simple slide). Squares are 0..63. */
export type MoveStep = { from: number; to: number; captured: number | null };

/** A full legal move = an ordered chain of one or more steps. For a simple
 *  slide the chain has length 1; for a multi-jump it has one step per jump. */
export type Move = {
  /** Origin square (0..63). */
  from: number;
  /** Final landing square (0..63). */
  to: number;
  /** Ordered jump/slide steps making up the move. */
  steps: MoveStep[];
  /** True if this move captures at least one piece. */
  isCapture: boolean;
  /** Notation string, e.g. "c3-d4" (slide) or "c3xe5xg7" (double jump). */
  notation: string;
};

export type AppliedMoveResult = {
  board: string;
  moveNotation: string;
  isCapture: boolean;
  /** True if a man was crowned to king by this move. */
  promoted: boolean;
  moverColor: CheckersColor;
};

// ---------------------------------------------------------------------------
// Board helpers
// ---------------------------------------------------------------------------

const rc = (index: number): { row: number; col: number } => ({
  row: Math.floor(index / BOARD_SIZE),
  col: index % BOARD_SIZE,
});

const idx = (row: number, col: number): number => row * BOARD_SIZE + col;

const inBounds = (row: number, col: number): boolean =>
  row >= 0 && row < BOARD_SIZE && col >= 0 && col < BOARD_SIZE;

export function colorOf(cell: Cell): CheckersColor | null {
  if (cell === 'r' || cell === 'R') return 'red';
  if (cell === 'w' || cell === 'W') return 'white';
  return null;
}

const isKing = (cell: Cell): boolean => cell === 'R' || cell === 'W';

/** Convert a board square index to algebraic-ish coordinates used in notation.
 *  Column a..h (left→right), row 1..8 from RED's side (bottom = row 7 internal
 *  → "1"), so notation reads naturally for the bottom (red) player. */
function squareName(index: number): string {
  const { row, col } = rc(index);
  const file = String.fromCharCode('a'.charCodeAt(0) + col);
  const rank = BOARD_SIZE - row; // internal row 7 → "1", row 0 → "8"
  return `${file}${rank}`;
}

/** Direction sets. Red men advance UP (row decreases); white men advance DOWN
 *  (row increases). Kings use all four diagonals. */
function moveDirections(cell: Cell): Array<[number, number]> {
  const king = isKing(cell);
  const color = colorOf(cell);
  if (king) return [[-1, -1], [-1, 1], [1, -1], [1, 1]];
  if (color === 'red') return [[-1, -1], [-1, 1]];
  return [[1, -1], [1, 1]];
}

/** Capture directions. Men may capture forward AND backward (standard English
 *  draughts allows men to jump backward), kings in all directions. We model
 *  men jumps in all four directions to match common implementations; if a
 *  stricter "forward-only man capture" variant is ever wanted, restrict here. */
function captureDirections(_cell: Cell): Array<[number, number]> {
  return [[-1, -1], [-1, 1], [1, -1], [1, 1]];
}

const boardToArray = (board: string): Cell[] => board.split('') as Cell[];
const arrayToBoard = (cells: Cell[]): string => cells.join('');

/** Promote a man that has landed on its far rank. Returns the (possibly
 *  crowned) cell. */
function maybePromote(cell: Cell, landing: number): Cell {
  const { row } = rc(landing);
  if (cell === 'r' && row === 0) return 'R'; // red reaches top
  if (cell === 'w' && row === BOARD_SIZE - 1) return 'W'; // white reaches bottom
  return cell;
}

// ---------------------------------------------------------------------------
// Move generation
// ---------------------------------------------------------------------------

/** All single-jump continuations available to the piece now sitting on
 *  `square`. Used to chain multi-jumps. `boardCells` is the board AFTER the
 *  prior jumps in the chain were applied. */
function jumpsFrom(boardCells: Cell[], square: number): MoveStep[] {
  const cell = boardCells[square];
  const color = colorOf(cell);
  if (!color) return [];
  const { row, col } = rc(square);
  const steps: MoveStep[] = [];
  for (const [dr, dc] of captureDirections(cell)) {
    const midRow = row + dr;
    const midCol = col + dc;
    const landRow = row + dr * 2;
    const landCol = col + dc * 2;
    if (!inBounds(landRow, landCol)) continue;
    const midIndex = idx(midRow, midCol);
    const landIndex = idx(landRow, landCol);
    const midColor = colorOf(boardCells[midIndex]);
    if (midColor && midColor !== color && boardCells[landIndex] === '.') {
      steps.push({ from: square, to: landIndex, captured: midIndex });
    }
  }
  return steps;
}

/** Apply a single capture step to a fresh board-cells copy, promoting if the
 *  landing square is a back rank. Returns the new cells + whether a promotion
 *  happened (which TERMINATES the jump chain per English rules). */
function applyStepToCells(
  cells: Cell[],
  step: MoveStep,
): { cells: Cell[]; promoted: boolean } {
  const next = cells.slice();
  const moving = next[step.from];
  next[step.from] = '.';
  if (step.captured !== null) next[step.captured] = '.';
  const crowned = maybePromote(moving, step.to);
  next[step.to] = crowned;
  return { cells: next, promoted: crowned !== moving };
}

/** Recursively enumerate every maximal jump sequence starting at `square` on
 *  `cells`. A freshly-crowned man stops (English rule). */
function enumerateJumpChains(
  cells: Cell[],
  square: number,
  pathSteps: MoveStep[],
): MoveStep[][] {
  const nextSteps = jumpsFrom(cells, square);
  if (nextSteps.length === 0) {
    return pathSteps.length > 0 ? [pathSteps] : [];
  }
  const chains: MoveStep[][] = [];
  for (const step of nextSteps) {
    const { cells: afterCells, promoted } = applyStepToCells(cells, step);
    const newPath = [...pathSteps, step];
    if (promoted) {
      // Crowned on this landing → the turn ends here, no further jumps.
      chains.push(newPath);
    } else {
      const deeper = enumerateJumpChains(afterCells, step.to, newPath);
      if (deeper.length === 0) chains.push(newPath);
      else chains.push(...deeper);
    }
  }
  return chains;
}

function buildMove(from: number, steps: MoveStep[]): Move {
  const isCapture = steps.some((s) => s.captured !== null);
  const to = steps[steps.length - 1].to;
  let notation: string;
  if (isCapture) {
    notation = squareName(from) + steps.map((s) => `x${squareName(s.to)}`).join('');
  } else {
    notation = `${squareName(from)}-${squareName(to)}`;
  }
  return { from, to, steps, isCapture, notation };
}

/** All legal moves for `turn` on `board`, enforcing the mandatory-capture rule:
 *  if ANY capture exists for the side to move, ONLY capture moves are returned. */
export function legalMoves(board: string, turn: CheckersColor): Move[] {
  const cells = boardToArray(board);
  const captureMoves: Move[] = [];
  const slideMoves: Move[] = [];

  for (let square = 0; square < cells.length; square++) {
    const cell = cells[square];
    if (colorOf(cell) !== turn) continue;

    // Captures (multi-jump chains).
    const chains = enumerateJumpChains(cells, square, []);
    for (const chain of chains) {
      captureMoves.push(buildMove(square, chain));
    }

    // Simple slides.
    const { row, col } = rc(square);
    for (const [dr, dc] of moveDirections(cell)) {
      const nr = row + dr;
      const nc = col + dc;
      if (!inBounds(nr, nc)) continue;
      const target = idx(nr, nc);
      if (cells[target] === '.') {
        slideMoves.push(buildMove(square, [{ from: square, to: target, captured: null }]));
      }
    }
  }

  // Mandatory capture: when captures exist, slides are not legal.
  return captureMoves.length > 0 ? captureMoves : slideMoves;
}

/** Legal moves originating from a specific square (for UI hints + the bot). */
export function legalMovesFrom(board: string, square: number, turn: CheckersColor): Move[] {
  return legalMoves(board, turn).filter((m) => m.from === square);
}

// ---------------------------------------------------------------------------
// Move parsing + application (server-authoritative)
// ---------------------------------------------------------------------------

/** Parse a move string into its origin + landing squares. Accepts:
 *    "c3-d4"          simple slide
 *    "c3xe5"          single jump
 *    "c3xe5xg7"       multi-jump (each landing square listed)
 *  Square tokens are file(a-h) + rank(1-8). Returns the list of square indices
 *  the piece visits (origin first). Throws on malformed input. */
function parseMoveString(move: string): number[] {
  if (typeof move !== 'string') {
    throw new Error(`Invalid move string: ${String(move)}`);
  }
  const trimmed = move.trim().toLowerCase();
  // Split on '-' (slide) or 'x' (jump) while keeping it simple: both separators
  // delimit square tokens.
  const tokens = trimmed.split(/[-x]/).filter((t) => t.length > 0);
  if (tokens.length < 2) {
    throw new Error(`Invalid move string: ${move}`);
  }
  const squares: number[] = [];
  for (const token of tokens) {
    if (!/^[a-h][1-8]$/.test(token)) {
      throw new Error(`Invalid move string: ${move}`);
    }
    const col = token.charCodeAt(0) - 'a'.charCodeAt(0);
    const rank = Number(token[1]);
    const row = BOARD_SIZE - rank; // inverse of squareName
    squares.push(idx(row, col));
  }
  return squares;
}

/** Validate + apply a move for `turn`. Enforces mandatory capture + full
 *  multi-jump + promotion. Throws `Illegal move: …` when the move is not in the
 *  legal set, and `Invalid move string: …` when it can't be parsed. */
export function applyMove(board: string, move: string, turn: CheckersColor): AppliedMoveResult {
  const visited = parseMoveString(move); // throws on malformed
  const from = visited[0];
  const to = visited[visited.length - 1];

  const candidates = legalMoves(board, turn);
  // Match by origin + the full ordered list of landing squares so that a
  // partial multi-jump (e.g. stopping early when more jumps are mandatory) is
  // rejected, and the exact capture path must be supplied.
  const match = candidates.find((m) => {
    if (m.from !== from || m.to !== to) return false;
    if (m.steps.length !== visited.length - 1) return false;
    for (let i = 0; i < m.steps.length; i++) {
      if (m.steps[i].to !== visited[i + 1]) return false;
    }
    return true;
  });

  if (!match) {
    // Give a clearer message when a capture was available but a slide/short
    // jump was attempted — this is the mandatory-capture rejection.
    const anyCapture = candidates.length > 0 && candidates[0].isCapture;
    if (anyCapture) {
      throw new Error('Illegal move: a capture is available and must be taken.');
    }
    throw new Error(`Illegal move: ${move}`);
  }

  const cells = boardToArray(board);
  let working = cells.slice();
  let promoted = false;
  for (const step of match.steps) {
    const result = applyStepToCells(working, step);
    working = result.cells;
    if (result.promoted) promoted = true;
  }

  return {
    board: arrayToBoard(working),
    moveNotation: match.notation,
    isCapture: match.isCapture,
    promoted,
    moverColor: turn,
  };
}

// ---------------------------------------------------------------------------
// Terminal detection
// ---------------------------------------------------------------------------

const otherColor = (c: CheckersColor): CheckersColor => (c === 'red' ? 'white' : 'red');

function hasPieces(board: string, color: CheckersColor): boolean {
  const cells = boardToArray(board);
  return cells.some((cell) => colorOf(cell) === color);
}

/**
 * Detect a terminal position. `turnToMove` is the side ABOUT to move on the
 * given board (i.e. AFTER the last move was applied, whose turn it now is).
 *
 *   • If the side to move has no pieces OR no legal move → they LOSE.
 *   • Optional draw by the 40-move rule (`noProgressPlies` counts plies since
 *     the last capture or crowning; 80 plies = 40 moves per side).
 */
export function detectGameEnd(
  board: string,
  turnToMove: CheckersColor,
  noProgressPlies = 0,
): GameEndResult {
  // 40-move draw (80 half-moves with no capture and no man crowned).
  if (noProgressPlies >= 80) {
    return { over: true, winnerColor: null, result: '1/2-1/2', reason: 'forty_move' };
  }

  const sideToMoveHasPieces = hasPieces(board, turnToMove);
  const sideToMoveMoves = legalMoves(board, turnToMove);

  if (!sideToMoveHasPieces || sideToMoveMoves.length === 0) {
    // The side to move is stuck → the OTHER side wins.
    const winnerColor = otherColor(turnToMove);
    return {
      over: true,
      winnerColor,
      result: winnerColor === 'red' ? '1-0' : '0-1',
      reason: 'no_moves',
    };
  }

  return { over: false };
}

// ---------------------------------------------------------------------------
// Misc helpers (parity with chess rules surface)
// ---------------------------------------------------------------------------

/** Which color is the given user in this match? Red is treated as "player A"
 *  / first mover (analogous to white in chess). */
export function colorForPlayer(
  match: { redId: string | null; whiteId: string | null },
  userId: string,
): CheckersColor | null {
  if (match.redId === userId) return 'red';
  if (match.whiteId === userId) return 'white';
  return null;
}

/** Convenience re-export so callers importing from the engine get the start
 *  position without reaching into types. */
export { STARTING_BOARD };

/** Count material for an evaluator / UI (men = 1, kings = 1.6-ish handled by
 *  the bot; here we just return raw counts). */
export function pieceCounts(board: string): {
  redMen: number; redKings: number; whiteMen: number; whiteKings: number;
} {
  const cells = boardToArray(board);
  let redMen = 0, redKings = 0, whiteMen = 0, whiteKings = 0;
  for (const cell of cells) {
    if (cell === 'r') redMen++;
    else if (cell === 'R') redKings++;
    else if (cell === 'w') whiteMen++;
    else if (cell === 'W') whiteKings++;
  }
  return { redMen, redKings, whiteMen, whiteKings };
}

/** Build an 8×8 grid view (row-major array of Cell) for the board renderer. */
export function boardToGrid(board: string): Cell[] {
  return boardToArray(board);
}

export { rc as squareToRowCol, idx as rowColToIndex, squareName, isKing };
