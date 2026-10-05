'use client';

/* Who is waiting for you, read while the social panel is open: challenges
   and friends' open tables, and matches where it is your move. The same
   /api/home/live the home page reads. It refreshes on a notification or a
   presence change for this player (at most every 5 s), every 30 s while the
   tab is visible, and when the tab comes back. New invites come back in
   `arrived` so the row can slide in and ring. */

import { useCallback, useEffect, useRef, useState } from 'react';

import type { HomeLive, HomeOnNow } from '@/features/arcade/components/home/tixy-home-types';
import { subscribeLive } from '@/lib/liveEvents';

const REFRESH_MS = 30_000;
const EVENT_MIN_GAP_MS = 5_000;

export function useSocialLive(userId: string | null, active: boolean) {
  const [onNow, setOnNow] = useState<HomeOnNow | null>(null);
  const [arrived, setArrived] = useState<ReadonlySet<string>>(() => new Set());
  const known = useRef<Set<string> | null>(null);
  const inFlight = useRef(false);
  const lastAt = useRef(0);
  const timer = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    lastAt.current = Date.now();
    try {
      const response = await fetch('/api/home/live', { cache: 'no-store' });
      if (!response.ok) return;
      const next = ((await response.json()) as HomeLive).onNow;
      if (!next) return;
      const ids = next.waiting.map((entry) => entry.matchId);
      if (known.current) {
        const fresh = ids.filter((id) => !known.current!.has(id));
        if (fresh.length > 0) setArrived((previous) => new Set([...previous, ...fresh]));
      }
      known.current = new Set([...(known.current ?? []), ...ids]);
      setOnNow(next);
    } catch {
      // keep what is on screen
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    if (!userId || !active) return;
    void refresh();
    const soon = () => {
      if (timer.current != null) return;
      const wait = Math.max(0, lastAt.current + EVENT_MIN_GAP_MS - Date.now());
      timer.current = window.setTimeout(() => {
        timer.current = null;
        void refresh();
      }, wait);
    };
    const unsubscribe = subscribeLive([`user:${userId}`], (payload) => {
      const type = (payload as { type?: string } | null)?.type;
      if (type === 'notification' || type === 'presence') soon();
    });
    const interval = window.setInterval(() => {
      if (!document.hidden) void refresh();
    }, REFRESH_MS);
    const onVisible = () => {
      if (!document.hidden && Date.now() - lastAt.current > EVENT_MIN_GAP_MS) void refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      unsubscribe();
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
      if (timer.current != null) window.clearTimeout(timer.current);
      timer.current = null;
    };
  }, [active, refresh, userId]);

  return { onNow, arrived, refresh };
}
