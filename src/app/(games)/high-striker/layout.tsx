import type { ReactNode } from 'react';

export { metadata } from './metadata';

type HighStrikerLayoutProps = {
  children: ReactNode;
};

export default function HighStrikerLayout({ children }: HighStrikerLayoutProps) {
  return (
    <div className="min-h-full bg-background text-strong font-sans antialiased overflow-hidden">
      {children}
    </div>
  );
}
