// ---------------------------------------------------------------------------
// Checkers — minimax / alpha-beta bot.
//
// Replaces the Stockfish-WASM wrapper used by chess with a pure, synchronous
// minimax search wrapped in a resolved Promise, so it exposes the SAME surface
// `checkers-match.ts`'s bot worker expects:
//   BotDifficulty, BOT_NAMES, isBotUser(id), getBotUserId(diff),
//   computeBotMove(board, difficulty): Promise<moveNotation>
//
// The evaluator is capture-aware (material dominates, kings weighted higher),
// with small positional terms (advancement toward kinging, back-rank defense,
// centre control, mobility) so the bot prefers winning material and avoids
// hanging a piece for free when it can. Search depth scales with difficulty;
// easy plays shallow with randomness so a new player can win.
// ---------------------------------------------------------------------------

import {
  legalMoves,
  applyMove,
  detectGameEnd,
  pieceCounts,
  type CheckersColor,
  type Move,
} from '@/features/arcade/lib/checkers';

export type BotDifficulty = 'easy' | 'medium' | 'hard';

const BOT_USER_ID_PREFIX = 'bot:';
export const BOT_NAMES: Record<BotDifficulty, string> = {
  easy: 'Checkers Novice (Bot)',
  medium: 'Checkers Sharp (Bot)',
  hard: 'Checkers Master (Bot)',
};

export function isBotUser(userId: string): boolean {
  return userId.startsWith(BOT_USER_ID_PREFIX);
}

export function getBotUserId(difficulty: BotDifficulty): string {
  return `${BOT_USER_ID_PREFIX}${difficulty}`;
}

type DifficultyProfile = {
  /** Search depth (plies). */
  depth: number;
  /** Probability of picking a random legal move instead of the best one. */
  randomness: number;
};

const DIFFICULTY: Record<BotDifficulty, DifficultyProfile> = {
  // Easy: shallow look-ahead + frequent random moves so a beginner can win.
  // Still respects mandatory captures (those are the only legal moves then).
  easy:   { depth: 2, randomness: 0.5 },
  // Medium: solid club-level search.
  medium: { depth: 6, randomness: 0.06 },
  // Hard: deep search, effectively no random noise.
  hard:   { depth: 9, randomness: 0 },
};

// ---------------------------------------------------------------------------
// Evaluation — from RED's perspective (positive favours red). The search
// negates as it alternates sides.
// ---------------------------------------------------------------------------

const MAN_VALUE = 100;
const KING_VALUE = 175;
const ADVANCE_BONUS = 6;      // per row of forward progress toward kinging
const BACK_RANK_BONUS = 14;   // keeping back-rank men makes you hard to king
const CENTRE_BONUS = 4;       // central control
const MOBILITY_BONUS = 2;     // per available move
const WIN_SCORE = 1_000_000;

const BOARD_SIZE = 8;

function evaluate(board: string, sideJustMovedIsRed: boolean): number {
  const { redMen, redKings, whiteMen, whiteKings } = pieceCounts(board);

  // Terminal short-circuit: if the side to move next has no move, that's a loss
  // for them. `sideJustMovedIsRed` tells us who moved; the other is to move.
  const sideToMove: CheckersColor = sideJustMovedIsRed ? 'white' : 'red';
  if (redMen + redKings === 0) return -WIN_SCORE;
  if (whiteMen + whiteKings === 0) return WIN_SCORE;

  let score = 0;
  score += (redMen - whiteMen) * MAN_VALUE;
  score += (redKings - whiteKings) * KING_VALUE;

  // Positional terms.
  for (let i = 0; i < BOARD_SIZE * BOARD_SIZE; i++) {
    const cell = board[i];
    if (cell === '.') continue;
    const row = Math.floor(i / BOARD_SIZE);
    const col = i % BOARD_SIZE;
    const centreCol = col >= 2 && col <= 5 ? CENTRE_BONUS : 0;

    if (cell === 'r') {
      // red advances UP (row decreasing): progress = (7 - row)
      score += (BOARD_SIZE - 1 - row) * ADVANCE_BONUS;
      if (row === BOARD_SIZE - 1) score += BACK_RANK_BONUS;
      score += centreCol;
    } else if (cell === 'w') {
      score -= row * ADVANCE_BONUS;
      if (row === 0) score -= BACK_RANK_BONUS;
      score -= centreCol;
    } else if (cell === 'R') {
      score += centreCol;
    } else if (cell === 'W') {
      score -= centreCol;
    }
  }

  // Mobility for the side to move (a stuck side is in trouble).
  const stmMoves = legalMoves(board, sideToMove).length;
  score += (sideToMove === 'red' ? 1 : -1) * stmMoves * MOBILITY_BONUS;

  return score;
}

// ---------------------------------------------------------------------------
// Alpha-beta negamax. Returns a score from RED's perspective.
// ---------------------------------------------------------------------------

function search(
  board: string,
  turn: CheckersColor,
  depth: number,
  alpha: number,
  beta: number,
  noProgressPlies: number,
): number {
  const end = detectGameEnd(board, turn, noProgressPlies);
  if (end.over) {
    if (end.winnerColor === null) return 0; // draw
    return end.winnerColor === 'red' ? WIN_SCORE - (10 - depth) : -WIN_SCORE + (10 - depth);
  }
  if (depth <= 0) {
    return evaluate(board, turn === 'white');
  }

  const moves = orderMoves(legalMoves(board, turn));
  const maximizing = turn === 'red';
  let best = maximizing ? -Infinity : Infinity;

  for (const move of moves) {
    const applied = applyMove(board, move.notation, turn);
    const nextNoProgress = applied.isCapture || applied.promoted ? 0 : noProgressPlies + 1;
    const value = search(
      applied.board,
      turn === 'red' ? 'white' : 'red',
      depth - 1,
      alpha,
      beta,
      nextNoProgress,
    );
    if (maximizing) {
      if (value > best) best = value;
      if (best > alpha) alpha = best;
    } else {
      if (value < best) best = value;
      if (best < beta) beta = best;
    }
    if (beta <= alpha) break; // prune
  }

  return best;
}

/** Move ordering: try captures first (and longer captures before shorter) to
 *  improve alpha-beta pruning. */
function orderMoves(moves: Move[]): Move[] {
  return [...moves].sort((a, b) => {
    if (a.isCapture !== b.isCapture) return a.isCapture ? -1 : 1;
    return b.steps.length - a.steps.length;
  });
}

// ---------------------------------------------------------------------------
// Public: compute the bot's move for the given board + difficulty.
// The board's side to move is inferred from `currentTurn` upstream, but the
// bot is colour-agnostic: it's told its colour via the match (the match module
// passes the board and we evaluate for whichever side is to move). Since the
// match always calls this on the bot's turn, we determine the bot's colour from
// the board parity is NOT possible — so the match passes the colour implicitly
// by only calling when it's the bot's turn. We therefore search for the side
// that has a legal move; the match guarantees that's the bot.
// ---------------------------------------------------------------------------

/**
 * Compute the bot's move. `turn` is the colour the bot is playing (the side to
 * move on `board`). Returns the move NOTATION string (e.g. "c3-d4" or
 * "c3xe5xg7") in the exact form `applyMove` + the move route expect.
 */
export async function computeBotMove(
  board: string,
  difficulty: BotDifficulty,
  turn: CheckersColor,
): Promise<string> {
  const profile = DIFFICULTY[difficulty];
  const moves = orderMoves(legalMoves(board, turn));

  if (moves.length === 0) {
    // Shouldn't happen (caller only invokes on the bot's turn with moves), but
    // guard so we never throw into the fire-and-forget worker.
    throw new Error('No legal moves for bot.');
  }
  if (moves.length === 1) return moves[0].notation;

  // Easy bot: frequently pick a random legal move so beginners can win.
  if (profile.randomness > 0 && Math.random() < profile.randomness) {
    const pick = moves[Math.floor(Math.random() * moves.length)];
    return pick.notation;
  }

  const maximizing = turn === 'red';
  let bestMove = moves[0];
  let bestScore = maximizing ? -Infinity : Infinity;

  for (const move of moves) {
    const applied = applyMove(board, move.notation, turn);
    const nextNoProgress = applied.isCapture || applied.promoted ? 0 : 1;
    const score = search(
      applied.board,
      turn === 'red' ? 'white' : 'red',
      profile.depth - 1,
      -Infinity,
      Infinity,
      nextNoProgress,
    );
    if (maximizing ? score > bestScore : score < bestScore) {
      bestScore = score;
      bestMove = move;
    }
  }

  return bestMove.notation;
}
