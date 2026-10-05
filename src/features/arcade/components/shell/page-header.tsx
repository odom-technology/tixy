'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

import {
  ArcadeProgress,
  ArcadeTicketStub,
} from '@/features/arcade/components/ui/arcade-ui';
import { useRollingNumber } from '@/features/arcade/lib/use-rolling-number';


export type PageHeaderWallet = {
  credits?: number;
  /** Roll the balance to each new value instead of jumping (feel kit).
   *  Opt-in per game until the shell adopts it. */
  roll?: boolean;
  progress?: {
    label: string;
    current: number;
    max: number;
  };
};

export type PageHeaderProps = {
  eyebrow?: string;
  icon?: ReactNode;
  title: string;
  subtitle?: ReactNode;
  wallet?: PageHeaderWallet | null;
  actions?: ReactNode;
};

export function GamesWalletCard({
  wallet,
  compact = false,
  layout = 'stacked',
}: {
  wallet?: PageHeaderWallet | null;
  compact?: boolean;
  layout?: 'stacked' | 'inline';
  showDailyClaim?: boolean;
}) {
  const credits = Math.max(0, Math.floor(wallet?.credits ?? 0));
  const shownCredits = useRollingNumber(credits, { duration: wallet?.roll ? undefined : 0 });
  const previousCreditsRef = useRef<number | null>(null);
  const [delta, setDelta] = useState<number | null>(null);

  useEffect(() => {
    const previous = previousCreditsRef.current;
    previousCreditsRef.current = credits;
    if (previous == null || previous === credits) return;
    setDelta(credits - previous);
    const timer = window.setTimeout(() => setDelta(null), 1800);
    return () => window.clearTimeout(timer);
  }, [credits]);

  if (!wallet) return null;

  const progress = wallet.progress;
  const inline = layout === 'inline';

  return (
    <div
      className={`arc-wallet rounded-panel border-2 border-ink bg-panel shadow-panel ${
        compact ? 'min-h-[3.25rem] p-3' : 'min-h-[5.5rem] p-4'
      } ${
        inline
          ? 'flex w-full flex-wrap items-center gap-3 sm:w-auto sm:min-w-80'
          : ''
      }`}
    >
      <ArcadeTicketStub
        value={shownCredits}
        delta={delta}
        size={compact ? 'sm' : 'md'}
      />
      {progress ? (
        <div className={inline ? 'min-w-44 flex-1' : undefined}>
          <ArcadeProgress
            label={progress.label}
            current={progress.current}
            max={progress.max}
            tone='tickets'
            className={inline ? 'arc-progress--railed' : 'mt-3 arc-progress--railed'}
          />
        </div>
      ) : null}
    </div>
  );
}

export function PageHeader({
  eyebrow,
  icon,
  title,
  subtitle,
  wallet,
  actions,
}: PageHeaderProps) {
  const hasSideRail = Boolean(wallet);
  /* Legacy callers pass lucide names as strings; the logotype chip is the
     mark, so string "icons" are not rendered as text. */
  const iconNode = typeof icon === 'string' ? null : icon;
  const showEyebrow = Boolean(eyebrow && eyebrow !== 'Arcade' && eyebrow !== title);

  return (
    <header className='flex min-h-[4.75rem] flex-col gap-4 sm:min-h-[5.5rem] sm:flex-row sm:items-start sm:justify-between'>
      <div className='min-w-0'>
        {showEyebrow ? <div className='arcade-kicker'>{eyebrow}</div> : null}
        <div className={`${showEyebrow ? 'mt-3' : ''} flex items-center gap-3`}>
          {iconNode ? <span className='shrink-0 text-faint'>{iconNode}</span> : null}
          <h1 className='arcade-display truncate text-xl text-strong uppercase sm:text-2xl'>
            {title}
          </h1>
        </div>
        {subtitle ? (
          <p className='mt-2 max-w-3xl text-sm text-body'>{subtitle}</p>
        ) : null}
        {actions ? <div className='mt-4'>{actions}</div> : null}
      </div>
      {hasSideRail ? (
        <div className='hidden w-full flex-col gap-3 sm:flex sm:max-w-xs sm:items-end'>
          {wallet ? (
            <div className='hidden sm:block sm:min-h-[5.5rem] sm:min-w-64'>
              <GamesWalletCard wallet={wallet} />
            </div>
          ) : null}
        </div>
      ) : null}
    </header>
  );
}
