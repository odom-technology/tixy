import { Suspense } from 'react';

import { GamesWalletProvider } from '@/features/arcade/components/shell/games-wallet-provider';

import DerbyRaceClient from './_race-client';

export { metadata } from './metadata';

export const dynamic = 'force-dynamic';

/* Derby: the water race. Derby royale's betting client stays in this
   folder (_derby-client.tsx) and its API routes still answer; the page is
   the race now. */
export default function DerbyPage() {
  return (
    <GamesWalletProvider>
      <Suspense fallback={null}>
        <DerbyRaceClient />
      </Suspense>
    </GamesWalletProvider>
  );
}
