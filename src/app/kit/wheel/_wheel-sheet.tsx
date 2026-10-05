'use client';

/* /kit/wheel: the daily spin with a local draw. Query: day (streak day),
   unit (force the draw), latency (ms), fail=1, spun=1 (already spun). The
   draw here is the client's and pays nothing; the real one is the server's. */

import { useCallback, useMemo, useState } from 'react';

import {
  DailySpinDialog,
  type DailySpinResult,
  type DailySpinView,
} from '@/features/arcade/components/daily-wheel/daily-spin';
import { DAILY_WHEEL_UNITS, wheelMultiplier, wheelPayout } from '@/features/arcade/lib/daily-wheel';

import '@/features/arcade/components/home/tixy-home.css';

declare global {
  interface Window {
    __wheelFrames?: number[];
    __wheelTurning?: boolean[];
    __wheelWork?: number[];
  }
}

function param(name: string) {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search).get(name);
}

export function WheelSheet() {
  const [open, setOpen] = useState(true);
  const [balance, setBalance] = useState(1874);
  const [runs, setRuns] = useState(0);
  const view = useMemo<DailySpinView>(() => {
    const day = Number(param('day') ?? 5);
    const todayKey = '2026-10-04';
    const spunUnit = param('spun') ? Number(param('unit') ?? 7) : null;
    const spun: DailySpinResult | null =
      spunUnit === null
        ? null
        : (() => {
            const pay = wheelPayout(spunUnit, day);
            return { dateKey: todayKey, streak: day, ...pay, balanceAfter: null };
          })();
    return {
      streakDay: day,
      multiplier: wheelMultiplier(day),
      hold: 0,
      todayKey: `${todayKey}#${runs}`,
      spun,
      nextAtMs: Date.now() + 9 * 3600_000 + 12 * 60_000,
    };
  }, [runs]);

  const request = useCallback(async (): Promise<DailySpinResult> => {
    const latency = Number(param('latency') ?? 160);
    await new Promise((resolve) => window.setTimeout(resolve, latency));
    if (param('fail')) throw new Error('The spin did not go through. Try again.');
    const forced = param('unit');
    const unit = forced !== null ? Number(forced) : crypto.getRandomValues(new Uint32Array(1))[0]! % DAILY_WHEEL_UNITS;
    const pay = wheelPayout(unit, view.streakDay);
    return { dateKey: view.todayKey, streak: view.streakDay, ...pay, balanceAfter: null };
  }, [view]);

  const onFrame = useCallback((now: number, turning: boolean, workMs: number) => {
    (window.__wheelFrames ??= []).push(now);
    (window.__wheelTurning ??= []).push(turning);
    (window.__wheelWork ??= []).push(workMs);
  }, []);

  return (
    <main className='tx-home' style={{ padding: 24 }}>
      <p>
        <button
          type='button'
          className='tx-btn'
          onClick={() => {
            setRuns((n) => n + 1);
            setOpen(true);
          }}
        >
          open
        </button>
      </p>
      {open ? (
        <DailySpinDialog
          key={runs}
          open
          onClose={() => setOpen(false)}
          view={view}
          balance={balance}
          onCredit={(delta) => setBalance((b) => b + delta)}
          onSpun={() => undefined}
          request={request}
          onFrame={onFrame}
        />
      ) : null}
    </main>
  );
}
