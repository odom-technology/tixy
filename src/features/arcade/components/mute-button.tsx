'use client';

import { useState, useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { SoundManager, type SoundLevel } from '@/features/arcade/lib/sound-manager';
import { ArcadeButton } from '@/features/arcade/components/ui/arcade-ui';

const NEXT_LEVEL_LABEL: Record<SoundLevel, string> = {
  off: 'sound off, press for low',
  low: 'sound low, press for high',
  high: 'sound high, press for off',
};

/**
 * Sound control for game sounds. Each press steps the level: off, low, high,
 * then off again. The level is device-local and shared by every control.
 *
 * The level lives in localStorage, so the server can't know it. The server
 * snapshot is null and the button shows a plain speaker until hydration,
 * instead of flashing the muted icon at players who have sound on. All
 * mounted controls stay in sync through the shared manager.
 */
export function MuteButton() {
  const level = useSyncExternalStore(
    (listener) => SoundManager.subscribe(listener),
    () => SoundManager.getLevel(),
    (): SoundLevel | null => null,
  );
  const [pulse, setPulse] = useState(false);
  const pulseTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (pulseTimeoutRef.current !== null) {
        window.clearTimeout(pulseTimeoutRef.current);
      }
    };
  }, []);

  const toggle = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const next = SoundManager.cycleLevel();
    if (next !== 'off') {
      // This runs synchronously inside the trusted click gesture. Later remote
      // move/settlement cues can then use the already-unlocked shared context.
      SoundManager.unlock();
      SoundManager.play('arcadeBet', { volume: 0.42 });
    }
    setPulse(true);
    if (pulseTimeoutRef.current !== null) {
      window.clearTimeout(pulseTimeoutRef.current);
    }
    pulseTimeoutRef.current = window.setTimeout(() => {
      setPulse(false);
      pulseTimeoutRef.current = null;
    }, 150);
  }, []);

  return (
    <ArcadeButton
      tone='ghost'
      size='icon'
      onClick={toggle}
      className={`min-w-11 min-h-11 ${pulse ? 'scale-110' : 'scale-100'}`}
      aria-label={level ? NEXT_LEVEL_LABEL[level] : 'sound'}
      title={level ? NEXT_LEVEL_LABEL[level] : undefined}
    >
      {level === 'off' ? (
        <svg
          width='20'
          height='20'
          viewBox='0 0 24 24'
          fill='none'
          stroke='currentColor'
          strokeWidth='2'
          strokeLinecap='round'
          strokeLinejoin='round'
        >
          <path d='M11 5L6 9H2v6h4l5 4V5z' />
          <line x1='23' y1='9' x2='17' y2='15' />
          <line x1='17' y1='9' x2='23' y2='15' />
        </svg>
      ) : (
        <svg
          width='20'
          height='20'
          viewBox='0 0 24 24'
          fill='none'
          stroke='currentColor'
          strokeWidth='2'
          strokeLinecap='round'
          strokeLinejoin='round'
        >
          <path d='M11 5L6 9H2v6h4l5 4V5z' />
          {level ? <path d='M15.54 8.46a5 5 0 0 1 0 7.07' /> : null}
          {level === 'high' ? <path d='M19.07 4.93a10 10 0 0 1 0 14.14' /> : null}
        </svg>
      )}
    </ArcadeButton>
  );
}
