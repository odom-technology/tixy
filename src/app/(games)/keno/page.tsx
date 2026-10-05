import type { Metadata } from 'next';

import { GamesWalletProvider } from '@/features/arcade/components/shell/games-wallet-provider';
import KenoClient from './_keno-client';

export const metadata: Metadata = {
  title: 'Keno | Arcade',
};

export default function KenoPage() {
  return (
    <GamesWalletProvider>
      <KenoClient />
    </GamesWalletProvider>
  );
}
