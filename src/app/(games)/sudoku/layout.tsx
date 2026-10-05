import type { ReactNode } from 'react';

export { metadata } from './metadata';

export default function SudokuLayout({ children }: { children: ReactNode }) {
  return (
    <div className='min-h-full bg-background text-strong font-sans antialiased overflow-hidden'>
      {children}
    </div>
  );
}
