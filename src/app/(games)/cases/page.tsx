import type { Metadata } from 'next';

import { GamesWalletProvider } from '@/features/arcade/components/shell/games-wallet-provider';
import CasesClient from './_cases-client';

export const metadata: Metadata = {
  title: 'Cases | tixy',
};

export default function CasesPage() {
  return (
    <GamesWalletProvider>
      <CasesClient />
    </GamesWalletProvider>
  );
}
