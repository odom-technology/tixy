import type { ReactNode } from 'react';

export const metadata = {
  title: 'Snake | tixy',
};

export default function SnakeLayout({ children }: { children: ReactNode }) {
  return (
    <div className='min-h-full bg-background text-strong font-sans antialiased overflow-hidden'>
      {children}
    </div>
  );
}
