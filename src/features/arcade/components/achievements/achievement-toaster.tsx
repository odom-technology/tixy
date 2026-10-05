'use client';

// Global achievement-unlock toaster. Any client (a score submission, the secret
// trigger helper) calls notifyAchievements(list) to surface freshly-unlocked
// achievements; this component, mounted once in the app shell, renders them.
// Unlocks enter a sequential queue so every award gets a complete ceremony.
import { useCallback, useEffect, useRef, useState } from 'react';

import { prefersReducedMotion } from '@/features/arcade/components/ui/arcade-interactive';
import { ArcadeToast } from '@/features/arcade/components/ui/arcade-toast';
import { Num } from '@/features/arcade/components/ui/num';
import { SoundManager } from '@/features/arcade/lib/sound-manager';
import { AchievementIcon } from './achievement-icon';

export type AchievementToast = {
  id: string;
  name: string;
  description: string;
  icon: string;
  rarity: string;
  tierLabel?: string;
  xp: number;
};

const ACHIEVEMENT_EVENT = 'arcade:achievements';
const EXIT_MS = 180;
const HOLD_MS = 5600;

type ToastRow = AchievementToast & {
  state: 'open' | 'closed';
};

/** Dispatch unlocked achievements to the global toaster. Safe to call anywhere. */
export function notifyAchievements(list: AchievementToast[] | undefined | null) {
  if (typeof window === 'undefined' || !list || list.length === 0) return;
  window.dispatchEvent(new CustomEvent(ACHIEVEMENT_EVENT, { detail: list }));
}

export function AchievementToaster() {
  const [current, setCurrent] = useState<ToastRow | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const queueRef = useRef<AchievementToast[]>([]);
  const seenIdsRef = useRef(new Set<string>());
  const celebratedIdsRef = useRef(new Set<string>());

  const presentNext = useCallback(() => {
    setCurrent((active) => {
      if (active) return active;
      const next = queueRef.current.shift();
      return next ? { ...next, state: 'open' } : null;
    });
  }, []);

  const dismiss = useCallback((id: string) => {
    setCurrent((active) =>
      active?.id === id ? { ...active, state: 'closed' } : active,
    );
  }, []);

  useEffect(() => {
    function onEvent(event: Event) {
      const detail = (event as CustomEvent<AchievementToast[]>).detail;
      if (!Array.isArray(detail) || detail.length === 0) return;

      for (const achievement of detail) {
        if (!achievement?.id || seenIdsRef.current.has(achievement.id)) continue;
        seenIdsRef.current.add(achievement.id);
        queueRef.current.push(achievement);
      }
      presentNext();
    }
    window.addEventListener(ACHIEVEMENT_EVENT, onEvent);
    return () => window.removeEventListener(ACHIEVEMENT_EVENT, onEvent);
  }, [presentNext]);

  useEffect(() => {
    if (!current) {
      presentNext();
      return;
    }

    if (current.state === 'closed') {
      const exitTimer = window.setTimeout(
        () => setCurrent(null),
        prefersReducedMotion() ? 0 : EXIT_MS,
      );
      return () => window.clearTimeout(exitTimer);
    }

    // Effects run twice in development Strict Mode. Keep the user-facing
    // announcement and cue singular while still recreating the cleanup timer.
    if (!celebratedIdsRef.current.has(current.id)) {
      celebratedIdsRef.current.add(current.id);
      setAnnouncement(
        `Achievement unlocked: ${current.name}. ${current.description} ${current.xp.toLocaleString()} xp.`,
      );
      SoundManager.play('achievementUnlock', {
        pitch: current.rarity === 'legendary' ? 1.22 : 1,
        volume: current.rarity === 'legendary' ? 1 : 0.82,
      });
    }

    const holdTimer = window.setTimeout(() => dismiss(current.id), HOLD_MS);
    return () => window.clearTimeout(holdTimer);
  }, [current, dismiss, presentNext]);

  return (
    <>
      <span className='sr-only' aria-live='polite' aria-atomic='true'>
        {announcement}
      </span>
      {current ? (
        <div className='pointer-events-none fixed right-3 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-[120] sm:right-6 sm:bottom-6'>
          <ArcadeToast
            state={current.state}
            className='pointer-events-auto'
            href='/achievements'
            linkLabel={`View achievement: ${current.name}`}
            icon={<AchievementIcon src={current.icon} alt='' size={52} />}
            title={current.name}
            meta={
              <>
                <Num className='arc-num-pop' value={current.xp} signed /> xp
              </>
            }
            onDismiss={() => dismiss(current.id)}
            dismissLabel={`Dismiss ${current.name} achievement`}
          >
            {current.description}
          </ArcadeToast>
        </div>
      ) : null}
    </>
  );
}
