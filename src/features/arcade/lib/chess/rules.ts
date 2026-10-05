// ---------------------------------------------------------------------------
// Chess rules wrapper. Thin layer over chess.js for move validation, game-end
// detection, and position → board conversion. Used on both server and client.
// ---------------------------------------------------------------------------

import { Chess, type Square, type Move } from 'chess.js';
import type { ChessColor, GameResult, WinReason } from './types';

export type PieceCode =
  | 'wp' | 'wn' | 'wb' | 'wr' | 'wq' | 'wk'
  | 'bp' | 'bn' | 'bb' | 'br' | 'bq' | 'bk';

/** 8×8 board array ordered a8..h8, a7..h7, ..., a1..h1. Null = empty. */
type BoardPiece = { code: PieceCode; square: Square };
type BoardArray = (BoardPiece | null)[];

export type GameEndResult = {
  over: true;
  winnerColor: ChessColor | null;
  result: GameResult;
  reason: WinReason;
} | { over: false };

type AppliedMoveResult = {
  uci: string;
  san: string;
  fenAfter: string;
  capture: boolean;
  check: boolean;
  checkmate: boolean;
  isPromotion: boolean;
  promotion: 'q' | 'r' | 'b' | 'n' | null;
  moverColor: ChessColor;
};

/** Build a Chess engine from a FEN. Throws if invalid. */
function loadFen(fen: string): Chess {
  return new Chess(fen);
}

/**
 * If the side-to-move is in check, return the square their king stands on
 * (for UI highlight). Returns null otherwise.
 */
export function kingInCheckSquare(fen: string): Square | null {
  try {
    const game = loadFen(fen);
    if (!game.inCheck()) return null;
    const turn = game.turn(); // 'w' or 'b'
    const board = game.board();
    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        const cell = board[r]?.[f];
        if (cell && cell.type === 'k' && cell.color === turn) {
          return (FILES_ARR[f] + (8 - r)) as Square;
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}

const FILES_ARR = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const;

/** Apply a UCI move (e.g., e2e4, e7e8q). Throws if illegal. */
export function applyUciMove(fen: string, uci: string): AppliedMoveResult {
  const game = loadFen(fen);
  const parsed = parseUci(uci);
  if (!parsed) throw new Error(`Invalid UCI string: ${uci}`);

  const moverColor: ChessColor = game.turn() === 'w' ? 'white' : 'black';
  const move: Move | null = game.move({
    from: parsed.from,
    to: parsed.to,
    promotion: parsed.promotion ?? undefined,
  });

  if (!move) throw new Error(`Illegal move: ${uci}`);

  return {
    uci,
    san: move.san,
    fenAfter: game.fen(),
    capture: Boolean(move.captured),
    check: game.inCheck(),
    checkmate: game.isCheckmate(),
    isPromotion: Boolean(move.promotion),
    promotion: (move.promotion as 'q' | 'r' | 'b' | 'n' | undefined) ?? null,
    moverColor,
  };
}

/** Parse a UCI move string. */
export function parseUci(uci: string): { from: Square; to: Square; promotion?: 'q' | 'r' | 'b' | 'n' } | null {
  if (typeof uci !== 'string') return null;
  const trimmed = uci.trim().toLowerCase();
  if (trimmed.length < 4 || trimmed.length > 5) return null;
  const from = trimmed.slice(0, 2);
  const to = trimmed.slice(2, 4);
  const promo = trimmed.slice(4, 5);
  if (!isSquare(from) || !isSquare(to)) return null;
  if (promo && !'qrbn'.includes(promo)) return null;
  return {
    from: from as Square,
    to: to as Square,
    promotion: promo ? (promo as 'q' | 'r' | 'b' | 'n') : undefined,
  };
}

function isSquare(s: string): boolean {
  return /^[a-h][1-8]$/.test(s);
}

/** Legal moves from a given square (for click-to-move UI hints). */
export function legalMovesFrom(fen: string, square: Square): Move[] {
  const game = loadFen(fen);
  return game.moves({ square, verbose: true }) as Move[];
}

/** Evaluate if the position is terminal.
 *
 * Pass `history` (prior UCI moves from STARTING_FEN through the move that
 * produced `fen`) so chess.js can correctly detect threefold repetition —
 * `isThreefoldRepetition()` only works when the instance has been driven
 * through those positions, not when loaded fresh from a FEN. Without history
 * we skip threefold detection rather than false-negatively claim "no draw."
 */
export function detectGameEnd(fen: string, history?: string[]): GameEndResult {
  const game = loadFen(fen);
  const moverColor: ChessColor = game.turn() === 'w' ? 'white' : 'black';

  if (game.isCheckmate()) {
    // Side to move is mated → opposite color wins.
    const winnerColor: ChessColor = moverColor === 'white' ? 'black' : 'white';
    return {
      over: true,
      winnerColor,
      result: winnerColor === 'white' ? '1-0' : '0-1',
      reason: 'checkmate',
    };
  }
  if (game.isStalemate()) {
    return { over: true, winnerColor: null, result: '1/2-1/2', reason: 'stalemate' };
  }
  if (game.isInsufficientMaterial()) {
    return { over: true, winnerColor: null, result: '1/2-1/2', reason: 'insufficient_material' };
  }
  if (history && history.length > 0 && detectThreefoldRepetition(history)) {
    return { over: true, winnerColor: null, result: '1/2-1/2', reason: 'threefold' };
  }
  // Draw by 50-move rule (chess.js reports as draw when halfmove >= 100).
  const halfmoves = Number(fen.split(' ')[4] ?? '0');
  if (halfmoves >= 100) {
    return { over: true, winnerColor: null, result: '1/2-1/2', reason: 'fifty_move' };
  }
  return { over: false };
}

/**
 * FIDE 6.9: on a flag-fall, the game is a loss for the flagging side *only*
 * if the opponent can possibly mate with the material they still have; a
 * lone king (K, K+N, K+B, K+NN, K + 2 same-colored B) can't deliver mate
 * even with opponent cooperation, so the position should draw instead.
 *
 * Returns true if the given color has enough material to deliver checkmate
 * against a lone king under best cooperation (the FIDE bar, which is lower
 * than "forced mate" — 3 knights is theoretically sufficient even though
 * it requires opponent errors).
 */
export function hasMatingMaterialFor(fen: string, color: ChessColor): boolean {
  const game = loadFen(fen);
  const board = game.board();
  const target = color === 'white' ? 'w' : 'b';
  const other = color === 'white' ? 'b' : 'w';

  let pawns = 0;
  let knights = 0;
  let rooks = 0;
  let queens = 0;
  let bishopsLight = 0;
  let bishopsDark = 0;
  let opponentNonKing = 0;

  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const sq = board[r][f];
      if (!sq) continue;
      if (sq.color === other) {
        if (sq.type !== 'k') opponentNonKing++;
        continue;
      }
      if (sq.color !== target) continue;
      switch (sq.type) {
        case 'p': pawns++; break;
        case 'n': knights++; break;
        case 'r': rooks++; break;
        case 'q': queens++; break;
        case 'b':
          // chess.js indexes board[0] as rank 8; a8 (r=0,f=0) is a light
          // square, so (r+f) % 2 === 0 is light.
          if ((r + f) % 2 === 0) bishopsLight++;
          else bishopsDark++;
          break;
        default: break; // king doesn't count
      }
    }
  }

  // Any of these alone suffices: pawns promote; Q/R mate lone K.
  if (pawns > 0 || queens > 0 || rooks > 0) return true;
  // Bishops on both colors OR bishop+knight can mate lone K.
  if (bishopsLight > 0 && bishopsDark > 0) return true;
  if ((bishopsLight + bishopsDark) > 0 && knights > 0) return true;
  // Three or more knights can mate under cooperation.
  if (knights >= 3) return true;
  // Two knights can force mate against K + any other piece (Troitsky
  // line); the opponent's extra material breaks the stalemate that
  // defeats KNN-vs-K. Against a lone king it's a draw, so require any
  // non-king material on the opposing side.
  if (knights >= 2 && opponentNonKing > 0) return true;
  return false;
}

/** Replay UCI history from the initial position and ask chess.js whether the
 * resulting state has seen the same position 3× — the only reliable way to
 * surface this rule since a FEN alone doesn't carry position history.
 * Returns false on any replay error rather than claiming a phantom draw. */
function detectThreefoldRepetition(history: string[]): boolean {
  try {
    const game = new Chess();
    for (const uci of history) {
      const from = uci.slice(0, 2);
      const to = uci.slice(2, 4);
      const promo = uci.slice(4, 5) || undefined;
      const result = game.move({ from, to, promotion: promo as 'q' | 'r' | 'b' | 'n' | undefined });
      if (!result) return false;
    }
    return game.isThreefoldRepetition();
  } catch {
    return false;
  }
}

/**
 * Turn a FEN into an 8×8 piece array.
 * Order: indexes 0..63 map to a8..h8, a7..h7, ..., a1..h1 (reading ranks top→bottom,
 * files left→right). This matches typical UI rendering from white's perspective.
 */
export function fenToBoard(fen: string): BoardArray {
  const rows = fen.split(' ')[0]?.split('/') ?? [];
  const board: BoardArray = Array(64).fill(null);
  const files: readonly string[] = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  for (let r = 0; r < 8; r++) {
    const rankStr = rows[r] ?? '';
    let fileIdx = 0;
    for (const ch of rankStr) {
      if (/[1-8]/.test(ch)) {
        fileIdx += Number(ch);
        continue;
      }
      const color = ch === ch.toUpperCase() ? 'w' : 'b';
      const piece = ch.toLowerCase() as 'p' | 'n' | 'b' | 'r' | 'q' | 'k';
      const square = (files[fileIdx] + (8 - r)) as Square;
      board[r * 8 + fileIdx] = { code: `${color}${piece}` as PieceCode, square };
      fileIdx++;
    }
  }
  return board;
}

/** Inverse: which color is the given user? */
export function colorForPlayer(match: {
  whiteId: string | null;
  blackId: string | null;
}, userId: string): ChessColor | null {
  if (match.whiteId === userId) return 'white';
  if (match.blackId === userId) return 'black';
  return null;
}
