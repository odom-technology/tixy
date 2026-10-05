'use client';

import { useEffect, useMemo, useState } from 'react';

import { ARCADE_GAMES } from '@/features/arcade/components/arcade-game-registry';
import { StoreItemPreview } from '@/features/arcade/components/store-item-preview';
import { ArcadeModal } from '@/features/arcade/components/ui/arcade-interactive';
import {
  ArcadeButton,
  ArcadeChip,
  ArcadeField,
  ArcadeInput,
  ArcadeNotice,
} from '@/features/arcade/components/ui/arcade-ui';
import { readJson } from '@/lib/read-json';
import type { OwnedStoreItem, StoreItem } from '@/server/arcade/rewards/types';

type InventoryResponse = {
  storeCatalog: StoreItem[];
  ownedItems: OwnedStoreItem[];
};
type GiftResponse = {
  success: boolean;
  grantResult: { granted: boolean };
  ownedItems: OwnedStoreItem[];
};
type Recipient = { id: string; username: string | null; email: string };

const GAME_NAMES = new Map(ARCADE_GAMES.map((game) => [game.slug, game.title]));
const gameName = (game: string) =>
  game === 'profile' ? 'Profile' : GAME_NAMES.get(game) ?? game;

export function GrantItemDialog({
  recipient,
  onClose,
  onGranted,
}: {
  recipient: Recipient;
  onClose: () => void;
  onGranted: (message: string) => void;
}) {
  const [data, setData] = useState<InventoryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [needsReload, setNeedsReload] = useState(false);
  const [search, setSearch] = useState('');
  const [game, setGame] = useState('all');
  const [limit, setLimit] = useState(40);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const recipientName = recipient.username ?? recipient.email;

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const payload = await readJson<InventoryResponse>(
          `/api/admin/db/user?${new URLSearchParams({ userId: recipient.id, view: 'gift' })}`,
          { signal: controller.signal, cache: 'no-store' },
        );
        if (controller.signal.aborted) return;
        setData(payload);
        setNeedsReload(false);
        setSelectedId(null);
        setReviewing(false);
      } catch (caught) {
        if (!controller.signal.aborted) {
          setNeedsReload(true);
          setError((caught as Error).message);
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void load();
    return () => controller.abort();
  }, [attempt, recipient.id]);

  // Match the inventory's supported items, including catalog-only admin gifts.
  const catalog = useMemo(
    () => (data?.storeCatalog ?? [])
      .filter((item) => item.gameType !== 'reaction-time')
      .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)),
    [data],
  );
  const owned = new Set(data?.ownedItems.map((entry) => entry.item.id) ?? []);
  const games = Array.from(new Set(catalog.map((item) => item.gameType)))
    .sort((a, b) => gameName(a).localeCompare(gameName(b)));
  const filtered = catalog.filter((item) =>
    (game === 'all' || item.gameType === game) &&
    `${item.name} ${item.id} ${gameName(item.gameType)} ${item.rarity} ${item.slots.join(' ')}`
      .toLowerCase().includes(search.trim().toLowerCase()),
  );
  const selected = catalog.find((item) => item.id === selectedId);
  const unavailable = loading || busy || needsReload || !data;
  const canGive = !unavailable && Boolean(selected && !owned.has(selected.id));

  const giveItem = async () => {
    if (!selected || !canGive || !reviewing) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const payload = await readJson<GiftResponse>('/api/admin/db/user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'grant-item',
          userId: recipient.id,
          itemId: selected.id,
          grantToAll: false,
        }),
      });
      if (!payload.success || !payload.ownedItems?.some((entry) => entry.item.id === selected.id)) {
        throw new Error('Updated ownership was not returned.');
      }
      setData((current) => current
        ? { ...current, ownedItems: payload.ownedItems }
        : current,
      );
      const message = payload.grantResult.granted
        ? `Gave ${selected.name} to ${recipientName}.`
        : `${recipientName} already owns ${selected.name}. No new item was given.`;
      setNotice(message);
      onGranted(message);
      setSelectedId(null);
      setReviewing(false);
    } catch (caught) {
      setNeedsReload(true);
      const reason = (caught as Error).message.replace(/\.+$/, '');
      setError(`Could not confirm the gift: ${reason}. Reload ownership before trying again.`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <ArcadeModal
      title={reviewing ? 'Confirm item gift' : 'Give item'}
      maxWidth={reviewing ? 760 : 1040}
      onClose={busy ? undefined : onClose}
      actions={
        <div className='flex w-full flex-wrap justify-end gap-2'>
          <ArcadeButton disabled={busy} onClick={onClose}>Close</ArcadeButton>
          {reviewing ? (
            <ArcadeButton disabled={busy} onClick={() => setReviewing(false)}>
              Back to items
            </ArcadeButton>
          ) : null}
          <ArcadeButton
            tone='primary'
            disabled={!canGive}
            onClick={() => reviewing ? void giveItem() : setReviewing(true)}
          >
            {busy ? 'Giving item…' : reviewing ? 'Give item' : 'Review gift'}
          </ArcadeButton>
        </div>
      }
    >
      <div className='space-y-4' aria-busy={loading || busy}>
        <div className='rounded-key border border-soft bg-panel p-3'>
          <p className='text-xs text-faint'>Recipient</p>
          <p className='break-words font-semibold text-strong'>{recipientName}</p>
          <p className='break-all text-xs text-faint'>{recipient.email}</p>
        </div>
        {notice ? (
          <div role='status'><ArcadeNotice tone='success'>{notice}</ArcadeNotice></div>
        ) : null}
        {error ? (
          <div role='alert'><ArcadeNotice tone='danger'>{error}</ArcadeNotice></div>
        ) : null}
        {needsReload && !loading ? (
          <ArcadeButton onClick={() => {
            setNotice(null);
            setAttempt((value) => value + 1);
          }}>
            Reload catalog and ownership
          </ArcadeButton>
        ) : null}
        {loading ? (
          <p role='status' className='py-8 text-center text-sm text-faint'>
            Loading catalog and owned items…
          </p>
        ) : null}
        {!loading && data ? <>
          {reviewing && selected ? <div className='space-y-3'>
            <div className='mx-auto max-w-64'><StoreItemPreview item={selected} compact /></div>
            <h3 className='text-lg font-semibold text-strong'>{selected.name}</h3>
            <p className='text-sm text-faint'>{gameName(selected.gameType)} · {selected.rarity} · {selected.slots.join(', ')}</p>
            <p className='break-all font-mono text-xs text-faint'>{selected.id}</p>
            <p className='text-sm text-body'>Give this item to <strong>{recipientName}</strong>? It will appear in their inventory. No Tickets will be charged.</p>
            {!selected.active ? <p className='text-xs text-faint'>This item is outside the store pool. It can still be given directly.</p> : null}
          </div> : <div className='grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]'>
            <div className='min-w-0 space-y-3'>
              <div className='grid gap-3 sm:grid-cols-[1fr_180px]'>
                <ArcadeField label='Search items'>
                  <ArcadeInput
                    disabled={unavailable}
                    value={search}
                    onChange={(event) => {
                      setSearch(event.target.value);
                      setLimit(40);
                    }}
                    placeholder='Name, item ID, rarity, or slot'
                  />
                </ArcadeField>
                <ArcadeField label='Game'>
                  <select
                    disabled={unavailable}
                    className='w-full arcade-input px-3 py-2 text-sm'
                    value={game}
                    onChange={(event) => {
                      setGame(event.target.value);
                      setLimit(40);
                    }}
                  >
                    <option value='all'>All games</option>
                    {games.map((value) => (
                      <option key={value} value={value}>{gameName(value)}</option>
                    ))}
                  </select>
                </ArcadeField>
              </div>
              <fieldset disabled={unavailable} className='space-y-2'>
                <legend className='mb-2 text-xs text-faint'>Choose an item · {filtered.length} matching</legend>
                <div className='max-h-64 space-y-2 overflow-y-auto rounded-key border border-soft p-2 lg:max-h-96'>
                  {filtered.slice(0, limit).map((item) => (
                    <label
                      key={item.id}
                      className={`flex cursor-pointer items-start gap-3 rounded-key border p-3 ${selectedId === item.id ? 'border-primary bg-raised' : 'border-soft bg-panel'} ${owned.has(item.id) ? 'opacity-60' : ''}`}
                    >
                      <input
                        type='radio'
                        name='gift-item'
                        value={item.id}
                        checked={selectedId === item.id}
                        disabled={owned.has(item.id)}
                        onChange={() => {
                          setSelectedId(item.id);
                          setNotice(null);
                        }}
                        className='mt-1 shrink-0'
                      />
                      <span className='min-w-0 flex-1'>
                        <span className='block font-medium text-strong'>{item.name}</span>
                        <span className='block text-xs text-faint'>
                          {gameName(item.gameType)} · {item.rarity} · {item.slots.join(', ')}
                        </span>
                        <span className='block break-all font-mono text-xs text-faint'>{item.id}</span>
                        {owned.has(item.id) ? (
                          <ArcadeChip>Already owned</ArcadeChip>
                        ) : !item.active ? (
                          <ArcadeChip>Outside store pool</ArcadeChip>
                        ) : null}
                      </span>
                    </label>
                  ))}
                  {!filtered.length ? (
                    <p className='p-4 text-center text-sm text-faint'>
                      {catalog.length
                        ? 'No items match these filters.'
                        : 'No items are available to give yet. Create an item in Skin Studio first.'}
                    </p>
                  ) : null}
                </div>
                {filtered.length > limit ? (
                  <ArcadeButton
                    disabled={unavailable}
                    size='sm'
                    onClick={() => setLimit((value) => value + 40)}
                  >
                    Show more items
                  </ArcadeButton>
                ) : null}
              </fieldset>
              {selected ? <p className='text-sm text-body'>Selected: <strong>{selected.name}</strong> for <strong>{recipientName}</strong>.</p> : null}
              <p className='text-xs text-faint'>Includes items outside the store pool. Items already owned, including gifts for all players, cannot be selected.</p>
            </div>
            <aside className='hidden self-start rounded-key border border-soft bg-panel p-4 lg:block' aria-label='Selected item preview'>
              <h3 className='mb-3 text-sm font-semibold text-strong'>Item preview</h3>
              {selected ? <div className='space-y-3'>
                <StoreItemPreview item={selected} compact />
                <p className='break-words font-semibold text-strong'>{selected.name}</p>
                <p className='text-xs text-faint'>{gameName(selected.gameType)} · {selected.rarity} · {selected.slots.join(', ')}</p>
                <p className='break-all font-mono text-xs text-faint'>{selected.id}</p>
                <p className='text-sm text-body'>For <strong>{recipientName}</strong>. No Tickets will be charged.</p>
                {!selected.active ? <ArcadeChip>Outside store pool</ArcadeChip> : null}
              </div> : <p className='text-sm text-faint'>Choose an item to preview it before reviewing the gift.</p>}
            </aside>
          </div>}
        </> : null}
      </div>
    </ArcadeModal>
  );
}
