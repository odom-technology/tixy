import type { ReactNode } from 'react';

export { metadata } from './metadata';

type PrizeClawLayoutProps = {
  children: ReactNode;
};

export default function PrizeClawLayout({ children }: PrizeClawLayoutProps) {
  return <div className='min-h-full'>{children}</div>;
}
