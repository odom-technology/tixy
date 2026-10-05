import type { ReactNode } from 'react';

export { metadata } from './metadata';

type SkeeBallLayoutProps = {
  children: ReactNode;
};

export default function SkeeBallLayout({ children }: SkeeBallLayoutProps) {
  return (
    <div className="min-h-full bg-background text-strong font-sans antialiased overflow-hidden">
      {children}
    </div>
  );
}
