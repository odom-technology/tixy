import type { Metadata } from 'next';

import { GamesWalletProvider } from '@/features/arcade/components/shell/games-wallet-provider';
import BaccaratClient from './_baccarat-client';

export const metadata: Metadata = {
  title: 'Baccarat | tixy',
};

export default function BaccaratPage() {
  return (
    <GamesWalletProvider>
      <BaccaratClient />
    </GamesWalletProvider>
  );
}
