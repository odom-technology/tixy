'use client';

import { Layers, Search, Ticket } from 'lucide-react';
import { type ReactNode, useMemo, useState } from 'react';

import { GamesWalletCard } from '@/features/arcade/components/shell/page-header';
import { AppPageFrame } from '@/features/arcade/components/shell/page-frame';
import { StoreItemPreview } from '@/features/arcade/components/store-item-preview';
import {
  GAME_SLOTS,
  STORE_GAME_TYPES,
  getCurrencyDisplayName,
  type RewardGameType,
} from '@/features/arcade/lib/rewards';
import {
  useGameInventory,
  type InventoryOwnedItem,
} from '@/features/arcade/components/use-game-inventory';
import {
  ArcadeButton,
  ArcadeChip,
  ArcadeLinkButton,
  ArcadeMarquee,
  ArcadeNotice,
} from '@/features/arcade/components/ui/arcade-ui';
import {
  GAME_LABELS,
  RarityChip,
  StoreItemDetailModal,
  formatSlotLabel,
  type StoreDetailItem,
} from '@/features/arcade/components/store-item-detail-modal';

/* Canonical game order for grouping + the loadout column: Profile (avatars
   and flair) leads, then every game in the registry order. We never hardcode
   a subset — the page derives which sections actually render from what the
   player owns / has equipped. */
const GAME_ORDER: RewardGameType[] = [
  'profile',
  ...STORE_GAME_TYPES.filter((game) => game !== 'profile'),
];

const orderIndex = new Map<RewardGameType, number>(
  GAME_ORDER.map((game, index) => [game, index]),
);

const byGameOrder = (a: RewardGameType, b: RewardGameType) =>
  (orderIndex.get(a) ?? 999) - (orderIndex.get(b) ?? 999);

const rarityWeight: Record<string, number> = {
  common: 0,
  rare: 1,
  epic: 2,
  legendary: 3,
  mythic: 4,
};

type SortMode = 'recommended' | 'rarity' | 'name' | 'recent';

/* Maps an item rarity onto the inventory-scoped enamel-rail class
   (see src/app/(games)/inventory/inventory-midway.css). Unknown rarities
   fall back to the neutral common rail. */
const rarityCardClass = (rarity: string) =>
  `inv-mw-rarity-${rarity in rarityWeight ? rarity : 'common'}`;

function SelectField({
  value,
  onChange,
  children,
}: {
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className='arcade-input h-10 px-3 text-sm'
    >
      {children}
    </select>
  );
}

function SummaryStat({
  value,
  label,
  icon,
}: {
  value: ReactNode;
  label: string;
  icon?: ReactNode;
}) {
  return (
    <div className='flex items-center gap-2 rounded-tag border-2 border-ink bg-raised px-3 py-2 shadow-panel'>
      {icon ? <span className='text-faint'>{icon}</span> : null}
      <div className='leading-tight'>
        <p className='arcade-num text-base font-semibold text-strong'>{value}</p>
        <p className='arcade-kicker text-[10px]'>{label}</p>
      </div>
    </div>
  );
}

export function GamesInventoryPage() {
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
  } = useGameInventory({});

  const [query, setQuery] = useState('');
  const [gameFilter, setGameFilter] = useState<RewardGameType | 'all'>('all');
  const [rarityFilter, setRarityFilter] = useState('all');
  const [slotFilter, setSlotFilter] = useState('all');
  const [sortMode, setSortMode] = useState<SortMode>('recommended');
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);

  const selectedItem = useMemo(() => {
    if (!selectedItemId) return null;
    return (
      state.ownedItems.find((entry) => entry.item.id === selectedItemId)
        ?.item ?? null
    );
  }, [selectedItemId, state.ownedItems]);

  /* The same inspection counter as the store: equip/unequip live in the
     modal, next to the preview. */
  const unequipSelected = (item: StoreDetailItem) => {
    for (const slot of item.slots) {
      const current = equippedByGameSlot.get(`${item.gameType}:${slot}`);
      if (current?.item.id === item.id) {
        void unequipItem(item.gameType, slot);
      }
    }
  };

  // Games the player actually owns cosmetics for, in registry order.
  const ownedGames = useMemo(() => {
    const seen = new Set<RewardGameType>();
    for (const entry of state.ownedItems) seen.add(entry.item.gameType);
    return Array.from(seen).sort(byGameOrder);
  }, [state.ownedItems]);

  // Games with at least one slot equipped — drives the loadout column so it
  // only lists games the player has actually customized.
  const equippedGames = useMemo(() => {
    const seen = new Set<RewardGameType>();
    for (const entry of state.equipped) seen.add(entry.item.gameType);
    return Array.from(seen).sort(byGameOrder);
  }, [state.equipped]);

  const ownedCountByGame = useMemo(() => {
    const counts = new Map<RewardGameType, number>();
    for (const entry of state.ownedItems) {
      counts.set(
        entry.item.gameType,
        (counts.get(entry.item.gameType) ?? 0) + 1,
      );
    }
    return counts;
  }, [state.ownedItems]);

  const rarityOptions = useMemo(() => {
    const unique = new Set<string>();
    for (const entry of state.ownedItems) unique.add(entry.item.rarity);
    return Array.from(unique).sort(
      (a, b) => (rarityWeight[b] ?? 0) - (rarityWeight[a] ?? 0),
    );
  }, [state.ownedItems]);

  const slotOptions = useMemo(() => {
    const unique = new Set<string>();
    const sourceGames =
      gameFilter === 'all' ? ownedGames : ([gameFilter] as RewardGameType[]);
    for (const game of sourceGames) {
      for (const slot of GAME_SLOTS[game] ?? []) unique.add(slot);
    }
    return Array.from(unique).sort();
  }, [gameFilter, ownedGames]);

  const sortItems = useMemo(() => {
    return (items: InventoryOwnedItem[]) => {
      const sorted = [...items];
      sorted.sort((a, b) => {
        if (sortMode === 'name') return a.item.name.localeCompare(b.item.name);
        if (sortMode === 'recent') return b.acquiredAt - a.acquiredAt;
        // recommended + rarity both lead with rarity; recommended additionally
        // floats equipped items to the top of each group.
        if (sortMode === 'recommended') {
          const eqA = equippedItemIds.has(a.item.id) ? 1 : 0;
          const eqB = equippedItemIds.has(b.item.id) ? 1 : 0;
          if (eqA !== eqB) return eqB - eqA;
        }
        const rarityDiff =
          (rarityWeight[b.item.rarity] ?? 0) - (rarityWeight[a.item.rarity] ?? 0);
        if (rarityDiff !== 0) return rarityDiff;
        return a.item.name.localeCompare(b.item.name);
      });
      return sorted;
    };
  }, [sortMode, equippedItemIds]);

  const filteredItems = useMemo(() => {
    const queryLower = query.trim().toLowerCase();
    return state.ownedItems.filter((entry) => {
      if (gameFilter !== 'all' && entry.item.gameType !== gameFilter)
        return false;
      if (rarityFilter !== 'all' && entry.item.rarity !== rarityFilter)
        return false;
      if (slotFilter !== 'all' && !entry.item.slots.includes(slotFilter))
        return false;
      if (!queryLower) return true;
      return (
        entry.item.name.toLowerCase().includes(queryLower) ||
        entry.item.slots.some((slot) =>
          formatSlotLabel(slot).toLowerCase().includes(queryLower),
        ) ||
        GAME_LABELS[entry.item.gameType].toLowerCase().includes(queryLower) ||
        (entry.item.setLabels ?? []).some((label) =>
          label.toLowerCase().includes(queryLower),
        )
      );
    });
  }, [gameFilter, query, rarityFilter, slotFilter, state.ownedItems]);

  // Group the filtered items by game so each section reads as its own shelf.
  // When a single game is selected we still flow through this (one group).
  const groupedItems = useMemo(() => {
    const groups = new Map<RewardGameType, InventoryOwnedItem[]>();
    for (const entry of filteredItems) {
      const list = groups.get(entry.item.gameType);
      if (list) list.push(entry);
      else groups.set(entry.item.gameType, [entry]);
    }
    return Array.from(groups.entries())
      .sort(([a], [b]) => byGameOrder(a, b))
      .map(([game, items]) => ({ game, items: sortItems(items) }));
  }, [filteredItems, sortItems]);

  const hasActiveFilters =
    query.trim() !== '' ||
    gameFilter !== 'all' ||
    rarityFilter !== 'all' ||
    slotFilter !== 'all';

  const resetFilters = () => {
    setQuery('');
    setGameFilter('all');
    setRarityFilter('all');
    setSlotFilter('all');
    setSortMode('recommended');
  };

  const renderOwnedItemCard = (entry: InventoryOwnedItem) => {
    const isEquipped = equippedItemIds.has(entry.item.id);
    const busy = busyKey === `equip:${entry.item.id}`;
    return (
      <article
        key={`${entry.item.id}-${entry.acquiredAt}-${entry.acquiredSource}`}
        className={`arcade-card inv-mw-card ${rarityCardClass(entry.item.rarity)} flex flex-col p-3`}
      >
        <button
          type='button'
          onClick={() => setSelectedItemId(entry.item.id)}
          className='inv-mw-well block w-full text-left'
          aria-label={`View ${entry.item.name}`}
        >
          <StoreItemPreview
            item={entry.item}
            compact
            snakeBoardAssetRef={snakeBoardAssetRef}
            typingPreviewContext={
              entry.item.gameType === 'typing-test'
                ? typingPreviewContext
                : undefined
            }
          />
        </button>
        <div className='flex-1'>
          <div className='mt-2.5 flex flex-wrap items-center gap-1.5'>
            <RarityChip rarity={entry.item.rarity} />
            {isEquipped ? <ArcadeChip tone='prize'>Equipped</ArcadeChip> : null}
          </div>
          <button
            type='button'
            onClick={() => setSelectedItemId(entry.item.id)}
            className='mt-2 text-left text-sm font-semibold text-strong transition-colors hover:text-primary-text'
          >
            {entry.item.name}
          </button>
          <p className='mt-0.5 text-xs text-faint'>
            {entry.item.slots.map(formatSlotLabel).join(', ') || 'Cosmetic'}
          </p>
        </div>
        <div className='inv-mw-stub-edge mt-3 flex items-center justify-between gap-2 pt-3'>
          <span className='inline-flex items-baseline gap-1 whitespace-nowrap'>
            <span className='arcade-num text-sm font-semibold text-tickets-text'>
              {entry.item.price.toLocaleString()}
            </span>
            <span className='arcade-kicker text-[10px]'>
              {getCurrencyDisplayName(entry.item.currencyType)}
            </span>
          </span>
          {isEquipped ? (
            <ArcadeButton
              type='button'
              onClick={() => setSelectedItemId(entry.item.id)}
              tone='ghost'
              size='xs'
            >
              View
            </ArcadeButton>
          ) : (
            <ArcadeButton
              type='button'
              onClick={() => void equipItem(entry.item)}
              disabled={busy}
              tone='success'
              size='xs'
            >
              {busy ? 'Equipping...' : 'Equip'}
            </ArcadeButton>
          )}
        </div>
      </article>
    );
  };

  const walletCard = {
    credits: state.wallet.credits,
    progress: {
      label: 'Daily tickets',
      current: state.dailyGameCredits.earned,
      max: state.dailyGameCredits.cap,
    },
  };

  const totalOwned = state.ownedItems.length;
  const hasNothing = totalOwned === 0;

  return (
    <AppPageFrame
      title='Inventory'
      subtitle='Everything you own across every game — equip a loadout per game or set your profile flair.'
      width='wide'
      actions={<GamesWalletCard wallet={walletCard} compact layout='inline' />}
      contentClassName='space-y-6'
    >
      {loading ? (
        <p className='text-sm text-body'>Loading inventory...</p>
      ) : null}
      {error ? <ArcadeNotice tone='danger'>{error}</ArcadeNotice> : null}

      {/* Summary strip — quick read on the collection plus a subtle ticket
          balance. */}
      <div className='flex flex-wrap gap-2.5'>
        <SummaryStat value={totalOwned} label='Items owned' />
        <SummaryStat value={ownedGames.length} label='Games collected' />
        <SummaryStat value={equippedGames.length} label='Loadouts set' />
        <SummaryStat
          value={state.wallet.credits.toLocaleString()}
          label='Tickets'
          icon={<Ticket aria-hidden className='h-4 w-4' />}
        />
      </div>

      {hasNothing && !loading ? (
        <div className='rounded-cabinet border-2 border-dashed border-soft bg-panel px-6 py-14 text-center shadow-cabinet'>
          <Layers aria-hidden className='mx-auto h-8 w-8 text-faint' />
          <p className='mt-3 text-base font-semibold text-strong'>
            You don&apos;t own any cosmetics yet
          </p>
          <p className='mt-1 text-sm text-body'>
            Skins, tables, backdrops, avatars and profile flair all live in the
            store. Earn tickets by playing, then make your games yours.
          </p>
          <ArcadeLinkButton href='/store' tone='primary' className='mt-5'>
            Visit the Store
          </ArcadeLinkButton>
        </div>
      ) : (
        <>
          {/* Filter row sits directly in the frame column — no standalone card
              (matches the store's borderless-inside-cabinet filter treatment). */}
          <div className='grid gap-3 lg:grid-cols-[minmax(0,1fr)_repeat(4,minmax(0,10rem))]'>
            <label className='relative min-w-0'>
              <Search className='pointer-events-none absolute left-3 top-3 h-4 w-4 text-faint' />
              <input
                type='text'
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder='Search name, game, slot, or set'
                className='arcade-input h-10 pl-9 pr-3 text-sm'
              />
            </label>
            <SelectField
              value={gameFilter}
              onChange={(value) =>
                setGameFilter(value as RewardGameType | 'all')
              }
            >
              <option value='all'>All games</option>
              {ownedGames.map((game) => (
                <option key={game} value={game}>
                  {GAME_LABELS[game]}
                </option>
              ))}
            </SelectField>
            <SelectField value={rarityFilter} onChange={setRarityFilter}>
              <option value='all'>All rarity</option>
              {rarityOptions.map((rarity) => (
                <option key={rarity} value={rarity}>
                  {rarity}
                </option>
              ))}
            </SelectField>
            <SelectField value={slotFilter} onChange={setSlotFilter}>
              <option value='all'>All slots</option>
              {slotOptions.map((slot) => (
                <option key={slot} value={slot}>
                  {formatSlotLabel(slot)}
                </option>
              ))}
            </SelectField>
            <SelectField
              value={sortMode}
              onChange={(value) => setSortMode(value as SortMode)}
            >
              <option value='recommended'>Sort: equipped first</option>
              <option value='rarity'>Sort: rarity</option>
              <option value='recent'>Sort: recently acquired</option>
              <option value='name'>Sort: A to Z</option>
            </SelectField>
          </div>

          <div className='grid items-start gap-4 xl:grid-cols-12'>
            {/* Loadouts is the quieter reference rail (kicker, no marquee) so
                Owned items keeps the primary enamel sign on this floor. */}
            <section className='overflow-hidden rounded-cabinet border-2 border-ink bg-panel shadow-cabinet xl:col-span-4'>
              <div className='flex items-center justify-between gap-2 border-b border-soft px-4 py-3'>
                <div className='min-w-0'>
                  <p className='arcade-kicker'>Loadouts</p>
                  <p className='mt-0.5 text-sm font-semibold text-strong'>
                    Equipped per game
                  </p>
                </div>
                <Layers aria-hidden className='h-4 w-4 shrink-0 text-faint' />
              </div>
              {/* One bordered surface (the cabinet). Only games the player has
                  actually customized show up; each is a kicker header over
                  divider-separated slot rows. Equipped rows carry a small live
                  preview thumb so avatars/skins read at a glance; empty slots
                  stay quiet labeled rows. */}
              {equippedGames.length === 0 ? (
                <div className='px-4 py-8 text-center'>
                  <p className='text-sm text-body'>
                    No loadouts equipped yet.
                  </p>
                  <p className='mt-1 text-xs text-faint'>
                    Equip an owned item and it shows up here, per game.
                  </p>
                </div>
              ) : (
                <div className='divide-y divide-soft'>
                  {equippedGames.map((game) => (
                    <div key={game} className='px-4 py-3'>
                      <p className='arcade-kicker'>{GAME_LABELS[game]}</p>
                      <div className='mt-1.5 divide-y divide-soft'>
                        {(GAME_SLOTS[game] ?? []).map((slot) => {
                          const equipped = equippedByGameSlot.get(
                            `${game}:${slot}`,
                          );
                          if (!equipped) return null;
                          const busy = busyKey === `unequip:${game}:${slot}`;
                          return (
                            <div
                              key={`${game}:${slot}`}
                              className='inv-mw-slot-filled -mx-2 flex items-center gap-2.5 rounded-tag px-2 py-2'
                            >
                              <button
                                type='button'
                                onClick={() =>
                                  setSelectedItemId(equipped.item.id)
                                }
                                className='inv-mw-well h-10 w-10 shrink-0 overflow-hidden'
                                aria-label={`View ${equipped.item.name}`}
                              >
                                <StoreItemPreview
                                  item={equipped.item}
                                  compact
                                  forceSquare
                                  snakeBoardAssetRef={snakeBoardAssetRef}
                                  typingPreviewContext={
                                    equipped.item.gameType === 'typing-test'
                                      ? typingPreviewContext
                                      : undefined
                                  }
                                />
                              </button>
                              <div className='min-w-0 flex-1'>
                                <p className='text-[10px] uppercase tracking-[0.16em] text-faint'>
                                  {formatSlotLabel(slot)}
                                </p>
                                <button
                                  type='button'
                                  onClick={() =>
                                    setSelectedItemId(equipped.item.id)
                                  }
                                  className='block w-full truncate text-left text-xs font-medium text-strong transition-colors hover:text-primary-text'
                                >
                                  {equipped.item.name}
                                </button>
                              </div>
                              <ArcadeButton
                                type='button'
                                onClick={() => void unequipItem(game, slot)}
                                disabled={busy}
                                size='xs'
                              >
                                {busy ? '...' : 'Unequip'}
                              </ArcadeButton>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className='overflow-hidden rounded-cabinet border-2 border-ink bg-panel shadow-cabinet xl:col-span-8'>
              <ArcadeMarquee
                tone='prize'
                trailing={
                  <span className='arcade-num text-sm'>
                    {filteredItems.length}
                  </span>
                }
              >
                Owned items
              </ArcadeMarquee>
              <div className='space-y-5 p-4'>
                {hasActiveFilters ? (
                  <div className='flex items-center justify-between gap-2'>
                    <p className='text-xs text-faint'>
                      Showing {filteredItems.length} of {totalOwned} items
                    </p>
                    <ArcadeButton
                      type='button'
                      onClick={resetFilters}
                      size='sm'
                    >
                      Clear filters
                    </ArcadeButton>
                  </div>
                ) : null}

                {groupedItems.length === 0 ? (
                  <div className='rounded-well border-2 border-dashed border-soft px-5 py-10 text-center'>
                    <p className='text-sm text-body'>
                      No items match these filters.
                    </p>
                    {hasActiveFilters ? (
                      <ArcadeButton
                        type='button'
                        onClick={resetFilters}
                        size='sm'
                        className='mt-4'
                      >
                        Clear filters
                      </ArcadeButton>
                    ) : null}
                  </div>
                ) : (
                  groupedItems.map(({ game, items }) => (
                    <div key={game}>
                      <div className='mb-2.5 flex items-center justify-between gap-2 border-b border-soft pb-1.5'>
                        <p className='arcade-kicker'>{GAME_LABELS[game]}</p>
                        <span className='arcade-num text-xs text-faint'>
                          {items.length}
                          {ownedCountByGame.get(game) !== items.length
                            ? ` / ${ownedCountByGame.get(game)}`
                            : ''}
                        </span>
                      </div>
                      <div className='grid gap-3 sm:grid-cols-2 xl:grid-cols-3'>
                        {items.map(renderOwnedItemCard)}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>
          </div>
        </>
      )}

      {selectedItem ? (
        <StoreItemDetailModal
          item={selectedItem}
          owned
          equipped={equippedItemIds.has(selectedItem.id)}
          busy={
            busyKey === `equip:${selectedItem.id}` ||
            selectedItem.slots.some(
              (slot) => busyKey === `unequip:${selectedItem.gameType}:${slot}`,
            )
          }
          walletCredits={state.wallet.credits}
          typingPreviewContext={typingPreviewContext}
          snakeBoardAssetRef={snakeBoardAssetRef}
          onClose={() => setSelectedItemId(null)}
          onEquip={() => void equipItem(selectedItem)}
          onUnequip={() => unequipSelected(selectedItem)}
        />
      ) : null}
    </AppPageFrame>
  );
}
