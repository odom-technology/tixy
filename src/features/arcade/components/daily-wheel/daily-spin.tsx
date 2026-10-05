'use client';

/* The daily spin dialog (DAILY_WHEEL.md): the week's multipliers, the
   wheel, and the payout. A full height sheet on phones, a dialog from 640 px
   up. The spin is the server's: `request` posts the claim and the wheel
   lands where the answer says. */

import { X } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';

import {
  TICKET_BALANCE_ATTR,
  TicketCountUp,
  flyTickets,
} from '@/features/arcade/components/feedback/ticket-gain';
import { ArcadeStub } from '@/features/arcade/components/ui/arcade-ui';
import { Num } from '@/features/arcade/components/ui/num';
import {
  DAILY_WHEEL_MULTIPLIERS,
  DAILY_WHEEL_TOP,
  wheelLadderDay,
} from '@/features/arcade/lib/daily-wheel';
import { wheelStopFor, type WheelStop } from '@/features/arcade/lib/daily-wheel-motion';
import { feelReducedMotion } from '@/features/arcade/lib/game-feel';
import { hapticTick, hapticWin } from '@/features/arcade/lib/game-haptics';
import { SoundManager } from '@/features/arcade/lib/sound-manager';
import { useRollingNumber } from '@/features/arcade/lib/use-rolling-number';

import { DailyWheel, type DailyWheelHandle } from './daily-wheel';
import './daily-spin.css';

export type DailySpinResult = {
  dateKey: string;
  /** The streak day this spin was. */
  streak: number;
  unit: number;
  value: number;
  multiplier: number;
  tickets: number;
  held: boolean;
  /** The balance after, when the server said; null if unknown. */
  balanceAfter: number | null;
  /** Spun before (another tab): the wallet already has it. */
  alreadyPaid?: boolean;
};

export type DailySpinView = {
  /** Today's streak day: the one a spin now would be, or was. */
  streakDay: number;
  multiplier: number;
  hold: number;
  todayKey: string;
  spun: DailySpinResult | null;
  /** When the next spin opens (the server's next midnight). */
  nextAtMs: number | null;
};

type PostPayload = {
  error?: string;
  dateKey?: string;
  streak?: number;
  ticketsAwarded?: number;
  balanceAfter?: { tickets?: number };
  wheel?: { unit: number; value: number; multiplier: number; held: boolean } | null;
};

type StatusPayload = {
  claimed?: boolean;
  streak?: number;
  todayKey?: string;
  claimedReward?: { tickets?: number };
  wheel?: { spin?: { unit: number; value: number; multiplier: number; held: boolean } | null } | null;
};

/** Post today's spin. A spin made elsewhere today comes back as that spin. */
export async function postDailySpin(): Promise<DailySpinResult> {
  const res = await fetch('/api/games/daily-claim', { method: 'POST' });
  const payload = (await res.json().catch(() => ({}))) as PostPayload;
  if (res.ok && payload.wheel && typeof payload.dateKey === 'string') {
    return {
      dateKey: payload.dateKey,
      streak: payload.streak ?? 1,
      unit: payload.wheel.unit,
      value: payload.wheel.value,
      multiplier: payload.wheel.multiplier,
      tickets: payload.ticketsAwarded ?? payload.wheel.value * payload.wheel.multiplier,
      held: payload.wheel.held,
      balanceAfter: typeof payload.balanceAfter?.tickets === 'number' ? payload.balanceAfter.tickets : null,
    };
  }
  if (res.status === 400 && /already claimed/i.test(payload.error ?? '')) {
    const status = (await fetch('/api/games/daily-claim', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)) as StatusPayload | null;
    const wheel = status?.wheel?.spin;
    if (status?.claimed && wheel && status.todayKey) {
      return {
        dateKey: status.todayKey,
        streak: status.streak ?? 1,
        unit: wheel.unit,
        value: wheel.value,
        multiplier: wheel.multiplier,
        tickets: status.claimedReward?.tickets ?? 0,
        held: Boolean(wheel.held),
        balanceAfter: null,
        alreadyPaid: true,
      };
    }
    throw new Error('Today’s spin is used.');
  }
  throw new Error(payload.error && res.status < 500 ? payload.error : 'The spin did not go through. Try again.');
}

const subscribeNever = () => () => {};

function untilWords(ms: number) {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
  const hours = Math.round(minutes / 60);
  return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
}

export function NextSpin({ at }: { at: number | null }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  if (at == null || now == null || at <= now) return <>Next spin tomorrow.</>;
  return <>Next spin in {untilWords(at - now)}.</>;
}

/** The seven days of this turn of the ladder, with their multipliers. */
function Week({ streakDay, spun }: { streakDay: number; spun: boolean }) {
  const ladderDay = wheelLadderDay(streakDay);
  const first = streakDay - ladderDay + 1;
  return (
    <ol className='ds-week' aria-label='multiplier by streak day'>
      {DAILY_WHEEL_MULTIPLIERS.map((multiplier, index) => {
        const day = first + index;
        const state = day < streakDay ? 'done' : day === streakDay ? (spun ? 'spun' : 'today') : undefined;
        return (
          <li key={day} data-day={state} aria-current={day === streakDay ? 'date' : undefined}>
            <small>
              day <Num value={day} />
            </small>
            <b>
              <Num value={`×${multiplier}`} label={`times ${multiplier}`} />
            </b>
          </li>
        );
      })}
    </ol>
  );
}

type Step = 'ready' | 'spinning' | 'landed' | 'paid' | 'error';

export function DailySpinDialog({
  open,
  onClose,
  view,
  balance,
  onCredit,
  onSpun,
  request = postDailySpin,
  onFrame,
}: {
  open: boolean;
  onClose: () => void;
  view: DailySpinView;
  /** The wallet's balance. */
  balance: number;
  /** Move the wallet by `delta` (the server's balance minus ours). */
  onCredit: (delta: number) => void;
  /** The spin is recorded: the card can show it. */
  onSpun: (result: DailySpinResult) => void;
  request?: () => Promise<DailySpinResult>;
  onFrame?: (now: number, turning: boolean, workMs: number) => void;
}) {
  const mounted = useSyncExternalStore(subscribeNever, () => true, () => false);
  const titleId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const wheelRef = useRef<DailyWheelHandle>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const actionRef = useRef<HTMLButtonElement>(null);
  const resultRef = useRef<HTMLSpanElement>(null);
  const balanceRef = useRef<HTMLSpanElement>(null);
  const [result, setResult] = useState<DailySpinResult | null>(view.spun);
  const [step, setStep] = useState<Step>(view.spun ? 'paid' : 'ready');
  const [error, setError] = useState<string | null>(null);
  // The balance on screen holds until the stubs land.
  const [held, setHeld] = useState<number | null>(null);
  const shownBalance = useRollingNumber(held ?? balance, { duration: 700 });
  const [beat, setBeat] = useState(0); // 1 value, 2 multiplier, 3 total
  const timers = useRef<number[]>([]);
  const later = (fn: () => void, ms: number) => timers.current.push(window.setTimeout(fn, ms));
  useEffect(() => () => timers.current.forEach((id) => window.clearTimeout(id)), []);

  const rested: WheelStop | null = view.spun ? wheelStopFor(view.spun.unit, view.spun.dateKey) : null;
  const [restedStop] = useState(rested);

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const stepRef = useRef(step);
  stepRef.current = step;
  // The result's button takes focus when the wheel lands.
  useEffect(() => {
    if (step === 'landed') actionRef.current?.focus({ preventScroll: true });
    // The spin button disables while the wheel turns; focus waits on the panel.
    else if (step === 'spinning') panelRef.current?.focus({ preventScroll: true });
  }, [step]);

  // Focus, keys, and the page behind going inert while open.
  useEffect(() => {
    const root = rootRef.current;
    if (!open || !root) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const others = Array.from(document.body.children).filter(
      (el): el is HTMLElement => el instanceof HTMLElement && el !== root && !el.inert,
    );
    for (const el of others) el.inert = true;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    actionRef.current?.focus({ preventScroll: true });
    // Keys work wherever focus is, even after the spin button disables.
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onCloseRef.current();
      } else if ((event.key === ' ' || event.key === 'Enter') && stepRef.current === 'spinning') {
        event.preventDefault();
        wheelRef.current?.skip();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      for (const el of others) el.inert = false;
      document.body.style.overflow = overflow;
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [open, mounted]);

  /* The answer is kept here until the wheel lands, so nothing re-renders
     (here or in the page behind) while it turns. Closing early commits it. */
  const pending = useRef<{ outcome: DailySpinResult; before: number } | null>(null);
  const commit = useCallback(
    (hold: boolean) => {
      const entry = pending.current;
      if (!entry) return null;
      pending.current = null;
      const { outcome, before } = entry;
      setResult(outcome);
      onSpun(outcome);
      if (!outcome.alreadyPaid) {
        const delta = outcome.balanceAfter !== null ? outcome.balanceAfter - before : outcome.tickets;
        // The wallet moves now; the number on screen waits for the stubs.
        if (hold && !feelReducedMotion()) setHeld(before);
        onCredit(delta);
      }
      return outcome;
    },
    [onCredit, onSpun],
  );
  const commitRef = useRef(commit);
  commitRef.current = commit;
  const openRef = useRef(open);
  openRef.current = open;
  useEffect(() => {
    if (!open) commitRef.current(false);
  }, [open]);
  useEffect(() => () => void commitRef.current(false), []);

  const spinRequest = useCallback(async () => {
    const before = balance;
    setError(null);
    setStep('spinning');
    try {
      const outcome = await request();
      pending.current = { outcome, before };
      if (!openRef.current) commitRef.current(false);
      return wheelStopFor(outcome.unit, outcome.dateKey);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The spin did not go through. Try again.');
      throw caught;
    }
  }, [balance, request]);

  const onLand = useCallback(() => {
    const outcome = commit(true) ?? result;
    setStep('landed');
    const reduced = feelReducedMotion();
    setBeat(1);
    const multiplied = (outcome?.multiplier ?? view.multiplier) > 1;
    later(() => {
      if (multiplied) {
        SoundManager.play('arcadeReveal', { pitch: 1.12 });
        hapticTick();
      }
      setBeat(2);
    }, reduced || !multiplied ? 0 : 160);
    later(() => setBeat(3), reduced ? 0 : multiplied ? 420 : 200);
  }, [commit, result, view.multiplier]);

  const onCounted = useCallback(() => {
    const from = resultRef.current;
    const count = !result ? 3 : result.value >= DAILY_WHEEL_TOP ? 5 : result.value >= 100 ? 4 : 3;
    const done = () => {
      setHeld(null);
      setStep('paid');
      hapticWin();
      window.dispatchEvent(new Event('store-inventory-updated'));
    };
    if (result?.alreadyPaid || !from) {
      done();
      return;
    }
    void flyTickets({ from, to: balanceRef.current, count }).then(done);
  }, [result]);

  const spin = () => {
    if (step === 'ready' || step === 'error') wheelRef.current?.pull();
  };

  if (!mounted || !open) return null;

  const multiplier = result?.multiplier ?? view.multiplier;
  const top = DAILY_WHEEL_TOP * view.multiplier;
  const landed = step === 'landed' || step === 'paid';

  return createPortal(
    <div ref={rootRef} className='ds-root'>
      <div className='ds-overlay' onClick={onClose} aria-hidden='true' />
      <div
        className='ds-panel'
        ref={panelRef}
        role='dialog'
        aria-modal='true'
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <header className='ds-head'>
          <h2 id={titleId}>daily spin</h2>
          <span ref={balanceRef} className='ds-balance' {...{ [TICKET_BALANCE_ATTR]: '' }}>
            <ArcadeStub perf size='sm' title='your tickets'>
              <Num value={shownBalance} labelValue={held ?? balance} labelSuffix='tickets' />
            </ArcadeStub>
          </span>
          <button type='button' className='ds-close' aria-label='close' onClick={onClose}>
            <X aria-hidden='true' size={18} strokeLinecap='square' strokeWidth={2.4} />
          </button>
        </header>
        <Week streakDay={result?.streak ?? view.streakDay} spun={landed} />
        <DailyWheel
          ref={wheelRef}
          multiplier={multiplier}
          rested={restedStop}
          canSpin={step === 'ready' || step === 'error'}
          onSpin={spinRequest}
          onLand={onLand}
          onSpinError={() => setStep('error')}
          onFrame={onFrame}
        />
        <div className='ds-foot' aria-live='polite'>
          {landed && result ? (
            <>
              <div className='ds-result' data-beat={step === 'paid' ? 3 : beat}>
                <span className='ds-base'>
                  <Num value={result.value} />
                </span>
                {result.multiplier > 1 ? (
                  <span className='ds-mult'>
                    <Num value={`×${result.multiplier}`} label={`times ${result.multiplier}`} />
                  </span>
                ) : null}
                <span ref={resultRef} className='ds-total'>
                  {step === 'paid' || beat >= 3 ? (
                    <TicketCountUp
                      value={result.tickets}
                      from={result.value}
                      signed={false}
                      size='lg'
                      play={step !== 'paid'}
                      onDone={step === 'paid' ? undefined : onCounted}
                    />
                  ) : null}
                </span>
              </div>
              <p>
                {result.held ? (
                  <>
                    Your old streak pays <Num value={result.tickets} />.{' '}
                  </>
                ) : null}
                <NextSpin at={view.nextAtMs} />
              </p>
              <button ref={actionRef} type='button' className='tx-btn' onClick={onClose}>
                done
              </button>
            </>
          ) : (
            <>
              {error ? (
                <p role='alert' className='ds-error'>
                  {error}
                </p>
              ) : (
                <p>
                  The top slot pays <Num value={top} /> today.
                </p>
              )}
              <button
                ref={actionRef}
                type='button'
                className='tx-btn'
                onClick={spin}
                disabled={step === 'spinning'}
              >
                spin
              </button>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
