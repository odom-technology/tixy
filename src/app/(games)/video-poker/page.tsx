import type { Metadata } from 'next';

import { GamesWalletProvider } from '@/features/arcade/components/shell/games-wallet-provider';
import VideoPokerClient from './_video-poker-client';

export const metadata: Metadata = {
  title: 'Video Poker | Arcade',
};

export default function VideoPokerPage() {
  return (
    <GamesWalletProvider>
      <VideoPokerClient />
    </GamesWalletProvider>
  );
}
