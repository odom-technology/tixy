import { getCurrencyDisplayName } from '@/features/arcade/lib/rewards';
import type { OwnedStoreItem, StoreCatalogItem } from './_types';

export const getInventoryEntryKey = (entry: OwnedStoreItem) =>
  `${entry.item.id}-${entry.acquiredAt}-${entry.grantedToAll ? 'global' : 'personal'}`;

export const formatGrantItemTypeLabel = (item: StoreCatalogItem) => {
  const slotsLabel = item.slots.length > 0 ? item.slots.join(', ') : 'no-slot';
  return `${item.name} [${item.gameType} • ${slotsLabel}] (${getCurrencyDisplayName(item.currencyType)} ${item.price}) — ${item.id}`;
};

export const formatDurationMs = (ms: number) => {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours.toString().padStart(2, '0')}:${minutes
    .toString()
    .padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
};
