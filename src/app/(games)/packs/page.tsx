import type { Metadata } from 'next';

import { GamesWalletProvider } from '@/features/arcade/components/shell/games-wallet-provider';
import PacksClient from './_packs-client';

export const metadata: Metadata = {
  title: 'Packs | Arcade',
};

export default function PacksPage() {
  return (
    <GamesWalletProvider>
      <PacksClient />
    </GamesWalletProvider>
  );
}
