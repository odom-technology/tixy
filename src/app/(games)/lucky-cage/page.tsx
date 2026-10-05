import { GamesWalletProvider } from '@/features/arcade/components/shell/games-wallet-provider';
import LuckyCageClient from './_lucky-cage-client';

export { metadata } from './metadata';

export default function LuckyCagePage() {
  return (
    <GamesWalletProvider>
      <LuckyCageClient />
    </GamesWalletProvider>
  );
}
