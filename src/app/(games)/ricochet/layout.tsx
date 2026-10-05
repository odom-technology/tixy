import type { ReactNode } from 'react';

export { metadata } from './metadata';

type RicochetLayoutProps = {
  children: ReactNode;
};

export default function RicochetLayout({ children }: RicochetLayoutProps) {
  return (
    <div className="min-h-full bg-background text-strong font-sans antialiased overflow-hidden">
      {children}
    </div>
  );
}
