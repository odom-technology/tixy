'use client';

import type { ReactNode } from 'react';

import {
  PageHeader,
  GamesWalletCard,
  type PageHeaderProps,
} from '@/features/arcade/components/shell/page-header';
import { GamesRouteSwitcher } from '@/features/arcade/components/games-route-switcher';

import {
  GamesWalletProvider,
  useGamesWallet,
} from './games-wallet-provider';
import type { GamesWalletSnapshot } from './games-wallet-types';

type GamesShellFrameProps = {
  children: ReactNode;
  shellClassName: string;
  showDesktopHeader: boolean;
  showRouteSwitcher: boolean;
  showMobileWallet: boolean;
  showDailyClaim: boolean;
  headerProps: Omit<PageHeaderProps, 'wallet'>;
};

function GamesShellFrame({
  children,
  shellClassName,
  showDesktopHeader,
  showRouteSwitcher,
  showMobileWallet,
  showDailyClaim,
  headerProps,
}: GamesShellFrameProps) {
  const { wallet } = useGamesWallet();

  return (
    <section className={shellClassName}>
      {showDesktopHeader ? (
        <div className='hidden sm:block'>
          <PageHeader {...headerProps} wallet={wallet} />
        </div>
      ) : null}
      {showMobileWallet ? (
        <div className='space-y-3 sm:hidden'>
          <GamesWalletCard wallet={wallet} compact showDailyClaim={showDailyClaim} />
        </div>
      ) : null}
      {showRouteSwitcher ? <GamesRouteSwitcher /> : null}
      {children}
    </section>
  );
}

type GamesShellProps = {
  children: ReactNode;
  initialSnapshot?: GamesWalletSnapshot | null;
  shellClassName?: string;
  showDesktopHeader?: boolean;
  showRouteSwitcher?: boolean;
  showMobileWallet?: boolean;
  showDailyClaim?: boolean;
  headerProps: Omit<PageHeaderProps, 'wallet'>;
};

export function GamesShell({
  children,
  initialSnapshot,
  shellClassName = 'page-shell space-y-8',
  showDesktopHeader = true,
  showRouteSwitcher = true,
  showMobileWallet = true,
  showDailyClaim = true,
  headerProps,
}: GamesShellProps) {
  return (
    <GamesWalletProvider initialSnapshot={initialSnapshot}>
      <GamesShellFrame
        shellClassName={shellClassName}
        showDesktopHeader={showDesktopHeader}
        showRouteSwitcher={showRouteSwitcher}
        showMobileWallet={showMobileWallet}
        showDailyClaim={showDailyClaim}
        headerProps={headerProps}
      >
        {children}
      </GamesShellFrame>
    </GamesWalletProvider>
  );
}
