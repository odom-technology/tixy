/** Versioned, deterministic rules shared by the browser and server replay. */
export const RULES_VERSION = 1;
export const SIZE = 3;
export const CELLS = SIZE * SIZE;
export const MAX_MOVES = 24;

export function toggleCell(board: boolean[], index: number): boolean[] {
  if (board.length !== CELLS || !Array.from(board).every((cell) => typeof cell === 'boolean')) {
    throw new Error('A board must contain nine lights.');
  }
  if (!Number.isInteger(index) || index < 0 || index >= CELLS) throw new Error('Choose a cell from 0 to 8.');
  const next = [...board];
  const row = Math.floor(index / SIZE);
  const column = index % SIZE;
  for (const [dr, dc] of [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]]) {
    const r = row + dr;
    const c = column + dc;
    if (r >= 0 && r < SIZE && c >= 0 && c < SIZE) next[r * SIZE + c] = !next[r * SIZE + c];
  }
  return next;
}

export function createBoard(seed: number): boolean[] {
  if (!Number.isInteger(seed) || seed < 0 || seed >= 2 ** 31) throw new Error('Invalid puzzle seed.');
  let board = Array<boolean>(CELLS).fill(false);
  let state = seed;
  // Scramble the solved board by legal moves: every puzzle remains solvable.
  for (let cell = 0; cell < CELLS; cell++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    if (state >>> 31) board = toggleCell(board, cell);
  }
  if (!board.some(Boolean)) board = toggleCell(board, seed % CELLS);
  return board;
}

export function readMoves(value: unknown): number[] {
  if (!Array.isArray(value) || value.length > MAX_MOVES) throw new Error(`Submit at most ${MAX_MOVES} moves.`);
  const moves = Array.from(value);
  if (!moves.every((move) => Number.isInteger(move) && move >= 0 && move < CELLS)) {
    throw new Error('Each move must be a cell index from 0 to 8.');
  }
  return moves;
}

export function replayLights(seed: number, value: unknown): { score: number; solved: boolean; moves: number; board: boolean[] } {
  const moves = readMoves(value);
  let board = createBoard(seed);
  for (const move of moves) {
    if (!board.some(Boolean)) throw new Error('A solved puzzle cannot contain extra moves.');
    board = toggleCell(board, move);
  }
  const solved = !board.some(Boolean);
  if (!solved && moves.length < MAX_MOVES) throw new Error('Finish the puzzle or use all 24 moves before submitting.');
  return { score: solved ? 1000 - 25 * (moves.length - 1) : 0, solved, moves: moves.length, board };
}
