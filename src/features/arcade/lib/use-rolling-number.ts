'use client';

import { useEffect, useRef, useState } from 'react';

import {
  FEEL,
  createNumberRoll,
  rollDuration,
  type NumberRoll,
} from '@/features/arcade/lib/game-feel';

export type RollingNumberOptions = {
  /** Roll length in ms. Defaults to 700 (the balance count). 0 jumps. */
  duration?: number;
  /** Decimal places shown while rolling. Defaults to 0. */
  decimals?: number;
};

/**
 * Show `value`, rolling from whatever is on screen to each new value on the
 * settle curve. The first render shows `value` as is; only changes roll. A
 * change mid-roll continues from the number currently shown. With duration 0
 * or under reduced motion it returns `value` in the same render.
 */
export function useRollingNumber(value: number, options?: RollingNumberOptions): number {
  const decimals = options?.decimals ?? 0;
  const ms = rollDuration(options?.duration ?? FEEL.rollMs);
  const jump = ms <= 0 || !Number.isFinite(value);
  const [shown, setShown] = useState(value);
  const rollRef = useRef<NumberRoll | null>(null);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    if (frameRef.current != null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    rollRef.current ??= createNumberRoll(value, decimals);
    const roll = rollRef.current;
    const now = typeof performance !== 'undefined' ? performance.now() : 0;
    roll.retarget(value, now, jump || typeof requestAnimationFrame === 'undefined' ? 0 : ms);
    if (roll.done(now)) {
      setShown(value);
      return;
    }
    const tick = (time: number) => {
      setShown(roll.sample(time));
      frameRef.current = roll.done(time) ? null : requestAnimationFrame(tick);
    };
    frameRef.current = requestAnimationFrame(tick);
    return () => {
      if (frameRef.current != null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    };
  }, [value, ms, jump, decimals]);

  return jump ? value : shown;
}
