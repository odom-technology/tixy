import type { Metadata } from 'next';

import { GamesWalletProvider } from '@/features/arcade/components/shell/games-wallet-provider';
import StoplightClient from './_stoplight-client';

export const metadata: Metadata = {
  title: 'Lucky Wheel | tixy',
};

export default function StoplightPage() {
  return (
    <GamesWalletProvider>
      <StoplightClient />
    </GamesWalletProvider>
  );
}
