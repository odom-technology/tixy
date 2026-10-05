import type { Metadata } from 'next';

import { GamesWalletProvider } from '@/features/arcade/components/shell/games-wallet-provider';
import BlackjackClient from './_blackjack-client';

export const metadata: Metadata = {
  title: '21 | Arcade',
};

export default function BlackjackPage() {
  return (
    <GamesWalletProvider>
      <BlackjackClient />
    </GamesWalletProvider>
  );
}
