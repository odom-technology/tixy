'use client';

import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from 'react';

import { Num } from '@/features/arcade/components/ui/num';
import {
  STRIP_TIMING as T,
  useCueTimers,
  type ResultClock,
} from '@/features/arcade/components/results/result-sequence';
import { SoundManager } from '@/features/arcade/lib/sound-manager';
import { useRollingNumber } from '@/features/arcade/lib/use-rolling-number';
import { TixyHost } from '@/features/brand/tixy-host';

/* The ticket strip: what a skill game prints when it ends (tixy theme).
   Stubs print one at a time, the total counts, the strip tears, and the host
   walks over to hand it to you when it pays. The look and timing are the
   mockup's `.strip` and its d-res sequence (docs/design/tixy-rebrand). */

export type TicketLine = {
  /** Lowercase noun: "win", "run of 3", "daily cap". */
  label: string;
  tickets: number;
};

type Plan = {
  drops: number[];
  countAt: number;
  tearAt: number;
  hostAt: number;
  doneAt: number;
};

/** Times from now, squeezed so the strip finishes inside the 3 s cap. */
function planStrip(stubs: number, startIn: number, budget: number): Plan {
  const tail = T.totalAfter + T.tearAfter + T.tearMs;
  const room = budget - startIn - tail;
  // Squeeze the gap, down to nothing, so any number of stubs fits the cap.
  const gap = stubs > 1 ? Math.max(0, Math.min(T.stubGap, room / (stubs - 1))) : 0;
  const drops = Array.from({ length: stubs }, (_, index) => startIn + index * gap);
  const countAt = drops[drops.length - 1]! + T.totalAfter;
  const tearAt = countAt + T.tearAfter;
  return {
    drops,
    countAt,
    tearAt,
    hostAt: Math.max(0, tearAt - T.hostLead),
    doneAt: tearAt + T.tearMs,
  };
}

export function TicketStrip({
  lines,
  total,
  clock,
  startAt,
  sequenceKey,
  onDone,
  sound = true,
  className,
}: {
  /** Stubs above the total. Empty prints the total alone. */
  lines: TicketLine[];
  /** The tickets this result paid. 0 prints a void strip and no host. */
  total: number;
  clock: ResultClock;
  /** ms after the clock started that the first stub prints. */
  startAt: number;
  /** Change it to print again (a new result). */
  sequenceKey: string;
  /** Called with `sequenceKey` once the strip has torn (or was skipped). */
  onDone?: (sequenceKey: string) => void;
  /** Printer ticks and the tear. ArcadeRunRewards passes `ticketSound`. */
  sound?: boolean;
  className?: string;
}) {
  const id = useId();
  const pays = total > 0;
  const stubs = lines.length + 1;
  const [mountedAt] = useState(() => performance.now());
  const plan = useMemo(() => {
    const elapsed = mountedAt - clock.startedAt;
    return planStrip(stubs, Math.max(0, startAt - elapsed), Math.max(0, T.capMs - elapsed));
    // Planned once per print; a later clock tick must not move the stubs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sequenceKey, stubs]);

  const [phase, setPhase] = useState<'print' | 'count' | 'done'>('print');
  const tornRef = useRef(false);
  const done = clock.instant || clock.skipped || phase === 'done';
  const counting = done || phase === 'count';
  const shownTotal = useRollingNumber(counting ? total : 0, {
    duration: clock.instant || clock.skipped ? 0 : T.totalMs,
  });

  const cues = useMemo(
    () => [
      ...plan.drops.map((at, index) => ({
        at,
        run: () => {
          if (sound) SoundManager.play('printerTick', { pitch: 1 + index * 0.06 });
        },
      })),
      { at: plan.countAt, run: () => setPhase((p) => (p === 'print' ? 'count' : p)) },
      {
        at: plan.tearAt,
        run: () => {
          tornRef.current = true;
          if (sound) SoundManager.play('ticketTear');
        },
      },
      { at: plan.doneAt, run: () => setPhase('done') },
    ],
    // One plan per print.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [plan],
  );
  useCueTimers(sequenceKey, cues, clock.skipped);

  // A skip lands on the torn strip, so it still sounds torn.
  useEffect(() => {
    if (!clock.skipped || tornRef.current) return;
    tornRef.current = true;
    if (sound) SoundManager.play('ticketTear');
  }, [clock.skipped, sound]);

  const { setPrinting } = clock;
  useEffect(() => {
    setPrinting(id, !done);
    return () => setPrinting(id, false);
  }, [id, done, setPrinting]);

  useEffect(() => {
    if (done) onDone?.(sequenceKey);
  }, [done, onDone, sequenceKey]);

  const at = (ms: number) => ({ '--at': `${Math.round(ms)}ms` }) as CSSProperties;

  return (
    <div
      className={['arc-strip-wrap', className].filter(Boolean).join(' ')}
      data-state={done ? 'done' : 'run'}
      data-pays={pays || undefined}
      // The strip leans 3 degrees from its top, so a long one ends further
      // right; the host steps over by the same amount (62 px × tan 3°).
      style={{ '--lean': `${Math.max(0, stubs - 3) * 3.25}px` } as CSSProperties}
    >
      <div className='arc-strip' style={{ '--tear-at': `${Math.round(plan.tearAt)}ms` } as CSSProperties}>
        {lines.map((line, index) => (
          <div key={`${line.label}-${index}`} className='arc-strip-stub' style={at(plan.drops[index]!)}>
            <span>{line.label}</span>
            <Num value={line.tickets} signed={line.tickets < 0} />
          </div>
        ))}
        <div className='arc-strip-stub' data-total='' style={at(plan.drops[stubs - 1]!)}>
          <span>tickets</span>
          <Num value={shownTotal} signed labelValue={total} labelSuffix='tickets' />
        </div>
      </div>
      {pays ? (
        <TixyHost className='arc-strip-host' width={96} style={at(plan.hostAt)} />
      ) : null}
    </div>
  );
}
