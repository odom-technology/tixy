import type { Metadata } from 'next';

import { GamesWalletProvider } from '@/features/arcade/components/shell/games-wallet-provider';
import ChickenClient from './_chicken-client';

export const metadata: Metadata = {
  title: 'Crossy Chicken | tixy',
};

export default function ChickenPage() {
  return (
    <GamesWalletProvider>
      <ChickenClient />
    </GamesWalletProvider>
  );
}
