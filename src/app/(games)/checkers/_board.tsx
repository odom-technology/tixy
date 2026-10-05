'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  legalMoves,
  rowColToIndex,
  colorOf,
  type CheckersColor,
  type Move,
  type Cell,
} from '@/features/arcade/lib/checkers';
import { playMoveSound } from './_sounds';
import {
  DEFAULT_CHECKERS_THEME,
  checkersThemeVars,
  type CheckersCosmeticTheme,
} from './_checkers-theme';
import './_checkers.css';

const BOARD_SIZE = 8;

type Props = {
  board: string;
  /** Orientation: which colour sits at the bottom for the local viewer. */
  orientation: CheckersColor;
  /** The colour the local player controls. `null` = spectator (no interaction). */
  myColor: CheckersColor | null;
  /** Whether it's this player's turn to move right now. */
  isMyTurn: boolean;
  /** Notation of the last move played (for highlight), e.g. "c3xe5". */
  lastMove: string | null;
  /** Called when the player commits a full legal move (notation string). */
  onMove: (notation: string) => void;
  /** True while waiting on the server to confirm; disables new input. */
  submitting?: boolean;
  /** If false, the match has ended and input is ignored. */
  interactive?: boolean;
  /** Apply a slight desaturation/dim when the game has ended. */
  dim?: boolean;
  /** Equipped cosmetics; defaults to the unchanged Midway look. */
  theme?: CheckersCosmeticTheme;
};

/** Parse a move notation into the ordered list of squares it visits. */
function notationToSquares(notation: string): number[] {
  const tokens = notation.trim().toLowerCase().split(/[-x]/).filter(Boolean);
  const out: number[] = [];
  for (const t of tokens) {
    if (!/^[a-h][1-8]$/.test(t)) continue;
    const col = t.charCodeAt(0) - 'a'.charCodeAt(0);
    const rank = Number(t[1]);
    out.push(rowColToIndex(BOARD_SIZE - rank, col));
  }
  return out;
}

/** Render an 8×8 lacquered draughts board with click-to-move + mandatory
 *  captures + multi-jump chaining (click each landing square in turn). */
export function CheckersBoard({
  board,
  orientation,
  myColor,
  isMyTurn,
  lastMove,
  onMove,
  submitting = false,
  interactive = true,
  dim = false,
  theme = DEFAULT_CHECKERS_THEME,
}: Props) {
  const cells = useMemo(() => board.split('') as Cell[], [board]);
  const themeVars = useMemo(() => checkersThemeVars(theme), [theme]);

  // Selection + in-progress multi-jump path. `pathSquares` holds the squares
  // visited so far in the current move (origin first). `pendingCaptures`
  // tracks captured-square indices so we can grey them out mid-chain.
  const [selected, setSelected] = useState<number | null>(null);
  const [pathSquares, setPathSquares] = useState<number[]>([]);

  const allMoves = useMemo(
    () => (myColor ? legalMoves(board, myColor) : []),
    [board, myColor],
  );
  const mustCapture = allMoves.length > 0 && allMoves[0].isCapture;
  // True once the player has begun a jump but the chain isn't committed yet
  // (a landing square with further jumps available has been clicked).
  const chainInProgress = pathSquares.length >= 2;

  // Reset selection whenever the position changes (remote move landed, etc.).
  useEffect(() => {
    setSelected(null);
    setPathSquares([]);
  }, [board]);

  const lastMoveSquares = useMemo(() => {
    if (!lastMove) return new Set<number>();
    return new Set(notationToSquares(lastMove));
  }, [lastMove]);

  // Moves available from the currently-selected origin, filtered to those whose
  // path so far matches what the user has clicked (for multi-jump chaining).
  const candidateMoves: Move[] = useMemo(() => {
    if (selected === null) return [];
    return allMoves.filter((m) => {
      if (m.from !== selected) return false;
      // The visited prefix must match the chosen path so far.
      const visited = [m.from, ...m.steps.map((s) => s.to)];
      for (let i = 0; i < pathSquares.length; i++) {
        if (visited[i] !== pathSquares[i]) return false;
      }
      return true;
    });
  }, [allMoves, selected, pathSquares]);

  // The set of squares the player can click NEXT, mapped to the move(s) they'd
  // (partially) commit. For a slide, clicking the target commits immediately.
  // For a jump, clicking the next landing either commits (if it's the final
  // step) or extends the path.
  const nextTargets = useMemo(() => {
    const map = new Map<number, { commit: Move | null; extend: boolean }>();
    const depth = pathSquares.length - 1; // pathSquares includes the origin; 0 steps taken = need first step
    for (const m of candidateMoves) {
      const visited = [m.from, ...m.steps.map((s) => s.to)];
      const next = visited[depth + 1];
      if (next === undefined) continue;
      const isFinal = depth + 1 === m.steps.length;
      const existing = map.get(next);
      if (isFinal) {
        map.set(next, { commit: m, extend: existing?.extend ?? false });
      } else if (!existing) {
        map.set(next, { commit: null, extend: true });
      }
    }
    return map;
  }, [candidateMoves, pathSquares]);

  function selectSquare(index: number) {
    const cell = cells[index];
    if (colorOf(cell) !== myColor) return;
    // Don't allow selecting a piece that has no legal move (e.g. when another
    // piece is forced to capture).
    const has = allMoves.some((m) => m.from === index);
    if (!has) return;
    setSelected(index);
    setPathSquares([index]);
    playMoveSound('select');
  }

  function onSquareClick(index: number) {
    if (!interactive || submitting || !myColor || !isMyTurn) return;

    // Clicking a target square.
    if (selected !== null) {
      const target = nextTargets.get(index);
      if (target) {
        if (target.commit) {
          onMove(target.commit.notation);
          setSelected(null);
          setPathSquares([]);
          return;
        }
        // Extend the multi-jump path.
        setPathSquares((prev) => [...prev, index]);
        return;
      }
      // Clicking the selected piece again deselects.
      if (index === selected && pathSquares.length <= 1) {
        setSelected(null);
        setPathSquares([]);
        return;
      }
    }

    // Otherwise (re)select an own piece.
    if (colorOf(cells[index]) === myColor) {
      selectSquare(index);
    }
  }

  // Current head of the in-progress chain (where the next click lands from).
  const chainHead = pathSquares.length > 0 ? pathSquares[pathSquares.length - 1] : selected;

  // Squares captured so far in the in-progress chain (greyed out preview).
  const inChainCaptured = useMemo(() => {
    const set = new Set<number>();
    if (selected === null || pathSquares.length < 2) return set;
    // Find a candidate move whose visited prefix matches the path, then mark
    // its captured squares up to the current depth.
    const m = candidateMoves[0];
    if (!m) return set;
    for (let i = 0; i < pathSquares.length - 1; i++) {
      const step = m.steps[i];
      if (step?.captured != null) set.add(step.captured);
    }
    return set;
  }, [candidateMoves, pathSquares, selected]);

  const rowIndices = orientation === 'red' ? [0, 1, 2, 3, 4, 5, 6, 7] : [7, 6, 5, 4, 3, 2, 1, 0];
  const colIndices = orientation === 'red' ? [0, 1, 2, 3, 4, 5, 6, 7] : [7, 6, 5, 4, 3, 2, 1, 0];

  return (
    <div
      className={`checkers-arcade relative aspect-square w-full max-w-[640px] select-none${
        theme.kingShimmer ? ' checkers-fx-king-shimmer' : ''
      }`}
      style={{
        transition: 'filter 360ms ease, opacity 360ms ease',
        filter: dim ? 'saturate(0.5) brightness(0.72)' : undefined,
        opacity: dim ? 0.92 : 1,
        ...themeVars,
      }}
    >
      <div className='checkers-board-bezel pointer-events-none absolute -inset-2 sm:-inset-3' aria-hidden='true' />
      <div className='checkers-board-grid relative z-[1] grid h-full w-full grid-cols-8 grid-rows-8 overflow-hidden rounded-well border-2'>
        {rowIndices.map((row) =>
          colIndices.map((col) => {
            const index = rowColToIndex(row, col);
            const cell = cells[index];
            const dark = (row + col) % 2 === 1;
            const isSelected = chainHead === index;
            const isOrigin = selected === index;
            const isLastMove = lastMoveSquares.has(index);
            const target = nextTargets.get(index);
            const isTarget = Boolean(target);
            const isCapturedPreview = inChainCaptured.has(index);
            const pieceColor = colorOf(cell);
            const pieceIsMine = pieceColor != null && pieceColor === myColor;
            const canSelect = interactive && isMyTurn && pieceIsMine && allMoves.some((m) => m.from === index);

            return (
              <button
                key={`${row}-${col}`}
                type='button'
                data-square={index}
                onClick={() => onSquareClick(index)}
                aria-label={`square ${index}`}
                className={`relative flex items-center justify-center ${
                  dark ? 'checkers-sq-dark' : 'checkers-sq-light'
                } ${isLastMove ? 'checkers-sq-lastmove' : ''} ${
                  isSelected ? 'checkers-sq-selected' : ''
                }`}
                style={{ cursor: canSelect || isTarget ? 'pointer' : 'default' }}
              >
                {/* legal-target dot / capture ring */}
                {isTarget && (
                  <span className='pointer-events-none absolute inset-0 flex items-center justify-center'>
                    <span
                      className={
                        target?.extend
                          ? 'checkers-target-ring'
                          : 'checkers-target-dot'
                      }
                    />
                  </span>
                )}

                {pieceColor && (
                  <Disc
                    cell={cell}
                    faded={isCapturedPreview}
                    selectable={canSelect}
                    selected={isOrigin}
                  />
                )}
              </button>
            );
          }),
        )}
      </div>

      {isMyTurn && interactive && (mustCapture || chainInProgress) && (
        <div
          className={`checkers-turn-flag pointer-events-none absolute left-1/2 top-1 -translate-x-1/2 rounded-full border border-ink px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider shadow-chip ${
            chainInProgress ? 'bg-tickets text-tickets-on' : 'bg-primary text-primary-on'
          }`}
        >
          {chainInProgress ? 'Keep jumping' : 'Capture required'}
        </div>
      )}
    </div>
  );
}

/** A single lacquered disc. Cream (white) or enamel-red, with a gold crown on
 *  kings. Hard bevels + offset shadow, nothing glows. */
function Disc({
  cell,
  faded,
  selectable,
  selected,
}: {
  cell: Cell;
  faded: boolean;
  selectable: boolean;
  selected: boolean;
}) {
  const isRed = cell === 'r' || cell === 'R';
  const king = cell === 'R' || cell === 'W';
  return (
    <span
      className={`checkers-disc ${isRed ? 'checkers-disc-red' : 'checkers-disc-cream'} ${
        selectable ? 'checkers-disc-selectable' : ''
      } ${selected ? 'checkers-disc-selected' : ''}`}
      style={{ opacity: faded ? 0.32 : 1 }}
      aria-label={`${isRed ? 'red' : 'white'} ${king ? 'king' : 'man'}`}
    >
      {king && (
        <svg className='checkers-crown' viewBox='0 0 24 24' aria-hidden>
          {/* simple gold crown */}
          <path
            d='M4 9 L7.5 13 L12 7 L16.5 13 L20 9 L18.5 18 L5.5 18 Z'
            style={{ fill: 'var(--ck-crown, #e8b23a)', stroke: 'var(--ck-crown-stroke, #7a5a14)' }}
            strokeWidth='1.1'
            strokeLinejoin='round'
          />
        </svg>
      )}
    </span>
  );
}
