'use client';

/* What the 8-ball lobby and match pages share inside the game shell:
   the ? sheet, the practice level and its memory on this device. */

import { useCallback, useSyncExternalStore } from 'react';

import type { GameHowTo } from '@/features/arcade/components/shell/game-shell';

import './pool-shell.css';

export const POOL_HOW_TO: GameHowTo = {
  lines: [
    'Aim at a ball, then drag back and let go to shoot.',
    'Sink your 7 balls before the 8, or the 8 loses it.',
    'A win pays 84 tickets, or 30 to 72 against the bot.',
  ],
};

export type PracticeLevel = 'easy' | 'medium' | 'hard';
export const PRACTICE_LEVELS: readonly PracticeLevel[] = ['easy', 'medium', 'hard'];

const LEVEL_KEY = 'tixy_pool_practice_level';
const listeners = new Set<() => void>();

function readLevel(): PracticeLevel {
  try {
    const stored = window.localStorage.getItem(LEVEL_KEY);
    if (stored === 'easy' || stored === 'medium' || stored === 'hard') return stored;
  } catch {
    /* storage blocked */
  }
  return 'medium';
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The practice level, medium until the player picks another under the table. */
export function usePracticeLevel(): [PracticeLevel, (level: PracticeLevel) => void] {
  const level = useSyncExternalStore(subscribe, readLevel, () => 'medium' as const);
  const setLevel = useCallback((next: PracticeLevel) => {
    try {
      window.localStorage.setItem(LEVEL_KEY, next);
    } catch {
      /* storage blocked: the level lasts for this page */
    }
    for (const listener of listeners) listener();
  }, []);
  return [level, setLevel];
}
