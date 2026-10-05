import type { Metadata } from 'next';

import { getGameTitle } from '@/features/arcade/lib/game-renames';

export const metadata: Metadata = {
  title: `${getGameTitle('coin-pusher', 'Coin Pusher')} | tixy`,
  description:
    'Drop coins onto two moving shelves and push them into the tray. A coin is 5 tickets, every coin in the tray pays 4.85, and your machine keeps its coins between visits.',
};
