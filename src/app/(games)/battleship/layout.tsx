import { getGameTitle } from '@/features/arcade/lib/game-renames';
import type { ReactNode } from 'react';

export const metadata = {
  title: `${getGameTitle('battleship', 'Battleship')} | Arcade`,
};

export default function BattleshipLayout({ children }: { children: ReactNode }) {
  return (
    <div className='min-h-full bg-background text-strong font-sans antialiased overflow-hidden'>
      {children}
    </div>
  );
}
