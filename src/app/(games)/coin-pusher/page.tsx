import { GamesWalletProvider } from '@/features/arcade/components/shell/games-wallet-provider';

import CoinPusherClient from './_coin-pusher-client';

export { metadata } from './metadata';

export default function CoinPusherPage() {
  return (
    <GamesWalletProvider>
      <CoinPusherClient />
    </GamesWalletProvider>
  );
}
