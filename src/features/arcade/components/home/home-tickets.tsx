'use client';

/* Your tickets: the balance and today's spin of the daily wheel
   (DAILY_WHEEL.md). Ready: the wheel in small with today's multiplier, the
   week's pips, the top slot today, and `spin`, which opens the wheel. Spun:
   what it paid on a muted stub and when the next spin opens. The balance
   counts up when the dialog's stubs land; quest and tier claims fly their
   stubs here too (flyTickets). */

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { ArcadeStub, Num } from '@/features/arcade/components/ui/arcade-ui';
import { useGamesWallet } from '@/features/arcade/components/shell/games-wallet-provider';
import { TICKET_BALANCE_ATTR } from '@/features/arcade/components/feedback/ticket-gain';
import {
  DailySpinDialog,
  NextSpin,
  type DailySpinResult,
  type DailySpinView,
} from '@/features/arcade/components/daily-wheel/daily-spin';
import { DailyWheelBadge } from '@/features/arcade/components/daily-wheel/daily-wheel';
import { DAILY_CLAIM_LADDER_DAYS } from '@/features/arcade/lib/rewards';
import { wheelLadderDay, wheelMultiplier } from '@/features/arcade/lib/daily-wheel';
import { useRollingNumber } from '@/features/arcade/lib/use-rolling-number';
import { SoundManager } from '@/features/arcade/lib/sound-manager';

import type { HomeDaily } from './tixy-home-types';

/* The seven days of this turn of the ladder: done, today, to come. */
function Pips({ day, spun }: { day: number; spun: boolean }) {
  const ladderDay = wheelLadderDay(day);
  return (
    <div className='tx-week' aria-hidden='true'>
      {Array.from({ length: DAILY_CLAIM_LADDER_DAYS }, (_, index) => {
        const at = index + 1;
        const state = at < ladderDay || (spun && at === ladderDay) ? 'done' : at === ladderDay ? 'today' : undefined;
        return <i key={at} data-day={state} />;
      })}
    </div>
  );
}

export function HomeTickets({
  daily,
  signedIn,
  nextAtMs = null,
}: {
  daily: HomeDaily | null;
  signedIn: boolean;
  /** When the next spin opens: the server's next midnight. */
  nextAtMs?: number | null;
}) {
  const { wallet, adjustCredits } = useGamesWallet();
  const [state, setState] = useState<HomeDaily | null>(daily);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<DailySpinView | null>(null);

  useEffect(() => setState(daily), [daily]);

  const balance = wallet.credits;
  const shown = useRollingNumber(balance, { duration: 700 });

  const openWheel = useCallback(() => {
    if (state?.state === 'ready') {
      SoundManager.play('arcadeBet', { volume: 0.5 });
      setView({
        streakDay: state.day,
        multiplier: state.multiplier,
        hold: state.hold,
        todayKey: state.todayKey,
        spun: null,
        nextAtMs,
      });
      setOpen(true);
    } else if (state?.state === 'claimed' && state.spin) {
      setView({
        streakDay: state.streak,
        multiplier: state.spin.multiplier,
        hold: 0,
        todayKey: state.todayKey,
        spun: {
          dateKey: state.todayKey,
          streak: state.streak,
          ...state.spin,
          tickets: state.tickets,
          balanceAfter: null,
          alreadyPaid: true,
        },
        nextAtMs,
      });
      setOpen(true);
    }
  }, [nextAtMs, state]);

  const onSpun = useCallback((result: DailySpinResult) => {
    setState({
      state: 'claimed',
      tickets: result.tickets,
      streak: result.streak,
      todayKey: result.dateKey,
      spin: { unit: result.unit, value: result.value, multiplier: result.multiplier, held: result.held },
      next: { day: result.streak + 1, multiplier: wheelMultiplier(result.streak + 1) },
    });
  }, []);

  if (!signedIn || state?.state === 'guest') {
    const top = state?.state === 'guest' ? state.top : 1600;
    return (
      <section className='tx-panel' aria-labelledby='tx-tickets'>
        <h2 id='tx-tickets'>daily tickets</h2>
        <div className='tx-daily'>
          <DailyWheelBadge multiplier={1} dim />
          <div>
            <small style={{ marginTop: 0 }}>
              Sign in for one spin a day. Day 7&rsquo;s top slot pays <Num value={top} />.
            </small>
          </div>
        </div>
        <Link href='/signin?next=%2F' className='tx-btn' data-size='sm' style={{ marginBottom: 10 }}>
          sign in
        </Link>
      </section>
    );
  }

  return (
    <section className='tx-panel' aria-labelledby='tx-tickets'>
      <h2 id='tx-tickets'>
        daily tickets
        <span className='tx-balance' {...{ [TICKET_BALANCE_ATTR]: '' }}>
          <ArcadeStub perf size='sm' title='your tickets'>
            <Num value={shown} labelValue={balance} labelSuffix='tickets' />
          </ArcadeStub>
        </span>
      </h2>
      <div aria-live='polite'>
        {state?.state === 'ready' ? (
          <div className='tx-daily'>
            <button type='button' className='tx-daily-wheel' onClick={openWheel} aria-label='open the wheel'>
              <DailyWheelBadge multiplier={state.multiplier} />
            </button>
            <div>
              <Pips day={state.day} spun={false} />
              <small>
                Day <Num value={state.day} />, ×<Num value={state.multiplier} />. The top slot pays <Num value={state.top} />.
              </small>
            </div>
            <button type='button' className='tx-btn' data-size='sm' onClick={openWheel}>
              spin
            </button>
          </div>
        ) : state?.state === 'claimed' ? (
          <div className='tx-daily'>
            {state.spin ? (
              <button type='button' className='tx-daily-stub' onClick={openWheel} aria-label='see today’s spin'>
                <ArcadeStub perf muted size='lg'>
                  <Num value={state.tickets} labelSuffix='tickets today' />
                </ArcadeStub>
              </button>
            ) : (
              <ArcadeStub perf muted size='lg'>
                <Num value={state.tickets} labelSuffix='tickets today' />
              </ArcadeStub>
            )}
            <div>
              <Pips day={Math.max(1, state.streak)} spun />
              <small>
                {state.spin ? (
                  <>
                    <Num value={state.spin.value} /> ×<Num value={state.spin.multiplier} /> today.{' '}
                  </>
                ) : null}
                <NextSpin at={nextAtMs} /> Day <Num value={state.next.day} /> is ×<Num value={state.next.multiplier} />.
              </small>
            </div>
          </div>
        ) : (
          <div className='tx-daily'>
            <div>
              <small style={{ marginTop: 0 }}>
                {state?.state === 'closed'
                  ? 'The daily spin is closed right now.'
                  : 'The daily spin is not loading right now.'}
              </small>
            </div>
          </div>
        )}
      </div>
      {view ? (
        <DailySpinDialog
          key={`${view.todayKey}:${view.spun ? 'spun' : 'ready'}`}
          open={open}
          onClose={() => setOpen(false)}
          view={view}
          balance={balance}
          onCredit={adjustCredits}
          onSpun={onSpun}
        />
      ) : null}
    </section>
  );
}
