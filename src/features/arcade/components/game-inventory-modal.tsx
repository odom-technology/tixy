'use client';

import { useEffect, useMemo, useState } from 'react';
import { Filter, Search, SlidersHorizontal } from 'lucide-react';

import {
  GAME_SLOTS,
  getCurrencyDisplayName,
  type RewardGameType,
} from '@/features/arcade/lib/rewards';
import { StoreItemPreview } from '@/features/arcade/components/store-item-preview';
import {
  useGameInventory,
  type InventoryOwnedItem,
} from '@/features/arcade/components/use-game-inventory';
import {
  ArcadeButton,
  ArcadeChip,
  ArcadeNotice,
  type ArcadeEnamel,
} from '@/features/arcade/components/ui/arcade-ui';
import { ArcadeModal } from '@/features/arcade/components/ui/arcade-interactive';
import { ArcadeSheet } from '@/features/arcade/components/ui/arcade-sheet';

/* Rarity is always a solid enamel chip — never a tinted name. */
const rarityChipTone: Record<string, ArcadeEnamel | undefined> = {
  common: undefined,
  rare: 'info',
  epic: 'prize',
  legendary: 'tickets',
  mythic: 'primary',
};

/**
 * Extra gameType/slot pairs the modal should surface alongside the primary
 * `gameType`'s own inventory. Used e.g. by chess to expose the shared
 * 8-ball `playercard` slot so chess players don't have to jump sideways to
 * equip it.
 */
type InventoryExtraSlot = {
  gameType: RewardGameType;
  slot: string;
  /** Display label override ("Player card (shared)"). */
  label?: string;
};

export function GameInventoryModal({
  open,
  onOpenChange,
  gameType,
  title,
  description,
  extraSlots,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  gameType?: RewardGameType;
  title?: string;
  description?: string;
  extraSlots?: InventoryExtraSlot[];
}) {
  const hasExtraSlots = (extraSlots?.length ?? 0) > 0;
  const {
    state,
    loading,
    error,
    busyKey,
    equipItem,
    unequipItem,
    equippedByGameSlot,
    equippedItemIds,
    typingPreviewContext,
    snakeBoardAssetRef,
  } = useGameInventory({
    gameType,
    enabled: open && Boolean(gameType),
    // When the modal surfaces slots borrowed from other games, the hook
    // needs the whole user inventory rather than just this game's items.
    skipServerFilter: hasExtraSlots,
  });

  const [isNarrow, setIsNarrow] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia('(max-width: 639px)');
    const update = () => setIsNarrow(mql.matches);
    update();
    mql.addEventListener('change', update);
    return () => mql.removeEventListener('change', update);
  }, []);



  const [query, setQuery] = useState('');
  const [rarityFilter, setRarityFilter] = useState('all');
  const [slotFilter, setSlotFilter] = useState('all');

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onOpenChange(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onOpenChange, open]);

  const slots = useMemo(
    () => (gameType ? (GAME_SLOTS[gameType] ?? []) : []),
    [gameType],
  );
  const activeGameType: RewardGameType | null = gameType ?? null;
  // Set of "gameType:slot" keys the modal is willing to surface — the
  // primary game's own slots plus any caller-supplied extras.
  const allowedSlotKeys = useMemo(() => {
    const keys = new Set<string>();
    if (gameType) {
      for (const slot of slots) keys.add(`${gameType}:${slot}`);
    }
    for (const extra of extraSlots ?? []) {
      keys.add(`${extra.gameType}:${extra.slot}`);
    }
    return keys;
  }, [gameType, slots, extraSlots]);
  // When extras are present the server returns unrelated items too (the
  // hook turns off the gameType query). Prefilter everything down to the
  // slots we're willing to display so the search grid stays focused.
  const scopedOwnedItems = useMemo(() => {
    if (!hasExtraSlots) return state.ownedItems;
    return state.ownedItems.filter((entry) =>
      entry.item.slots.some((slot) =>
        allowedSlotKeys.has(`${entry.item.gameType}:${slot}`),
      ),
    );
  }, [hasExtraSlots, state.ownedItems, allowedSlotKeys]);

  const rarityOptions = useMemo(() => {
    const unique = new Set<string>();
    for (const entry of scopedOwnedItems) {
      unique.add(entry.item.rarity);
    }
    return Array.from(unique).sort();
  }, [scopedOwnedItems]);

  // Combined slot filter options: this game's slots plus any extras, each
  // tagged with its owning gameType so they render uniquely in the picker.
  const slotFilterOptions = useMemo(() => {
    const items: Array<{ key: string; gameType: RewardGameType; slot: string; label: string }> = [];
    if (gameType) {
      for (const slot of slots) {
        items.push({ key: `${gameType}:${slot}`, gameType, slot, label: slot });
      }
    }
    for (const extra of extraSlots ?? []) {
      items.push({
        key: `${extra.gameType}:${extra.slot}`,
        gameType: extra.gameType,
        slot: extra.slot,
        label: extra.label ?? `${extra.slot} (shared)`,
      });
    }
    return items;
  }, [gameType, slots, extraSlots]);

  const filteredItems = useMemo(() => {
    const queryLower = query.trim().toLowerCase();
    return scopedOwnedItems.filter((entry) => {
      if (rarityFilter !== 'all' && entry.item.rarity !== rarityFilter) return false;
      if (slotFilter !== 'all') {
        // slotFilter is formatted as `gameType:slot` when extras exist so
        // chess's `board` and a hypothetical 8-ball `board` don't collide.
        const [filterGame, filterSlot] = slotFilter.includes(':')
          ? slotFilter.split(':')
          : [entry.item.gameType, slotFilter];
        if (entry.item.gameType !== filterGame) return false;
        if (!entry.item.slots.includes(filterSlot)) return false;
      }
      if (!queryLower) return true;
      return (
        entry.item.name.toLowerCase().includes(queryLower) ||
        entry.item.slots.some((slot) => slot.toLowerCase().includes(queryLower)) ||
        (entry.item.setLabels ?? []).some((label) =>
          label.toLowerCase().includes(queryLower),
        )
      );
    });
  }, [query, rarityFilter, slotFilter, scopedOwnedItems]);

  const renderItemCard = (entry: InventoryOwnedItem) => {
    const isEquipped = equippedItemIds.has(entry.item.id);
    const busy = busyKey === `equip:${entry.item.id}`;
    return (
      <article
        key={`${entry.item.id}-${entry.acquiredAt}-${entry.acquiredSource}`}
        className='arcade-card flex flex-col p-3'
      >
        <StoreItemPreview
          item={entry.item}
          compact
          snakeBoardAssetRef={snakeBoardAssetRef}
          typingPreviewContext={
            entry.item.gameType === 'typing-test' ? typingPreviewContext : undefined
          }
        />
        <div className='flex-1'>
          <div className='mt-2.5 flex flex-wrap items-center gap-1.5'>
            <RarityChipLocal rarity={entry.item.rarity} />
          </div>
          <p className='mt-2 text-sm font-semibold text-strong'>
            {entry.item.name}
          </p>
          <p className='mt-0.5 text-xs text-faint'>
            {entry.item.slots.join(', ')}
          </p>
        </div>
        <div className='mt-3 flex items-center justify-between gap-2 border-t border-dashed border-soft pt-3'>
          <span className='inline-flex items-baseline gap-1 whitespace-nowrap'>
            <span className='arcade-num text-sm font-semibold text-tickets-text'>
              {entry.item.price.toLocaleString()}
            </span>
            <span className='arcade-kicker text-[10px]'>
              {getCurrencyDisplayName(entry.item.currencyType)}
            </span>
          </span>
          {isEquipped ? (
            <ArcadeChip tone='prize'>Equipped</ArcadeChip>
          ) : (
            <ArcadeButton
              type='button'
              onClick={() => void equipItem(entry.item)}
              disabled={busy}
              size='xs'
            >
              {busy ? 'Equipping...' : 'Equip'}
            </ArcadeButton>
          )}
        </div>
      </article>
    );
  };

  const body = (
    <>
          <p className='text-sm text-body'>
            {description ?? 'Equip items available for this game only.'}
          </p>

          {loading ? (
            <p className='mt-3 text-sm text-body'>Loading inventory...</p>
          ) : null}
          {error ? (
            <ArcadeNotice tone='danger' className='mt-3'>
              {error}
            </ArcadeNotice>
          ) : null}

          {slotFilterOptions.length === 0 || !activeGameType ? (
            <div className='mt-4 rounded-well border-2 border-dashed border-soft px-5 py-8 text-center'>
              <p className='text-sm text-body'>
                This cabinet has no equipable slots yet.
              </p>
            </div>
          ) : (
            <div className='mt-4 space-y-4'>
              <section>
                <p className='arcade-kicker'>Current loadout</p>
                <div className='mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-3'>
                  {slotFilterOptions.map((opt) => {
                    const equipped = equippedByGameSlot.get(opt.key);
                    const unequipKey = `unequip:${opt.gameType}:${opt.slot}`;
                    const isShared = opt.gameType !== activeGameType;
                    return (
                      <div
                        key={opt.key}
                        className='flex items-center justify-between gap-2 rounded-well border-2 border-ink bg-well px-3 py-2.5 inset-shadow-well'
                      >
                        <div className='min-w-0'>
                          <p className='text-[10px] uppercase tracking-[0.16em] text-faint'>
                            {opt.label}
                            {isShared ? (
                              <span className='ml-1 normal-case tracking-normal'>
                                · shared
                              </span>
                            ) : null}
                          </p>
                          <p className='mt-0.5 truncate text-xs font-medium text-strong'>
                            {equipped?.item.name ?? 'Empty'}
                          </p>
                        </div>
                        {equipped ? (
                          <ArcadeButton
                            type='button'
                            onClick={() => void unequipItem(opt.gameType, opt.slot)}
                            disabled={busyKey === unequipKey}
                            size='xs'
                          >
                            {busyKey === unequipKey ? '...' : 'Unequip'}
                          </ArcadeButton>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </section>

              <section className='border-t border-dashed border-soft pt-4'>
                <div className='flex flex-wrap items-center gap-2'>
                  <label className='relative min-w-[220px] flex-1'>
                    <Search className='pointer-events-none absolute left-3 top-3 h-4 w-4 text-faint' />
                    <input
                      type='text'
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder='Search name, slot, or set'
                      className='arcade-input h-10 pl-9 pr-3 text-sm'
                    />
                  </label>
                  <label className='inline-flex items-center gap-1.5'>
                    <Filter aria-hidden className='h-3.5 w-3.5 text-faint' />
                    <select
                      value={rarityFilter}
                      onChange={(event) => setRarityFilter(event.target.value)}
                      className='arcade-input h-10 w-auto px-3 text-sm'
                    >
                      <option value='all'>All rarity</option>
                      {rarityOptions.map((rarity) => (
                        <option key={rarity} value={rarity}>
                          {rarity}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className='inline-flex items-center gap-1.5'>
                    <SlidersHorizontal aria-hidden className='h-3.5 w-3.5 text-faint' />
                    <select
                      value={slotFilter}
                      onChange={(event) => setSlotFilter(event.target.value)}
                      className='arcade-input h-10 w-auto px-3 text-sm'
                    >
                      <option value='all'>All slots</option>
                      {slotFilterOptions.map((opt) => (
                        <option
                          key={opt.key}
                          // Extras encode gameType in the value so the filter
                          // can distinguish e.g. chess `board` from a
                          // hypothetical 8-ball `board`.
                          value={hasExtraSlots ? opt.key : opt.slot}
                        >
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                {filteredItems.length === 0 ? (
                  <div className='mt-3 rounded-well border-2 border-dashed border-soft px-5 py-8 text-center'>
                    <p className='text-sm text-body'>
                      {scopedOwnedItems.length === 0
                        ? 'Nothing for this cabinet yet — hit the store.'
                        : 'No items match these filters.'}
                    </p>
                  </div>
                ) : (
                  <div className='mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'>
                    {filteredItems.map(renderItemCard)}
                  </div>
                )}
              </section>
            </div>
          )}
    </>
  );

  // Mobile: sheet. Desktop: wide cabinet modal. Both use enter/exit presence.
  if (isNarrow) {
    return (
      <ArcadeSheet
        open={open}
        onClose={() => onOpenChange(false)}
        title={title ?? 'Inventory'}
        tone='prize'
      >
        {body}
      </ArcadeSheet>
    );
  }

  return (
    <ArcadeModal
      open={open}
      onClose={() => onOpenChange(false)}
      title={title ?? 'Inventory'}
      tone='prize'
      maxWidth='64rem'
      className='z-[80]'
    >
      {body}
    </ArcadeModal>
  );
}

function RarityChipLocal({ rarity }: { rarity: string }) {
  return (
    <ArcadeChip tone={rarityChipTone[rarity]} className='uppercase'>
      {rarity}
    </ArcadeChip>
  );
}
