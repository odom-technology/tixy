'use client';

import { useEffect } from 'react';

/**
 * Fire `onAction` on Space keydown, ignoring presses while a text field
 * has focus. Pass null when the current phase has no Space action — the
 * listener is removed so default scrolling behavior returns, same as the
 * per-game handlers this replaces (they no-opped without preventDefault).
 *
 * Memoize the callback against the game's phase so the action tracks it:
 *
 *   useSpaceKeyAction(useMemo(() => {
 *     if (phase === 'idle' && !isOpening) return () => void handleOpen();
 *     if (phase === 'result') return handlePlayAgain;
 *     return null;
 *   }, [phase, isOpening, handleOpen, handlePlayAgain]));
 */
export function useSpaceKeyAction(onAction: (() => void) | null) {
  useEffect(() => {
    if (!onAction) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      const active = document.activeElement;
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) return;
      e.preventDefault();
      onAction();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onAction]);
}
