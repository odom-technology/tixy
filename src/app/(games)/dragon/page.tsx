import type { Metadata } from 'next';

import { GamesWalletProvider } from '@/features/arcade/components/shell/games-wallet-provider';
import DragonClient from './_dragon-client';

export const metadata: Metadata = {
  title: 'Dragon Tower | tixy',
};

export default function DragonPage() {
  return (
    <GamesWalletProvider>
      <DragonClient />
    </GamesWalletProvider>
  );
}
