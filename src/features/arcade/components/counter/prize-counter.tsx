'use client';

/* The prize counter (docs/design/tixy-rebrand/PROGRESSION.md, "The prize
   counter"; mockup.html's counter). Every prize, every day, on four shelves
   by price: 450, 750, 1,200 and 2,000 tickets. "New this week" sits in the
   case up top, a prize can be pinned, and the head says how far the next
   prize is. Ticket packs stay at the bottom with the same Stripe checkout.

   Prices, ownership and the next-prize sums come from /api/store; nothing
   here decides a price. */

import { Pin, PinOff } from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';

import { StoreItemPreview } from '@/features/arcade/components/store-item-preview';
import { useAccountSummary } from '@/features/arcade/components/shell/use-account-summary';
import { useSiteAvailability } from '@/features/arcade/components/shell/site-availability-context';
import { ArcadeStub } from '@/features/arcade/components/ui/arcade-ui';
import { Num } from '@/features/arcade/components/ui/num';
import type { RewardGameType } from '@/features/arcade/lib/rewards';
import { COUNTER_SHELVES } from '@/features/arcade/lib/skins/counter-catalog';
import { SKIN_GAMES } from '@/features/arcade/lib/skins/skin-set';
import { TixyHost } from '@/features/brand/tixy-host';
import { RewardedAdButton } from '@/features/monetization/components/rewarded-ad-button';

import { PrizeHover } from './preview/prize-hover';
import { PrizePreview } from './preview/prize-preview';
import type { Me, ProfileLook } from './preview/identity-preview';
import { profileLookFrom } from './preview/identity-preview';

import './prize-counter.css';

type CounterItem = {
  id: string;
  name: string;
  gameType: RewardGameType;
  price: number;
  slots: string[];
  assetRef: Record<string, unknown> | null;
};

type CounterEntry = { slotIndex: number; item: CounterItem; owned: boolean; kind: string };

type CounterState = {
  isGuest?: boolean;
  level?: number | null;
  wallet: { credits: number; storeCredits?: number; spendableCredits?: number };
  rotation: CounterEntry[];
  equipped: Array<{ slot: string; item: CounterItem }>;
  counter: {
    pinnedItemId: string | null;
    newThisWeek: string[];
    pace: { ticketsPerDay: number | null; daysCounted: number };
    next: { itemId: string; pinned: boolean; away: number; days: number | null } | null;
    canAffordEverything: boolean;
  };
};

type TicketPack = { id: string; name: string; tickets: number; amount: number; currency: string };

type Busy = { itemId: string; action: 'buy' | 'equip' | 'pin' } | null;

const SHELF_LABEL: Record<number, string> = { 450: '450', 750: '750', 1200: '1,200', 2000: '2,000' };

/* Every skin game, in the catalog's order, then profile prizes. */
const GROUP_LABEL: Record<string, string> = {
  ...Object.fromEntries(Object.entries(SKIN_GAMES).map(([game, spec]) => [game, spec.label])),
  profile: 'profile',
};

const capitalise = (text: string) => (text ? `${text[0]!.toUpperCase()}${text.slice(1)}` : text);

const balanceOf = (state: CounterState | null) =>
  state ? (state.wallet.spendableCredits ?? state.wallet.credits + (state.wallet.storeCredits ?? 0)) : 0;

function PrizeArt({ item }: { item: CounterItem }) {
  return (
    <StoreItemPreview
      item={{ id: item.id, name: item.name, gameType: item.gameType, slots: item.slots, assetRef: item.assetRef }}
      compact
    />
  );
}

/* Whether this device points (a mouse or a pen), so a card can show the
   prize in place on hover. Never true on touch. */
const canHover = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(hover: hover) and (pointer: fine)').matches === true;

/* What a prize's second line says once you point at it (or always, on touch). */
function PrizeStatus({ entry, equipped, balance, signedIn }: { entry: CounterEntry; equipped: boolean; balance: number; signedIn: boolean }) {
  if (equipped) return <>equipped</>;
  if (entry.owned) return <>yours</>;
  if (!signedIn) return <>sign in to save for it</>;
  const short = entry.item.price - balance;
  if (short <= 0) return <>you can afford it</>;
  return (
    <>
      <Num className='pc-num' value={short} /> more
    </>
  );
}

function PrizeCard({
  entry,
  equipped,
  pinned,
  isNew,
  balance,
  signedIn,
  busy,
  justBought,
  me,
  look,
  onOpen,
  onBuy,
  onEquip,
  onPin,
}: {
  entry: CounterEntry;
  me: Me | null;
  look: ProfileLook;
  equipped: boolean;
  pinned: boolean;
  isNew: boolean;
  balance: number;
  signedIn: boolean;
  busy: Busy;
  justBought: boolean;
  onOpen: () => void;
  onBuy: () => void;
  onEquip: () => void;
  onPin: () => void;
}) {
  const mine = busy?.itemId === entry.item.id;
  const affordable = !entry.owned && entry.item.price <= balance;
  // The in-place preview mounts the first time a pointer comes over the
  // card (or keyboard focus lands on it), and stays.
  const [hovered, setHovered] = useState(false);
  const wake = () => {
    if (!hovered && canHover()) setHovered(true);
  };
  return (
    <article
      className='pc-prize'
      data-pinned={pinned || undefined}
      data-can={affordable || undefined}
      data-owned={entry.owned || undefined}
      data-just={justBought ? 'bought' : undefined}
    >
      <button
        type='button'
        className='pc-prize-art'
        onClick={onOpen}
        onPointerEnter={(event) => {
          if (event.pointerType === 'mouse' || event.pointerType === 'pen') wake();
        }}
        onFocus={wake}
        aria-label={`look at ${entry.item.name}`}
        aria-haspopup='dialog'
      >
        <PrizeArt item={entry.item} />
        {hovered ? <PrizeHover item={entry.item} me={me} look={look} /> : null}
      </button>
      <span className='pc-prize-name'>{entry.item.name}</span>
      <span className='pc-prize-kind'>
        <span>{isNew ? `${entry.kind}, new this week` : entry.kind}</span>
        <span>
          <PrizeStatus entry={entry} equipped={equipped} balance={balance} signedIn={signedIn} />
        </span>
      </span>
      <div className='pc-prize-foot'>
        <ArcadeStub size='sm' muted={entry.owned}>
          <Num value={entry.item.price} labelSuffix='tickets' />
        </ArcadeStub>
        <div className='pc-prize-actions'>
          {!entry.owned && signedIn ? (
            <button
              type='button'
              className='pc-icon'
              onClick={onPin}
              aria-pressed={pinned}
              aria-label={pinned ? `unpin ${entry.item.name}` : `pin ${entry.item.name}`}
              disabled={mine}
            >
              {pinned ? <PinOff aria-hidden strokeLinecap='square' /> : <Pin aria-hidden strokeLinecap='square' />}
            </button>
          ) : null}
          {!signedIn ? null : entry.owned ? (
            equipped ? null : (
              <button type='button' className='pc-btn' data-tone='paper' onClick={onEquip} disabled={mine}>
                {mine && busy?.action === 'equip' ? 'equipping' : 'equip'}
              </button>
            )
          ) : (
            <button type='button' className='pc-btn' data-tone={affordable ? 'ticket' : 'paper'} onClick={onBuy} disabled={mine || !affordable}>
              {mine && busy?.action === 'buy' ? 'buying' : 'buy'}
            </button>
          )}
        </div>
      </div>
    </article>
  );
}

function HeadLine({ state, signedIn }: { state: CounterState | null; signedIn: boolean }): ReactNode {
  if (!state) return 'Opening the counter.';
  if (state.rotation.length === 0) return 'The counter is closed right now.';
  if (!signedIn) return 'Tickets you win buy prizes here. Sign in to keep them.';
  const balance = balanceOf(state);
  const { next, canAffordEverything } = state.counter;
  const you = (
    <>
      You have <Num className='pc-num' value={balance} /> tickets.
    </>
  );
  if (!next) {
    return canAffordEverything ? <>{you} You can afford every prize.</> : <>{you} You own every prize on the counter.</>;
  }
  const prize = state.rotation.find((entry) => entry.item.id === next.itemId)?.item;
  if (!prize) return you;
  if (next.away <= 0) {
    return (
      <>
        {you} You can afford {prize.name}, your pin.
      </>
    );
  }
  return (
    <>
      {you} {next.pinned ? <>Your pin, {prize.name}, is</> : <>{capitalise(prize.name)} is</>}{' '}
      <Num className='pc-num' value={next.away} /> away.
      {next.days ? (
        <>
          {' '}
          About <Num value={next.days} /> {next.days === 1 ? 'day' : 'days'} at your pace.
        </>
      ) : null}
    </>
  );
}

export function PrizeCounter() {
  const { ticketBundlesEnabled } = useSiteAvailability();
  const [state, setState] = useState<CounterState | null>(null);
  const [packs, setPacks] = useState<TicketPack[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [busyPack, setBusyPack] = useState<string | null>(null);
  const [justBought, setJustBought] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [group, setGroup] = useState<string>('all');

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/store', { cache: 'no-store' });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || 'The counter did not load.');
      setState(payload as CounterState);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!ticketBundlesEnabled) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/store/ticket-packs', { cache: 'no-store' });
        const payload = (await res.json()) as { packs?: TicketPack[] };
        if (!cancelled && res.ok) setPacks(payload.packs ?? []);
      } catch {
        if (!cancelled) setPacks([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ticketBundlesEnabled]);

  // Back from Stripe checkout.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const purchase = params.get('ticket_purchase');
    if (purchase === 'success') {
      setNotice('Your tickets are on the way. The balance updates when Stripe confirms the payment.');
      void load();
    } else if (purchase === 'cancelled') {
      setNotice('Checkout cancelled. Nothing was charged.');
    }
    if (purchase) {
      params.delete('ticket_purchase');
      params.delete('session_id');
      const next = params.toString();
      window.history.replaceState(null, '', `${window.location.pathname}${next ? `?${next}` : ''}${window.location.hash}`);
    }
  }, [load]);

  const signedIn = Boolean(state && !state.isGuest);
  const { account } = useAccountSummary();
  const me = useMemo<Me | null>(
    () =>
      signedIn && account
        ? { name: account.username ?? 'you', avatarUrl: account.imageUrl ?? null, level: state?.level ?? null }
        : null,
    [signedIn, account, state?.level],
  );
  const look = useMemo(() => profileLookFrom(state?.equipped ?? [], me?.avatarUrl ?? null), [state, me]);

  /* The open prize lives in the address (?prize=<id>), so a link opens it
     and back closes it. */
  const openPreview = useCallback((id: string) => {
    setOpenId(id);
    const url = new URL(window.location.href);
    url.searchParams.set('prize', id);
    window.history.pushState({ prize: id }, '', url);
  }, []);
  const closePreview = useCallback(() => {
    setOpenId(null);
    const url = new URL(window.location.href);
    if (!url.searchParams.has('prize')) return;
    if (window.history.state?.prize) {
      window.history.back();
    } else {
      url.searchParams.delete('prize');
      window.history.replaceState(null, '', url);
    }
  }, []);
  useEffect(() => {
    const sync = () => setOpenId(new URL(window.location.href).searchParams.get('prize'));
    sync();
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, []);
  const balance = balanceOf(state);
  const entries = useMemo(() => state?.rotation ?? [], [state]);
  const equippedIds = useMemo(() => new Set((state?.equipped ?? []).map((entry) => entry.item.id)), [state]);
  const newIds = useMemo(() => new Set(state?.counter.newThisWeek ?? []), [state]);
  const pinnedId = state?.counter.pinnedItemId ?? null;

  const groups = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of entries) counts.set(entry.item.gameType, (counts.get(entry.item.gameType) ?? 0) + 1);
    return Object.keys(GROUP_LABEL)
      .filter((key) => counts.has(key))
      .map((key) => ({ key, label: GROUP_LABEL[key]!, count: counts.get(key)! }));
  }, [entries]);

  const shown = group === 'all' ? entries : entries.filter((entry) => entry.item.gameType === group);
  const newEntries = (state?.counter.newThisWeek ?? [])
    .map((id) => entries.find((entry) => entry.item.id === id))
    .filter((entry): entry is CounterEntry => Boolean(entry));
  const pinnedEntry = pinnedId ? entries.find((entry) => entry.item.id === pinnedId) ?? null : null;
  const openEntry = openId ? entries.find((entry) => entry.item.id === openId) ?? null : null;

  const act = useCallback(
    async (itemId: string, action: 'buy' | 'equip' | 'pin', run: () => Promise<Response>, done: (payload: Record<string, unknown>) => void) => {
      setBusy({ itemId, action });
      setError(null);
      setNotice(null);
      try {
        const res = await run();
        const payload = (await res.json()) as Record<string, unknown>;
        if (!res.ok) throw new Error((payload.error as string) || 'That did not work. Try again.');
        done(payload);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setBusy(null);
      }
    },
    [],
  );

  const buy = (entry: CounterEntry) =>
    void act(
      entry.item.id,
      'buy',
      () => fetch('/api/store/purchase', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ itemId: entry.item.id }) }),
      (payload) => {
        setState(payload.state as CounterState);
        setJustBought(entry.item.id);
        setNotice(`${capitalise(entry.item.name)} is yours. Equip it from here or in the game.`);
        window.dispatchEvent(new Event('store-inventory-updated'));
      },
    );

  const equip = (entry: CounterEntry) =>
    void act(
      entry.item.id,
      'equip',
      () => fetch('/api/store/equip', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ itemId: entry.item.id, gameType: entry.item.gameType }) }),
      () => {
        setNotice(`${capitalise(entry.item.name)} is on.`);
        window.dispatchEvent(new Event('store-inventory-updated'));
        void load();
      },
    );

  const pin = (entry: CounterEntry) => {
    const next = pinnedId === entry.item.id ? null : entry.item.id;
    void act(
      entry.item.id,
      'pin',
      () => fetch('/api/store/pin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ itemId: next }) }),
      (payload) => setState(payload.state as CounterState),
    );
  };

  const checkout = async (packId: string) => {
    setBusyPack(packId);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch('/api/store/ticket-packs/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packId }),
      });
      const payload = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !payload.url) throw new Error(payload.error || 'Checkout did not open. Try again.');
      window.location.assign(payload.url);
    } catch (err) {
      setError((err as Error).message);
      setBusyPack(null);
    }
  };

  const card = (entry: CounterEntry, onNewShelf = false) => (
    <PrizeCard
      key={entry.item.id}
      entry={entry}
      equipped={equippedIds.has(entry.item.id)}
      pinned={pinnedId === entry.item.id}
      isNew={!onNewShelf && newIds.has(entry.item.id)}
      balance={balance}
      signedIn={signedIn}
      busy={busy}
      justBought={justBought === entry.item.id}
      me={me}
      look={look}
      onOpen={() => openPreview(entry.item.id)}
      onBuy={() => buy(entry)}
      onEquip={() => equip(entry)}
      onPin={() => pin(entry)}
    />
  );

  return (
    <div className='pc-page'>
      <section className='pc-head' aria-labelledby='pc-title'>
        <div className='pc-head-copy'>
          <h1 id='pc-title'>prize counter</h1>
          <p>
            <HeadLine state={state} signedIn={signedIn} />
          </p>
          {!signedIn && state ? (
            <a className='pc-btn' data-tone='paper' href='/signin?next=%2Fstore'>
              sign in
            </a>
          ) : null}
        </div>
        {pinnedEntry ? (
          <div className='pc-pinned'>
            <span className='pc-pinned-art'>
              <PrizeArt item={pinnedEntry.item} />
            </span>
            <span className='pc-pinned-copy'>
              <span className='pc-pinned-label'>your pin</span>
              <span className='pc-prize-name'>{pinnedEntry.item.name}</span>
              <ArcadeStub size='sm'>
                <Num value={pinnedEntry.item.price} labelSuffix='tickets' />
              </ArcadeStub>
            </span>
          </div>
        ) : (
          <div />
        )}
        <TixyHost width={130} className='pc-host' />
      </section>

      {error ? (
        <p className='pc-note' data-tone='error' role='alert'>
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className='pc-note' role='status'>
          {notice}
        </p>
      ) : null}

      {newEntries.length > 0 ? (
        <section className='pc-case' aria-labelledby='pc-new-title'>
          <h2 id='pc-new-title'>new this week</h2>
          <div className='pc-glass'>{newEntries.map((entry) => card(entry, true))}</div>
        </section>
      ) : null}

      {groups.length > 1 ? (
        <div className='pc-filter' role='group' aria-label='show prizes for'>
          <button type='button' aria-pressed={group === 'all'} onClick={() => setGroup('all')}>
            all <Num value={entries.length} />
          </button>
          {groups.map((entry) => (
            <button key={entry.key} type='button' aria-pressed={group === entry.key} onClick={() => setGroup(entry.key)}>
              {entry.label} <Num value={entry.count} />
            </button>
          ))}
        </div>
      ) : null}

      {COUNTER_SHELVES.map((price) => {
        const onShelf = shown.filter((entry) => entry.item.price === price);
        if (onShelf.length === 0) return null;
        return (
          <section key={price} className='pc-shelf' aria-label={`${SHELF_LABEL[price]} tickets`}>
            <div className='pc-shelf-head'>
              <ArcadeStub size='lg'>
                <Num value={price} labelSuffix='tickets' />
              </ArcadeStub>
              <span>
                <Num value={onShelf.length} /> {onShelf.length === 1 ? 'prize' : 'prizes'}
              </span>
            </div>
            <div className='pc-glass'>{onShelf.map((entry) => card(entry))}</div>
          </section>
        );
      })}
      {/* Prizes priced off the four shelves (an admin price) still sell. */}
      {(() => {
        const off = shown.filter((entry) => !(COUNTER_SHELVES as readonly number[]).includes(entry.item.price));
        if (off.length === 0) return null;
        return (
          <section className='pc-shelf' aria-label='more prizes'>
            <div className='pc-shelf-head'>
              <span>more prizes</span>
            </div>
            <div className='pc-glass'>{off.map((entry) => card(entry))}</div>
          </section>
        );
      })()}

      {ticketBundlesEnabled ? (
        <section className='pc-packs' aria-labelledby='pc-packs-title'>
          <h2 id='pc-packs-title'>ticket packs</h2>
          <p>Pack tickets spend here at the counter.</p>
          <div className='pc-pack-row'>
            {packs.map((pack) => (
              <article key={pack.id} className='pc-pack'>
                <span className='pc-pack-name'>{pack.name.toLowerCase()}</span>
                <ArcadeStub size='lg'>
                  <Num value={pack.tickets} labelSuffix='tickets' />
                </ArcadeStub>
                <span className='pc-pack-price'>
                  {(pack.amount / 100).toLocaleString(undefined, { style: 'currency', currency: pack.currency.toUpperCase() })}
                </span>
                {signedIn ? (
                  <button
                    type='button'
                    className='pc-btn'
                    onClick={() => void checkout(pack.id)}
                    disabled={!state || busyPack === pack.id}
                  >
                    {busyPack === pack.id ? 'opening' : 'buy'}
                  </button>
                ) : (
                  <a className='pc-btn' href='/signin?next=%2Fstore'>
                    sign in
                  </a>
                )}
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {/* The rewarded ad stays whether or not ticket packs are on sale. */}
      <section className='pc-packs pc-ad' aria-labelledby='pc-ad-title'>
        <div className='pc-ad-copy'>
          <h2 id='pc-ad-title'>optional ad reward</h2>
          <p>Watch a rewarded ad for tickets you spend at the counter.</p>
        </div>
        <RewardedAdButton
          rewardType='store_tickets'
          onReward={() => {
            setNotice('Tickets added.');
            void load();
          }}
        >
          watch ad
        </RewardedAdButton>
      </section>

      {openEntry ? (
        <PrizePreview
          entry={openEntry}
          equipped={state?.equipped ?? []}
          me={me}
          balance={balance}
          signedIn={signedIn}
          pinned={pinnedId === openEntry.item.id}
          busy={busy !== null}
          onClose={closePreview}
          onBuy={() => buy(openEntry)}
          onEquip={() => equip(openEntry)}
          onPin={() => pin(openEntry)}
        />
      ) : null}
    </div>
  );
}
