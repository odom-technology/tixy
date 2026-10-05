import type { Metadata } from 'next';

import { GamesWalletProvider } from '@/features/arcade/components/shell/games-wallet-provider';
import SlotsClient from './_slots-client';

export const metadata: Metadata = {
  title: 'Slots | Arcade',
};

// The provider is here so the shell's strip never mounts one of its own:
// slots keeps its own balance and passes it to the strip.
export default function SlotsPage() {
  return (
    <GamesWalletProvider>
      <SlotsClient />
    </GamesWalletProvider>
  );
}
