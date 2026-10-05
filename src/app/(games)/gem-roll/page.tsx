import type { Metadata } from 'next';

import { GamesWalletProvider } from '@/features/arcade/components/shell/games-wallet-provider';
import GemRollClient from './_gem-roll-client';

export const metadata: Metadata = {
  title: 'Gem Roll | tixy',
};

export default function GemRollPage() {
  return (
    <GamesWalletProvider>
      <GemRollClient />
    </GamesWalletProvider>
  );
}
