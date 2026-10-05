'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { prefersReducedMotion } from '@/features/arcade/components/ui/arcade-interactive';

/** Short-lived stage feedback for wager / skill rounds. */
export type GameJuiceKind =
  | 'win'
  | 'big-win'
  | 'bust'
  | 'cashout'
  | 'hit'
  | 'collect'
  | 'combo'
  | 'near-miss'
  | 'level-up'
  | 'idle';

const HOLD_MS: Record<Exclude<GameJuiceKind, 'idle'>, number> = {
  win: 520,
  'big-win': 780,
  bust: 480,
  cashout: 560,
  hit: 220,
  collect: 240,
  combo: 420,
  'near-miss': 300,
  'level-up': 620,
};

/**
 * One-shot stage juice. Call `trigger('win')` after settle; the hook holds
 * `data-juice` long enough for CSS keyframes, then returns to idle.
 * Reduced-motion users get an instant idle (CSS also no-ops animations).
 */
export function useGameJuice() {
  const [juice, setJuice] = useState<GameJuiceKind>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restartFrame = useRef<number | null>(null);
  const currentJuice = useRef<GameJuiceKind>('idle');

  const clear = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (restartFrame.current != null) {
      cancelAnimationFrame(restartFrame.current);
      restartFrame.current = null;
    }
    currentJuice.current = 'idle';
    setJuice('idle');
  }, []);

  const trigger = useCallback(
    (kind: Exclude<GameJuiceKind, 'idle'>) => {
      if (timer.current) clearTimeout(timer.current);
      if (restartFrame.current != null) {
        cancelAnimationFrame(restartFrame.current);
        restartFrame.current = null;
      }
      if (prefersReducedMotion()) {
        currentJuice.current = kind;
        setJuice(kind);
        timer.current = setTimeout(() => {
          currentJuice.current = 'idle';
          setJuice('idle');
        }, 40);
        return;
      }

      const apply = () => {
        restartFrame.current = null;
        currentJuice.current = kind;
        setJuice(kind);
        timer.current = setTimeout(() => {
          currentJuice.current = 'idle';
          setJuice('idle');
        }, HOLD_MS[kind]);
      };

      // Removing and re-applying the same data-juice value across frames
      // reliably restarts its CSS keyframe without remounting a live canvas.
      if (currentJuice.current === kind) {
        currentJuice.current = 'idle';
        setJuice('idle');
        restartFrame.current = requestAnimationFrame(apply);
      } else {
        apply();
      }
    },
    [],
  );

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
    if (restartFrame.current != null) cancelAnimationFrame(restartFrame.current);
  }, []);

  return { juice, trigger, clear } as const;
}

/** Map a boolean settle into win / bust juice. Big wins at ≥ 5× payout mult. */
export function juiceFromSettle(opts: {
  won: boolean;
  multiplier?: number | null;
  payout?: number | null;
  wager?: number | null;
}): Exclude<GameJuiceKind, 'idle' | 'hit'> {
  if (!opts.won) return 'bust';
  const mult =
    opts.multiplier ??
    (opts.payout != null && opts.wager != null && opts.wager > 0
      ? opts.payout / opts.wager
      : 1);
  return mult >= 5 ? 'big-win' : 'win';
}
