'use client';

/* The prize counter closes the page: how far you are from the next prize,
   in tickets, and four prizes from today's rotation around your balance.
   The host stands at the counter and doesn't talk. Prices and what's for
   sale come straight from the store; nothing here changes them. */

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useMemo } from 'react';

import { TixyHost } from '@/features/brand/tixy-host';
import { useGamesWallet } from '@/features/arcade/components/shell/games-wallet-provider';
import { ArcadeStub, Num } from '@/features/arcade/components/ui/arcade-ui';
import type { RewardGameType } from '@/features/arcade/lib/rewards';

import { pickCounter, type HomeCounter, type HomePrize } from './tixy-home-types';

// The store's item art is a large module; it loads in its own chunk.
const StoreItemPreview = dynamic(
  () => import('@/features/arcade/components/store-item-preview').then((mod) => mod.StoreItemPreview),
  { loading: () => null },
);

function Prize({ prize, balance, signedIn }: { prize: HomePrize; balance: number; signedIn: boolean }) {
  const short = prize.price - balance;
  return (
    <Link href='/store' className='tx-prize'>
      <span className='tx-prize-art' aria-hidden='true'>
        <StoreItemPreview
          item={{
            id: prize.id,
            name: prize.name,
            gameType: prize.gameType as RewardGameType,
            slots: prize.slots,
            assetRef: prize.assetRef,
            rarity: prize.rarity,
          }}
          compact
        />
      </span>
      <span className='tx-prize-name'>{prize.name}</span>
      <span className='tx-prize-kind'>
        <span>{prize.kind}</span>
        <span>
          {!signedIn ? (
            'sign in to save for it'
          ) : short > 0 ? (
            <>
              <Num className='tx-num' value={short} /> more
            </>
          ) : (
            'you can afford it'
          )}
        </span>
      </span>
      <ArcadeStub size='sm'>
        <Num value={prize.price} labelSuffix='tickets' />
      </ArcadeStub>
    </Link>
  );
}

export function HomeCounterPanel({ counter, signedIn }: { counter: HomeCounter | null; signedIn: boolean }) {
  const { wallet } = useGamesWallet();
  const balance = signedIn ? wallet.credits : 0;
  const view = useMemo(() => pickCounter(counter?.unowned ?? [], balance, counter?.pinnedId), [balance, counter]);

  let line: React.ReactNode;
  if (!counter) {
    line = 'The counter is closed right now.';
  } else if (!signedIn) {
    line = 'Tickets you win buy prizes here. Sign in to keep them.';
  } else if (counter.unowned.length === 0) {
    line = 'You own everything on the counter today.';
  } else if (view.next) {
    line = (
      <>
        You have <Num className='tx-num' value={balance} /> tickets. The next prize, {view.next.name}, is{' '}
        <Num className='tx-num' value={view.next.price - balance} /> away.
      </>
    );
  } else {
    line = (
      <>
        You have <Num className='tx-num' value={balance} /> tickets. You can afford all{' '}
        <Num className='tx-num' value={view.affordable} /> prizes on the counter today.
      </>
    );
  }

  return (
    <section className='tx-counter' aria-labelledby='tx-counter-name'>
      <div className='tx-counter-copy'>
        <h2 id='tx-counter-name'>prize counter</h2>
        <p>{line}</p>
        <Link href='/store' className='tx-btn' data-tone='paper' data-size='sm'>
          all prizes
        </Link>
      </div>
      {view.prizes.length > 0 ? (
        <div className='tx-case'>
          {view.prizes.map((prize) => (
            <Prize key={prize.id} prize={prize} balance={balance} signedIn={signedIn} />
          ))}
        </div>
      ) : (
        <div />
      )}
      <TixyHost width={150} className='tx-host' />
    </section>
  );
}
