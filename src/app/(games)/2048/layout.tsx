import type { ReactNode } from 'react';

export const metadata = {
  title: '2048 | tixy',
};

export default function Game2048Layout({ children }: { children: ReactNode }) {
  return (
    <div className='min-h-full bg-background text-strong font-sans antialiased overflow-hidden'>
      {children}
    </div>
  );
}
