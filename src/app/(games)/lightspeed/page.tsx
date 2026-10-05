import type { Metadata } from 'next';

import { GamesWalletProvider } from '@/features/arcade/components/shell/games-wallet-provider';
import LightspeedClient from './_lightspeed-client';

export const metadata: Metadata = {
  title: 'Lightspeed | tixy',
};

export default function LightspeedPage() {
  return (
    <GamesWalletProvider>
      <LightspeedClient />
    </GamesWalletProvider>
  );
}
