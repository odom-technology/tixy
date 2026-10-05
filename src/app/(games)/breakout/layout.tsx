import type { ReactNode } from 'react';

export { metadata } from './metadata';

type BreakoutLayoutProps = {
  children: ReactNode;
};

export default function BreakoutLayout({ children }: BreakoutLayoutProps) {
  return (
    <div className="min-h-full bg-background text-strong font-sans antialiased overflow-hidden">
      {children}
    </div>
  );
}
