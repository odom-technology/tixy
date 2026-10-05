'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

import '@/features/arcade/components/leaderboard-board.css';

/** "Snake board", "Connections Leaderboard" and "chess leaderboards" all
 *  read as the game's name and "board", lowercase. */
function headingFor(title: string) {
  const name = title
    .replace(/\s*\(.*\)\s*$/, '')
    .replace(/\s+(leaderboards?|boards?)$/i, '')
    .trim()
    .toLowerCase();
  return name ? `${name} board` : 'board';
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * The board, in a sheet over the game: a bottom sheet on phones, a card from
 * 640 px. One design for every game; `children` is the game's
 * `GameLeaderboard`. Escape, the close button and a tap outside close it, and
 * focus goes back to what opened it.
 */
export function GameLeaderboardModal({
  open,
  onOpenChange,
  title,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** Kept so call sites compile; the board says what it shows. */
  description?: string;
  children: ReactNode;
}) {
  const sheetRef = useRef<HTMLElement>(null);
  const headingId = useId();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    sheetRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onOpenChange(false);
        return;
      }
      if (event.key !== 'Tab' || !sheetRef.current) return;
      // Keep Tab inside the sheet.
      const items = Array.from(sheetRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === sheetRef.current)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      document.body.style.overflow = previousOverflow;
      opener?.focus?.();
    };
  }, [onOpenChange, open]);

  if (!open || !mounted) return null;

  return createPortal(
    <div
      className='arc-board-overlay'
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onOpenChange(false);
      }}
    >
      <section
        ref={sheetRef}
        role='dialog'
        aria-modal='true'
        aria-labelledby={headingId}
        tabIndex={-1}
        className='arc-board-sheet'
      >
        <div className='arc-board-head'>
          <h2 id={headingId}>{headingFor(title)}</h2>
          <button
            type='button'
            className='arc-board-close'
            onClick={() => onOpenChange(false)}
            aria-label='Close board'
          >
            <X size={20} strokeWidth={2.5} strokeLinecap='square' aria-hidden />
          </button>
        </div>
        <div className='arc-board-scroll'>{children}</div>
      </section>
    </div>,
    document.body,
  );
}
