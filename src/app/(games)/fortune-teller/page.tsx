import type { Metadata } from 'next';

import { GamesWalletProvider } from '@/features/arcade/components/shell/games-wallet-provider';
import FortuneTellerClient from './_fortune-teller-client';

export const metadata: Metadata = {
  title: 'Fortune Teller | Arcade',
};

export default function FortuneTellerPage() {
  return (
    <GamesWalletProvider>
      <FortuneTellerClient />
    </GamesWalletProvider>
  );
}
