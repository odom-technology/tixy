import type { Metadata } from 'next';

import { AppPageFrame } from '@/features/arcade/components/shell/page-frame';
import { ArcadePanel } from '@/features/arcade/components/ui/arcade-ui';

export const metadata: Metadata = {
  title: 'Terms | tixy',
  description: 'Terms for tixy by ODOM Tech.',
};

export default function TermsPage() {
  return (
    <AppPageFrame
      eyebrow='Legal'
      title='Terms'
      subtitle='Rules for using tixy accounts, games, ads, rewards, and store purchases.'
      contentClassName='space-y-4'
    >
      <ArcadePanel variant='raised' className='space-y-5 p-4 text-sm leading-7 text-body sm:p-5'>
        <p className='font-semibold text-strong'>Last updated: June 24, 2026.</p>

        <section className='space-y-2'>
          <h2 className='arcade-display text-lg text-strong uppercase'>Use of tixy</h2>
          <p>
            tixy is provided for browser games, accounts, scores, cosmetic inventory,
            and related project features. Do not misuse the service, automate abusive
            traffic, attack the site, exploit bugs, or bypass game, account, payment, or
            advertising controls.
          </p>
        </section>

        <section className='space-y-2'>
          <h2 className='arcade-display text-lg text-strong uppercase'>Tickets and items</h2>
          <p>
            Tickets, store-only credits, free plays, continues, cosmetics, and inventory
            items are digital tixy features only. They have no cash value, cannot be
            cashed out, and are not a stored-value product.
          </p>
        </section>

        <section className='space-y-2'>
          <h2 className='arcade-display text-lg text-strong uppercase'>Ads and rewards</h2>
          <p>
            Guests may see ads on game pages. Signed-in users may be offered optional
            rewarded ads. Rewards are granted only through approved tixy flows and may
            be limited, delayed, denied, or reversed when abuse or invalid activity is
            detected.
          </p>
        </section>

        <section className='space-y-2'>
          <h2 className='arcade-display text-lg text-strong uppercase'>Purchases</h2>
          <p>
            Paid tickets are store-only digital items. They cannot be transferred for
            real-world value and cannot fund wager games. Refunds, failed payments, and
            disputes may reverse or freeze related balances and entitlements.
          </p>
        </section>

        <section className='space-y-2'>
          <h2 className='arcade-display text-lg text-strong uppercase'>Leaderboards</h2>
          <p>
            Continued runs, suspicious submissions, and invalid game activity may be
            excluded from leaderboards, rewards, and ticket payouts.
          </p>
        </section>
      </ArcadePanel>
    </AppPageFrame>
  );
}
