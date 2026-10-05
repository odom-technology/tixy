import type { ReactNode } from 'react';

export const metadata = {
  title: 'Coin Flip | Arcade',
};

type CoinFlipLayoutProps = {
  children: ReactNode;
};

export default function CoinFlipLayout({ children }: CoinFlipLayoutProps) {
  return (
    <div className="min-h-full bg-background text-strong font-sans antialiased overflow-hidden">
      {children}
    </div>
  );
}
