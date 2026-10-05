'use client';

import { useEffect, useMemo, useRef } from 'react';
import { ColorInput, ValidationChecklist } from './_components';
import type {
  ItemDraft,
  ChessBoardDraft,
  ChessPiecesDraft,
  ChessClockDraft,
} from './_types';

// ─── Board preview ──────────────────────────────────────────────────────────

function BoardPreview({ draft }: { draft: ChessBoardDraft }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const border = 6;
    ctx.fillStyle = draft.boardBorderColor;
    ctx.fillRect(0, 0, w, h);

    const size = Math.min(w - border * 2, h - border * 2);
    const originX = (w - size) / 2;
    const originY = (h - size) / 2;
    const cell = size / 8;

    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        const isDark = (r + f) % 2 === 1;
        ctx.fillStyle = isDark ? draft.boardDarkColor : draft.boardLightColor;
        ctx.fillRect(originX + f * cell, originY + r * cell, cell, cell);
      }
    }

    // Last-move highlight — e2 and e4 (from white POV: file 4, ranks 6 + 4).
    const hf = 4;
    const hrFrom = 6;
    const hrTo = 4;
    ctx.fillStyle = draft.boardHighlightColor;
    ctx.fillRect(originX + hf * cell, originY + hrFrom * cell, cell, cell);
    ctx.fillRect(originX + hf * cell, originY + hrTo * cell, cell, cell);

    // Selected square — d4 (file 3, rank 4).
    const sf = 3;
    const sr = 4;
    ctx.strokeStyle = draft.boardSelectedColor;
    ctx.lineWidth = 3;
    ctx.strokeRect(
      originX + sf * cell + 1.5,
      originY + sr * cell + 1.5,
      cell - 3,
      cell - 3,
    );

    // Legal-move dots on c3, d5, e3 (arbitrary demo targets).
    const legalTargets: Array<[number, number]> = [
      [2, 5], [3, 3], [4, 5],
    ];
    ctx.fillStyle = draft.boardLegalMoveColor;
    for (const [f, r] of legalTargets) {
      ctx.beginPath();
      ctx.arc(
        originX + f * cell + cell / 2,
        originY + r * cell + cell / 2,
        cell * 0.14,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
  }, [draft]);

  return (
    <canvas
      ref={canvasRef}
      width={256}
      height={256}
      className='w-full rounded-lg'
      style={{ imageRendering: 'auto' }}
    />
  );
}

// ─── Pieces preview ─────────────────────────────────────────────────────────

const PIECE_GLYPHS: { glyph: string; side: 'white' | 'black' }[] = [
  { glyph: '♔', side: 'white' },
  { glyph: '♕', side: 'white' },
  { glyph: '♖', side: 'white' },
  { glyph: '♗', side: 'white' },
  { glyph: '♘', side: 'white' },
  { glyph: '♙', side: 'white' },
  { glyph: '♚', side: 'black' },
  { glyph: '♛', side: 'black' },
  { glyph: '♜', side: 'black' },
  { glyph: '♝', side: 'black' },
  { glyph: '♞', side: 'black' },
  { glyph: '♟', side: 'black' },
];

function PiecesPreview({ draft }: { draft: ChessPiecesDraft }) {
  return (
    <div className='rounded-lg bg-slate-900 p-3'>
      <div className='grid grid-cols-6 gap-1'>
        {PIECE_GLYPHS.slice(0, 6).map((p, i) => (
          <div
            key={`w-${i}`}
            className='flex aspect-square items-center justify-center rounded text-4xl leading-none'
            style={{
              background: '#f0d9b5',
              color: draft.piecesWhiteColor,
              textShadow: `0 2px 4px ${draft.piecesWhiteShadow}`,
            }}
          >
            {p.glyph}
          </div>
        ))}
        {PIECE_GLYPHS.slice(6).map((p, i) => (
          <div
            key={`b-${i}`}
            className='flex aspect-square items-center justify-center rounded text-4xl leading-none'
            style={{
              background: '#b58863',
              color: draft.piecesBlackColor,
              textShadow: `0 2px 4px ${draft.piecesBlackShadow}`,
            }}
          >
            {p.glyph}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Clock preview ──────────────────────────────────────────────────────────

function ClockPreview({ draft }: { draft: ChessClockDraft }) {
  return (
    <div className='rounded-lg bg-slate-900 p-3 space-y-2'>
      {/* Inactive clock — normal foreground. */}
      <div className='flex items-center justify-between rounded-lg border border-soft bg-well px-4 py-3'>
        <span className='text-xs uppercase tracking-wide text-faint'>Opponent</span>
        <span className='font-mono text-2xl text-strong/70 tabular-nums'>3:24</span>
      </div>
      {/* Active clock — accent color + active bg. */}
      <div
        className='flex items-center justify-between rounded-lg border px-4 py-3'
        style={{
          background: draft.clockActiveBg,
          borderColor: draft.clockActiveColor,
        }}
      >
        <span
          className='text-xs uppercase tracking-wide'
          style={{ color: draft.clockActiveColor }}
        >
          Your turn
        </span>
        <span
          className='font-mono text-2xl tabular-nums'
          style={{ color: draft.clockActiveColor }}
        >
          2:18
        </span>
      </div>
      {/* Low-time warning. */}
      <div
        className='flex items-center justify-between rounded-lg border px-4 py-3'
        style={{
          background: draft.clockActiveBg,
          borderColor: draft.clockWarningColor,
        }}
      >
        <span
          className='text-xs uppercase tracking-wide'
          style={{ color: draft.clockWarningColor }}
        >
          Low time
        </span>
        <span
          className='font-mono text-2xl tabular-nums'
          style={{ color: draft.clockWarningColor }}
        >
          0:08
        </span>
      </div>
    </div>
  );
}

// ─── Presets ────────────────────────────────────────────────────────────────

const BOARD_PRESETS: { id: string; label: string; draft: ChessBoardDraft }[] = [
  {
    id: 'classic-walnut',
    label: 'Classic Walnut',
    draft: {
      boardLightColor: '#f0d9b5',
      boardDarkColor: '#b58863',
      boardBorderColor: '#3d2817',
      boardHighlightColor: '#fbbf2470',
      boardSelectedColor: '#22c55e',
      boardLegalMoveColor: '#22c55e',
    },
  },
  {
    id: 'seafoam',
    label: 'Seafoam',
    draft: {
      boardLightColor: '#e8f4ea',
      boardDarkColor: '#4a7c59',
      boardBorderColor: '#1e3a2a',
      boardHighlightColor: '#fde04770',
      boardSelectedColor: '#10b981',
      boardLegalMoveColor: '#10b981',
    },
  },
  {
    id: 'midnight',
    label: 'Midnight',
    draft: {
      boardLightColor: '#cbd5e1',
      boardDarkColor: '#334155',
      boardBorderColor: '#0f172a',
      boardHighlightColor: '#38bdf870',
      boardSelectedColor: '#60a5fa',
      boardLegalMoveColor: '#38bdf8',
    },
  },
  {
    id: 'rosewood',
    label: 'Rosewood',
    draft: {
      boardLightColor: '#fde6d8',
      boardDarkColor: '#9c4a4a',
      boardBorderColor: '#5c1e1e',
      boardHighlightColor: '#fbbf2470',
      boardSelectedColor: '#f97316',
      boardLegalMoveColor: '#f97316',
    },
  },
  {
    id: 'emerald',
    label: 'Emerald Throne',
    draft: {
      boardLightColor: '#f0fdf4',
      boardDarkColor: '#065f46',
      boardBorderColor: '#042f2e',
      boardHighlightColor: '#fde04770',
      boardSelectedColor: '#fbbf24',
      boardLegalMoveColor: '#34d399',
    },
  },
  {
    id: 'obsidian',
    label: 'Obsidian & Gold',
    draft: {
      boardLightColor: '#fde68a',
      boardDarkColor: '#18181b',
      boardBorderColor: '#000000',
      boardHighlightColor: '#fbbf2470',
      boardSelectedColor: '#fbbf24',
      boardLegalMoveColor: '#fbbf24',
    },
  },
];

const PIECES_PRESETS: { id: string; label: string; draft: ChessPiecesDraft }[] = [
  {
    id: 'ivory-ebony',
    label: 'Ivory & Ebony',
    draft: {
      piecesWhiteColor: '#f8fafc',
      piecesBlackColor: '#0f172a',
      piecesWhiteShadow: 'rgba(0, 0, 0, 0.7)',
      piecesBlackShadow: 'rgba(255, 255, 255, 0.2)',
    },
  },
  {
    id: 'slate',
    label: 'Slate',
    draft: {
      piecesWhiteColor: '#e2e8f0',
      piecesBlackColor: '#1e293b',
      piecesWhiteShadow: 'rgba(0, 0, 0, 0.6)',
      piecesBlackShadow: 'rgba(148, 163, 184, 0.35)',
    },
  },
  {
    id: 'royal',
    label: 'Royal',
    draft: {
      piecesWhiteColor: '#fef3c7',
      piecesBlackColor: '#3730a3',
      piecesWhiteShadow: 'rgba(120, 53, 15, 0.7)',
      piecesBlackShadow: 'rgba(233, 213, 255, 0.45)',
    },
  },
  {
    id: 'jade',
    label: 'Jade Dynasty',
    draft: {
      piecesWhiteColor: '#d1fae5',
      piecesBlackColor: '#064e3b',
      piecesWhiteShadow: 'rgba(6, 78, 59, 0.8)',
      piecesBlackShadow: 'rgba(167, 243, 208, 0.4)',
    },
  },
  {
    id: 'gilded',
    label: 'Gilded',
    draft: {
      piecesWhiteColor: '#fde68a',
      piecesBlackColor: '#92400e',
      piecesWhiteShadow: 'rgba(180, 83, 9, 0.85)',
      piecesBlackShadow: 'rgba(254, 243, 199, 0.55)',
    },
  },
];

const CLOCK_PRESETS: { id: string; label: string; draft: ChessClockDraft }[] = [
  {
    id: 'standard',
    label: 'Standard',
    draft: {
      clockActiveColor: '#34d399',
      clockActiveBg: 'rgba(16, 185, 129, 0.1)',
      clockWarningColor: '#ef4444',
    },
  },
  {
    id: 'crimson',
    label: 'Crimson Alarm',
    draft: {
      clockActiveColor: '#f87171',
      clockActiveBg: 'rgba(220, 38, 38, 0.12)',
      clockWarningColor: '#fbbf24',
    },
  },
  {
    id: 'neon',
    label: 'Neon Flux',
    draft: {
      clockActiveColor: '#22d3ee',
      clockActiveBg: 'rgba(34, 211, 238, 0.12)',
      clockWarningColor: '#f472b6',
    },
  },
  {
    id: 'royal',
    label: 'Royal',
    draft: {
      clockActiveColor: '#a78bfa',
      clockActiveBg: 'rgba(139, 92, 246, 0.14)',
      clockWarningColor: '#fbbf24',
    },
  },
];

// ─── Editor components ──────────────────────────────────────────────────────

export function ChessBoardEditor({
  itemDraft,
  chessBoardDraft,
  setChessBoardDraft,
}: {
  itemDraft: ItemDraft;
  chessBoardDraft: ChessBoardDraft;
  setChessBoardDraft: React.Dispatch<React.SetStateAction<ChessBoardDraft>>;
}) {
  const checklist = useMemo(
    () => [
      { label: 'Item name set', ok: itemDraft.name.trim().length > 0 },
      { label: 'Slot assigned', ok: itemDraft.slots.includes('board') },
    ],
    [itemDraft.name, itemDraft.slots],
  );

  return (
    <div className='space-y-4 rounded-xl border border-soft bg-raised p-4'>
      <div>
        <p className='text-sm font-semibold'>Chess — Board Editor</p>
        <p className='text-xs text-faint'>
          Colors for light/dark squares, border, last-move highlight, selected
          ring, and legal-move dot.
        </p>
      </div>

      <div className='grid gap-4 xl:grid-cols-[1fr_1.3fr]'>
        <aside className='space-y-3'>
          <section className='rounded-lg border border-soft bg-slate-950/45 p-3 space-y-3'>
            <p className='text-[11px] uppercase tracking-wide text-faint'>Live Preview</p>
            <BoardPreview draft={chessBoardDraft} />
          </section>

          <section className='rounded-lg border border-soft bg-well p-3 space-y-2'>
            <p className='text-[11px] uppercase tracking-wide text-faint'>Quick Presets</p>
            <div className='grid grid-cols-2 gap-2'>
              {BOARD_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type='button'
                  className='rounded-tag border border-soft bg-raised px-2 py-1.5 text-xs text-body shadow-chip transition-[filter] duration-[140ms] hover:brightness-110'
                  onClick={() => setChessBoardDraft({ ...preset.draft })}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </section>
        </aside>

        <div className='space-y-3'>
          <section className='arcade-card-inset p-3 space-y-3'>
            <p className='text-xs font-semibold uppercase tracking-wide text-faint'>Squares</p>
            <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
              <ColorInput
                label='Light square'
                value={chessBoardDraft.boardLightColor}
                onChange={(v) => setChessBoardDraft((p) => ({ ...p, boardLightColor: v }))}
                hint='Fill for the lighter squares.'
              />
              <ColorInput
                label='Dark square'
                value={chessBoardDraft.boardDarkColor}
                onChange={(v) => setChessBoardDraft((p) => ({ ...p, boardDarkColor: v }))}
                hint='Fill for the darker squares.'
              />
              <ColorInput
                label='Border'
                value={chessBoardDraft.boardBorderColor}
                onChange={(v) => setChessBoardDraft((p) => ({ ...p, boardBorderColor: v }))}
                hint='Outer frame around the board.'
              />
            </div>
          </section>

          <section className='arcade-card-inset p-3 space-y-3'>
            <p className='text-xs font-semibold uppercase tracking-wide text-faint'>Highlights</p>
            <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
              <ColorInput
                label='Last-move tint'
                value={chessBoardDraft.boardHighlightColor}
                onChange={(v) => setChessBoardDraft((p) => ({ ...p, boardHighlightColor: v }))}
                hint='Tint applied to the previous move source + destination. Accepts hex with alpha, e.g. #fbbf2470.'
              />
              <ColorInput
                label='Selected ring'
                value={chessBoardDraft.boardSelectedColor}
                onChange={(v) => setChessBoardDraft((p) => ({ ...p, boardSelectedColor: v }))}
                hint='Outline color of the square a player has clicked.'
              />
              <ColorInput
                label='Legal-move dot'
                value={chessBoardDraft.boardLegalMoveColor}
                onChange={(v) => setChessBoardDraft((p) => ({ ...p, boardLegalMoveColor: v }))}
                hint='Small dots on legal target squares.'
              />
            </div>
          </section>

          <ValidationChecklist items={checklist} />
        </div>
      </div>
    </div>
  );
}

export function ChessPiecesEditor({
  itemDraft,
  chessPiecesDraft,
  setChessPiecesDraft,
}: {
  itemDraft: ItemDraft;
  chessPiecesDraft: ChessPiecesDraft;
  setChessPiecesDraft: React.Dispatch<React.SetStateAction<ChessPiecesDraft>>;
}) {
  const checklist = useMemo(
    () => [
      { label: 'Item name set', ok: itemDraft.name.trim().length > 0 },
      { label: 'Slot assigned', ok: itemDraft.slots.includes('pieces') },
    ],
    [itemDraft.name, itemDraft.slots],
  );

  return (
    <div className='space-y-4 rounded-xl border border-soft bg-raised p-4'>
      <div>
        <p className='text-sm font-semibold'>Chess — Pieces Editor</p>
        <p className='text-xs text-faint'>
          Fill + drop-shadow colors for the white and black piece sets.
        </p>
      </div>

      <div className='grid gap-4 xl:grid-cols-[1fr_1.3fr]'>
        <aside className='space-y-3'>
          <section className='rounded-lg border border-soft bg-slate-950/45 p-3 space-y-3'>
            <p className='text-[11px] uppercase tracking-wide text-faint'>Live Preview</p>
            <PiecesPreview draft={chessPiecesDraft} />
          </section>

          <section className='rounded-lg border border-soft bg-well p-3 space-y-2'>
            <p className='text-[11px] uppercase tracking-wide text-faint'>Quick Presets</p>
            <div className='grid grid-cols-2 gap-2'>
              {PIECES_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type='button'
                  className='rounded-tag border border-soft bg-raised px-2 py-1.5 text-xs text-body shadow-chip transition-[filter] duration-[140ms] hover:brightness-110'
                  onClick={() => setChessPiecesDraft({ ...preset.draft })}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </section>
        </aside>

        <div className='space-y-3'>
          <section className='arcade-card-inset p-3 space-y-3'>
            <p className='text-xs font-semibold uppercase tracking-wide text-faint'>White pieces</p>
            <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
              <ColorInput
                label='Fill'
                value={chessPiecesDraft.piecesWhiteColor}
                onChange={(v) => setChessPiecesDraft((p) => ({ ...p, piecesWhiteColor: v }))}
                hint='Main body color for white pieces.'
              />
              <ColorInput
                label='Shadow'
                value={chessPiecesDraft.piecesWhiteShadow}
                onChange={(v) => setChessPiecesDraft((p) => ({ ...p, piecesWhiteShadow: v }))}
                hint='Drop-shadow color. rgba() allows transparency, e.g. rgba(0,0,0,0.7).'
              />
            </div>
          </section>

          <section className='arcade-card-inset p-3 space-y-3'>
            <p className='text-xs font-semibold uppercase tracking-wide text-faint'>Black pieces</p>
            <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
              <ColorInput
                label='Fill'
                value={chessPiecesDraft.piecesBlackColor}
                onChange={(v) => setChessPiecesDraft((p) => ({ ...p, piecesBlackColor: v }))}
                hint='Main body color for black pieces.'
              />
              <ColorInput
                label='Shadow'
                value={chessPiecesDraft.piecesBlackShadow}
                onChange={(v) => setChessPiecesDraft((p) => ({ ...p, piecesBlackShadow: v }))}
                hint='Drop-shadow color for black pieces.'
              />
            </div>
          </section>

          <ValidationChecklist items={checklist} />
        </div>
      </div>
    </div>
  );
}

export function ChessClockEditor({
  itemDraft,
  chessClockDraft,
  setChessClockDraft,
}: {
  itemDraft: ItemDraft;
  chessClockDraft: ChessClockDraft;
  setChessClockDraft: React.Dispatch<React.SetStateAction<ChessClockDraft>>;
}) {
  const checklist = useMemo(
    () => [
      { label: 'Item name set', ok: itemDraft.name.trim().length > 0 },
      { label: 'Slot assigned', ok: itemDraft.slots.includes('clock') },
    ],
    [itemDraft.name, itemDraft.slots],
  );

  return (
    <div className='space-y-4 rounded-xl border border-soft bg-raised p-4'>
      <div>
        <p className='text-sm font-semibold'>Chess — Clock Editor</p>
        <p className='text-xs text-faint'>
          Accent color + background tint for the active player&apos;s clock, plus a
          low-time warning color for when the clock drops below 10 seconds.
        </p>
      </div>

      <div className='grid gap-4 xl:grid-cols-[1fr_1.3fr]'>
        <aside className='space-y-3'>
          <section className='rounded-lg border border-soft bg-slate-950/45 p-3 space-y-3'>
            <p className='text-[11px] uppercase tracking-wide text-faint'>Live Preview</p>
            <ClockPreview draft={chessClockDraft} />
          </section>

          <section className='rounded-lg border border-soft bg-well p-3 space-y-2'>
            <p className='text-[11px] uppercase tracking-wide text-faint'>Quick Presets</p>
            <div className='grid grid-cols-2 gap-2'>
              {CLOCK_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type='button'
                  className='rounded-tag border border-soft bg-raised px-2 py-1.5 text-xs text-body shadow-chip transition-[filter] duration-[140ms] hover:brightness-110'
                  onClick={() => setChessClockDraft({ ...preset.draft })}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </section>
        </aside>

        <div className='space-y-3'>
          <section className='arcade-card-inset p-3 space-y-3'>
            <p className='text-xs font-semibold uppercase tracking-wide text-faint'>Active clock</p>
            <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
              <ColorInput
                label='Accent'
                value={chessClockDraft.clockActiveColor}
                onChange={(v) => setChessClockDraft((p) => ({ ...p, clockActiveColor: v }))}
                hint="Text + border color while it's the player's turn."
              />
              <ColorInput
                label='Background'
                value={chessClockDraft.clockActiveBg}
                onChange={(v) => setChessClockDraft((p) => ({ ...p, clockActiveBg: v }))}
                hint='Translucent background tint behind the active clock. Use rgba() for transparency.'
              />
            </div>
          </section>

          <section className='arcade-card-inset p-3 space-y-3'>
            <p className='text-xs font-semibold uppercase tracking-wide text-faint'>Low-time warning</p>
            <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
              <ColorInput
                label='Warning color'
                value={chessClockDraft.clockWarningColor}
                onChange={(v) => setChessClockDraft((p) => ({ ...p, clockWarningColor: v }))}
                hint='Accent color applied below ~10 seconds remaining.'
              />
            </div>
          </section>

          <ValidationChecklist items={checklist} />
        </div>
      </div>
    </div>
  );
}
