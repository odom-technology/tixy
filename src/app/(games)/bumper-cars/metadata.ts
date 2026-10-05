import type { Metadata } from 'next';

import { getGameTitle } from '@/features/arcade/lib/game-renames';

export const metadata: Metadata = {
  title: `${getGameTitle('bumper-cars', 'Bumper Cars')} | Arcade`,
  description: 'Four to eight cars, 90-second rounds, most bumps wins. Bots fill the empty seats.',
};
