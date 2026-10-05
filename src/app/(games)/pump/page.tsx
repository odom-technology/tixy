import type { Metadata } from 'next';

import { GamesWalletProvider } from '@/features/arcade/components/shell/games-wallet-provider';
import PumpClient from './_pump-client';

export const metadata: Metadata = {
  title: 'Pump | tixy',
};

export default function PumpPage() {
  return (
    <GamesWalletProvider>
      <PumpClient />
    </GamesWalletProvider>
  );
}
