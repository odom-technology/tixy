'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

import {
  type ArcadeGameplayCallout,
  type ArcadeGameplayCalloutTone,
} from '@/features/arcade/components/gameplay/arcade-game-hud';
import { CALLOUT_MS } from '@/features/arcade/components/gameplay/callout-motion';
import { prefersReducedMotion } from '@/features/arcade/components/ui/arcade-interactive';
import { hapticTick } from '@/features/arcade/lib/game-haptics';
import { isNewBest } from '@/features/arcade/lib/new-best';
import { SoundManager } from '@/features/arcade/lib/sound-manager';

export type PushGameplayCallout = {
  label: ReactNode;
  detail?: ReactNode;
  tone?: ArcadeGameplayCalloutTone;
  /** Position inside the game stage, expressed as a percentage. */
  x?: number;
  y?: number;
  duration?: number;
  /** Keep rapid score ticks quiet; announce only milestones and state changes. */
  announce?: string;
  /** A number set big under the label: the score a new best reached. */
  value?: number;
  /** Prefix a positive `value` with +. */
  signed?: boolean;
  /**
   * A `best` callout is the new-best moment: it plays one sound and a
   * haptic tick when it shows. Pass false when the game plays its own.
   */
  sound?: boolean;
};

const MAX_CALLOUTS = 4;
/* A new best holds long enough to read the number, and no longer. */
const BEST_DURATION_MS = 1200;

export function useGameplayCallouts() {
  const [items, setItems] = useState<ArcadeGameplayCallout[]>([]);
  const nextIdRef = useRef(1);
  const timersRef = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    const timer = timersRef.current.get(id);
    if (timer) clearTimeout(timer);
    timersRef.current.delete(id);
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  const push = useCallback((callout: PushGameplayCallout) => {
    const id = nextIdRef.current++;
    const tone = callout.tone ?? 'neutral';
    const requestedDuration =
      callout.duration ?? (tone === 'best' ? BEST_DURATION_MS : CALLOUT_MS);
    const duration = Math.max(
      160,
      prefersReducedMotion() ? Math.min(tone === 'best' ? 900 : 500, requestedDuration) : requestedDuration,
    );
    const item: ArcadeGameplayCallout = {
      id,
      label: callout.label,
      detail: callout.detail,
      tone,
      x: callout.x,
      y: callout.y,
      announce: callout.announce,
      value: callout.value,
      signed: callout.signed,
      duration,
    };

    setItems((current) => [...current.slice(-(MAX_CALLOUTS - 1)), item]);
    if (tone === 'best' && callout.sound !== false) {
      SoundManager.play('newBest');
      hapticTick();
    }
    const timer = setTimeout(() => {
      timersRef.current.delete(id);
      setItems((current) => current.filter((entry) => entry.id !== id));
    }, duration);
    timersRef.current.set(id, timer);
    return id;
  }, []);

  const clear = useCallback(() => {
    for (const timer of timersRef.current.values()) clearTimeout(timer);
    timersRef.current.clear();
    setItems([]);
  }, []);

  useEffect(
    () => () => {
      for (const timer of timersRef.current.values()) clearTimeout(timer);
      timersRef.current.clear();
    },
    [],
  );

  return { items, push, dismiss, clear } as const;
}

export type NewBestOptions = {
  /** Where it shows, as a percentage of the stage. It stays in the top band. */
  x?: number;
  y?: number;
  /** What the number counts, for screen readers: "points", "pipes". */
  unit?: string;
};

/**
 * The new-best moment, once a run. Call `check(score, best)` whenever the
 * score changes; the first time it passes the best the run started with, a
 * `best` callout shows the score in red with one sound. The rule is
 * `isNewBest`, the same one the result card uses. With no best known yet
 * (null) it stays quiet.
 * `reset()` when a run starts.
 */
export function useNewBestMoment(
  push: (callout: PushGameplayCallout) => number,
  options?: NewBestOptions,
) {
  const firedRef = useRef(false);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const check = useCallback(
    (score: number, best: number | null | undefined) => {
      if (firedRef.current || best == null || !isNewBest(score, best)) return false;
      firedRef.current = true;
      const { x, y, unit } = optionsRef.current ?? {};
      push({
        label: 'New best',
        value: score,
        tone: 'best',
        x,
        y,
        announce: `New best: ${score.toLocaleString('en-US')}${unit ? ` ${unit}` : ''}.`,
      });
      return true;
    },
    [push],
  );

  const reset = useCallback(() => {
    firedRef.current = false;
  }, []);

  return { check, reset } as const;
}
