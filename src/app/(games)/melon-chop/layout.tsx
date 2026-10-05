import type { ReactNode } from 'react';

export { metadata } from './metadata';

type MelonChopLayoutProps = {
  children: ReactNode;
};

export default function MelonChopLayout({ children }: MelonChopLayoutProps) {
  return (
    <div className="min-h-full bg-background text-strong font-sans antialiased overflow-hidden">
      {children}
    </div>
  );
}
