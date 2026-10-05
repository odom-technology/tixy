'use client';

import Link from 'next/link';

import { SocialExperience } from '@/features/social/social-experience';
import type { SocialThreadTarget } from '@/features/social/social-types';

import '@/features/social/tixy-people.css';

export function SocialClient({
  initialThread,
  initialTab = 'friends',
}: {
  initialThread?: SocialThreadTarget | null;
  initialTab?: 'chats' | 'friends';
}) {
  return (
    <div className='tp tp-page'>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, maxWidth: '40rem' }}>
        <h1 className='tp-title'>social</h1>
        <span style={{ display: 'flex', gap: 6 }}>
          <Link href='/players' className='tp-btn' data-tone='quiet' data-size='sm'>
            <span>players</span>
          </Link>
          <Link href='/social?view=alerts' className='tp-btn' data-tone='quiet' data-size='sm'>
            <span>alerts</span>
          </Link>
        </span>
      </div>
      <section className='tp-social-page'>
        <SocialExperience variant='page' initialThread={initialThread} initialTab={initialTab} />
      </section>
    </div>
  );
}
