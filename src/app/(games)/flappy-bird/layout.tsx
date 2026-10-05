import { getGameTitle } from '@/features/arcade/lib/game-renames';
import type { ReactNode } from 'react';

export const metadata = {
  title: `${getGameTitle('flappy-bird', 'Flappy Bird')} | Arcade`,
};

type FlappyBirdLayoutProps = {
  children: ReactNode;
};

export default function FlappyBirdLayout({ children }: FlappyBirdLayoutProps) {
  return (
    <div className="min-h-full bg-background text-strong font-sans antialiased overflow-hidden">
      {children}
    </div>
  );
}
