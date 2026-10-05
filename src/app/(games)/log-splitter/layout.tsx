import type { ReactNode } from 'react';

export { metadata } from './metadata';

type LogSplitterLayoutProps = {
  children: ReactNode;
};

export default function LogSplitterLayout({ children }: LogSplitterLayoutProps) {
  return (
    <div className="min-h-full bg-background text-strong font-sans antialiased overflow-hidden">
      {children}
    </div>
  );
}
