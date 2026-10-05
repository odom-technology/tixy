'use client';

import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { ArcadeButton } from '@/features/arcade/components/ui/arcade-ui';

const INITIAL_VISIBLE_ITEMS = 24;

export type StoreCatalogTableItem = {
  id: string;
  name: string;
  gameType: string;
  rarity: string;
  currencyType: 'credits';
  price: number;
  slots: string[];
  active?: boolean;
};

export type StoreCatalogTableGroup = {
  id: string;
  name: string;
  itemIds: string[];
};

export type StoreCatalogTableSelection = {
  selectedIds: Set<string>;
  onToggleItem: (itemId: string) => void;
  onToggleAllVisible: (visibleItemIds: string[]) => void;
};

type StoreCatalogTableProps<
  Item extends StoreCatalogTableItem,
  Group extends StoreCatalogTableGroup,
> = {
  title?: string;
  loading: boolean;
  items: Item[];
  groups: Group[];
  inStoreItemIds?: Set<string>;
  actions?: ReactNode;
  selection?: StoreCatalogTableSelection;
  rowActions?: (item: Item) => ReactNode;
  onVisibleItemsChange?: (visibleItems: Item[]) => void;
  defaultCollapsed?: boolean;
  presentation?: 'default' | 'console';
  busy?: boolean;
  className?: string;
};

export function StoreCatalogTable<
  Item extends StoreCatalogTableItem = StoreCatalogTableItem,
  Group extends StoreCatalogTableGroup = StoreCatalogTableGroup,
>({
  title = 'Item Catalog',
  loading,
  items,
  groups,
  inStoreItemIds,
  actions,
  selection,
  rowActions,
  onVisibleItemsChange,
  defaultCollapsed = false,
  presentation = 'default',
  busy = false,
  className = '',
}: StoreCatalogTableProps<Item, Group>) {
  const [isExpanded, setIsExpanded] = useState(!defaultCollapsed);
  const [searchQuery, setSearchQuery] = useState('');
  const [gameFilter, setGameFilter] = useState('all');
  const [rarityFilter, setRarityFilter] = useState('all');
  const [currencyFilter, setCurrencyFilter] = useState('all');
  const [slotFilter, setSlotFilter] = useState('all');
  const [groupFilter, setGroupFilter] = useState('all');
  const [activeFilter, setActiveFilter] = useState('all');
  const [inStoreFilter, setInStoreFilter] = useState('all');
  const [sortBy, setSortBy] = useState<'name' | 'id' | 'game' | 'rarity' | 'price'>(
    'name',
  );
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE_ITEMS);

  const gameOptions = useMemo(
    () => Array.from(new Set(items.map((item) => item.gameType))).sort(),
    [items],
  );
  const rarityOptions = useMemo(
    () => Array.from(new Set(items.map((item) => item.rarity))).sort(),
    [items],
  );
  const slotOptions = useMemo(
    () =>
      Array.from(
        new Set(items.flatMap((item) => item.slots).filter((slot) => Boolean(slot))),
      ).sort(),
    [items],
  );
  const groupOptions = useMemo(() => {
    const scopedItemIds = new Set(
      items
        .filter((item) => gameFilter === 'all' || item.gameType === gameFilter)
        .map((item) => item.id),
    );
    const seenNames = new Set<string>();
    return groups
      .filter((group) => group.itemIds.some((itemId) => scopedItemIds.has(itemId)))
      .filter((group) => {
        const key = group.name.trim().toLowerCase();
        if (!key) return false;
        if (seenNames.has(key)) return false;
        seenNames.add(key);
        return true;
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [gameFilter, groups, items]);

  const itemGroupsById = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const group of groups) {
      for (const itemId of group.itemIds) {
        const current = map.get(itemId) ?? [];
        current.push(group.id);
        map.set(itemId, current);
      }
    }
    return map;
  }, [groups]);

  const groupNameById = useMemo(
    () => new Map(groups.map((group) => [group.id, group.name])),
    [groups],
  );

  useEffect(() => {
    if (groupFilter === 'all' || groupFilter === 'ungrouped') return;
    if (groupOptions.some((group) => group.id === groupFilter)) return;
    setGroupFilter('all');
  }, [groupFilter, groupOptions]);

  const filteredItems = useMemo(() => {
    const search = searchQuery.trim().toLowerCase();
    const rarityRank: Record<string, number> = {
      common: 0,
      rare: 1,
      epic: 2,
      legendary: 3,
    };

    const filtered = items.filter((item) => {
      if (gameFilter !== 'all' && item.gameType !== gameFilter) return false;
      if (rarityFilter !== 'all' && item.rarity !== rarityFilter) return false;
      if (currencyFilter !== 'all' && item.currencyType !== currencyFilter) return false;
      if (slotFilter !== 'all' && !item.slots.includes(slotFilter)) return false;
      if (activeFilter === 'active' && item.active === false) return false;
      if (activeFilter === 'inactive' && item.active !== false) return false;
      if (inStoreItemIds) {
        if (inStoreFilter === 'in-store' && !inStoreItemIds.has(item.id)) return false;
        if (inStoreFilter === 'not-in-store' && inStoreItemIds.has(item.id)) return false;
      }

      const groupIds = itemGroupsById.get(item.id) ?? [];
      if (groupFilter === 'ungrouped' && groupIds.length > 0) return false;
      if (
        groupFilter !== 'all' &&
        groupFilter !== 'ungrouped' &&
        !groupIds.includes(groupFilter)
      ) {
        return false;
      }

      if (!search) return true;

      const groupNames = groupIds
        .map((groupId) => groupNameById.get(groupId))
        .filter((name): name is string => Boolean(name))
        .join(' ');
      const haystack = [
        item.id,
        item.name,
        item.gameType,
        item.rarity,
        item.currencyType,
        item.slots.join(' '),
        groupNames,
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(search);
    });

    filtered.sort((a, b) => {
      let cmp = 0;
      if (sortBy === 'name') cmp = a.name.localeCompare(b.name);
      else if (sortBy === 'id') cmp = a.id.localeCompare(b.id);
      else if (sortBy === 'game') cmp = a.gameType.localeCompare(b.gameType);
      else if (sortBy === 'price') cmp = a.price - b.price;
      else cmp = (rarityRank[a.rarity] ?? 0) - (rarityRank[b.rarity] ?? 0);
      return sortDirection === 'asc' ? cmp : -cmp;
    });

    return filtered;
  }, [
    activeFilter,
    currencyFilter,
    gameFilter,
    groupFilter,
    groupNameById,
    inStoreFilter,
    inStoreItemIds,
    itemGroupsById,
    items,
    rarityFilter,
    searchQuery,
    slotFilter,
    sortBy,
    sortDirection,
  ]);

  useEffect(() => {
    if (!onVisibleItemsChange) return;
    onVisibleItemsChange(filteredItems);
  }, [filteredItems, onVisibleItemsChange]);

  useEffect(() => {
    setVisibleCount(INITIAL_VISIBLE_ITEMS);
  }, [
    activeFilter,
    currencyFilter,
    gameFilter,
    groupFilter,
    inStoreFilter,
    rarityFilter,
    searchQuery,
    slotFilter,
    sortBy,
    sortDirection,
  ]);

  const allFilteredSelected = useMemo(() => {
    if (!selection || filteredItems.length === 0) return false;
    return filteredItems.every((item) => selection.selectedIds.has(item.id));
  }, [filteredItems, selection]);
  const visibleItems = useMemo(
    () => filteredItems.slice(0, visibleCount),
    [filteredItems, visibleCount],
  );

  const groupNamesFor = (item: Item) => {
    const itemGroupIds = itemGroupsById.get(item.id) ?? [];
    const scopedIds = groupFilter !== 'all' && groupFilter !== 'ungrouped'
      ? itemGroupIds.filter((groupId) => groupId === groupFilter)
      : itemGroupIds;
    return Array.from(new Set(scopedIds
      .map((groupId) => groupNameById.get(groupId))
      .filter((name): name is string => Boolean(name)))).join(', ') || 'None';
  };

  if (presentation === 'console') {
    const filterClass = 'mt-1 w-full rounded-key border border-soft bg-background px-3 py-2 text-sm text-strong';
    const advancedFilterCount = [rarityFilter, currencyFilter, slotFilter, groupFilter, inStoreFilter]
      .filter((value) => value !== 'all').length;

    return (
      <section className={`arcade-card space-y-4 p-4 sm:p-5 ${className}`} aria-busy={loading || busy}>
        <header className='flex flex-wrap items-start justify-between gap-3'>
          <div>
            <h2 className='text-lg font-semibold text-strong'>{title}</h2>
            <p className='mt-1 text-xs text-faint'>
              {loading ? 'Loading items…' : `${filteredItems.length} matching · ${items.length} total`}
            </p>
          </div>
          {actions ? <div className='flex flex-wrap gap-2' inert={busy}>{actions}</div> : null}
        </header>

        <div className='grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(9rem,13rem)_minmax(8rem,11rem)]'>
          <label className='text-xs font-semibold text-faint'>
            Search items
            <input
              type='search'
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              className={filterClass}
              placeholder='Name, ID, or group'
            />
          </label>
          <label className='text-xs font-semibold text-faint'>
            Game
            <select className={filterClass} value={gameFilter} onChange={(event) => setGameFilter(event.target.value)}>
              <option value='all'>All games</option>
              {gameOptions.map((gameType) => <option key={gameType} value={gameType}>{gameType}</option>)}
            </select>
          </label>
          <label className='text-xs font-semibold text-faint'>
            Status
            <select className={filterClass} value={activeFilter} onChange={(event) => setActiveFilter(event.target.value)}>
              <option value='all'>All statuses</option>
              <option value='active'>Active</option>
              <option value='inactive'>Inactive</option>
            </select>
          </label>
        </div>

        <details className='rounded-key border border-soft bg-raised/50 p-3'>
          <summary className='cursor-pointer text-sm font-semibold text-strong'>
            Advanced filters{advancedFilterCount ? ` · ${advancedFilterCount} active` : ''}
          </summary>
          <div className='mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4'>
            <label className='text-xs font-semibold text-faint'>
              Rarity
              <select className={filterClass} value={rarityFilter} onChange={(event) => setRarityFilter(event.target.value)}>
                <option value='all'>All rarities</option>
                {rarityOptions.map((rarity) => <option key={rarity} value={rarity}>{rarity}</option>)}
              </select>
            </label>
            <label className='text-xs font-semibold text-faint'>
              Currency
              <select className={filterClass} value={currencyFilter} onChange={(event) => setCurrencyFilter(event.target.value)}>
                <option value='all'>All currencies</option>
                <option value='credits'>Tickets</option>
              </select>
            </label>
            <label className='text-xs font-semibold text-faint'>
              Slot
              <select className={filterClass} value={slotFilter} onChange={(event) => setSlotFilter(event.target.value)}>
                <option value='all'>All slots</option>
                {slotOptions.map((slot) => <option key={slot} value={slot}>{slot}</option>)}
              </select>
            </label>
            <label className='text-xs font-semibold text-faint'>
              Group
              <select className={filterClass} value={groupFilter} onChange={(event) => setGroupFilter(event.target.value)}>
                <option value='all'>All groups</option>
                <option value='ungrouped'>Ungrouped</option>
                {groupOptions.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
              </select>
            </label>
            {inStoreItemIds ? (
              <label className='text-xs font-semibold text-faint'>
                Store
                <select className={filterClass} value={inStoreFilter} onChange={(event) => setInStoreFilter(event.target.value)}>
                  <option value='all'>All items</option>
                  <option value='in-store'>In store</option>
                  <option value='not-in-store'>Not in store</option>
                </select>
              </label>
            ) : null}
            <label className='text-xs font-semibold text-faint'>
              Sort by
              <select className={filterClass} value={sortBy} onChange={(event) => setSortBy(event.target.value as typeof sortBy)}>
                <option value='name'>Name</option>
                <option value='id'>ID</option>
                <option value='game'>Game</option>
                <option value='rarity'>Rarity</option>
                <option value='price'>Price</option>
              </select>
            </label>
            <label className='text-xs font-semibold text-faint'>
              Direction
              <select className={filterClass} value={sortDirection} onChange={(event) => setSortDirection(event.target.value as typeof sortDirection)}>
                <option value='asc'>Ascending</option>
                <option value='desc'>Descending</option>
              </select>
            </label>
          </div>
        </details>

        {loading ? (
          <p className='rounded-key border border-soft p-5 text-sm text-faint'>Loading catalog…</p>
        ) : filteredItems.length === 0 ? (
          <p className='rounded-key border border-soft p-5 text-sm text-faint'>No items match these filters.</p>
        ) : (
          <>
            <div className='hidden max-h-[34rem] overflow-auto rounded-key border border-soft md:block'>
              <table className='w-full min-w-[48rem] text-left text-sm'>
                <thead className='sticky top-0 bg-raised text-xs uppercase text-faint'>
                  <tr>
                    {selection ? <th className='p-3'><input type='checkbox' aria-label='Select all matching items' checked={allFilteredSelected} disabled={busy} onChange={() => selection.onToggleAllVisible(filteredItems.map((item) => item.id))} /></th> : null}
                    <th className='p-3'>Item</th><th className='p-3'>Game</th><th className='p-3'>Rarity</th><th className='p-3'>Slots</th>
                    <th className='p-3 text-right'>Price</th><th className='p-3'>Status</th>
                    {rowActions ? <th className='p-3 text-right'>Actions</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {visibleItems.map((item) => (
                    <tr key={item.id} className='border-t border-soft align-top'>
                      {selection ? <td className='p-3'><input type='checkbox' aria-label={`Select ${item.name}`} checked={selection.selectedIds.has(item.id)} disabled={busy} onChange={() => selection.onToggleItem(item.id)} /></td> : null}
                      <td className='p-3'><span className='font-semibold text-strong'>{item.name}</span><span className='block text-xs text-faint'>{item.id}</span><span className='block text-xs text-faint'>{groupNamesFor(item)}</span></td>
                      <td className='p-3'>{item.gameType}</td><td className='p-3'>{item.rarity}</td>
                      <td className='p-3'>{item.slots.join(', ') || 'None'}</td>
                      <td className='arcade-num p-3 text-right'>{item.price.toLocaleString()} Tickets</td>
                      <td className='p-3'>{item.active === false ? 'Inactive' : 'Active'}{inStoreItemIds ? ` · ${inStoreItemIds.has(item.id) ? 'In store' : 'Out of store'}` : ''}</td>
                      {rowActions ? <td className='p-3 text-right'><div inert={busy} className='flex justify-end gap-2'>{rowActions(item)}</div></td> : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className='grid gap-2 md:hidden'>
              {selection ? (
                <label className='flex items-center gap-2 text-xs font-semibold text-faint'>
                  <input type='checkbox' checked={allFilteredSelected} disabled={busy} onChange={() => selection.onToggleAllVisible(filteredItems.map((item) => item.id))} />
                  Select all matching items
                </label>
              ) : null}
              {visibleItems.map((item) => (
                <article key={item.id} className='rounded-key border border-soft bg-raised/50 p-3'>
                  <div className='flex items-start gap-3'>
                    {selection ? <input type='checkbox' className='mt-1' aria-label={`Select ${item.name}`} checked={selection.selectedIds.has(item.id)} disabled={busy} onChange={() => selection.onToggleItem(item.id)} /> : null}
                    <div className='min-w-0 flex-1'>
                      <h3 className='font-semibold text-strong'>{item.name}</h3>
                      <p className='break-all text-xs text-faint'>{item.id}</p>
                      <p className='mt-2 text-xs text-body'>{item.gameType} · {item.rarity} · {item.active === false ? 'Inactive' : 'Active'}</p>
                      <p className='mt-1 text-xs text-faint'>Slots: {item.slots.join(', ') || 'None'}{inStoreItemIds ? ` · ${inStoreItemIds.has(item.id) ? 'In store' : 'Out of store'}` : ''}</p>
                      <p className='mt-1 text-xs text-faint'>{groupNamesFor(item)}</p>
                      <p className='arcade-num mt-2 text-sm font-semibold text-strong'>{item.price.toLocaleString()} Tickets</p>
                    </div>
                  </div>
                  {rowActions ? <div inert={busy} className='mt-3 flex flex-wrap gap-2 border-t border-soft pt-3'>{rowActions(item)}</div> : null}
                </article>
              ))}
            </div>
          </>
        )}

        {filteredItems.length > visibleCount ? (
          <div className='flex flex-wrap items-center justify-between gap-3'>
            <p className='text-xs text-faint'>Showing {visibleItems.length} of {filteredItems.length} matching items.</p>
            <div className='flex gap-2'>
              <ArcadeButton tone='default' size='xs' onClick={() => setVisibleCount((count) => Math.min(filteredItems.length, count + INITIAL_VISIBLE_ITEMS))}>Show more</ArcadeButton>
              <ArcadeButton tone='default' size='xs' onClick={() => setVisibleCount(filteredItems.length)}>Show all</ArcadeButton>
            </div>
          </div>
        ) : null}
      </section>
    );
  }

  return (
    <section
      className={`rounded-lg border border-soft p-4 space-y-4 ${className}`}
    >
      <div className='flex flex-wrap items-end justify-between gap-3'>
        <div>
          <h2 className='text-lg font-semibold'>{title}</h2>
          <p className='text-xs text-faint'>
            {loading
              ? 'Loading items...'
              : isExpanded
                ? `${visibleItems.length} visible / ${filteredItems.length} filtered / ${items.length} total`
                : `${items.length} total items`}
          </p>
        </div>
        <div className='flex flex-wrap items-end gap-2'>
          <ArcadeButton
            tone='default'
            size='xs'
            onClick={() => setIsExpanded((current) => !current)}
          >
            {isExpanded ? 'Collapse' : 'Open catalog'}
          </ArcadeButton>
          {isExpanded ? (
            <>
          <label className='text-xs text-faint'>
            Search
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              className='ml-1 p-1 border border-soft rounded bg-background text-strong'
              placeholder='Name, id, group...'
            />
          </label>
          <label className='text-xs text-faint'>
            Game
            <select
              className='ml-1 p-1 border border-soft rounded bg-background text-strong'
              value={gameFilter}
              onChange={(event) => setGameFilter(event.target.value)}
            >
              <option value='all'>all</option>
              {gameOptions.map((gameType) => (
                <option key={gameType} value={gameType}>
                  {gameType}
                </option>
              ))}
            </select>
          </label>
          <label className='text-xs text-faint'>
            Rarity
            <select
              className='ml-1 p-1 border border-soft rounded bg-background text-strong'
              value={rarityFilter}
              onChange={(event) => setRarityFilter(event.target.value)}
            >
              <option value='all'>all</option>
              {rarityOptions.map((rarity) => (
                <option key={rarity} value={rarity}>
                  {rarity}
                </option>
              ))}
            </select>
          </label>
          <label className='text-xs text-faint'>
            Currency
            <select
              className='ml-1 p-1 border border-soft rounded bg-background text-strong'
              value={currencyFilter}
              onChange={(event) => setCurrencyFilter(event.target.value)}
            >
              <option value='all'>all</option>
              <option value='credits'>Tickets</option>
            </select>
          </label>
          <label className='text-xs text-faint'>
            Slot
            <select
              className='ml-1 p-1 border border-soft rounded bg-background text-strong'
              value={slotFilter}
              onChange={(event) => setSlotFilter(event.target.value)}
            >
              <option value='all'>all</option>
              {slotOptions.map((slot) => (
                <option key={slot} value={slot}>
                  {slot}
                </option>
              ))}
            </select>
          </label>
          <label className='text-xs text-faint'>
            Group
            <select
              className='ml-1 p-1 border border-soft rounded bg-background text-strong'
              value={groupFilter}
              onChange={(event) => setGroupFilter(event.target.value)}
            >
              <option value='all'>all</option>
              <option value='ungrouped'>ungrouped</option>
              {groupOptions.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
            </select>
          </label>
          <label className='text-xs text-faint'>
            Status
            <select
              className='ml-1 p-1 border border-soft rounded bg-background text-strong'
              value={activeFilter}
              onChange={(event) => setActiveFilter(event.target.value)}
            >
              <option value='all'>all</option>
              <option value='active'>active</option>
              <option value='inactive'>inactive</option>
            </select>
          </label>
          {inStoreItemIds ? (
            <label className='text-xs text-faint'>
              Store
              <select
                className='ml-1 p-1 border border-soft rounded bg-background text-strong'
                value={inStoreFilter}
                onChange={(event) => setInStoreFilter(event.target.value)}
              >
                <option value='all'>all</option>
                <option value='in-store'>in-store</option>
                <option value='not-in-store'>not-in-store</option>
              </select>
            </label>
          ) : null}
          <label className='text-xs text-faint'>
            Sort
            <select
              className='ml-1 p-1 border border-soft rounded bg-background text-strong'
              value={sortBy}
              onChange={(event) =>
                setSortBy(
                  event.target.value as 'name' | 'id' | 'game' | 'rarity' | 'price',
                )
              }
            >
              <option value='name'>name</option>
              <option value='id'>id</option>
              <option value='game'>game</option>
              <option value='rarity'>rarity</option>
              <option value='price'>price</option>
            </select>
          </label>
          <label className='text-xs text-faint'>
            Direction
            <select
              className='ml-1 p-1 border border-soft rounded bg-background text-strong'
              value={sortDirection}
              onChange={(event) => setSortDirection(event.target.value as 'asc' | 'desc')}
            >
              <option value='asc'>asc</option>
              <option value='desc'>desc</option>
            </select>
          </label>
          {actions ? <div inert={busy}>{actions}</div> : null}
            </>
          ) : null}
        </div>
      </div>

      {!isExpanded ? (
        <div className='arcade-card-inset border-dashed px-4 py-6 text-sm text-faint'>
          Open the catalog to view filters, selection controls, and items.
        </div>
      ) : loading ? (
        <p className='text-xs text-faint'>Loading store catalog...</p>
      ) : filteredItems.length === 0 ? (
        <p className='text-xs text-faint'>No matching store items.</p>
      ) : (
        <div className='max-h-80 overflow-x-auto overflow-y-auto rounded border border-soft'>
          <table className='min-w-max w-full text-xs'>
            <thead className='bg-raised'>
              <tr>
                {selection ? (
                  <th className='text-left p-2'>
                    <label className='inline-flex items-center gap-1 cursor-pointer'>
                      <input
                        type='checkbox'
                        checked={allFilteredSelected}
                        disabled={busy}
                        onChange={() =>
                          selection.onToggleAllVisible(filteredItems.map((item) => item.id))
                        }
                      />
                      <span className='text-[11px] text-faint'>All</span>
                    </label>
                  </th>
                ) : null}
                <th className='text-left p-2'>Item</th>
                <th className='text-left p-2'>Game</th>
                <th className='text-left p-2'>Rarity</th>
                <th className='text-left p-2'>Currency</th>
                <th className='text-left p-2'>Price</th>
                <th className='text-left p-2'>Slots</th>
                <th className='text-left p-2'>Set Tags</th>
                <th className='text-left p-2'>Status</th>
                {rowActions ? <th className='text-left p-2'>Actions</th> : null}
              </tr>
            </thead>
            <tbody>
              {visibleItems.map((item) => {
                const itemGroupIds = itemGroupsById.get(item.id) ?? [];
                const scopedGroupIds =
                  groupFilter !== 'all' && groupFilter !== 'ungrouped'
                    ? itemGroupIds.filter((groupId) => groupId === groupFilter)
                    : itemGroupIds;
                const groupNames = Array.from(
                  new Set(
                    scopedGroupIds
                      .map((groupId) => groupNameById.get(groupId))
                      .filter((name): name is string => Boolean(name)),
                  ),
                );
                return (
                  <tr key={item.id} className='border-t border-soft'>
                    {selection ? (
                      <td className='p-2 align-top'>
                        <input
                          type='checkbox'
                          checked={selection.selectedIds.has(item.id)}
                          disabled={busy}
                          onChange={() => selection.onToggleItem(item.id)}
                        />
                      </td>
                    ) : null}
                    <td className='p-2'>
                      <div className='font-medium'>{item.name}</div>
                      <div className='text-faint'>{item.id}</div>
                    </td>
                    <td className='p-2'>{item.gameType}</td>
                    <td className='p-2'>{item.rarity}</td>
                    <td className='p-2'>Tickets</td>
                    <td className='p-2'>{item.price}</td>
                    <td className='p-2'>{item.slots.join(', ') || 'none'}</td>
                    <td className='p-2'>{groupNames.join(', ') || 'none'}</td>
                    <td className='p-2'>
                      {item.active === false ? 'Inactive' : 'Active'}
                    </td>
                    {rowActions ? <td className='p-2'><div inert={busy}>{rowActions(item)}</div></td> : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {isExpanded && filteredItems.length > visibleCount ? (
        <div className='flex flex-wrap items-center justify-between gap-3'>
          <p className='text-xs text-faint'>
            Showing {visibleItems.length} of {filteredItems.length} matching items.
          </p>
          <div className='flex flex-wrap gap-2'>
            <ArcadeButton
              tone='default'
              size='xs'
              onClick={() =>
                setVisibleCount((count) =>
                  Math.min(filteredItems.length, count + INITIAL_VISIBLE_ITEMS),
                )
              }
            >
              Show more
            </ArcadeButton>
            <ArcadeButton
              tone='default'
              size='xs'
              onClick={() => setVisibleCount(filteredItems.length)}
            >
              Show all
            </ArcadeButton>
          </div>
        </div>
      ) : null}
    </section>
  );
}
