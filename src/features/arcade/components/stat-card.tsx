import type { ReactNode } from 'react';

/* Legacy Holocron accent classes still passed by some lobbies, mapped
   onto Midway enamel text colors until those call sites are converted. */
const LEGACY_ACCENTS: Record<string, string> = {
  'text-strong': 'text-strong',
  'text-emerald-400': 'text-prize-text',
  'text-emerald-300': 'text-prize-text',
  'text-green-400': 'text-prize-text',
  'text-teal-300': 'text-prize-text',
  'text-amber-300': 'text-tickets-text',
  'text-amber-400': 'text-tickets-text',
  'text-yellow-300': 'text-tickets-text',
  'text-cyan-300': 'text-info-text',
  'text-sky-300': 'text-info-text',
  'text-blue-300': 'text-info-text',
  'text-rose-400': 'text-danger-text',
  'text-red-400': 'text-danger-text',
  'text-pink-400': 'text-primary-text',
};

/**
 * A single stat: kicker label + big tabular number.
 *
 * Prefer `variant='flat'` inside a `<GameStatGroup>` — that renders ONE inset
 * well with divided cells instead of a grid of individually-bordered tiles
 * (the "card soup" the design audit flagged). `variant='tile'` keeps the old
 * standalone bordered tile for the rare one-off.
 */
export function GameStatCard({
  label,
  value,
  accent = 'text-strong',
  sub,
  variant = 'tile',
}: {
  label: string;
  value: number | string;
  /** Tailwind text color class for the main value (enamel `-text` colors). */
  accent?: string;
  /** Optional secondary line under the label ("best 12", "peak 1800", …). */
  sub?: ReactNode;
  variant?: 'tile' | 'flat';
}) {
  const accentClass = LEGACY_ACCENTS[accent] ?? accent;
  if (variant === 'flat') {
    return (
      <div className='flex flex-col gap-0.5'>
        <p className='arcade-kicker text-[10px]'>{label}</p>
        <p className={`arcade-num text-xl font-semibold leading-tight ${accentClass}`}>{value}</p>
        {sub && <p className='text-[10px] text-faint'>{sub}</p>}
      </div>
    );
  }
  return (
    <div className='inset-shadow-well flex min-h-[92px] flex-col items-center justify-center rounded-panel border-2 border-ink bg-well p-3 text-center'>
      <p className={`arcade-num text-xl font-semibold ${accentClass}`}>{value}</p>
      <p className='arcade-kicker mt-1 text-[10px]'>{label}</p>
      {sub && <p className='mt-0.5 text-[9px] text-faint'>{sub}</p>}
    </div>
  );
}

/**
 * Groups flat `GameStatCard`s into a single inset well with hairline-divided
 * cells. Pass the column count so the dividers land correctly.
 */
export function GameStatGroup({
  cols = 3,
  className = '',
  children,
}: {
  cols?: 2 | 3 | 4;
  className?: string;
  children: ReactNode;
}) {
  const colClass =
    cols === 2 ? 'grid-cols-2' : cols === 4 ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-3';
  return (
    <div className={`arc-statgrid ${colClass} ${className}`} data-cols={cols}>
      {children}
    </div>
  );
}
