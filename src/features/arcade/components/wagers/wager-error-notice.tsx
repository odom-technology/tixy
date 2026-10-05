import type { ReactNode } from 'react';

/**
 * The inset red error block several wager games (packs, darts, chicken)
 * duplicated 1:1. Class list is frozen — it must render pixel-identical
 * to the divs it replaces.
 */
export function WagerErrorNotice({ children }: { children: ReactNode }) {
  return (
    <div className='arcade-card-inset border-red-500/35 bg-red-500/10 px-4 py-3 text-sm text-red-400'>
      {children}
    </div>
  );
}
