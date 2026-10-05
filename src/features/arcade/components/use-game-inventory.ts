'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  GAME_DAILY_CREDIT_CAP,
  type RewardGameType,
} from '@/features/arcade/lib/rewards';
import type { TypingPreviewContext } from '@/features/arcade/components/store-item-preview';

type InventoryStoreItem = {
  id: string;
  name: string;
  gameType: RewardGameType;
  rarity: string;
  currencyType: 'credits';
  price: number;
  slots: string[];
  assetRef: Record<string, unknown> | null;
  setLabels?: string[];
};

export type InventoryOwnedItem = {
  item: InventoryStoreItem;
  acquiredAt: number;
  acquiredSource: string;
  grantedToAll: boolean;
};

type InventoryEquippedItem = {
  slot: string;
  item: InventoryStoreItem;
  equippedAt: number;
};

type InventoryWallet = {
  credits: number;
  updatedAt: number;
};

type DailyCredits = {
  earned: number;
  cap: number;
};

type InventoryState = {
  wallet: InventoryWallet;
  dailyGameCredits: DailyCredits;
  ownedItems: InventoryOwnedItem[];
  equipped: InventoryEquippedItem[];
};

const emptyState: InventoryState = {
  wallet: {
    credits: 0,
    updatedAt: 0,
  },
  dailyGameCredits: {
    earned: 0,
    cap: GAME_DAILY_CREDIT_CAP,
  },
  ownedItems: [],
  equipped: [],
};

export function useGameInventory({
  gameType,
  enabled = true,
  skipServerFilter = false,
}: {
  gameType?: RewardGameType;
  enabled?: boolean;
  /**
   * When true, call `/api/store/inventory` without a `gameType` query so the
   * full cross-game inventory comes back — useful when a game wants to show
   * slots it borrows from another game (e.g. chess's shared playercard).
   * Display-side filtering is the caller's responsibility.
   */
  skipServerFilter?: boolean;
}) {
  const [state, setState] = useState<InventoryState>(emptyState);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const loadInventory = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    setError(null);
    try {
      const qs = skipServerFilter || !gameType
        ? ''
        : `?gameType=${encodeURIComponent(gameType)}`;
      const response = await fetch(`/api/store/inventory${qs}`, {
        cache: 'no-store',
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error || 'Failed to load inventory.');
      }
      setState(payload as InventoryState);
    } catch (err) {
      setError((err as Error).message);
      setState(emptyState);
    } finally {
      setLoading(false);
    }
  }, [enabled, gameType, skipServerFilter]);

  useEffect(() => {
    void loadInventory();
  }, [loadInventory]);

  const emitInventoryUpdated = useCallback(() => {
    window.dispatchEvent(new Event('store-inventory-updated'));
  }, []);

  const equipItem = useCallback(
    async (item: InventoryStoreItem) => {
      setBusyKey(`equip:${item.id}`);
      setError(null);
      try {
        const response = await fetch('/api/store/equip', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ itemId: item.id, gameType: item.gameType }),
        });
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload?.error || 'Failed to equip item.');
        }
        if (payload?.state) {
          setState(payload.state as InventoryState);
        } else {
          await loadInventory();
        }
        emitInventoryUpdated();
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setBusyKey(null);
      }
    },
    [emitInventoryUpdated, loadInventory],
  );

  const unequipItem = useCallback(
    async (itemGameType: RewardGameType, slot: string) => {
      setBusyKey(`unequip:${itemGameType}:${slot}`);
      setError(null);
      try {
        const response = await fetch('/api/store/unequip', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ gameType: itemGameType, slot }),
        });
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload?.error || 'Failed to unequip slot.');
        }
        if (payload?.state) {
          setState(payload.state as InventoryState);
        } else {
          await loadInventory();
        }
        emitInventoryUpdated();
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setBusyKey(null);
      }
    },
    [emitInventoryUpdated, loadInventory],
  );

  const equippedByGameSlot = useMemo(() => {
    const map = new Map<string, InventoryEquippedItem>();
    for (const entry of state.equipped) {
      map.set(`${entry.item.gameType}:${entry.slot}`, entry);
    }
    return map;
  }, [state.equipped]);

  const equippedItemIds = useMemo(
    () => new Set(state.equipped.map((entry) => entry.item.id)),
    [state.equipped],
  );

  const typingPreviewContext = useMemo<TypingPreviewContext>(() => {
    return {
      theme:
        equippedByGameSlot.get('typing-test:theme')?.item.assetRef ??
        equippedByGameSlot.get('typing-test:hud')?.item.assetRef ??
        null,
      caret: equippedByGameSlot.get('typing-test:caret')?.item.assetRef ?? null,
      feedback:
        equippedByGameSlot.get('typing-test:feedback')?.item.assetRef ?? null,
      'text-style':
        equippedByGameSlot.get('typing-test:text-style')?.item.assetRef ?? null,
    };
  }, [equippedByGameSlot]);

  const snakeBoardAssetRef = useMemo(
    () => equippedByGameSlot.get('snake:board')?.item.assetRef ?? null,
    [equippedByGameSlot],
  );

  return {
    state,
    loading,
    error,
    busyKey,
    loadInventory,
    equipItem,
    unequipItem,
    equippedByGameSlot,
    equippedItemIds,
    typingPreviewContext,
    snakeBoardAssetRef,
    setError,
  };
}
