import { GamesWalletProvider } from '@/features/arcade/components/shell/games-wallet-provider';
import CoinFlipClient from './_coin-flip-client';

export default function CoinFlipPage() {
  return (
    <GamesWalletProvider>
      <CoinFlipClient />
    </GamesWalletProvider>
  );
}
