import type { Metadata } from 'next';

import { GamesWalletProvider } from '@/features/arcade/components/shell/games-wallet-provider';
import MinesClient from './_mines-client';

export const metadata: Metadata = {
  title: 'Mines | Arcade',
};

export default function MinesPage() {
  return (
    <GamesWalletProvider>
      <MinesClient />
    </GamesWalletProvider>
  );
}
