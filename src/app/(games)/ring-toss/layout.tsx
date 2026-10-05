import type { ReactNode } from 'react';

export { metadata } from './metadata';

type RingTossLayoutProps = {
  children: ReactNode;
};

export default function RingTossLayout({ children }: RingTossLayoutProps) {
  return (
    <div className="min-h-full bg-background text-strong font-sans antialiased overflow-hidden">
      {children}
    </div>
  );
}
