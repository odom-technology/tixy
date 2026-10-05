import type { ReactNode } from 'react';

export const metadata = {
  title: '8-Ball Pool | tixy',
};

export default function EightBallLayout({ children }: { children: ReactNode }) {
  return (
    <div className='min-h-full bg-background text-strong font-sans antialiased overflow-hidden'>
      {children}
    </div>
  );
}
