import type { ReactNode } from 'react';

import './_reaction-time.css';

export const metadata = {
  title: 'Reaction Time | tixy',
};

type ReactionTimeLayoutProps = {
  children: ReactNode;
};

export default function ReactionTimeLayout({ children }: ReactionTimeLayoutProps) {
  return (
    <div className="rt-midway min-h-full bg-background text-strong font-sans antialiased overflow-hidden">
      {children}
    </div>
  );
}
