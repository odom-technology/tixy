import type { ReactNode } from 'react';

import './_typing-test.css';

export const metadata = {
  title: 'Typing Test | tixy',
};

export default function TypingTestLayout({ children }: { children: ReactNode }) {
  return (
    <div className='tt-midway min-h-full bg-background text-strong font-sans antialiased overflow-hidden'>
      {children}
    </div>
  );
}
