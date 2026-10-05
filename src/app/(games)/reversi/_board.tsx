'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  REVERSI_COLS,
  REVERSI_ROWS,
  boardToGrid,
  legalMoves,
  type Cell,
  type Color,
} from '@/features/arcade/lib/reversi';
import './_reversi.css';

type Props = {
  /** 64-char board string ('.'/'B'/'W'). */
  board: string;
  /** The viewer's disc color, or null for spectators. */
  myColor: Color | null;
  /** True when it's the viewer's turn and the match is live. */
  isMyTurn: boolean;
  /** 0-63 cell index of the last placement, or null. */
  lastMove: number | null;
  /** Fired when the user commits a legal placement on `cell`. */
  onMove: (cell: number) => void;
  /** True while a move POST is in flight (disables input). */
  submitting?: boolean;
  /** Interactive vs. read-only (spectator / finished). */
  interactive?: boolean;
  /** Dim the board (e.g. game over). */
  dim?: boolean;
};

const CELL_COLOR = (cell: Cell): Color | null =>
  cell === 'B' ? 'black' : cell === 'W' ? 'white' : null;

/**
 * Interactive 8×8 Reversi/Othello board. Felt playfield in a dark cabinet; discs
 * are enamel black / cream-white with hard bevels. When it's the viewer's turn,
 * legal cells show an amber hint dot and a ghost disc on hover; clicking places
 * a disc (flips are resolved server-side; the board re-renders from the
 * authoritative string). Changed discs pop in. Nothing glows; reduced-motion-safe.
 */
export function ReversiBoard({
  board,
  myColor,
  isMyTurn,
  lastMove,
  onMove,
  submitting = false,
  interactive = true,
  dim = false,
}: Props) {
  const [hoverCell, setHoverCell] = useState<number | null>(null);

  const grid = useMemo(() => boardToGrid(board), [board]);
  const legalSet = useMemo(() => {
    if (!interactive || !isMyTurn || !myColor || submitting) return new Set<number>();
    return new Set(legalMoves(board, myColor));
  }, [board, interactive, isMyTurn, myColor, submitting]);

  // Track which cells changed since the previous board so the freshly PLACED
  // disc pops in and the FLIPPED discs read as a distinct color-flip. Splitting
  // the two makes captures legible — a flip visibly turns over rather than
  // silently swapping color.
  const prevBoardRef = useRef<string>(board);
  const [popped, setPopped] = useState<Set<number>>(new Set());
  const [flipped, setFlipped] = useState<Set<number>>(new Set());
  useEffect(() => {
    const prev = prevBoardRef.current;
    if (prev !== board && prev.length === board.length) {
      const placedCells = new Set<number>();
      const flippedCells = new Set<number>();
      for (let i = 0; i < board.length; i++) {
        if (board[i] === prev[i] || board[i] === '.') continue;
        if (prev[i] === '.') placedCells.add(i); // newly placed disc
        else flippedCells.add(i);                // captured → flipped over
      }
      setPopped(placedCells);
      setFlipped(flippedCells);
    }
    prevBoardRef.current = board;
  }, [board]);

  const canPlay = interactive && isMyTurn && !submitting && !!myColor;

  const handleCell = (cell: number) => {
    if (!canPlay) return;
    if (!legalSet.has(cell)) return;
    onMove(cell);
  };

  return (
    <div
      className="reversi-arcade w-full"
      style={{ maxWidth: 'min(92vw, 640px)', opacity: dim ? 0.82 : 1 }}
    >
      <div className="rv-cabinet">
        <div className="rv-playfield">
          <div className="rv-grid">
            {Array.from({ length: REVERSI_ROWS }).map((_, row) =>
              Array.from({ length: REVERSI_COLS }).map((__, col) => {
                const i = row * REVERSI_COLS + col;
                const cell = grid[row][col];
                const color = CELL_COLOR(cell);
                const isLegal = legalSet.has(i);
                const isHint = isLegal && !color;
                const showGhost = hoverCell === i && isLegal && !!myColor;
                const isLast = lastMove === i;
                const justPopped = popped.has(i);
                const justFlipped = flipped.has(i);
                return (
                  <div
                    key={`cell-${i}`}
                    className={[
                      'rv-cell',
                      isLegal ? 'rv-cell-playable' : '',
                    ].join(' ')}
                    onMouseEnter={() => setHoverCell(i)}
                    onMouseLeave={() => setHoverCell((c) => (c === i ? null : c))}
                    onClick={() => handleCell(i)}
                    role={isLegal ? 'button' : undefined}
                    tabIndex={isLegal ? 0 : undefined}
                    aria-label={isLegal ? `Place on row ${row + 1}, column ${col + 1}` : undefined}
                    aria-disabled={!isLegal}
                    onKeyDown={(e) => {
                      if (!isLegal) return;
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        handleCell(i);
                      }
                    }}
                  >
                    {color && (
                      <div
                        className={[
                          'rv-disc',
                          color === 'black' ? 'rv-disc-black' : 'rv-disc-white',
                          justPopped ? 'rv-disc-pop' : '',
                          justFlipped ? 'rv-disc-flip' : '',
                          isLast ? 'rv-disc-last' : '',
                        ].join(' ')}
                      />
                    )}
                    {!color && showGhost && myColor && (
                      <div
                        className={[
                          'rv-disc rv-ghost-disc',
                          myColor === 'black' ? 'rv-disc-black' : 'rv-disc-white',
                        ].join(' ')}
                        aria-hidden
                      />
                    )}
                    {!color && isHint && !showGhost && <span className="rv-hint" aria-hidden />}
                  </div>
                );
              }),
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
