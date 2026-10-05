import type { Metadata } from 'next';
import Link from 'next/link';

import { AppPageFrame } from '@/features/arcade/components/shell/page-frame';
import {
  ArcadeAnchorButton,
  ArcadePanel,
} from '@/features/arcade/components/ui/arcade-ui';

export const metadata: Metadata = {
  title: 'Privacy Policy | tixy',
  description: 'Privacy policy for tixy by ODOM Tech.',
};

export default function PrivacyPage() {
  return (
    <AppPageFrame
      eyebrow='Legal'
      title='Privacy Policy'
      subtitle='How tixy handles accounts, gameplay, ads, purchases, and support data.'
      contentClassName='space-y-4'
    >
      <ArcadePanel variant='raised' className='space-y-5 p-4 text-sm leading-7 text-body sm:p-5'>
        <p className='font-semibold text-strong'>Last updated: June 24, 2026.</p>

        <section className='space-y-2'>
          <h2 className='arcade-display text-lg text-strong uppercase'>Information collected</h2>
          <p>
            tixy may collect account details you provide, gameplay activity, scores,
            tickets, store-only credits, inventory, reward claims, purchase records,
            feedback, device/browser information, cookies, logs, and security data needed
            to run the service.
          </p>
        </section>

        <section className='space-y-2'>
          <h2 className='arcade-display text-lg text-strong uppercase'>Ads and cookies</h2>
          <p>
            Guests may see Google ads on game pages. Google and other advertising partners
            may use cookies or similar technologies to show ads based on visits to tixy
            and other websites. You can manage personalized ad choices through Google Ads
            Settings or broader industry opt-out tools.
          </p>
          <div className='flex flex-wrap gap-2'>
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
          <h2 className='arcade-display text-lg text-strong uppercase'>Payments</h2>
          <p>
            Ticket pack purchases are processed by Stripe. tixy does not store payment
            card details directly. Purchase records may be stored to grant digital items,
            reconcile refunds or disputes, prevent fraud, and provide support.
          </p>
        </section>

        <section className='space-y-2'>
          <h2 className='arcade-display text-lg text-strong uppercase'>How data is used</h2>
          <p>
            Data is used to operate accounts, save scores, run games, grant rewards,
            manage inventory, process purchases, prevent abuse, respond to feedback, and
            improve reliability and security.
          </p>
        </section>

        <section className='space-y-2'>
          <h2 className='arcade-display text-lg text-strong uppercase'>Contact</h2>
          <p>
            Send privacy questions through our{' '}
            <Link href='/feedback?category=privacy' className='arcade-link'>
              Feedback form
            </Link>
            .
          </p>
        </section>
      </ArcadePanel>
    </AppPageFrame>
  );
}
