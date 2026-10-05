'use client';

import {
  createContext,
  startTransition,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import type { PageHeaderWallet } from '@/features/arcade/components/shell/page-header';

import type { GamesWalletSnapshot } from './games-wallet-types';

type GamesWalletContextValue = {
  wallet: PageHeaderWallet;
  dailyCredits: GamesWalletSnapshot['dailyCredits'];
  isRefreshing: boolean;
  /** True once a real balance is known (an initial snapshot or a fetch). */
  loaded: boolean;
  refresh: () => Promise<void>;
  setSnapshot: (snapshot: GamesWalletSnapshot | null) => void;
  /** Optimistically nudge the displayed balance (e.g. debit a wager before the server confirms). */
  adjustCredits: (delta: number) => void;
};

const DEFAULT_SNAPSHOT: GamesWalletSnapshot = {
  credits: 0,
  dailyCredits: {
    earned: 0,
    cap: 300,
  },
};

const GamesWalletContext = createContext<GamesWalletContextValue | null>(null);

function normalizeSnapshot(snapshot: GamesWalletSnapshot | null | undefined): GamesWalletSnapshot {
  return snapshot ?? DEFAULT_SNAPSHOT;
}

export function GamesWalletProvider({
  children,
  initialSnapshot,
}: {
  children: ReactNode;
  initialSnapshot?: GamesWalletSnapshot | null;
}) {
  const [snapshot, setSnapshotState] = useState<GamesWalletSnapshot>(
    normalizeSnapshot(initialSnapshot),
  );
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [fetched, setFetched] = useState(false);
  const loaded = initialSnapshot != null || fetched;

  useEffect(() => {
    setSnapshotState(normalizeSnapshot(initialSnapshot));
  }, [initialSnapshot]);

  const setSnapshot = useCallback((nextSnapshot: GamesWalletSnapshot | null) => {
    startTransition(() => {
      setSnapshotState(normalizeSnapshot(nextSnapshot));
    });
  }, []);

  // Deliberately not wrapped in startTransition: optimistic wager debits
  // should paint immediately, like the local setState they replace.
  const adjustCredits = useCallback((delta: number) => {
    setSnapshotState((prev) => ({ ...prev, credits: prev.credits + delta }));
  }, []);

  const refresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const response = await fetch('/api/store/inventory', { cache: 'no-store' });
      if (!response.ok) return;
      const payload = (await response.json()) as {
        wallet?: { credits?: number };
        dailyGameCredits?: { earned?: number; cap?: number };
      };
      startTransition(() => {
        setSnapshotState({
          credits: payload.wallet?.credits ?? 0,
          dailyCredits: {
            earned: payload.dailyGameCredits?.earned ?? 0,
            cap: payload.dailyGameCredits?.cap ?? 300,
          },
        });
        setFetched(true);
      });
    } catch {
      // best effort
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const handleInventoryUpdated = () => {
      void refresh();
    };
    window.addEventListener('store-inventory-updated', handleInventoryUpdated);
    return () => window.removeEventListener('store-inventory-updated', handleInventoryUpdated);
  }, [refresh]);

  // Pages without a server-fed snapshot (e.g. chess) would otherwise show a
  // 0-ticket wallet until something dispatches store-inventory-updated.
  useEffect(() => {
    if (initialSnapshot == null) {
      void refresh();
    }
  }, [initialSnapshot, refresh]);

  const value = useMemo<GamesWalletContextValue>(() => ({
    wallet: {
      credits: snapshot.credits,
      progress: {
        label: 'Daily tickets',
        current: snapshot.dailyCredits.earned,
        max: snapshot.dailyCredits.cap,
      },
    },
    dailyCredits: snapshot.dailyCredits,
    isRefreshing,
    loaded,
    refresh,
    setSnapshot,
    adjustCredits,
  }), [adjustCredits, isRefreshing, loaded, refresh, setSnapshot, snapshot]);

  return (
    <GamesWalletContext.Provider value={value}>
      {children}
    </GamesWalletContext.Provider>
  );
}

/** The wallet when a provider is mounted above, else null. */
export function useOptionalGamesWallet() {
  return useContext(GamesWalletContext);
}

export function useGamesWallet() {
  const context = useContext(GamesWalletContext);
  if (!context) {
    throw new Error('useGamesWallet must be used within a GamesWalletProvider.');
  }
  return context;
}
