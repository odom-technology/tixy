'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import type { LucideIcon } from 'lucide-react';

import { ARCADE_GAMES, isGameListed } from '@/features/arcade/components/arcade-game-registry';
import { canonicalGamePath } from '@/features/arcade/lib/game-renames';

export type RecentGameItem = {
  href: string;
  label: string;
  mobileLabel: string;
  icon: LucideIcon;
};

const GAME_ITEMS: RecentGameItem[] = ARCADE_GAMES.map((game) => ({
  href: game.href,
  label: game.routeLabel,
  mobileLabel: game.mobileRouteLabel,
  icon: game.icon,
}));

const RECENT_GAMES_KEY = 'arcade_recent_game_order';

export const isRouteActive = (rawPathname: string, href: string) => {
  const pathname = canonicalGamePath(rawPathname);
  return pathname === href || pathname.startsWith(`${href}/`);
};

const getCanonicalGameHref = (pathname: string): string | null =>
  GAME_ITEMS.find((item) => isRouteActive(pathname, item.href))?.href ?? null;

const readStoredOrder = (): string[] => {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(RECENT_GAMES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is string =>
      typeof entry === 'string' && GAME_ITEMS.some((item) => item.href === entry),
    );
  } catch {
    return [];
  }
};

const writeStoredOrder = (order: string[]) => {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(RECENT_GAMES_KEY, JSON.stringify(order));
  } catch {
    // Ignore localStorage write failures.
  }
};

/* Records the current game route into the recent-games history. Mount this
   ONCE high in the tree (the app shell) so every game visit is captured —
   independent of whether any recent-games UI is on screen. Only real visits
   are stored (no default padding), so the history reflects what was played. */
export function useRecordRecentGame() {
  const pathname = usePathname();

  useEffect(() => {
    const activeGameHref = getCanonicalGameHref(pathname);
    if (activeGameHref === null) return;
    const stored = readStoredOrder();
    writeStoredOrder([
      activeGameHref,
      ...stored.filter((href) => href !== activeGameHref),
    ]);
  }, [pathname]);
}

/* The games a player has ACTUALLY opened (the raw localStorage history, not
   padded with the default catalog), most-recent first. Returns the full
   registry entries so callers get title/icon/section tone. Empty on the
   server and first client paint, then fills after mount — so a "jump back in"
   shelf only appears for returning players and never trips hydration. */
export function useRecentlyPlayedGames(limit = 6) {
  const [games, setGames] = useState<(typeof ARCADE_GAMES)[number][]>([]);

  useEffect(() => {
    const played = readStoredOrder()
      .map((href) => ARCADE_GAMES.find((game) => game.href === href))
      // Hidden games stay in the stored history but are not offered again.
      .filter((game): game is (typeof ARCADE_GAMES)[number] =>
        game !== undefined && isGameListed(game.slug))
      .slice(0, limit);
    setGames(played);
  }, [limit]);

  return games;
}

/* Most-recently-played game ordering, persisted in localStorage. The
   current game is bumped to the front on every navigation. */
export function useRecentGames() {
  const pathname = usePathname();
  const [orderedItems, setOrderedItems] = useState<RecentGameItem[]>(GAME_ITEMS);

  useEffect(() => {
    const defaultOrder = GAME_ITEMS.map((item) => item.href);
    const stored = readStoredOrder();
    const merged = [
      ...stored,
      ...defaultOrder.filter((href) => !stored.includes(href)),
    ];

    const activeGameHref = getCanonicalGameHref(pathname);
    const nextOrder =
      activeGameHref === null
        ? merged
        : [activeGameHref, ...merged.filter((href) => href !== activeGameHref)];

    writeStoredOrder(nextOrder);

    setOrderedItems(
      nextOrder
        .map((href) => GAME_ITEMS.find((item) => item.href === href))
        .filter((item): item is RecentGameItem => Boolean(item)),
    );
  }, [pathname]);

  return { orderedItems, pathname };
}
