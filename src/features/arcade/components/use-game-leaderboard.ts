'use client';

import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { subscribeLive } from '@/lib/liveEvents';
import { fetchPlayerCards } from '@/features/users/use-player-cards';
import { fetchCurrentUserId } from '@/features/users/current-user-client';
import { AccountIdentityContext } from '@/features/arcade/components/shell/use-account-summary';
import type { ProfileFlair } from '@/server/arcade/rewards/profile-flair';

export type GameLeaderboardEntry = {
  id: string;
  userId: string;
  userName: string | null;
  score: number;
  imageUrl?: string | null;
  /** Equipped cosmetic loadout (badge, name color, frame, title, background). */
  flair?: ProfileFlair | null;
  averageTime?: number;
  bestTime?: number;
  wpm?: number;
  accuracy?: number;
  wins?: number;
  losses?: number;
  winRate?: number;
  currentStreak?: number;
  bestStreak?: number;
  // 8-ball specific
  eloRating?: number;
  tier?: string;
  tierColor?: string;
  totalWins?: number;
  totalLosses?: number;
  totalDraws?: number;
  fewestTurns?: number;
  totalTurnDurationMs?: number | null;
  achievedAt?: number;
  totalGamesPlayed?: number;
  accuracyPercentage?: number;
  // chess specific
  fewestPly?: number;
  totalThinkingMs?: number | null;
};

interface UseGameLeaderboardOptions {
  gameType: string;
  refreshKey?: number;
  mode?: number | string; // For typing-test mode or 8-ball mode selection
  limit?: number | 'all';
  /** `last` reads last season's board from a route that offers `?season=last`. */
  season?: 'last';
  /** False skips the fetch (the board reads another source). */
  enabled?: boolean;
}

export function useGameLeaderboard({
  gameType,
  refreshKey,
  mode,
  limit,
  season,
  enabled = true,
}: UseGameLeaderboardOptions) {
  const hasServerIdentity = useContext(AccountIdentityContext);
  const [leaderboard, setLeaderboard] = useState<GameLeaderboardEntry[]>([]);
  const [pinnedEntry, setPinnedEntry] = useState<(GameLeaderboardEntry & { rank?: number | null }) | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const hasFetchedRef = useRef(false);
  const latestFetchRef = useRef<(() => void) | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const fetchLeaderboard = useCallback(async () => {
    // Abort any in-flight request before starting a new one
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;
    let wasAborted = false;

    try {
      // Only show loading skeleton on initial fetch, not on refreshes
      if (!hasFetchedRef.current) {
        setIsLoading(true);
      }
      const query = new URLSearchParams();
      if (mode != null) query.set('mode', String(mode));
      if (limit != null) query.set('limit', String(limit));
      if (season) query.set('season', season);
      const queryString = query.toString();
      const url = queryString
        ? `/api/games/${gameType}/leaderboard?${queryString}`
        : `/api/games/${gameType}/leaderboard`;
      const response = await fetch(url, {
        cache: 'no-store',
        signal: controller.signal,
      });
      if (!response.ok) {
        setLeaderboard([]);
        setPinnedEntry(null);
        return;
      }

      const data = await response.json();
      controller.signal.throwIfAborted();
      const entries: GameLeaderboardEntry[] = data.leaderboard || [];

      if (entries.length === 0) {
        setLeaderboard([]);
        setPinnedEntry(data.currentUserEntry ?? null);
        return;
      }

      const userIds = entries.map((entry) => entry.userId).filter(Boolean);
      // Also fetch the cosmetic card for the pinned entry if present.
      if (data.currentUserEntry?.userId) {
        userIds.push(data.currentUserEntry.userId);
      }

      // Batch-fetch every player's full cosmetic namecard (avatar + equipped
      // flair) so each row can show the player's loadout. Best-effort: an empty
      // map just renders rows with name + initials.
      const cards = await fetchPlayerCards(userIds);
      controller.signal.throwIfAborted();
      const hydrate = (entry: GameLeaderboardEntry): GameLeaderboardEntry => {
        const card = cards[entry.userId];
        if (!card) return entry;
        return {
          ...entry,
          imageUrl: card.avatarUrl ?? entry.imageUrl ?? null,
          flair: card.flair ?? null,
        };
      };

      const hydratedEntries = entries.map(hydrate);
      setLeaderboard(hydratedEntries);

      const serverPinnedEntry = data.currentUserEntry ?? null;
      if (serverPinnedEntry) {
        setPinnedEntry(hydrate(serverPinnedEntry));
      } else if (hasServerIdentity !== false) {
        const currentUserId = await fetchCurrentUserId();
        controller.signal.throwIfAborted();
        if (currentUserId) {
          const rankIndex = hydratedEntries.findIndex(
            (entry) => entry.userId === currentUserId,
          );
          if (rankIndex >= 0) {
            setPinnedEntry({
              ...hydratedEntries[rankIndex],
              rank: rankIndex + 1,
            });
          } else {
            setPinnedEntry(null);
          }
        } else {
          setPinnedEntry(null);
        }
      } else setPinnedEntry(null);
    } catch (error) {
      // Silently ignore aborts (e.g. unmount, navigation, or timeout)
      if (error instanceof DOMException && error.name === 'AbortError') {
        wasAborted = true;
        return;
      }
      console.error('Failed to fetch leaderboard:', error);
      setLeaderboard([]);
      setPinnedEntry(null);
    } finally {
      if (!wasAborted) {
        hasFetchedRef.current = true;
        setIsLoading(false);
      }
    }
  }, [gameType, hasServerIdentity, limit, mode, season]);

  // Set up polling and SSE
  useEffect(() => {
    const fetchIfVisible = () => {
      if (!document.hidden) void fetchLeaderboard();
    };
    latestFetchRef.current = fetchIfVisible;
    if (!enabled) {
      setIsLoading(false);
      return;
    }

    void fetchLeaderboard();
    const interval = setInterval(fetchIfVisible, 30000);
    document.addEventListener('visibilitychange', fetchIfVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', fetchIfVisible);
      // Abort any in-flight request on unmount/cleanup
      abortControllerRef.current?.abort();
    };
  }, [enabled, gameType, refreshKey, mode, limit, fetchLeaderboard]);

  // Subscribe to the global SSE singleton for real-time updates
  useEffect(() => {
    if (!enabled) return;
    return subscribeLive(['gameLeaderboards'], () => {
      latestFetchRef.current?.();
    });
  }, [enabled, gameType]);

  return { leaderboard, pinnedEntry, isLoading };
}
