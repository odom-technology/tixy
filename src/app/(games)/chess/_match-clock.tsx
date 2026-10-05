'use client';

import { useEffect, useRef, useState } from 'react';
import { Num } from '@/features/arcade/components/ui/num';
import { playMoveSound } from './_sounds';
import './_chess.css';

type Props = {
  /** Player's remaining clock at the lastSyncAt timestamp (ms). */
  remainingAtSyncMs: number;
  /** Timestamp the clock snapshot was captured. */
  lastSyncAt: number;
  /** Whether this clock is currently ticking down (it's this player's turn and match active). */
  ticking: boolean;
  /** Label, typically the player name. Empty for the compact row. */
  label: string;
  /** Tick once a second under 10 seconds while the clock runs. Your own clock only. */
  tickWhenLow?: boolean;
};

const LOW_MS = 10_000;

function formatClock(ms: number) {
  const clampedMs = Math.max(0, ms);
  const totalSeconds = Math.floor(clampedMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes >= 10) return `${minutes}:${String(seconds).padStart(2, '0')}`;
  // Below 10 minutes, show tenths of a second once under a minute
  if (minutes === 0 && clampedMs < 60_000) {
    const tenths = Math.floor((clampedMs % 1000) / 100);
    return `${seconds}.${tenths}`;
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function MatchClock({
  remainingAtSyncMs,
  lastSyncAt,
  ticking,
  label,
  tickWhenLow = false,
}: Props) {
  const [, setTick] = useState(0);
  const rafRef = useRef<number | null>(null);
  // The frame loop reads the latest snapshot without restarting.
  const snapshotRef = useRef({ remainingAtSyncMs, lastSyncAt, tickWhenLow });
  snapshotRef.current = { remainingAtSyncMs, lastSyncAt, tickWhenLow };
  const lastTickSecondRef = useRef<number | null>(null);

  useEffect(() => {
    if (!ticking) {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      lastTickSecondRef.current = null;
      return;
    }
    const step = () => {
      const snap = snapshotRef.current;
      const ms = snap.remainingAtSyncMs - (Date.now() - snap.lastSyncAt);
      if (snap.tickWhenLow && ms > 0 && ms < LOW_MS) {
        // One tick as each whole second comes up: 9, 8, 7 ... 1.
        const second = Math.ceil(ms / 1000);
        if (second !== lastTickSecondRef.current) {
          lastTickSecondRef.current = second;
          playMoveSound('lowTime');
        }
      } else {
        lastTickSecondRef.current = null;
      }
      setTick((t) => t + 1);
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [ticking]);

  const displayMs = ticking
    ? Math.max(0, remainingAtSyncMs - (Date.now() - lastSyncAt))
    : remainingAtSyncMs;

  const low = ticking && displayMs < LOW_MS;
  const text = formatClock(displayMs);

  return (
    <div
      className={`chess-arcade chess-clock ${
        low ? 'chess-clock-low' : ticking ? 'chess-clock-active' : 'chess-clock-idle'
      }`}
      role='timer'
      aria-label={`${label ? `${label}, ` : ''}${ticking ? 'clock running' : 'clock stopped'}`}
    >
      {label ? <div className='mr-auto truncate pr-3 text-sm font-bold'>{label}</div> : null}
      <div className='chess-clock-time'>
        <Num value={text} />
      </div>
    </div>
  );
}
