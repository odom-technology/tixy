'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Tabular count-up over `--motion-payout` (600ms, linear by default).
 * Instant swap under `prefers-reduced-motion: reduce`.
 * Shared by wager result plates, lobby stats, and end-of-run XP.
 */
export function usePayoutCount(target: number, duration = 600): number {
  const [display, setDisplay] = useState(target);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    if (
      typeof window === 'undefined' ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      setDisplay(target);
      return;
    }
    const start = performance.now();
    const from = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      setDisplay(Math.round(from + (target - from) * t));
      if (t < 1) frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
    return () => {
      if (frame.current != null) cancelAnimationFrame(frame.current);
    };
  }, [target, duration]);

  return display;
}
