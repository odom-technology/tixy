'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { prefersReducedMotion } from '@/features/arcade/components/ui/arcade-interactive';

/**
 * Mount/unmount with enter + exit animation frames.
 * While `open` is false but exit is playing, still renders children with
 * `data-state="closed"`. After exit duration (or immediately under reduced
 * motion), unmounts.
 */
export function usePresence(open: boolean, exitMs = 160) {
  const [present, setPresent] = useState(open);
  const [state, setState] = useState<'open' | 'closed'>(open ? 'open' : 'closed');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }

    if (open) {
      setPresent(true);
      // Double-rAF so the open animation restarts when reopening quickly.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setState('open'));
      });
      return;
    }

    if (!present) return;

    setState('closed');
    if (prefersReducedMotion()) {
      setPresent(false);
      return;
    }
    timer.current = setTimeout(() => {
      setPresent(false);
      timer.current = null;
    }, exitMs);

    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [open, exitMs, present]);

  return { present, state } as const;
}

/**
 * Soft navigation helper: wraps Next router transitions in
 * document.startViewTransition when available.
 */
export function useViewTransitionNavigate() {
  return useCallback((navigate: () => void) => {
    if (
      typeof document !== 'undefined' &&
      'startViewTransition' in document &&
      !prefersReducedMotion()
    ) {
      (
        document as Document & {
          startViewTransition: (cb: () => void) => void;
        }
      ).startViewTransition(() => {
        navigate();
      });
      return;
    }
    navigate();
  }, []);
}
