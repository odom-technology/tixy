import type { Metadata } from 'next';

import { GamesWalletProvider } from '@/features/arcade/components/shell/games-wallet-provider';
import PrizeWheelClient from './_prize-wheel-client';

export const metadata: Metadata = {
  title: 'Prize Wheel | tixy',
};

export default function PrizeWheelPage() {
  return (
    <GamesWalletProvider>
      <PrizeWheelClient />
    </GamesWalletProvider>
  );
}
