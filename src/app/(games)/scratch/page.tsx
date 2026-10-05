import type { Metadata } from 'next';

import { GamesWalletProvider } from '@/features/arcade/components/shell/games-wallet-provider';
import ScratchClient from './_scratch-client';

export const metadata: Metadata = {
  title: 'Scratch Cards | tixy',
};

export default function ScratchPage() {
  return (
    <GamesWalletProvider>
      <ScratchClient />
    </GamesWalletProvider>
  );
}
