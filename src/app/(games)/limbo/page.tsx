import type { Metadata } from 'next';

import { GamesWalletProvider } from '@/features/arcade/components/shell/games-wallet-provider';
import LimboClient from './_limbo-client';

export const metadata: Metadata = {
  title: 'Limbo | tixy',
};

export default function LimboPage() {
  return (
    <GamesWalletProvider>
      <LimboClient />
    </GamesWalletProvider>
  );
}
