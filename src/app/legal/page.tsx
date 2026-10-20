import type { Metadata } from 'next';
import Link from 'next/link';

import { AppPageFrame } from '@/features/arcade/components/shell/page-frame';
import {
  ArcadeAnchorButton,
  ArcadePanel,
} from '@/features/arcade/components/ui/arcade-ui';

export const metadata: Metadata = {
  title: 'Privacy & Terms | tixy',
  description: 'Privacy policy and terms for tixy by ODOM Tech.',
};

export default function LegalPage() {
  return (
    <AppPageFrame
      eyebrow='Legal'
      title='Privacy & Terms'
      subtitle='How tixy handles your data and the rules for using the service.'
      contentClassName='space-y-4'
    >
      <nav aria-label='Legal sections' className='flex flex-wrap gap-3'>
        <a href='#privacy' className='arcade-link'>Privacy Policy</a>
        <a href='#terms' className='arcade-link'>Terms</a>
      </nav>
      <ArcadePanel variant='raised' id='privacy' aria-labelledby='privacy-title' className='space-y-5 p-4 text-sm leading-7 text-body sm:p-5'>
        <h2 id='privacy-title' className='arcade-display text-xl text-strong uppercase'>Privacy Policy</h2>
        <p className='font-semibold text-strong'>Last updated: October 14, 2026.</p>

        <section className='space-y-2'>
          <h3 className='arcade-display text-lg text-strong uppercase'>Information collected</h3>
          <p>
            tixy may collect account details you provide, gameplay activity, scores,
            tickets, store-only credits, inventory, reward claims, purchase records,
            feedback, device/browser information, cookies, logs, and security data needed
            to run the service.
          </p>
        </section>

        <section className='space-y-2'>
          <h3 className='arcade-display text-lg text-strong uppercase'>Ads and cookies</h3>
          <p>
            Guests may see Google ads on game pages. Google and other advertising partners
            may place and read cookies on your browser and use web beacons, IP addresses,
            device/browser information, and other identifiers to deliver and measure ads,
            prevent fraud, and personalize ads where permitted. These partners may use
            information about your visits to tixy and other websites.
          </p>
          <p>
            Where a consent message is shown, you can choose whether to consent and manage
            your advertising preferences there. You can also manage personalized ad choices
            through Google Ads Settings or broader industry opt-out tools. Google&apos;s partner
            data policy explains how Google collects, shares, and uses information when you
            visit a site that uses its services.
          </p>
          <div className='flex flex-wrap gap-2'>
            <ArcadeAnchorButton
              href='https://policies.google.com/technologies/partner-sites'
              target='_blank'
              rel='noopener noreferrer'
              size='sm'
              tone='ghost'
            >
              How Google uses partner-site data
            </ArcadeAnchorButton>
            <ArcadeAnchorButton
              href='https://adssettings.google.com/'
              target='_blank'
              rel='noopener noreferrer'
              size='sm'
              tone='ghost'
            >
              Google Ads Settings
            </ArcadeAnchorButton>
            <ArcadeAnchorButton
              href='https://www.aboutads.info/'
              target='_blank'
              rel='noopener noreferrer'
              size='sm'
              tone='ghost'
            >
              About Ads
            </ArcadeAnchorButton>
          </div>
        </section>

        <section className='space-y-2'>
          <h3 className='arcade-display text-lg text-strong uppercase'>Payments</h3>
          <p>
            Ticket pack purchases are processed by Stripe. tixy does not store payment
            card details directly. Purchase records may be stored to grant digital items,
            reconcile refunds or disputes, prevent fraud, and provide support.
          </p>
        </section>

        <section className='space-y-2'>
          <h3 className='arcade-display text-lg text-strong uppercase'>How data is used</h3>
          <p>
            Data is used to operate accounts, save scores, run games, grant rewards,
            manage inventory, process purchases, prevent abuse, respond to feedback, and
            improve reliability and security.
          </p>
        </section>

        <section className='space-y-2'>
          <h3 className='arcade-display text-lg text-strong uppercase'>Contact</h3>
          <p>
            Send privacy questions through our{' '}
            <Link href='/feedback?category=privacy' className='arcade-link'>
              Feedback form
            </Link>
            .
          </p>
        </section>
      </ArcadePanel>

      <ArcadePanel variant='raised' id='terms' aria-labelledby='terms-title' className='space-y-5 p-4 text-sm leading-7 text-body sm:p-5'>
        <h2 id='terms-title' className='arcade-display text-xl text-strong uppercase'>Terms</h2>
        <p className='font-semibold text-strong'>Last updated: June 24, 2026.</p>

        <section className='space-y-2'>
          <h3 className='arcade-display text-lg text-strong uppercase'>Use of tixy</h3>
          <p>
            tixy is provided for browser games, accounts, scores, cosmetic inventory,
            and related project features. Do not misuse the service, automate abusive
            traffic, attack the site, exploit bugs, or bypass game, account, payment, or
            advertising controls.
          </p>
        </section>

        <section className='space-y-2'>
          <h3 className='arcade-display text-lg text-strong uppercase'>Tickets and items</h3>
          <p>
            Tickets, store-only credits, free plays, continues, cosmetics, and inventory
            items are digital tixy features only. They have no cash value, cannot be
            cashed out, and are not a stored-value product.
          </p>
        </section>

        <section className='space-y-2'>
          <h3 className='arcade-display text-lg text-strong uppercase'>Ads and rewards</h3>
          <p>
            Guests may see ads on game pages. Signed-in users may be offered optional
            rewarded ads. Rewards are granted only through approved tixy flows and may
            be limited, delayed, denied, or reversed when abuse or invalid activity is
            detected.
          </p>
        </section>

        <section className='space-y-2'>
          <h3 className='arcade-display text-lg text-strong uppercase'>Purchases</h3>
          <p>
            Paid tickets are store-only digital items. They cannot be transferred for
            real-world value and cannot fund wager games. Refunds, failed payments, and
            disputes may reverse or freeze related balances and entitlements.
          </p>
        </section>

        <section className='space-y-2'>
          <h3 className='arcade-display text-lg text-strong uppercase'>Leaderboards</h3>
          <p>
            Continued runs, suspicious submissions, and invalid game activity may be
            excluded from leaderboards, rewards, and ticket payouts.
          </p>
        </section>
      </ArcadePanel>
    </AppPageFrame>
  );
}
