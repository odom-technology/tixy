'use client';

import { useEffect, useState } from 'react';

import type { NamecardCosmetics } from '@/features/users/components/namecard';
import { subscribeLive } from '@/lib/liveEvents';

export type ClientPlayerCard = NamecardCosmetics & { userId: string };

/**
 * Batch-fetch player namecards (name + avatar + equipped flair) for a set of
 * user ids. Used by client leaderboards / match views so every row can render
 * the player's full cosmetic loadout. Returns a record keyed by userId.
 */
export function usePlayerCards(userIds: string[]): Record<string, ClientPlayerCard> {
  const [cards, setCards] = useState<Record<string, ClientPlayerCard>>({});
  // Stable key so we only refetch when the actual set of ids changes.
  const key = [...new Set(userIds.filter(Boolean))].sort().join(',');

  useEffect(() => {
    const ids = key ? key.split(',') : [];
    if (ids.length === 0) {
      setCards({});
      return;
    }
    let cancelled = false;
    let controller: AbortController | null = null;
    const load = async () => {
      controller?.abort();
      const requestController = new AbortController();
      controller = requestController;
      try {
        const res = await fetch('/api/users/cards', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userIds: ids }),
          cache: 'no-store',
          signal: requestController.signal,
        });
        if (!res.ok) return;
        const data = (await res.json()) as { cards?: Record<string, ClientPlayerCard> };
        if (!cancelled && !requestController.signal.aborted && data.cards) setCards(data.cards);
      } catch {
        /* best-effort cosmetics; leaderboard still renders without them */
      }
    };
    const refreshIfVisible = () => {
      if (!document.hidden) void load();
    };
    void load();
    // Identity updates do not change the id set, so they need an explicit refresh.
    // Ordinary score events leave cosmetics alone to avoid repeating this request.
    const unsubscribe = subscribeLive(['gameLeaderboards'], (payload) => {
      if (payload.reason === 'profile-updated' && typeof payload.userId === 'string' && ids.includes(payload.userId)) {
        refreshIfVisible();
      }
    });
    document.addEventListener('visibilitychange', refreshIfVisible);
    return () => {
      cancelled = true;
      controller?.abort();
      unsubscribe();
      document.removeEventListener('visibilitychange', refreshIfVisible);
    };
  }, [key]);

  return cards;
}

/** One-shot batch fetch (non-hook) for imperative callers. */
export async function fetchPlayerCards(
  userIds: string[],
): Promise<Record<string, ClientPlayerCard>> {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (ids.length === 0) return {};
  try {
    const res = await fetch('/api/users/cards', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userIds: ids }),
      cache: 'no-store',
    });
    if (!res.ok) return {};
    const data = (await res.json()) as { cards?: Record<string, ClientPlayerCard> };
    return data.cards ?? {};
  } catch {
    return {};
  }
}
