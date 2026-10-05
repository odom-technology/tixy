'use client';

// Client-side easter-egg detectors + the shared trigger helper. Detected events
// POST to /api/achievements/trigger; any resulting unlocks are toasted via the
// global AchievementToaster.
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';

import { getFloorGames, getListedGames } from '@/features/arcade/components/arcade-game-registry';

import { notifyAchievements } from './achievement-toaster';

const KONAMI = [
  'ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown',
  'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight',
  'b', 'a',
];

/** Fire a named secret trigger. Safe to call from anywhere on the client. */
export async function triggerSecret(key: string) {
  try {
    const res = await fetch('/api/achievements/trigger', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key }),
    });
    if (!res.ok) return;
    const data = (await res.json()) as { achievements?: Parameters<typeof notifyAchievements>[0] };
    notifyAchievements(data.achievements);
  } catch {
    /* best-effort */
  }
}

const LOGO_CLICKS = 10;
const LOGO_GAP_MS = 2000;
const QUICK_QUIT_MS = 5000;
const EXPLORED_KEY = 'arcade:secret:explored';

/** The listed games by route, for "quit a game fast". */
const GAME_HREFS = getListedGames().map((game) => game.href);
const isGamePath = (path: string) => GAME_HREFS.includes(path);
/** Cartographer asks for the floor: the reserve is a list away and the rest redirect. */
const FLOOR_HREFS = getFloorGames().map((game) => game.href);

export function SecretEasterEggs() {
  const seq = useRef<string[]>([]);
  const pathname = usePathname();
  const arrival = useRef<{ path: string; at: number } | null>(null);

  // Route-driven secrets: Touch Grass (leave a game within 5 seconds),
  // Cartographer (every game page on the floor in one session), Window Shopper
  // (each store visit; the server clears the count on a purchase).
  useEffect(() => {
    const prev = arrival.current;
    if (prev && isGamePath(prev.path) && prev.path !== pathname && Date.now() - prev.at < QUICK_QUIT_MS) {
      void triggerSecret('rage_quit');
    }
    arrival.current = { path: pathname, at: Date.now() };

    if (pathname.startsWith('/store')) void triggerSecret('window_shopper');

    if (FLOOR_HREFS.includes(pathname)) {
      try {
        const seen = new Set<string>(JSON.parse(window.sessionStorage.getItem(EXPLORED_KEY) ?? '[]'));
        if (!seen.has(pathname)) {
          seen.add(pathname);
          window.sessionStorage.setItem(EXPLORED_KEY, JSON.stringify([...seen]));
          if (FLOOR_HREFS.every((href) => seen.has(href))) void triggerSecret('explorer');
        }
      } catch {
        /* storage disabled: the session just can't be tracked */
      }
    }
  }, [pathname]);

  // Stop Poking Me: the logo, 10 clicks in a row with under 2 seconds between them.
  useEffect(() => {
    let count = 0;
    let last = 0;
    function onClick(e: MouseEvent) {
      const onLogo = (e.target as Element | null)?.closest?.('a[aria-label="tixy.lol"]');
      const now = Date.now();
      if (!onLogo || now - last > LOGO_GAP_MS) count = 0;
      if (!onLogo) return;
      count += 1;
      last = now;
      if (count >= LOGO_CLICKS) {
        count = 0;
        void triggerSecret('logo');
      }
    }
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, []);

  useEffect(() => {
    // Konami code, anywhere.
    function onKey(e: KeyboardEvent) {
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      const next = [...seq.current, key].slice(-KONAMI.length);
      seq.current = next;
      if (next.length === KONAMI.length && next.every((k, i) => k === KONAMI[i])) {
        seq.current = [];
        void triggerSecret('konami');
      }
    }
    window.addEventListener('keydown', onKey);
    // NOTE: time-of-day + New-Year secrets are detected server-side on a real
    // game run (see stats/pipeline.ts secretRunDeltas) so they can't be spoofed
    // by simply having the app open at the right hour.
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return null;
}
