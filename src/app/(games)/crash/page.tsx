import type { Metadata } from 'next';

import { GamesWalletProvider } from '@/features/arcade/components/shell/games-wallet-provider';
import CrashClient from './_crash-client';

export const metadata: Metadata = {
  title: 'Crash | Arcade',
};

export default function CrashPage() {
  return (
    <GamesWalletProvider>
      <CrashClient />
    </GamesWalletProvider>
  );
}
