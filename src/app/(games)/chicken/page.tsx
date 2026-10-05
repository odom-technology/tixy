import type { Metadata } from 'next';

import { GamesWalletProvider } from '@/features/arcade/components/shell/games-wallet-provider';
import ChickenClient from './_chicken-client';

export const metadata: Metadata = {
  title: 'Crossy Chicken | Arcade',
};

export default function ChickenPage() {
  return (
    <GamesWalletProvider>
      <ChickenClient />
    </GamesWalletProvider>
  );
}
