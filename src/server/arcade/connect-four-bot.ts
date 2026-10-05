// ---------------------------------------------------------------------------
// Connect Four — minimax / alpha-beta bot.
//
// Replaces the chess Stockfish-WASM wrapper with a pure synchronous search
// that exposes the SAME surface (BotDifficulty, BOT_NAMES, isBotUser,
// getBotUserId, computeBotMove) so `connect-four-match.ts`'s bot worker is
// unchanged. computeBotMove returns the chosen 0-based column.
//
// Board encoding matches src/features/arcade/lib/connect-four/rules.ts:
//   42-char string, row-major top row first, index = row*7 + col,
//   '.'=empty '1'=red(first) '2'=yellow.
// ---------------------------------------------------------------------------

import {
  C4_COLS,
  C4_ROWS,
  STARTING_BOARD,
  applyMove,
  findWinner,
  legalMovesFrom,
  type Color,
} from '@/features/arcade/lib/connect-four';

export type BotDifficulty = 'easy' | 'medium' | 'hard';

const BOT_USER_ID_PREFIX = 'bot:';
export const BOT_NAMES: Record<BotDifficulty, string> = {
  easy: 'Four Novice (Bot)',
  medium: 'Four Tactician (Bot)',
  hard: 'Four Grandmaster (Bot)',
};

export function isBotUser(userId: string): boolean {
  return userId.startsWith(BOT_USER_ID_PREFIX);
}

export function getBotUserId(difficulty: BotDifficulty): string {
  return `${BOT_USER_ID_PREFIX}${difficulty}`;
}

type DifficultyProfile = {
  /** Alpha-beta search depth (plies). */
  depth: number;
  /** Probability the bot plays a random legal move instead of the best one
   *  (only matters at easy, to give beginners a path to win). */
  randomness: number;
};

const DIFFICULTY: Record<BotDifficulty, DifficultyProfile> = {
  // Easy: shallow look-ahead + frequent random moves. Still takes immediate
  // wins / blocks immediate losses (those are checked before the random gate),
  // but otherwise plays loosely so a new player can beat it.
  easy: { depth: 1, randomness: 0.5 },
  // Medium: a solid 5-ply search, no randomness. Plays sound tactical Four.
  medium: { depth: 5, randomness: 0 },
  // Hard: 7-ply alpha-beta with center ordering — strong, rarely tactically
  // beatable; near-optimal in the midgame.
  hard: { depth: 7, randomness: 0 },
};

const WIN_SCORE = 1_000_000;

const cellFor = (color: Color): '1' | '2' => (color === 'red' ? '1' : '2');
const opposite = (color: Color): Color => (color === 'red' ? 'yellow' : 'red');

const idx = (row: number, col: number): number => row * C4_COLS + col;

/** Center-out column ordering improves alpha-beta pruning and biases play
 *  toward the strong central files. For width 7: [3,2,4,1,5,0,6]. */
const COLUMN_ORDER: number[] = (() => {
  const center = Math.floor(C4_COLS / 2);
  const order: number[] = [center];
  for (let offset = 1; offset <= center; offset++) {
    if (center - offset >= 0) order.push(center - offset);
    if (center + offset < C4_COLS) order.push(center + offset);
  }
  return order;
})();

/** Score a 4-cell window for `me`. Standard CF heuristic weights. */
function scoreWindow(cells: Array<'.' | '1' | '2'>, meCell: '1' | '2', oppCell: '1' | '2'): number {
  let mine = 0;
  let opp = 0;
  let empty = 0;
  for (const c of cells) {
    if (c === meCell) mine++;
    else if (c === oppCell) opp++;
    else empty++;
  }
  if (mine > 0 && opp > 0) return 0; // blocked window, no potential
  if (mine === 4) return 100;
  if (mine === 3 && empty === 1) return 8;
  if (mine === 2 && empty === 2) return 3;
  if (opp === 3 && empty === 1) return -10; // discourage letting opp reach 3
  if (opp === 2 && empty === 2) return -2;
  return 0;
}

/** Heuristic evaluation of a non-terminal board from `me`'s perspective. */
function evaluate(board: string, me: Color): number {
  const meCell = cellFor(me);
  const oppCell = cellFor(opposite(me));
  let score = 0;

  // Center column control.
  const centerCol = Math.floor(C4_COLS / 2);
  for (let row = 0; row < C4_ROWS; row++) {
    if (board[idx(row, centerCol)] === meCell) score += 3;
    else if (board[idx(row, centerCol)] === oppCell) score -= 3;
  }

  // Horizontal windows.
  for (let row = 0; row < C4_ROWS; row++) {
    for (let col = 0; col <= C4_COLS - 4; col++) {
      const w = [
        board[idx(row, col)],
        board[idx(row, col + 1)],
        board[idx(row, col + 2)],
        board[idx(row, col + 3)],
      ] as Array<'.' | '1' | '2'>;
      score += scoreWindow(w, meCell, oppCell);
    }
  }
  // Vertical windows.
  for (let col = 0; col < C4_COLS; col++) {
    for (let row = 0; row <= C4_ROWS - 4; row++) {
      const w = [
        board[idx(row, col)],
        board[idx(row + 1, col)],
        board[idx(row + 2, col)],
        board[idx(row + 3, col)],
      ] as Array<'.' | '1' | '2'>;
      score += scoreWindow(w, meCell, oppCell);
    }
  }
  // Diagonal ↘ windows.
  for (let row = 0; row <= C4_ROWS - 4; row++) {
    for (let col = 0; col <= C4_COLS - 4; col++) {
      const w = [
        board[idx(row, col)],
        board[idx(row + 1, col + 1)],
        board[idx(row + 2, col + 2)],
        board[idx(row + 3, col + 3)],
      ] as Array<'.' | '1' | '2'>;
      score += scoreWindow(w, meCell, oppCell);
    }
  }
  // Diagonal ↙ windows.
  for (let row = 0; row <= C4_ROWS - 4; row++) {
    for (let col = 3; col < C4_COLS; col++) {
      const w = [
        board[idx(row, col)],
        board[idx(row + 1, col - 1)],
        board[idx(row + 2, col - 2)],
        board[idx(row + 3, col - 3)],
      ] as Array<'.' | '1' | '2'>;
      score += scoreWindow(w, meCell, oppCell);
    }
  }

  return score;
}

/** Drop a disc for `turn` into `col`, returning the new board (no validation —
 *  caller guarantees the column is legal). */
function drop(board: string, col: number, turn: Color): string {
  return applyMove(board, col, turn).board;
}

/**
 * Alpha-beta negamax-style search. Returns the heuristic score of `board`
 * with `toMove` to play, from the perspective of `me`. `depth` is plies left.
 */
function search(
  board: string,
  depth: number,
  alpha: number,
  beta: number,
  toMove: Color,
  me: Color,
): number {
  const winner = findWinner(board);
  if (winner) {
    // Prefer faster wins / slower losses by folding remaining depth into score.
    return winner === me ? WIN_SCORE + depth : -WIN_SCORE - depth;
  }
  const moves = legalMovesFrom(board);
  if (moves.length === 0) return 0; // full board, draw
  if (depth === 0) return evaluate(board, me);

  // Order moves center-out for better pruning.
  const ordered = COLUMN_ORDER.filter((c) => moves.includes(c));

  if (toMove === me) {
    let best = -Infinity;
    for (const col of ordered) {
      const next = drop(board, col, toMove);
      const value = search(next, depth - 1, alpha, beta, opposite(toMove), me);
      if (value > best) best = value;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break; // beta cutoff
    }
    return best;
  }

  let best = Infinity;
  for (const col of ordered) {
    const next = drop(board, col, toMove);
    const value = search(next, depth - 1, alpha, beta, opposite(toMove), me);
    if (value < best) best = value;
    if (best < beta) beta = best;
    if (alpha >= beta) break; // alpha cutoff
  }
  return best;
}

/** Pick the column that immediately wins for `me`, if one exists. */
function immediateWin(board: string, me: Color): number | null {
  for (const col of legalMovesFrom(board)) {
    if (findWinner(drop(board, col, me))) return col;
  }
  return null;
}

/**
 * Compute the bot's move (a 0-based column) for the given board + difficulty.
 * Synchronous search wrapped in a resolved Promise so the surface matches the
 * async chess `computeBotMove`.
 */
export async function computeBotMove(board: string, difficulty: BotDifficulty): Promise<number> {
  const profile = DIFFICULTY[difficulty] ?? DIFFICULTY.medium;
  const me = botColorToMove(board);
  const legal = legalMovesFrom(board);
  if (legal.length === 0) {
    throw new Error('No legal moves: board is full.');
  }

  // Always take an immediate win, and always block the opponent's immediate
  // win — even on easy. These are checked before the randomness gate so the
  // bot never ignores a one-move loss, which feels broken rather than weak.
  const winNow = immediateWin(board, me);
  if (winNow !== null) return winNow;
  const blockNow = immediateWin(board, opposite(me));
  if (blockNow !== null) return blockNow;

  // Easy bots sometimes wander.
  if (profile.randomness > 0 && Math.random() < profile.randomness) {
    return legal[Math.floor(Math.random() * legal.length)];
  }

  // Full alpha-beta search; pick the best-scoring legal column (center-out
  // ordering breaks ties toward the middle).
  const ordered = COLUMN_ORDER.filter((c) => legal.includes(c));
  let bestCol = ordered[0];
  let bestScore = -Infinity;
  for (const col of ordered) {
    const next = drop(board, col, me);
    // If this move wins outright, take it (covered by immediateWin, but cheap).
    if (findWinner(next)) return col;
    const score = search(next, profile.depth - 1, -Infinity, Infinity, opposite(me), me);
    if (score > bestScore) {
      bestScore = score;
      bestCol = col;
    }
  }
  return bestCol;
}

/**
 * Whose turn is it on this board? Red ('1') always moves first, so red is to
 * move when the disc counts are equal, otherwise yellow.
 */
function botColorToMove(board: string): Color {
  let red = 0;
  let yellow = 0;
  for (const ch of board) {
    if (ch === '1') red++;
    else if (ch === '2') yellow++;
  }
  return red <= yellow ? 'red' : 'yellow';
}

// Re-export for tests / callers that want the empty board constant.
export { STARTING_BOARD };
