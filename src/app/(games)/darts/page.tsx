import type { Metadata } from 'next';

import { GamesWalletProvider } from '@/features/arcade/components/shell/games-wallet-provider';
import DartsClient from './_darts-client';

export const metadata: Metadata = {
  title: 'Darts | tixy',
};

export default function DartsPage() {
  return (
    <GamesWalletProvider>
      <DartsClient />
    </GamesWalletProvider>
  );
}
