import type { ReactNode } from 'react';

export const metadata = {
  title: 'Snake | Arcade',
};

export default function SnakeLayout({ children }: { children: ReactNode }) {
  return (
    <div className='min-h-full bg-background text-strong font-sans antialiased overflow-hidden'>
      {children}
    </div>
  );
}
