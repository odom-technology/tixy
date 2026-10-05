import type { Metadata } from 'next';

import { GamesWalletProvider } from '@/features/arcade/components/shell/games-wallet-provider';
import DiceClient from './_dice-client';

export const metadata: Metadata = {
  title: 'Dice | tixy',
};

export default function DicePage() {
  return (
    <GamesWalletProvider>
      <DiceClient />
    </GamesWalletProvider>
  );
}
