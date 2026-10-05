import { GamesWalletProvider } from '@/features/arcade/components/shell/games-wallet-provider';

import MiniGolfClient from './_mini-golf-client';

export { metadata } from './metadata';

/* The wallet provider is the strip's balance from the first render, so a
   payout that passes `tickets` later never changes the shell's tree (which
   would remount the canvas under the renderer). */
export default function MiniGolfPage() {
  return (
    <GamesWalletProvider>
      <MiniGolfClient />
    </GamesWalletProvider>
  );
}
