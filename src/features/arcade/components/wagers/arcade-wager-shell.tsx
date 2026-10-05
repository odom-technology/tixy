'use client';

import Link from 'next/link';
import {
  type ComponentPropsWithoutRef,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { ArrowLeft } from 'lucide-react';
import {
  ArcadeMarquee,
  ArcadePanel,
  cx,
} from '@/features/arcade/components/ui/arcade-ui';
import { MuteButton } from '@/features/arcade/components/mute-button';
import { usePayoutCount } from '@/features/arcade/lib/use-payout-count';
import type { GameJuiceKind } from '@/features/arcade/lib/use-game-juice';

/* Midway wager-cabinet shell — docs/design/midway/ui_kits/arcade/game.screen.jsx
   Stage cabinet on the left (marquee + inset well), bet rail on the right.
   Stacks to a single column on small screens. Pure layout: games keep all
   wager logic, networking, and playfield rendering. */

type ArcadeWagerShellProps = {
  /** Marquee signage — the cabinet name (Bungee, uppercase). */
  title: string;
  /** Trailing lucide icon for the marquee. */
  marqueeIcon?: ReactNode;
  /** Wager subsection label, e.g. "Quick bets". */
  kicker: string;
  backHref?: string;
  /** Extra chips/keys in the header row (next to the mute key). */
  headerExtra?: ReactNode;
  /** Cabinet body — the game stage (use ArcadeStageWell inside). */
  stage: ReactNode;
  /** Dashed strip under the stage — last drops, history chips. */
  stageFooter?: ReactNode;
  /** Right rail — bet selector, game controls, the primary key. */
  rail: ReactNode;
  /** Full-width content under the grid — paytables, fairness, boards. */
  below?: ReactNode;
};

export function ArcadeWagerShell({
  title,
  marqueeIcon,
  kicker,
  backHref = '/?section=wager',
  headerExtra,
  stage,
  stageFooter,
  rail,
  below,
}: ArcadeWagerShellProps) {
  return (
    <>
      <div className='arc-wager-nav flex items-center gap-3'>
        <Link
          href={backHref}
          className='inline-flex shrink-0 items-center gap-1.5 text-xs font-medium text-faint transition-colors hover:text-strong'
        >
          <ArrowLeft size={14} aria-hidden />
          All games
        </Link>
        <span className='arcade-kicker hidden truncate sm:inline'>
          Wagers · {kicker}
        </span>
        <span className='ml-auto inline-flex shrink-0 items-center gap-2'>
          {headerExtra}
          <MuteButton />
        </span>
      </div>

      <div className='arc-wager-grid grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]'>
        <ArcadePanel
          variant='cabinet'
          className='arc-wager-cabinet arc-enter-up overflow-hidden'
        >
          <ArcadeMarquee tone='tickets' size='md' trailing={marqueeIcon}>
            {title}
          </ArcadeMarquee>
          <div className='arc-wager-stage-pad p-3 sm:p-4'>{stage}</div>
          {stageFooter ? (
            <div className='border-t border-dashed border-soft px-3 py-2.5 sm:px-4'>
              {stageFooter}
            </div>
          ) : null}
        </ArcadePanel>

        <div
          className='arc-wager-rail arc-enter-up flex min-w-0 flex-col gap-3'
          style={{ '--i': 1 } as CSSProperties}
        >
          {rail}
        </div>
      </div>

      {below}
    </>
  );
}

/** Inset stage well — the frame every playfield sits in.
 *  Pass `juice` from `useGameJuice()` for win/bust/cashout stage feedback. */
export function ArcadeStageWell({
  children,
  className,
  juice = 'idle',
  ...props
}: ComponentPropsWithoutRef<'div'> & {
  children: ReactNode;
  /** Short-lived settle juice (`useGameJuice`). */
  juice?: GameJuiceKind;
}) {
  return (
    <div
      {...props}
      data-juice={juice === 'idle' ? undefined : juice}
      className={cx(
        'arc-stage rounded-well border-2 border-ink bg-well inset-shadow-well',
        className,
      )}
    >
      {children}
    </div>
  );
}

/* ── Result plate ───────────────────────────────────────────────────
   Solid enamel plate for round results. Wins get the reveal pop and a
   600ms payout count-up; busts stay matter-of-fact. Never alpha tints. */

const PLATE_TONES = {
  prize: 'bg-prize text-prize-on',
  tickets: 'bg-tickets text-tickets-on',
  danger: 'bg-danger text-danger-on',
  neutral: 'bg-raised text-strong',
} as const;

type ArcadeResultPlateProps = {
  tone?: keyof typeof PLATE_TONES;
  /** Small uppercase line, e.g. "Clean clear". */
  kicker?: ReactNode;
  /** The big number — multiplier or roll. Mono, tabular. */
  headline?: ReactNode;
  /** Payout in tickets; counts up over --motion-payout. */
  amount?: number | null;
  /** Matter-of-fact detail line. */
  sub?: ReactNode;
  className?: string;
};

export function ArcadeResultPlate({
  tone = 'neutral',
  kicker,
  headline,
  amount,
  sub,
  className,
}: ArcadeResultPlateProps) {
  const isWin = tone === 'prize' || tone === 'tickets';
  return (
    <div
      data-tone={tone}
      data-win={isWin || undefined}
      className={cx(
        'arc-result-plate rounded-panel border-2 border-ink px-4 py-3 text-center shadow-panel',
        PLATE_TONES[tone],
        className,
      )}
    >
      {kicker ? (
        <p className='text-[11px] font-bold tracking-[0.14em] uppercase opacity-80'>
          {kicker}
        </p>
      ) : null}
      {headline != null ? (
        <p className='arcade-num arc-num-pop mt-0.5 text-2xl leading-tight font-bold'>
          {headline}
        </p>
      ) : null}
      {amount != null ? (
        <p className='arcade-num text-sm font-semibold'>
          +<ArcadePayoutAmount value={amount} /> tickets
        </p>
      ) : null}
      {sub ? <p className='mt-1 text-xs opacity-90'>{sub}</p> : null}
    </div>
  );
}

/** Skill-game score burst — mono number pop + optional label. */
export function ArcadeScoreBurst({
  value,
  label = 'Score',
  className,
}: {
  value: number | string;
  label?: string;
  className?: string;
}) {
  return (
    <div className={cx('arc-score-burst text-center', className)} role='status'>
      <p className='arcade-kicker'>{label}</p>
      <p className='arcade-num arc-num-pop mt-1 text-3xl font-bold text-strong'>
        {typeof value === 'number' ? value.toLocaleString() : value}
      </p>
    </div>
  );
}

/** Tabular payout number that counts up over --motion-payout (600ms,
    linear). Collapses to an instant swap under reduced motion. */
export function ArcadePayoutAmount({ value }: { value: number }) {
  const display = usePayoutCount(value);
  return <>{display.toLocaleString()}</>;
}

export { usePayoutCount };
