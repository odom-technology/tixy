import { getGameTitle } from '@/features/arcade/lib/game-renames';
import type { Metadata } from 'next';

import { GamesWalletProvider } from '@/features/arcade/components/shell/games-wallet-provider';
import PlinkoClient from './_plinko-client';

export const metadata: Metadata = {
  title: `${getGameTitle('plinko', 'Plinko')} | tixy`,
};

export default function PlinkoPage() {
  return (
    <GamesWalletProvider>
      <PlinkoClient />
    </GamesWalletProvider>
  );
}
