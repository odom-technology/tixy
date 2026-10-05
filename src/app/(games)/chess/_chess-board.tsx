'use client';

import { useMemo, useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { Square } from 'chess.js';
import {
  fenToBoard,
  kingInCheckSquare,
  legalMovesFrom,
  parseUci,
  type ChessColor,
  type PieceCode,
} from '@/features/arcade/lib/chess';
import {
  DEFAULT_CHESS_BOARD_THEME,
  DEFAULT_CHESS_PIECES_THEME,
  type ChessBoardTheme,
  type ChessPiecesTheme,
} from '@/features/arcade/lib/chess/theme';
import { playMoveSound } from './_sounds';
import { ArcadeButton } from '@/features/arcade/components/ui/arcade-ui';
import { ChessPieceSvg } from './_piece-svg';
import type { ChessSkinLook } from './_chess-skin';
import './_chess.css';

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const;

/** What a screen reader says for a piece: "e4, white knight". */
const PIECE_NAME: Record<PieceCode, string> = {
  wk: 'white king', wq: 'white queen', wr: 'white rook', wb: 'white bishop', wn: 'white knight', wp: 'white pawn',
  bk: 'black king', bq: 'black queen', br: 'black rook', bb: 'black bishop', bn: 'black knight', bp: 'black pawn',
};

/** Ink or paper, whichever reads on a square of this colour. Coordinates use it
 *  so they stay quiet but legible on any board skin. */
function coordInk(square: string): string {
  const hex = /^#([0-9a-f]{6})$/i.exec(square.trim());
  if (!hex) return '#54483d';
  const n = parseInt(hex[1], 16);
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const lum = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return lum > 0.3 ? '#54483d' : '#f4ebdc';
}

type Props = {
  fen: string;
  orientation: ChessColor;
  /** The color the local player controls. `null` = spectator (no interaction). */
  myColor: ChessColor | null;
  /** Whether it's this player's turn to move right now. */
  isMyTurn: boolean;
  /** UCI of the last move played (for highlight). */
  lastMoveUci: string | null;
  /** Called when the player commits a legal move. UCI string like "e2e4". */
  onMove: (uci: string) => void;
  /** True while we're waiting on the server to confirm; disables new clicks. */
  submitting?: boolean;
  /** Board color theme. */
  boardTheme?: ChessBoardTheme;
  /** Pieces color theme. */
  piecesTheme?: ChessPiecesTheme;
  /** If false, the match has ended and input is ignored. */
  interactive?: boolean;
  /** Apply a slight desaturation/dim when the game has ended. */
  dim?: boolean;
  /** Whether the last move was a capture (used for a flash effect). */
  lastMoveWasCapture?: boolean;
  /** UCI move to draw as a translucent "best move" arrow overlay (review only). */
  bestMoveArrowUci?: string | null;
  /** Move-quality annotation for the last move, surfaced as a chess.com-style
   *  badge on the destination square (review only). */
  lastMoveQuality?: 'best' | 'good' | 'inaccuracy' | 'mistake' | 'blunder' | null;
  /** Outline color for white pieces. Defaults to the legacy dark slate so
   *  existing skins are unaffected; the Midway base look passes a warm
   *  espresso here. */
  pieceStrokeWhite?: string;
  /** Outline color for black pieces. */
  pieceStrokeBlack?: string;
  /** An equipped skin set (SKINS.md): the piece shape, the frame and the
   *  material on each square. Left out, the house board is drawn. */
  skin?: ChessSkinLook | null;
};

/** Styling for the chess.com-style move-quality badge on the destination. */
const QUALITY_BADGE_STYLE: Record<
  'best' | 'good' | 'inaccuracy' | 'mistake' | 'blunder',
  { icon: string; bg: string; text: string; label: string }
> = {
  best:       { icon: '!',  bg: '#1f1a16', text: '#f4ebdc', label: 'Best move' },
  good:       { icon: '',   bg: '#1f1a16', text: '#f4ebdc', label: 'Good move' },
  inaccuracy: { icon: '?!', bg: '#54483d', text: '#f4ebdc', label: 'Inaccuracy' },
  mistake:    { icon: '?',  bg: '#f2a33c', text: '#1f1a16', label: 'Mistake' },
  blunder:    { icon: '??', bg: '#b83627', text: '#f4ebdc', label: 'Blunder' },
};

type PreMove = { from: Square; to: Square; promotion?: 'q' | 'r' | 'b' | 'n' };

/** User-drawn analysis shapes (right-click): arrows and square highlights. */
type ShapeColor = 'green' | 'red' | 'blue' | 'yellow';
type Shape =
  | { kind: 'arrow'; from: Square; to: Square; color: ShapeColor }
  | { kind: 'highlight'; square: Square; color: ShapeColor };

const SHAPE_COLORS: Record<ShapeColor, string> = {
  green: 'rgba(31, 26, 22, 0.75)',
  red: 'rgba(184, 54, 39, 0.8)',
  blue: 'rgba(84, 72, 61, 0.75)',
  yellow: 'rgba(242, 163, 60, 0.85)',
};

function shapeColorFor(e: { shiftKey: boolean; altKey: boolean; ctrlKey: boolean; metaKey: boolean }): ShapeColor {
  if (e.shiftKey) return 'red';
  if (e.altKey) return 'blue';
  if (e.ctrlKey || e.metaKey) return 'yellow';
  return 'green';
}

function sameShape(a: Shape, b: Shape): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'arrow' && b.kind === 'arrow') {
    return a.from === b.from && a.to === b.to && a.color === b.color;
  }
  if (a.kind === 'highlight' && b.kind === 'highlight') {
    return a.square === b.square && a.color === b.color;
  }
  return false;
}

/** Render an 8×8 chess board with SVG pieces, click-to-move, drag-and-drop,
 *  pre-moves, check indicator, and a promotion picker. */
export function ChessBoard({
  fen,
  orientation,
  myColor,
  isMyTurn,
  lastMoveUci,
  onMove,
  submitting = false,
  boardTheme: boardThemeInput,
  piecesTheme: piecesThemeInput,
  interactive = true,
  dim = false,
  lastMoveWasCapture = false,
  bestMoveArrowUci = null,
  lastMoveQuality = null,
  pieceStrokeWhite = '#0f172a',
  pieceStrokeBlack = '#f8fafc',
  skin = null,
}: Props) {
  const pieceShape = skin?.shape;
  const boardTheme = boardThemeInput ?? DEFAULT_CHESS_BOARD_THEME;
  const piecesTheme = piecesThemeInput ?? DEFAULT_CHESS_PIECES_THEME;
  const strokeFor = (code: string) => (code.startsWith('w') ? pieceStrokeWhite : pieceStrokeBlack);
  const board = useMemo(() => fenToBoard(fen), [fen]);
  const [selected, setSelected] = useState<Square | null>(null);
  const [dragFrom, setDragFromState] = useState<Square | null>(null);
  const [dragOverSq, setDragOverSq] = useState<Square | null>(null);
  const [preMove, setPreMove] = useState<PreMove | null>(null);
  const [promotionPending, setPromotionPending] = useState<{ from: Square; to: Square; isPreMove?: boolean } | null>(null);
  // Drag state drops the live x/y into a ref so the ghost can be repositioned
  // via direct DOM writes on each pointermove. Without that, the 64-button
  // board re-rendered at the pointer's input rate (100+ Hz on some mice),
  // which made dragging visibly laggy.
  const [pointerDrag, setPointerDrag] = useState<{
    from: Square;
    pieceCode: PieceCode;
    size: number;
    moved: boolean;
  } | null>(null);
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);
  const pointerPosRef = useRef<{ x: number; y: number } | null>(null);
  const ghostRef = useRef<HTMLDivElement | null>(null);
  // `document.body` is unavailable during SSR; track portal mount separately
  // so we only render the ghost once we're in the browser.
  const [portalReady, setPortalReady] = useState(false);
  useEffect(() => { setPortalReady(true); }, []);

  // User-drawn analysis shapes (right-click arrows + square highlights).
  const [shapes, setShapes] = useState<Shape[]>([]);
  // Right-click drag state — tracks the pointer for arrow drawing.
  const [rightDrag, setRightDrag] = useState<{
    from: Square;
    hover: Square | null;
    color: ShapeColor;
    pointerId: number;
  } | null>(null);
  // Transient red flash on a square when the user's move attempt was illegal,
  // so the UI acknowledges the failed input instead of silently doing nothing.
  // One square is a tab stop (roving tabindex); the arrow keys move it.
  const [focusSq, setFocusSq] = useState<Square | null>(null);
  const [illegalFlashSq, setIllegalFlashSq] = useState<Square | null>(null);
  const illegalFlashTimeoutRef = useRef<number | null>(null);
  function flashIllegal(sq: Square) {
    if (illegalFlashTimeoutRef.current !== null) {
      window.clearTimeout(illegalFlashTimeoutRef.current);
    }
    setIllegalFlashSq(sq);
    illegalFlashTimeoutRef.current = window.setTimeout(() => {
      illegalFlashTimeoutRef.current = null;
      setIllegalFlashSq(null);
    }, 420);
  }

  // Refs mirror state for drag handlers so dragOver/drop read the value
  // synchronously (React state updates are async).
  const dragFromRef = useRef<Square | null>(null);
  const preMoveRef = useRef<PreMove | null>(null);
  // Suppress the click that fires on the underlying square button right after
  // a drop lands — the drop target sits inside the <button>.
  const suppressNextClickRef = useRef<boolean>(false);

  const setDragFrom = (v: Square | null) => {
    dragFromRef.current = v;
    setDragFromState(v);
  };

  // Sync the pre-move ref *inside* an effect so React Compiler can't drop
  // the assignment during a skipped render.
  useEffect(() => {
    preMoveRef.current = preMove;
  }, [preMove]);

  // Reset ephemeral UI state when the position changes. Also cancels any
  // in-flight pointer drag — a remote move can land mid-drag and leave the
  // ghost piece tethered to a unmounted square.
  useEffect(() => {
    setSelected(null);
    setDragFrom(null);
    setDragOverSq(null);
    setPointerDrag(null);
    pointerStartRef.current = null;
    pointerPosRef.current = null;
    suppressNextClickRef.current = false;
    // Clear any open promotion dialog — if the opponent moves while the
    // user has the picker up, leaving it open would commit the old
    // from/to against the new FEN, producing an illegal move.
    setPromotionPending(null);
    // Any time the position changes, clear user-drawn arrows/highlights so
    // analysis marks don't survive into a new board state.
    setShapes([]);
    setRightDrag(null);
  }, [fen]);

  // Global Esc + window-blur cancels any in-flight drag so the ghost piece
  // doesn't linger when the user tabs away / opens a context menu / etc.
  useEffect(() => {
    const cancelDrag = () => {
      setPointerDrag(null);
      setDragFrom(null);
      setDragOverSq(null);
      pointerStartRef.current = null;
      pointerPosRef.current = null;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      cancelDrag();
      // Escape also clears any queued pre-move + analysis shapes so the
      // board resets to a clean state in one keystroke.
      setPreMove(null);
      setShapes([]);
      setRightDrag(null);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('blur', cancelDrag);
    document.addEventListener('visibilitychange', cancelDrag);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', cancelDrag);
      document.removeEventListener('visibilitychange', cancelDrag);
    };
  }, []);

  // Cleanup illegal-flash timeout on unmount.
  useEffect(() => () => {
    if (illegalFlashTimeoutRef.current !== null) {
      window.clearTimeout(illegalFlashTimeoutRef.current);
      illegalFlashTimeoutRef.current = null;
    }
  }, []);

  const legal = useMemo(() => {
    const source = selected ?? dragFrom;
    if (!source) return new Map<string, string>();
    try {
      const moves = legalMovesFrom(fen, source);
      const map = new Map<string, string>();
      for (const m of moves) map.set(m.to, m.san);
      return map;
    } catch {
      return new Map<string, string>();
    }
  }, [fen, selected, dragFrom]);

  const lastMove = useMemo(() => {
    if (!lastMoveUci) return null;
    const parsed = parseUci(lastMoveUci);
    if (!parsed) return null;
    return { from: parsed.from, to: parsed.to };
  }, [lastMoveUci]);

  // Transient "landed" state on the destination square — animates a quick
  // pulse so remote moves are visually obvious.
  const [landedSq, setLandedSq] = useState<Square | null>(null);
  // Compute source→destination offset (in percent of piece's own size) so the
  // destination piece appears to slide in from its source on each new move.
  const [slideInfo, setSlideInfo] = useState<{ to: Square; offsetX: number; offsetY: number; key: number } | null>(null);
  const slideSeqRef = useRef(0);
  useEffect(() => {
    if (!lastMove) return;
    setLandedSq(lastMove.to);
    // Compute offset in render space.
    const FILES_REF = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const;
    const srcF = FILES_REF.indexOf(lastMove.from[0] as typeof FILES_REF[number]);
    const srcR = 8 - parseInt(lastMove.from[1], 10);
    const dstF = FILES_REF.indexOf(lastMove.to[0] as typeof FILES_REF[number]);
    const dstR = 8 - parseInt(lastMove.to[1], 10);
    const srcRenderR = orientation === 'white' ? srcR : 7 - srcR;
    const srcRenderF = orientation === 'white' ? srcF : 7 - srcF;
    const dstRenderR = orientation === 'white' ? dstR : 7 - dstR;
    const dstRenderF = orientation === 'white' ? dstF : 7 - dstF;
    const offsetX = (srcRenderF - dstRenderF) * 100;
    const offsetY = (srcRenderR - dstRenderR) * 100;
    slideSeqRef.current += 1;
    setSlideInfo({ to: lastMove.to, offsetX, offsetY, key: slideSeqRef.current });
    const tPulse = window.setTimeout(() => setLandedSq(null), 320);
    const tSlide = window.setTimeout(() => setSlideInfo(null), 160);
    return () => {
      window.clearTimeout(tPulse);
      window.clearTimeout(tSlide);
    };
  }, [lastMoveUci, lastMove, orientation]);

  const checkSquare = useMemo(() => kingInCheckSquare(fen), [fen]);

  // When it becomes my turn, apply a queued pre-move.
  useEffect(() => {
    if (!isMyTurn) return;
    const queued = preMoveRef.current;
    if (!queued) return;
    try {
      const moves = legalMovesFrom(fen, queued.from);
      const legalTargets = new Map(moves.map((m) => [m.to, m]));
      const lm = legalTargets.get(queued.to);
      if (lm) {
        const isPromotion = lm.san.includes('=');
        if (isPromotion && !queued.promotion) {
          setPromotionPending({ from: queued.from, to: queued.to, isPreMove: true });
          setPreMove(null);
          return;
        }
        commitMove(queued.from, queued.to, queued.promotion);
      }
    } catch {
      /* illegal — cancel silently */
    }
    setPreMove(null);
    // The queued pre-move must fire only on turn/board changes; commitMove
    // is recreated per render and would re-trigger this every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMyTurn, fen]);

  function squareAt(r: number, f: number): Square {
    return (FILES[f] + (8 - r)) as Square;
  }

  function pieceAt(sq: Square) {
    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        if (squareAt(r, f) === sq) return board[r * 8 + f];
      }
    }
    return null;
  }

  function ownPieceAt(sq: Square): boolean {
    if (!myColor) return false;
    const p = pieceAt(sq);
    if (!p) return false;
    const c: ChessColor = p.code.startsWith('w') ? 'white' : 'black';
    return c === myColor;
  }

  function commitMove(from: Square, to: Square, promotion?: 'q' | 'r' | 'b' | 'n') {
    const uci = from + to + (promotion ?? '');
    onMove(uci);
    setSelected(null);
    setPromotionPending(null);
  }

  /** Returns true if a move (or pre-move) was committed from `from` → `to`.
   *  Flashes the source square red on failure so the attempt isn't silent. */
  function tryMove(from: Square, to: Square): boolean {
    if (!myColor) return false;
    if (from === to) return false;

    if (isMyTurn) {
      try {
        const moves = legalMovesFrom(fen, from);
        const target = moves.find((m) => m.to === to);
        if (!target) {
          flashIllegal(from);
          setSelected(null);
          return false;
        }
        const isPromotion = target.san.includes('=');
        if (isPromotion) {
          setPromotionPending({ from, to });
          return true;
        }
        commitMove(from, to);
        return true;
      } catch {
        flashIllegal(from);
        setSelected(null);
        return false;
      }
    }

    if (!ownPieceAt(from)) {
      flashIllegal(from);
      return false;
    }
    setPreMove({ from, to });
    setSelected(null);
    return true;
  }

  function onSquareClick(r: number, f: number) {
    if (suppressNextClickRef.current) {
      suppressNextClickRef.current = false;
      return;
    }
    if (!interactive || submitting || !myColor) return;
    const sq = squareAt(r, f);
    const piece = board[r * 8 + f];

    if (selected) {
      if (selected === sq) {
        setSelected(null);
        return;
      }
      if (tryMove(selected, sq)) return;
    }

    if (piece) {
      const pieceColor: ChessColor = piece.code.startsWith('w') ? 'white' : 'black';
      if (pieceColor === myColor) {
        setSelected(sq);
        playMoveSound('select');
        if (preMove) setPreMove(null);
        return;
      }
    }
    setSelected(null);
  }

  // ── Right-click shapes (arrows + highlights) ────────────────────────────
  // chess.com / lichess pattern: right-click drag = arrow, right-click tap =
  // square highlight. Modifiers switch color (shift=red, alt=blue, ctrl=yellow).
  function squareFromEvent(clientX: number, clientY: number): Square | null {
    const el = document.elementFromPoint(clientX, clientY)?.closest('[data-square]');
    const sq = (el as HTMLElement | null)?.dataset.square;
    return typeof sq === 'string' ? (sq as Square) : null;
  }

  function onBoardPointerDown(e: React.PointerEvent) {
    if (e.button !== 2) return;
    const from = squareFromEvent(e.clientX, e.clientY);
    if (!from) return;
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* ignore */ }
    setRightDrag({
      from,
      hover: from,
      color: shapeColorFor(e),
      pointerId: e.pointerId,
    });
  }

  function onBoardPointerMove(e: React.PointerEvent) {
    setRightDrag((prev) => {
      if (!prev || prev.pointerId !== e.pointerId) return prev;
      const hovered = squareFromEvent(e.clientX, e.clientY);
      if (hovered === prev.hover) return prev;
      return { ...prev, hover: hovered };
    });
  }

  function onBoardPointerUp(e: React.PointerEvent) {
    if (e.button !== 2) return;
    const curr = rightDrag;
    setRightDrag(null);
    if (!curr) return;
    const to = squareFromEvent(e.clientX, e.clientY);
    if (!to) return;
    const color = curr.color;
    const next: Shape = to === curr.from
      ? { kind: 'highlight', square: to, color }
      : { kind: 'arrow', from: curr.from, to, color };
    setShapes((prev) => {
      const existingIdx = prev.findIndex((s) => sameShape(s, next));
      if (existingIdx >= 0) {
        const copy = prev.slice();
        copy.splice(existingIdx, 1);
        return copy;
      }
      return [...prev, next];
    });
  }

  function onBoardPointerCancel() {
    setRightDrag(null);
  }

  // ── Pointer-based drag (works on mouse, touch, and pen) ─────────────────
  // Rather than HTML5 drag (which doesn't fire on touch), we track the
  // pointer after a piece is pressed, render a floating ghost piece at the
  // cursor, and resolve the drop target via `document.elementFromPoint`.
  const boardGridRef = useRef<HTMLDivElement | null>(null);

  function getSquareSize(): number {
    const rect = boardGridRef.current?.getBoundingClientRect();
    if (!rect) return 64;
    return rect.width / 8;
  }

  function onPiecePointerDown(e: React.PointerEvent, sq: Square) {
    if (!interactive || submitting || !myColor) return;
    const p = pieceAt(sq);
    if (!p) return;
    const pColor: ChessColor = p.code.startsWith('w') ? 'white' : 'black';
    if (pColor !== myColor) return;
    // Ignore right-click / middle-click.
    if (e.button !== undefined && e.button !== 0) return;
    // Ignore secondary touches so multi-touch doesn't hijack the drag.
    if (!e.isPrimary) return;

    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* ignore */ }
    setDragFrom(sq);
    pointerStartRef.current = { x: e.clientX, y: e.clientY };
    pointerPosRef.current = { x: e.clientX, y: e.clientY };
    setPointerDrag({
      from: sq,
      pieceCode: p.code,
      size: getSquareSize(),
      moved: false,
    });
  }

  function onPiecePointerMove(e: React.PointerEvent) {
    const curr = pointerDrag;
    const start = pointerStartRef.current;
    if (!curr || !start) return;

    pointerPosRef.current = { x: e.clientX, y: e.clientY };

    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    const dist = Math.hypot(dx, dy);
    const moved = curr.moved || dist > 5;

    // One-time setState when we cross the "dragging" threshold. After that
    // the ghost follows the cursor via direct DOM writes below, so the
    // board doesn't re-render on every pointer sample.
    if (moved && !curr.moved) {
      setPointerDrag({ ...curr, moved: true });
    }

    if (moved) {
      const el = ghostRef.current;
      if (el) {
        el.style.left = `${e.clientX - curr.size / 2}px`;
        el.style.top = `${e.clientY - curr.size / 2}px`;
      }
      const sqEl = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-square]');
      const hovered = (sqEl as HTMLElement | null)?.dataset.square as Square | undefined;
      if (hovered !== dragOverSq) setDragOverSq(hovered ?? null);
    }
  }

  function onPiecePointerUp(e: React.PointerEvent) {
    // Capture drag state, clear transient UI, then call onMove OUTSIDE any
    // setState updater. Calling the parent's move submit (which triggers
    // setSubmitting on the page component) from inside a setState updater
    // was producing "Cannot update a component while rendering a different
    // component" under React 19 + Compiler.
    const curr = pointerDrag;
    setPointerDrag(null);
    setDragFrom(null);
    setDragOverSq(null);
    pointerStartRef.current = null;
    pointerPosRef.current = null;
    if (!curr) return;
    if (curr.moved) {
      const sqEl = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-square]');
      const to = (sqEl as HTMLElement | null)?.dataset.square as Square | undefined;
      if (to && to !== curr.from) {
        suppressNextClickRef.current = true;
        tryMove(curr.from, to);
      }
    }
    // Tap (no move) leaves the piece selected so the user can tap a
    // destination next — the click event also fires on pointerup.
  }

  function onPiecePointerCancel() {
    setPointerDrag(null);
    setDragFrom(null);
    setDragOverSq(null);
    pointerStartRef.current = null;
    pointerPosRef.current = null;
  }

  const tabSquare: Square = focusSq ?? (orientation === 'black' ? 'e7' : 'e2');

  /** Arrow keys move focus one square in the direction drawn on screen. */
  function onSquareKeyDown(e: React.KeyboardEvent, r: number, f: number) {
    const delta: Record<string, [number, number]> = {
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
    };
    const d = delta[e.key];
    if (!d) return;
    e.preventDefault();
    const ri = rowIndices.indexOf(r) + d[0];
    const ci = colIndices.indexOf(f) + d[1];
    if (ri < 0 || ri > 7 || ci < 0 || ci > 7) return;
    const next = squareAt(rowIndices[ri], colIndices[ci]);
    setFocusSq(next);
    boardGridRef.current?.querySelector<HTMLElement>(`[data-square="${next}"]`)?.focus();
  }

  const isDark = (r: number, f: number) => (r + f) % 2 === 1;
  const rowIndices = orientation === 'white' ? [0, 1, 2, 3, 4, 5, 6, 7] : [7, 6, 5, 4, 3, 2, 1, 0];
  const colIndices = orientation === 'white' ? [0, 1, 2, 3, 4, 5, 6, 7] : [7, 6, 5, 4, 3, 2, 1, 0];

  return (
    <div
      className='chess-arcade relative aspect-square w-full max-w-[640px] select-none'
      data-skin={skin?.material}
      style={{
        transition: 'filter 360ms ease, opacity 360ms ease',
        filter: dim ? 'saturate(0.45) brightness(0.7)' : undefined,
        opacity: dim ? 0.92 : 1,
      }}
      // Suppress the browser context menu across the entire board — the
      // promotion modal, floating ghost, and shapes overlay are children
      // and would otherwise surface the native menu when right-clicked
      // during drag/pre-move/promotion.
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* Recessed lacquered bezel behind the playfield. Decorative only —
          kept as an absolutely-positioned underlay so the grid still fills
          inset-0 and the percentage-based arrow/overlay coords stay aligned. */}
      <div
        className='chess-board-bezel pointer-events-none absolute -inset-2 sm:-inset-3'
        style={skin ? { backgroundColor: skin.frame, backgroundImage: skin.frameArt, backgroundSize: '100% 100%' } : undefined}
        aria-hidden='true'
      />
      <div
        ref={boardGridRef}
        className='chess-board-grid relative z-[1] grid h-full w-full grid-cols-8 grid-rows-8 overflow-hidden rounded-well border-2'
        style={{
          borderColor: boardTheme.borderColor,
          // Prevent touch scroll from hijacking piece drags that begin on
          // an empty square (ghost is triggered by the piece itself, but
          // the grid still receives the initial pointer sample).
          touchAction: 'none',
        }}
        onPointerDown={onBoardPointerDown}
        onPointerMove={onBoardPointerMove}
        onPointerUp={onBoardPointerUp}
        onPointerCancel={onBoardPointerCancel}
      >
        {rowIndices.map((r) =>
          colIndices.map((f) => {
            const sq = squareAt(r, f);
            const piece = board[r * 8 + f];
            const dark = isDark(r, f);
            const isSelected = selected === sq;
            const isLegalTarget = legal.has(sq);
            const isLastMoveSq = lastMove && (lastMove.from === sq || lastMove.to === sq);
            const isPreMoveSq = preMove && (preMove.from === sq || preMove.to === sq);
            const isCheckSq = checkSquare === sq;
            const isDraggingFrom = dragFrom === sq;
            const isDragHover = dragOverSq === sq;

            let squareShadow: string | undefined;
            const isLanded = landedSq === sq;
            const isIllegalFlash = illegalFlashSq === sq;
            const userHighlight = shapes.find((s) => s.kind === 'highlight' && s.square === sq);
            const isRightDragOrigin = rightDrag?.from === sq;
            // Check ring is driven by the chess-anim-check class (steady pulse);
            // skip the static box-shadow so the two don't fight.
            if (isCheckSq) squareShadow = undefined;
            else if (isDragHover) squareShadow = `inset 0 0 0 3px ${boardTheme.selectedColor}`;
            else if (isSelected) squareShadow = `inset 0 0 0 2px ${boardTheme.selectedColor}`;
            else if (isPreMoveSq) squareShadow = 'inset 0 0 0 2px rgba(242, 163, 60, 0.85)';
            else if (isLastMoveSq) squareShadow = `inset 0 0 0 2px ${boardTheme.highlightColor}`;
            else if (userHighlight && userHighlight.kind === 'highlight') {
              squareShadow = `inset 0 0 0 3px ${SHAPE_COLORS[userHighlight.color]}`;
            } else if (isRightDragOrigin && rightDrag) {
              squareShadow = `inset 0 0 0 3px ${SHAPE_COLORS[rightDrag.color]}`;
            }

            const squareBg = isPreMoveSq
              ? 'rgba(242, 163, 60, 0.25)'
              : (dark ? boardTheme.darkColor : boardTheme.lightColor);

            // Pre-move ghost: when the pre-move has a destination on this
            // square and no piece currently sits here, render a ghost of
            // the moving piece at reduced opacity (lichess-style).
            const isPreMoveDest = preMove?.to === sq;
            const preMovePiece = isPreMoveDest && preMove ? pieceAt(preMove.from) : null;
            // Pre-move source also fades so the player sees the piece "is
            // moving elsewhere". We dim the piece rather than hide it so
            // a glance still reads the starting position.
            const isPreMoveSource = preMove?.from === sq;

            const pieceColorStr: ChessColor | null = piece
              ? (piece.code.startsWith('w') ? 'white' : 'black')
              : null;
            const pieceIsMine = pieceColorStr != null && pieceColorStr === myColor;
            const pieceDraggable = interactive && !submitting && pieceIsMine;

            return (
              <button
                key={`${r}-${f}`}
                type='button'
                data-square={sq}
                onClick={() => onSquareClick(r, f)}
                onFocus={() => setFocusSq(sq)}
                onKeyDown={(e) => onSquareKeyDown(e, r, f)}
                tabIndex={tabSquare === sq ? 0 : -1}
                className={`relative flex items-center justify-center transition-colors ${
                  isCheckSq
                    ? 'chess-anim-check'
                    : isIllegalFlash
                      ? 'chess-anim-illegal'
                      : isLanded
                        ? 'chess-anim-landed'
                        : ''
                }`}
                style={{
                  background: squareBg,
                  // A skin's material under the square: grain, ruled lines,
                  // chalk or weave, a little different on each square.
                  ...(skin && !isPreMoveSq
                    ? { backgroundImage: skin.squareArt(dark, r * 3 + f * 5), backgroundSize: '100% 100%' }
                    : {}),
                  boxShadow: squareShadow,
                  cursor: pieceDraggable ? (isMyTurn ? 'grab' : 'pointer') : 'default',
                  // Elevate the slide-destination cell so the moving piece
                  // stacks above sibling cells it crosses during the
                  // animation (z-index on the inner div alone loses to
                  // later-DOM-order siblings in the same stacking context).
                  ...(slideInfo?.to === sq
                    ? { zIndex: 20, position: 'relative' as const }
                    : {}),
                }}
                aria-label={piece ? `${sq}, ${PIECE_NAME[piece.code]}` : sq}
                aria-pressed={isSelected}
              >
                {isLanded && lastMoveWasCapture && (
                  <span className='chess-anim-capture pointer-events-none absolute inset-0' />
                )}
                {f === (orientation === 'white' ? 0 : 7) && (
                  <span
                    className='chess-coord pointer-events-none absolute left-1 top-0.5 text-[10px]'
                    style={{ color: coordInk(dark ? boardTheme.darkColor : boardTheme.lightColor), opacity: 0.85 }}
                  >
                    {8 - r}
                  </span>
                )}
                {r === (orientation === 'white' ? 7 : 0) && (
                  <span
                    className='chess-coord pointer-events-none absolute bottom-0.5 right-1 text-[10px]'
                    style={{ color: coordInk(dark ? boardTheme.darkColor : boardTheme.lightColor), opacity: 0.85 }}
                  >
                    {FILES[f]}
                  </span>
                )}
                {preMovePiece && !piece && (
                  <div
                    className='pointer-events-none absolute inset-0 flex items-center justify-center'
                    style={{ padding: '5%', opacity: 0.55 }}
                  >
                    <ChessPieceSvg
                      piece={preMovePiece.code}
                      fill={preMovePiece.code.startsWith('w') ? piecesTheme.whiteColor : piecesTheme.blackColor}
                      stroke={strokeFor(preMovePiece.code)}
                      shape={pieceShape}
                    />
                  </div>
                )}
                {piece && (
                  <div
                    key={slideInfo?.to === sq ? `slide-${slideInfo.key}` : `static-${sq}`}
                    onPointerDown={pieceDraggable ? (e) => onPiecePointerDown(e, sq) : undefined}
                    onPointerMove={pieceDraggable ? onPiecePointerMove : undefined}
                    onPointerUp={pieceDraggable ? onPiecePointerUp : undefined}
                    onPointerCancel={pieceDraggable ? onPiecePointerCancel : undefined}
                    className={`flex h-full w-full items-center justify-center ${
                      piece.code.startsWith('w') ? 'chess-piece-face' : 'chess-piece-face-dark'
                    } ${slideInfo?.to === sq ? 'chess-anim-slide' : ''} ${
                      pieceDraggable && isMyTurn && !(slideInfo?.to === sq) ? 'chess-piece-draggable' : ''
                    }`}
                    style={{
                      padding: '5%',
                      cursor: pieceDraggable ? (isMyTurn ? 'grab' : 'pointer') : 'default',
                      touchAction: pieceDraggable ? 'none' : undefined,
                      opacity: isDraggingFrom ? 0.3 : isPreMoveSource ? 0.35 : 1,
                      ...(slideInfo?.to === sq
                        ? {
                            ['--slide-x' as string]: `${slideInfo.offsetX}%`,
                            ['--slide-y' as string]: `${slideInfo.offsetY}%`,
                            // Elevate the sliding piece above neighbors so it
                            // doesn't visually slip "under the board" as it
                            // crosses squares rendered later in DOM order.
                            position: 'relative',
                            zIndex: 20,
                          }
                        : {}),
                    }}
                  >
                    <ChessPieceSvg
                      piece={piece.code}
                      fill={piece.code.startsWith('w') ? piecesTheme.whiteColor : piecesTheme.blackColor}
                      stroke={strokeFor(piece.code)}
                      shape={pieceShape}
                    />
                  </div>
                )}
                {lastMoveQuality && lastMove && lastMove.to === sq && (() => {
                  // chess.com-style quality badge on the destination of the
                  // last move. Rendered above the piece in the top-right
                  // corner of the square.
                  const style = QUALITY_BADGE_STYLE[lastMoveQuality];
                  if (!style.icon) return null;
                  return (
                    <span
                      className='pointer-events-none absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full font-sans text-[10px] font-bold shadow-md'
                      style={{ background: style.bg, color: style.text, zIndex: 25 }}
                      title={style.label}
                      aria-label={style.label}
                    >
                      {style.icon}
                    </span>
                  );
                })()}
                {isLegalTarget && (
                  <span className='pointer-events-none absolute inset-0 flex items-center justify-center'>
                    <span
                      className={`${piece ? 'h-[86%] w-[86%] border-[5px] rounded-full' : 'h-[28%] w-[28%] rounded-full'}`}
                      style={{
                        borderColor: piece ? boardTheme.legalMoveColor : undefined,
                        background: piece ? 'transparent' : `${boardTheme.legalMoveColor}c0`,
                        opacity: piece ? 0.65 : 0.85,
                      }}
                    />
                  </span>
                )}
              </button>
            );
          }),
        )}
      </div>

      {/* Best-move arrow overlay (post-game review). Sits above the grid,
          below the promotion modal. Drawn in board-percentage coordinates so
          it stays aligned regardless of square size. */}
      {bestMoveArrowUci && (
        <BestMoveArrowOverlay uci={bestMoveArrowUci} orientation={orientation} />
      )}

      {/* User-drawn analysis arrows (right-click drag). The in-progress
          right-drag is included so the arrow follows the cursor live. */}
      <UserShapesOverlay
        shapes={shapes}
        liveArrow={rightDrag && rightDrag.hover && rightDrag.hover !== rightDrag.from
          ? { from: rightDrag.from, to: rightDrag.hover, color: rightDrag.color }
          : null}
        orientation={orientation}
      />

      {/* Floating ghost piece. Portaled to document.body so an ancestor
          `transform` / `will-change: transform` (the page-shell reveal
          animation sets one on every direct child) can't redefine the
          containing block for our `position: fixed` node. Appears only once
          the pointer crosses the activation threshold so a simple click
          doesn't flash a ghost. */}
      {portalReady && pointerDrag && pointerDrag.moved && createPortal(
        <div
          ref={(el) => {
            ghostRef.current = el;
            if (el && pointerPosRef.current && pointerDrag) {
              // Position on first mount so the ghost appears under the
              // cursor immediately, not from the top-left of the viewport.
              el.style.left = `${pointerPosRef.current.x - pointerDrag.size / 2}px`;
              el.style.top = `${pointerPosRef.current.y - pointerDrag.size / 2}px`;
            }
          }}
          className='pointer-events-none fixed z-[1000]'
          style={{
            left: 0,
            top: 0,
            width: pointerDrag.size,
            height: pointerDrag.size,
          }}
        >
          <div
            style={{
              width: '100%',
              height: '100%',
              padding: '5%',
              filter: 'drop-shadow(0 6px 10px rgba(0,0,0,0.5))',
            }}
          >
            <ChessPieceSvg
              piece={pointerDrag.pieceCode}
              fill={pointerDrag.pieceCode.startsWith('w') ? piecesTheme.whiteColor : piecesTheme.blackColor}
              stroke={strokeFor(pointerDrag.pieceCode)}
              shape={pieceShape}
            />
          </div>
        </div>,
        document.body,
      )}

      {preMove && !isMyTurn && (
        <div className='pointer-events-none absolute left-1/2 top-1 z-[2] -translate-x-1/2 rounded-full bg-[#f2a33c] px-2.5 py-0.5 text-xs font-bold text-[#1f1a16]'>
          premove queued, esc cancels
        </div>
      )}

      {promotionPending && myColor && (
        <div className='absolute inset-0 z-[3] flex items-center justify-center bg-[rgb(31_26_22/0.7)]'>
          <div className='flex flex-col items-center gap-3 rounded-panel border-2 border-ink bg-panel p-4 shadow-modal'>
            <div className='text-sm font-bold text-strong'>promote to</div>
            <div className='flex gap-2'>
              {(['q', 'r', 'b', 'n'] as const).map((p) => {
                const code = ((myColor === 'white' ? 'w' : 'b') + p) as PieceCode;
                return (
                  <ArcadeButton
                    key={p}
                    tone='default'
                    size='icon'
                    className='h-14 w-14'
                    onClick={() => commitMove(promotionPending.from, promotionPending.to, p)}
                  >
                    <ChessPieceSvg
                      piece={code}
                      fill={myColor === 'white' ? piecesTheme.whiteColor : piecesTheme.blackColor}
                      stroke={myColor === 'white' ? pieceStrokeWhite : pieceStrokeBlack}
                      shape={pieceShape}
                    />
                  </ArcadeButton>
                );
              })}
            </div>
            <ArcadeButton
              tone='ghost'
              size='xs'
              onClick={() => setPromotionPending(null)}
            >
              cancel
            </ArcadeButton>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Draws a translucent arrow from the source square to the destination square
 * of a UCI move. Used to hint at the engine's preferred move during review.
 * Coordinates are expressed as percentages so the arrow scales with the board.
 */
function BestMoveArrowOverlay({
  uci,
  orientation,
}: {
  uci: string;
  orientation: 'white' | 'black';
}) {
  const parsed = parseUci(uci);
  if (!parsed) return null;
  const fileToIdx = (file: string) => file.charCodeAt(0) - 'a'.charCodeAt(0);
  const rankToRow = (rank: string) => 8 - parseInt(rank, 10);

  const srcF = fileToIdx(parsed.from[0]);
  const srcR = rankToRow(parsed.from[1]);
  const dstF = fileToIdx(parsed.to[0]);
  const dstR = rankToRow(parsed.to[1]);

  const toPct = (f: number, r: number) => ({
    x: orientation === 'white' ? (f + 0.5) * 12.5 : (7 - f + 0.5) * 12.5,
    y: orientation === 'white' ? (r + 0.5) * 12.5 : (7 - r + 0.5) * 12.5,
  });
  const a = toPct(srcF, srcR);
  const b = toPct(dstF, dstR);

  return (
    <svg
      className='pointer-events-none absolute inset-0 h-full w-full'
      viewBox='0 0 100 100'
      preserveAspectRatio='none'
      style={{ zIndex: 5 }}
    >
      <defs>
        <marker
          id='chess-best-arrowhead'
          viewBox='0 0 10 10'
          refX='6'
          refY='5'
          markerWidth='4'
          markerHeight='4'
          orient='auto-start-reverse'
        >
          <path d='M0,0 L10,5 L0,10 z' fill='rgba(31, 26, 22, 0.85)' />
        </marker>
      </defs>
      <line
        x1={a.x}
        y1={a.y}
        x2={b.x}
        y2={b.y}
        stroke='rgba(31, 26, 22, 0.7)'
        strokeWidth='2.2'
        strokeLinecap='round'
        markerEnd='url(#chess-best-arrowhead)'
        vectorEffect='non-scaling-stroke'
      />
    </svg>
  );
}

/**
 * Renders user-drawn analysis shapes: arrows and inline-live right-drag
 * previews. Coordinates are in board percent so the overlay scales cleanly
 * with board size. Sits above the grid but below the promotion modal.
 */
function UserShapesOverlay({
  shapes,
  liveArrow,
  orientation,
}: {
  shapes: Shape[];
  liveArrow: { from: Square; to: Square; color: ShapeColor } | null;
  orientation: 'white' | 'black';
}) {
  const fileToIdx = (file: string) => file.charCodeAt(0) - 'a'.charCodeAt(0);
  const rankToRow = (rank: string) => 8 - parseInt(rank, 10);
  const toPct = (f: number, r: number) => ({
    x: orientation === 'white' ? (f + 0.5) * 12.5 : (7 - f + 0.5) * 12.5,
    y: orientation === 'white' ? (r + 0.5) * 12.5 : (7 - r + 0.5) * 12.5,
  });

  const arrows: Array<{ from: Square; to: Square; color: ShapeColor; key: string }> = shapes
    .filter((s): s is Extract<Shape, { kind: 'arrow' }> => s.kind === 'arrow')
    .map((s, i) => ({ from: s.from, to: s.to, color: s.color, key: `arrow-${i}` }));
  if (liveArrow) {
    arrows.push({ ...liveArrow, key: 'arrow-live' });
  }

  if (arrows.length === 0) return null;

  return (
    <svg
      className='pointer-events-none absolute inset-0 h-full w-full'
      viewBox='0 0 100 100'
      preserveAspectRatio='none'
      style={{ zIndex: 6 }}
    >
      <defs>
        {(['green', 'red', 'blue', 'yellow'] as const).map((c) => (
          <marker
            key={c}
            id={`chess-shape-arrow-${c}`}
            viewBox='0 0 10 10'
            refX='6'
            refY='5'
            markerWidth='4'
            markerHeight='4'
            orient='auto-start-reverse'
          >
            <path d='M0,0 L10,5 L0,10 z' fill={SHAPE_COLORS[c]} />
          </marker>
        ))}
      </defs>
      {arrows.map((arrow) => {
        const a = toPct(fileToIdx(arrow.from[0]), rankToRow(arrow.from[1]));
        const b = toPct(fileToIdx(arrow.to[0]), rankToRow(arrow.to[1]));
        return (
          <line
            key={arrow.key}
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            stroke={SHAPE_COLORS[arrow.color]}
            strokeWidth='2.5'
            strokeLinecap='round'
            markerEnd={`url(#chess-shape-arrow-${arrow.color})`}
            vectorEffect='non-scaling-stroke'
          />
        );
      })}
    </svg>
  );
}
