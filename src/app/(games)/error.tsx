'use client';

import { useEffect } from 'react';
import {
  ArcadeButton,
  ArcadeLinkButton,
} from '@/features/arcade/components/ui/arcade-ui';

export default function GamesError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className='page-shell max-w-none flex flex-col items-center justify-center gap-6 text-center'>
      <div className='arcade-card border-danger/30 bg-danger/5 px-8 py-10'>
        <h2 className='text-xl font-semibold text-strong'>
          Failed to load Games
        </h2>
        <p className='mt-2 text-sm text-faint'>
          Something went wrong loading the games page. Your progress is safe.
        </p>
        <div className='mt-6 flex items-center justify-center gap-3'>
          <ArcadeButton tone='primary' size='sm' onClick={reset}>
            Try again
          </ArcadeButton>
          <ArcadeLinkButton href='/' tone='ghost' size='sm'>
            Go to Dashboard
          </ArcadeLinkButton>
        </div>
      </div>
    </div>
  );
}
