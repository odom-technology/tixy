'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

import {
  ArcadeMarquee,
  ArcadePage,
  ArcadePanel,
} from '@/features/arcade/components/ui/arcade-ui';

export function SignOutClient() {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;

    const signOut = async () => {
      try {
        await fetch('/api/account/session', { method: 'DELETE' });
      } finally {
        if (!cancelled) {
          router.replace('/signin');
          router.refresh();
        }
      }
    };

    void signOut();

    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <ArcadePage narrow className='flex items-center'>
      <ArcadePanel variant='cabinet' className='w-full overflow-hidden'>
        <ArcadeMarquee tone='cream' size='md'>
          Signing out
        </ArcadeMarquee>
        <div className='p-6 text-center'>
          <h1 className='sr-only'>Signing out</h1>
          <p className='text-sm text-body'>Your session is being cleared.</p>
        </div>
      </ArcadePanel>
    </ArcadePage>
  );
}
