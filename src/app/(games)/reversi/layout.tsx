import type { ReactNode } from 'react';

export const metadata = {
  title: 'Reversi | Arcade',
};

export default function ReversiLayout({ children }: { children: ReactNode }) {
  return (
    <div className='min-h-full bg-background text-strong font-sans antialiased overflow-hidden'>
      {children}
    </div>
  );
}
