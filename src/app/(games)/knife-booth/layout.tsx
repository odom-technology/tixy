import type { ReactNode } from 'react';

export { metadata } from './metadata';

type KnifeBoothLayoutProps = {
  children: ReactNode;
};

export default function KnifeBoothLayout({ children }: KnifeBoothLayoutProps) {
  return (
    <div className="min-h-full bg-background text-strong font-sans antialiased overflow-hidden">
      {children}
    </div>
  );
}
