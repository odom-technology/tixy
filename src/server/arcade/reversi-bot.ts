// ---------------------------------------------------------------------------
// Reversi/Othello — minimax / alpha-beta bot.
//
// Pure synchronous search exposing the surface the match bot worker uses:
//   BotDifficulty, BOT_NAMES, isBotUser, getBotUserId, botDifficultyFromId,
//   computeBotMove(board, color, difficulty) -> chosen 0-63 cell index.
//
// Board encoding matches the engine: 64-char string, index = row*8 + col,
// '.'=empty 'B'=black(first) 'W'=white.
//
// Bot user ids are namespaced 'bot:reversi-<difficulty>' so they never collide
// with another game's bots (Connect Four uses 'bot:<difficulty>').
// ---------------------------------------------------------------------------

import {
  applyMove,
  legalMoves,
  hasAnyMove,
  detectGameEnd,
  countDiscs,
  opposite,
  type Color,
} from '@/features/arcade/lib/reversi';

export type BotDifficulty = 'easy' | 'medium' | 'hard';

const BOT_USER_ID_PREFIX = 'bot:';
const BOT_USER_ID_GAME = 'bot:reversi-';

export const BOT_NAMES: Record<BotDifficulty, string> = {
  easy: 'Reversi Novice (Bot)',
  medium: 'Reversi Tactician (Bot)',
  hard: 'Reversi Grandmaster (Bot)',
};

export function isBotUser(userId: string): boolean {
  return userId.startsWith(BOT_USER_ID_PREFIX);
}

export function getBotUserId(difficulty: BotDifficulty): string {
  return `${BOT_USER_ID_GAME}${difficulty}`;
}

/** Parse the difficulty out of a 'bot:reversi-<difficulty>' id, or null. */
export function botDifficultyFromId(userId: string): BotDifficulty | null {
  if (!userId.startsWith(BOT_USER_ID_GAME)) return null;
  const tier = userId.slice(BOT_USER_ID_GAME.length);
  return tier === 'easy' || tier === 'medium' || tier === 'hard' ? tier : null;
}

type DifficultyProfile = {
  /** Alpha-beta search depth (plies). */
  depth: number;
  /** Probability the bot plays a random legal move instead of the best one. */
  randomness: number;
};

const DIFFICULTY: Record<BotDifficulty, DifficultyProfile> = {
  // Easy: shallow + frequent random moves so a beginner can win.
  easy: { depth: 1, randomness: 0.55 },
  // Medium: a solid 3-ply search with no randomness.
  medium: { depth: 3, randomness: 0 },
  // Hard: a deep 6-ply alpha-beta with positional weights + mobility.
  hard: { depth: 6, randomness: 0 },
};

const WIN_SCORE = 1_000_000;

/**
 * Positional weight table (8×8). Corners are gold; the cells diagonally /
 * orthogonally adjacent to a corner (X-squares / C-squares) are penalised
 * because they tend to hand the corner to the opponent.
 */
const POSITION_WEIGHTS: number[] = [
  120, -20,  20,   5,   5,  20, -20, 120,
  -20, -40,  -5,  -5,  -5,  -5, -40, -20,
   20,  -5,  15,   3,   3,  15,  -5,  20,
    5,  -5,   3,   3,   3,   3,  -5,   5,
    5,  -5,   3,   3,   3,   3,  -5,   5,
   20,  -5,  15,   3,   3,  15,  -5,  20,
  -20, -40,  -5,  -5,  -5,  -5, -40, -20,
  120, -20,  20,   5,   5,  20, -20, 120,
];

const cellFor = (color: Color): 'B' | 'W' => (color === 'black' ? 'B' : 'W');

/**
 * Heuristic evaluation of a non-terminal board from `me`'s perspective. Blends
 * positional weights, disc differential (lightly), and mobility.
 */
function evaluate(board: string, me: Color): number {
  const meCell = cellFor(me);
  const oppCell = cellFor(opposite(me));

  let positional = 0;
  for (let i = 0; i < 64; i++) {
    const ch = board[i];
    if (ch === meCell) positional += POSITION_WEIGHTS[i];
    else if (ch === oppCell) positional -= POSITION_WEIGHTS[i];
  }

  const { black, white } = countDiscs(board);
  const myDiscs = me === 'black' ? black : white;
  const oppDiscs = me === 'black' ? white : black;
  const discDiff = myDiscs - oppDiscs;

  const myMoves = legalMoves(board, me).length;
  const oppMoves = legalMoves(board, opposite(me)).length;
  const mobility =
    myMoves + oppMoves > 0
      ? (100 * (myMoves - oppMoves)) / (myMoves + oppMoves)
      : 0;

  // Positional dominates the midgame; mobility keeps options open; a small disc
  // term nudges toward the right side of an even position.
  return positional + 8 * mobility + discDiff;
}

/**
 * Alpha-beta search. Returns the heuristic score of `board` with `toMove` to
 * play, from the perspective of `me`. Handles Reversi passes: if `toMove` has no
 * move but the opponent does, the turn passes without consuming depth credit for
 * a real move.
 */
function search(
  board: string,
  depth: number,
  alpha: number,
  beta: number,
  toMove: Color,
  me: Color,
): number {
  const end = detectGameEnd(board);
  if (end.over) {
    const { black, white } = countDiscs(board);
    const myDiscs = me === 'black' ? black : white;
    const oppDiscs = me === 'black' ? white : black;
    if (myDiscs > oppDiscs) return WIN_SCORE + (myDiscs - oppDiscs);
    if (myDiscs < oppDiscs) return -WIN_SCORE - (oppDiscs - myDiscs);
    return 0;
  }
  if (depth === 0) return evaluate(board, me);

  const moves = legalMoves(board, toMove);
  if (moves.length === 0) {
    // Pass — opponent plays (not terminal, since detectGameEnd was false).
    return search(board, depth, alpha, beta, opposite(toMove), me);
  }

  if (toMove === me) {
    let best = -Infinity;
    for (const cell of moves) {
      const next = applyMove(board, cell, toMove).board;
      const value = search(next, depth - 1, alpha, beta, opposite(toMove), me);
      if (value > best) best = value;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;
    }
    return best;
  }

  let best = Infinity;
  for (const cell of moves) {
    const next = applyMove(board, cell, toMove).board;
    const value = search(next, depth - 1, alpha, beta, opposite(toMove), me);
    if (value < best) best = value;
    if (best < beta) beta = best;
    if (alpha >= beta) break;
  }
  return best;
}

/**
 * Compute the bot's move (a 0-63 cell index) for the given board + color +
 * difficulty. Synchronous search wrapped in a resolved Promise so the surface
 * matches the async Connect Four `computeBotMove`.
 */
export async function computeBotMove(
  board: string,
  color: Color,
  difficulty: BotDifficulty,
): Promise<number> {
  const profile = DIFFICULTY[difficulty] ?? DIFFICULTY.medium;
  const legal = legalMoves(board, color);
  if (legal.length === 0) {
    throw new Error('No legal moves for the bot.');
  }
  if (legal.length === 1) return legal[0];

  // Easy bots often wander; otherwise still bias toward grabbing corners.
  if (profile.randomness > 0 && Math.random() < profile.randomness) {
    return legal[Math.floor(Math.random() * legal.length)];
  }

  // Order moves by positional weight (corners first) for better pruning.
  const ordered = [...legal].sort((a, b) => POSITION_WEIGHTS[b] - POSITION_WEIGHTS[a]);

  let bestCell = ordered[0];
  let bestScore = -Infinity;
  for (const cell of ordered) {
    const next = applyMove(board, cell, color).board;
    const score = search(next, profile.depth - 1, -Infinity, Infinity, opposite(color), color);
    if (score > bestScore) {
      bestScore = score;
      bestCell = cell;
    }
  }
  return bestCell;
}

// Re-export for callers that want them.
export { hasAnyMove };
