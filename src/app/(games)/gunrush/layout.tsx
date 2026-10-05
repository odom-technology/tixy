import type { ReactNode } from 'react';

export { metadata } from './metadata';

type GunrushLayoutProps = { children: ReactNode };

export default function GunrushLayout({ children }: GunrushLayoutProps) {
  return (
    <div className="min-h-full bg-background text-strong font-sans antialiased overflow-hidden">
      {children}
    </div>
  );
}
