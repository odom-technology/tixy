import type { ReactNode } from 'react';

export const metadata = {
  title: 'Air Hockey | Arcade',
};

export default function AirHockeyLayout({ children }: { children: ReactNode }) {
  return (
    <div className='min-h-full bg-background text-strong font-sans antialiased overflow-hidden'>
      {children}
    </div>
  );
}
