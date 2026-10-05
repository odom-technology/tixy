import type { Metadata } from 'next';

import { GamesWalletProvider } from '@/features/arcade/components/shell/games-wallet-provider';
import RouletteClient from './_roulette-client';

export const metadata: Metadata = {
  title: 'Roulette | Arcade',
};

export default function RoulettePage() {
  return (
    <GamesWalletProvider>
      <RouletteClient />
    </GamesWalletProvider>
  );
}
