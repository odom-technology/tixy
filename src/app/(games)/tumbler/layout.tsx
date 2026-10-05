import type { ReactNode } from 'react';

export { metadata } from './metadata';

type TumblerLayoutProps = {
  children: ReactNode;
};

export default function TumblerLayout({ children }: TumblerLayoutProps) {
  return (
    <div className="min-h-full bg-background text-strong font-sans antialiased overflow-hidden">
      {children}
    </div>
  );
}
