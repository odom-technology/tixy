'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  C4_COLS,
  C4_ROWS,
  boardToGrid,
  legalMovesFrom,
  winningLine,
  type Cell,
  type Color,
} from '@/features/arcade/lib/connect-four';
import { squashElement } from '@/features/arcade/lib/game-feel';
import {
  useFeelReducedMotion,
  useGameFeedback,
  usePitchLadder,
} from '@/features/arcade/lib/use-game-feedback';
import {
  DEFAULT_CONNECT_FOUR_THEME,
  connectFourThemeVars,
  type ConnectFourCosmeticTheme,
} from './_connect-four-theme';
import { ChipArt, type ChipSide } from './_chip-art';
import { playMoveSound } from './_sounds';
import './_connect-four.css';

type Props = {
  /** 42-char board string ('.'/'1'/'2'). */
  board: string;
  /** The viewer's disc color, or null for spectators. */
  myColor: Color | null;
  /** True when it's the viewer's turn and the match is live. */
  isMyTurn: boolean;
  /** 0-based column of the last drop, or null. */
  lastMove: number | null;
  /** Fired when the user commits a legal drop into `column`. */
  onMove: (column: number) => void;
  /** True while a move POST is in flight (disables input). */
  submitting?: boolean;
  /** Interactive vs. read-only (spectator / finished). */
  interactive?: boolean;
  /** Dim the board (e.g. game over). */
  dim?: boolean;
  /** Equipped cosmetics; defaults to the tixy look. */
  theme?: ConnectFourCosmeticTheme;
};

const CELL = (cell: Cell): Color | null =>
  cell === '1' ? 'red' : cell === '2' ? 'yellow' : null;

/** A chip falls from the top of its column: 130 ms for one cell, and a longer
 *  fall takes the square root of the distance, which is what gravity does. */
const FALL_MS_PER_ROOT_CELL = 130;
/** The landing is 72% of the whole drop; the rest is the one bounce. */
const LANDING_SHARE = 0.72;
/** The four light one after another, this far apart. */
const LIGHT_STEP_MS = 140;

type DropAnim = {
  index: number;
  fall: number;
  totalMs: number;
  bounce: number;
};

/**
 * Interactive 7×6 Connect Four rack. Chips are casino chips: a coloured body,
 * a striped paper rim, an inner ring. The rack is dark with deep holes.
 * Dropping falls under gravity, lands with a clack, bounces once and settles
 * (the board re-renders from the authoritative string, so a chip only falls
 * when the string gains one). The winning four light one after another.
 *
 * The column preview follows the pointer, and on a touch screen it follows
 * the finger: press to see where the chip would go, slide to change column,
 * lift to drop it. Slide off the rack and lift to cancel.
 */
export function ConnectFourBoard({
  board,
  myColor,
  isMyTurn,
  lastMove,
  onMove,
  submitting = false,
  interactive = true,
  dim = false,
  theme = DEFAULT_CONNECT_FOUR_THEME,
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const reduced = useFeelReducedMotion();
  // The feel kit shakes the board a little when a chip lands.
  const { trigger } = useGameFeedback({ stage: rootRef });
  const ladder = usePitchLadder();
  const themeVars = useMemo(() => connectFourThemeVars(theme), [theme]);
  // A skin set colours the chips by side: yours, and theirs. A spectator
  // sees red as `you`.
  const skin = theme.skin;
  const sideOf = (color: Color): ChipSide => (color === (myColor ?? 'red') ? 'you' : 'them');
  const chipProps = (color: Color) =>
    skin ? { 'data-side': sideOf(color) } : { 'data-side': undefined };

  const [previewCol, setPreviewCol] = useState<number | null>(null);
  // One column is a tab stop (roving tabindex); the arrow keys move it.
  const [focusCol, setFocusCol] = useState(Math.floor(C4_COLS / 2));
  const columnRefs = useRef<Array<HTMLDivElement | null>>([]);
  const [drop, setDrop] = useState<DropAnim | null>(null);
  // Lights come on after the landing of the chip that made the four.
  const [winBaseMs, setWinBaseMs] = useState(0);
  // A finished game opened from a link shows its four lit at once.
  const [winStatic, setWinStatic] = useState(() => winningLine(board) !== null);
  const prevBoardRef = useRef<string | null>(null);
  const pressedRef = useRef(false);
  const skipClickRef = useRef(false);
  const timersRef = useRef<number[]>([]);

  const grid = useMemo(() => boardToGrid(board), [board]);
  const legal = useMemo(() => legalMovesFrom(board), [board]);
  // Map each winning cell index → its 0-based position along the connected
  // line, so the lights can come on in order down the four.
  const winOrder = useMemo(() => {
    const line = winningLine(board);
    if (!line) return null;
    const map = new Map<number, number>();
    line.forEach((cell, i) => map.set(cell, i));
    return map;
  }, [board]);

  const canPlay = interactive && isMyTurn && !submitting;

  const clearTimers = useCallback(() => {
    for (const id of timersRef.current) window.clearTimeout(id);
    timersRef.current = [];
  }, []);
  useEffect(() => clearTimers, [clearTimers]);

  // A chip dropped: fall, clack at the landing, a smaller clack at the bounce.
  // The first render (a game opened mid-way, or a replay jump that changes
  // more than one cell) animates nothing.
  useEffect(() => {
    const prev = prevBoardRef.current;
    prevBoardRef.current = board;
    if (prev === null) return;
    if (prev === board) return;
    let index = -1;
    let added = 0;
    for (let i = 0; i < board.length; i++) {
      if (prev[i] === '.' && board[i] !== '.') {
        index = i;
        added++;
      }
    }
    if (added !== 1) return;

    const row = Math.floor(index / C4_COLS);
    const fall = row + 1;
    const fallMs = reduced ? 0 : Math.round(FALL_MS_PER_ROOT_CELL * Math.sqrt(fall));
    const totalMs = Math.round(fallMs / LANDING_SHARE);
    setDrop({ index, fall, totalMs, bounce: Math.min(18, 6 + fall * 2) });
    setWinStatic(false);

    const force = Math.min(1, fall / C4_ROWS);
    timersRef.current.push(
      window.setTimeout(() => {
        playMoveSound('drop');
        trigger('impact', { sound: false, motion: false, haptic: true, shake: 0.15 + 0.35 * force });
        squashElement(rootRef.current?.querySelector(`[data-disc="${index}"]`), { force });
      }, fallMs),
    );
    // One bounce: a quieter clack as it comes back down. Under reduced motion
    // there is no bounce to hear.
    if (!reduced && totalMs - fallMs >= 90) {
      timersRef.current.push(window.setTimeout(() => playMoveSound('drop', 0.22), totalMs));
    }

    // Four in a row: light them in turn once the last chip has settled.
    if (winningLine(board)) {
      const base = reduced ? 0 : totalMs;
      setWinBaseMs(base);
      ladder.reset();
      for (let step = 0; step < 4; step++) {
        timersRef.current.push(
          window.setTimeout(() => {
            trigger('collect', { motion: false, pitch: ladder.next() });
          }, base + step * LIGHT_STEP_MS),
        );
      }
      timersRef.current.push(
        window.setTimeout(() => {
          trigger('round-win', { sound: false, motion: false, haptic: true });
        }, base + 3 * LIGHT_STEP_MS),
      );
    }
  }, [board, reduced, trigger, ladder]);

  const handleColumn = useCallback(
    (col: number) => {
      if (!canPlay) return;
      if (!legal.includes(col)) return;
      onMove(col);
    },
    [canPlay, legal, onMove],
  );

  // Which row a ghost chip would land in for a previewed open column.
  const ghostRowForCol = (col: number): number => {
    for (let row = C4_ROWS - 1; row >= 0; row--) {
      if (grid[row][col] === '.') return row;
    }
    return -1;
  };

  // ── Pointer: the preview follows the mouse, and the finger ─────────────
  const colFromPointer = (clientX: number, clientY: number): number | null => {
    const rect = gridRef.current?.getBoundingClientRect();
    if (!rect) return null;
    // A finger can go above the rack (onto the drop row) but not far off it.
    if (clientX < rect.left || clientX > rect.right) return null;
    if (clientY < rect.top - rect.width / 5 || clientY > rect.bottom + 24) return null;
    return Math.min(C4_COLS - 1, Math.floor(((clientX - rect.left) / rect.width) * C4_COLS));
  };

  const previewFrom = (clientX: number, clientY: number) => {
    const col = colFromPointer(clientX, clientY);
    setPreviewCol(col !== null && legal.includes(col) ? col : null);
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!canPlay || (e.button !== undefined && e.button !== 0)) return;
    pressedRef.current = true;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* the pointer may already be gone */
    }
    previewFrom(e.clientX, e.clientY);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!canPlay) return;
    // A mouse previews on hover; a finger only while it is down.
    if (e.pointerType === 'touch' && !pressedRef.current) return;
    previewFrom(e.clientX, e.clientY);
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!pressedRef.current) return;
    pressedRef.current = false;
    const col = canPlay ? colFromPointer(e.clientX, e.clientY) : null;
    if (e.pointerType === 'touch') setPreviewCol(null);
    if (col === null || !legal.includes(col)) return;
    // The click that follows this release is the same press: drop once.
    skipClickRef.current = true;
    window.setTimeout(() => {
      skipClickRef.current = false;
    }, 450);
    handleColumn(col);
  };

  const onPointerCancel = () => {
    pressedRef.current = false;
    setPreviewCol(null);
  };

  const onPointerLeave = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && !pressedRef.current) setPreviewCol(null);
  };

  const shownPreview = canPlay && previewCol !== null && legal.includes(previewCol) ? previewCol : null;

  /** Left and right move focus along the columns; the ghost chip follows. */
  const onColumnKeyDown = (e: React.KeyboardEvent, col: number) => {
    const target =
      e.key === 'ArrowLeft' ? col - 1
      : e.key === 'ArrowRight' ? col + 1
      : e.key === 'Home' ? 0
      : e.key === 'End' ? C4_COLS - 1
      : null;
    if (target !== null) {
      e.preventDefault();
      const next = Math.max(0, Math.min(C4_COLS - 1, target));
      setFocusCol(next);
      columnRefs.current[next]?.focus();
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleColumn(col);
    }
  };

  return (
    <div
      ref={rootRef}
      className={[
        'connect-four-arcade w-full',
        theme.discGlow ? 'c4-fx-disc-glow' : '',
        skin ? 'c4-skinned' : '',
        winOrder ? 'c4-has-win' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={{ opacity: dim ? 0.82 : 1, ...themeVars }}
      data-shape={skin?.shape}
      data-material={skin?.material}
    >
      <div className='c4-cabinet'>
        <div
          className='c4-playfield'
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
          onPointerLeave={onPointerLeave}
        >
          {/* The drop row: the preview chip hovers over the column. */}
          <div className='c4-droprow' aria-hidden>
            <span className='c4-droprow-sizer' />
            {myColor && shownPreview !== null && (
              <div
                className='c4-preview'
                style={{ ['--c4-col' as string]: shownPreview } as React.CSSProperties}
              >
                <div className={['c4-disc', myColor === 'red' ? 'c4-disc-red' : 'c4-disc-yellow'].join(' ')} {...chipProps(myColor)}>
                  {skin ? <ChipArt shape={skin.shape} side='you' /> : null}
                </div>
              </div>
            )}
          </div>

          <div ref={gridRef} className='c4-grid'>
            {Array.from({ length: C4_COLS }).map((_, col) => {
              const colLegal = legal.includes(col);
              const isActiveCol = canPlay && colLegal;
              const ghostRow = shownPreview === col && isActiveCol ? ghostRowForCol(col) : -1;
              return (
                <div
                  key={`col-${col}`}
                  ref={(el) => {
                    columnRefs.current[col] = el;
                  }}
                  className={[
                    'c4-column flex flex-col',
                    isActiveCol ? 'c4-column-active' : 'c4-column-disabled',
                    shownPreview === col ? 'c4-column-preview' : '',
                  ].join(' ')}
                  style={{ gap: 'inherit' }}
                  onClick={() => {
                    if (skipClickRef.current) return;
                    handleColumn(col);
                  }}
                  role='button'
                  // Always a tab stop, so focus stays on the board through a
                  // move and while it is the other player's turn.
                  tabIndex={focusCol === col ? 0 : -1}
                  aria-label={isActiveCol ? `drop in column ${col + 1}` : `column ${col + 1}`}
                  aria-disabled={!isActiveCol}
                  onFocus={(e) => {
                    setFocusCol(col);
                    // A keyboard player sees the ghost chip over the focused
                    // column; a mouse or finger has its own preview.
                    if (e.currentTarget.matches(':focus-visible')) setPreviewCol(col);
                  }}
                  onBlur={() => {
                    if (!pressedRef.current) setPreviewCol(null);
                  }}
                  onKeyDown={(e) => onColumnKeyDown(e, col)}
                >
                  {lastMove === col && <span className='c4-lastmove' aria-hidden />}
                  {Array.from({ length: C4_ROWS }).map((__, row) => {
                    const i = row * C4_COLS + col;
                    const cell = grid[row][col];
                    const color = CELL(cell);
                    const dropping = drop?.index === i;
                    const winPos = winOrder?.get(i);
                    const isWin = winPos !== undefined;
                    const showGhost = ghostRow === row;
                    const style: Record<string, string> = {};
                    if (dropping) {
                      style['--c4-fall'] = String(drop.fall);
                      style['--c4-ms'] = `${drop.totalMs}ms`;
                      style['--c4-bounce'] = `${drop.bounce}%`;
                    }
                    if (isWin) {
                      style['--c4-win-delay'] = winStatic ? '0ms' : `${winBaseMs + winPos * LIGHT_STEP_MS}ms`;
                    }
                    return (
                      <div key={`cell-${i}`} className='c4-cell'>
                        {color && (
                          <div
                            data-disc={i}
                            className={[
                              'c4-disc',
                              color === 'red' ? 'c4-disc-red' : 'c4-disc-yellow',
                              dropping ? 'c4-disc-drop' : '',
                              isWin ? 'c4-disc-win' : '',
                            ].join(' ')}
                            style={Object.keys(style).length ? (style as React.CSSProperties) : undefined}
                            // A finished game opened from a link: lit, no motion.
                            data-static={isWin && winStatic ? '' : undefined}
                            {...chipProps(color)}
                          >
                            {skin ? <ChipArt shape={skin.shape} side={sideOf(color)} /> : null}
                          </div>
                        )}
                        {!color && showGhost && myColor && (
                          <div
                            className={[
                              'c4-disc c4-ghost-disc',
                              myColor === 'red' ? 'c4-disc-red' : 'c4-disc-yellow',
                            ].join(' ')}
                            aria-hidden
                            {...chipProps(myColor)}
                          >
                            {skin ? <ChipArt shape={skin.shape} side='you' /> : null}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
