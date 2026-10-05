import type { Metadata } from 'next';

import { GamesWalletProvider } from '@/features/arcade/components/shell/games-wallet-provider';
import HiLoClient from './_hilo-client';

export const metadata: Metadata = {
  title: 'Hi-Lo | Arcade',
};

export default function HiLoPage() {
  return (
    <GamesWalletProvider>
      <HiLoClient />
    </GamesWalletProvider>
  );
}
