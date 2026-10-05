import type { ReactNode } from 'react';

export { metadata } from './metadata';

type LuckyCageLayoutProps = {
  children: ReactNode;
};

export default function LuckyCageLayout({ children }: LuckyCageLayoutProps) {
  return <div className='min-h-full'>{children}</div>;
}
