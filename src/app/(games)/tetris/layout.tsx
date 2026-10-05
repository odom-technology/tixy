import { getGameTitle } from '@/features/arcade/lib/game-renames';
import type { ReactNode } from 'react';
import './_tetris-midway.css';

export const metadata = {
  title: `${getGameTitle('tetris', 'Tetris')} | Arcade`,
};

export default function TetrisLayout({ children }: { children: ReactNode }) {
  return (
    <div className='tetris-midway min-h-full bg-background text-strong font-sans antialiased overflow-hidden'>
      {children}
    </div>
  );
}
