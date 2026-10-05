'use client';

import './_chess.css';

/**
 * Vertical evaluation bar, lichess-style. White's share of the bar grows from
 * the bottom; black's from the top. A small label shows the signed centipawn
 * value (or "M<N>" for a forced mate).
 *
 * Midway look: a recessed cabinet meter. The two halves use warm cream ink vs
 * espresso lacquer (instead of cold slate) so it reads as part of the cabinet.
 */

// Cream "white" share vs espresso "black" share — the meter's two paints.
const EVAL_LIGHT = '#f0e6d2';
const EVAL_DARK = '#22180e';

type Props = {
  /** Centipawns from white's perspective. null = no analysis yet. */
  cp: number | null;
  /** Board orientation — the bar flips so the viewer's color is always on the bottom. */
  orientation: 'white' | 'black';
  /** Optional height override; defaults to matching a 640px board. */
  heightPx?: number;
};

/** Squash a large cp value into a 0–100 percentage using a light sigmoid. */
function cpToWhitePercent(cp: number): number {
  // Mate scores are already clamped to ±10_000 on the server.
  const x = cp / 400;
  const sigmoid = 1 / (1 + Math.exp(-x));
  // Keep at least 3% visible for either side so the minority bar stays legible.
  return Math.max(3, Math.min(97, sigmoid * 100));
}

function formatEvalLabel(cp: number): string {
  const abs = Math.abs(cp);
  if (abs >= 9000) {
    // Server encodes mate distance as magnitude = 10_000 - |mate|.
    const mateDistance = Math.max(1, 10_000 - abs);
    return `M${mateDistance}`;
  }
  const pawns = cp / 100;
  const sign = pawns > 0 ? '+' : pawns < 0 ? '−' : '';
  return `${sign}${Math.abs(pawns).toFixed(1)}`;
}

export function EvalBar({ cp, orientation, heightPx }: Props) {
  const whitePercent = cp === null ? 50 : cpToWhitePercent(cp);
  // When the viewer is black, flip the bar so their color sits on bottom.
  const bottomIsWhite = orientation === 'white';
  const bottomFillPercent = bottomIsWhite ? whitePercent : 100 - whitePercent;

  const label = cp === null ? '—' : formatEvalLabel(cp);
  const labelOnTop = cp !== null && (bottomIsWhite ? cp < 0 : cp >= 0);

  return (
    <div
      className='chess-arcade chess-eval-bar relative w-7 shrink-0 overflow-hidden rounded-tag border-2 border-ink'
      style={{
        background: bottomIsWhite ? EVAL_DARK : EVAL_LIGHT,
        height: heightPx ?? '100%',
        minHeight: 320,
      }}
      aria-label={`Evaluation ${label}`}
    >
      <div
        className='chess-eval-fill absolute bottom-0 left-0 w-full'
        style={{
          height: `${bottomFillPercent}%`,
          background: bottomIsWhite ? EVAL_LIGHT : EVAL_DARK,
        }}
      />
      <span
        className='pointer-events-none absolute left-0 right-0 whitespace-nowrap text-center font-mono text-[11px] font-bold tabular-nums leading-none'
        style={{
          top: labelOnTop ? 5 : undefined,
          bottom: labelOnTop ? undefined : 5,
          color: labelOnTop
            ? bottomIsWhite ? EVAL_LIGHT : EVAL_DARK
            : bottomIsWhite ? EVAL_DARK : EVAL_LIGHT,
        }}
      >
        {label}
      </span>
    </div>
  );
}
