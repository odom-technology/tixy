import type { ReactNode } from 'react';

export const metadata = {
  title: 'Checkers | Arcade',
};

export default function CheckersLayout({ children }: { children: ReactNode }) {
  return (
    <div className='min-h-full bg-background text-strong font-sans antialiased overflow-hidden'>
      {children}
    </div>
  );
}
