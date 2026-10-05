'use client';

import { X, Star } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from 'react';

import { usePresence } from '@/features/arcade/lib/use-presence';
import {
  ArcadeButton,
  ArcadeMarquee,
  type ArcadeEnamel,
  cx,
} from './arcade-ui';
import { Num } from './num';

/* True when the user asked for reduced motion. SSR-safe (false on server). */
export function prefersReducedMotion() {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
  );
}

/* Interactive Midway primitives — split from arcade-ui.tsx so the
   presentational primitives stay usable in server components. */

/* Dialog as a small cabinet: marquee title band, painted body, key
   actions in the footer. Settles in with a spring; ink-dim overlay.
   Keyboard contract: focus moves into the dialog on open (and returns on
   close), Escape closes, and Tab cycles inside while open. */
export function ArcadeModal({
  open = true,
  onClose,
  title,
  tone = 'primary',
  children,
  actions,
  maxWidth,
  className,
  ...props
}: ComponentPropsWithoutRef<'div'> & {
  open?: boolean;
  onClose?: () => void;
  title: ReactNode;
  tone?: ArcadeEnamel | 'cream';
  actions?: ReactNode;
  maxWidth?: number | string;
}) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  // Always-current close handler so the open effect doesn't re-run (and
  // steal focus) whenever a caller passes an inline onClose.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const { present, state } = usePresence(open, 170);

  useEffect(() => {
    if (!present || state !== 'open') return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const restoreFocusTo =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // Focus the dialog itself so Escape/Tab work even before any inner
    // control has focus.
    dialog.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onCloseRef.current?.();
        return;
      }
      if (event.key !== 'Tab') return;
      // Keep Tab cycling inside the dialog while it's open.
      const focusable = dialog.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey) {
        if (document.activeElement === first || document.activeElement === dialog) {
          event.preventDefault();
          last.focus();
        }
      } else if (document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      restoreFocusTo?.focus();
    };
  }, [present, state]);

  if (!present) return null;
  return (
    <div
      className='arc-modal-overlay'
      data-state={state}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose?.();
      }}
    >
      <div
        {...props}
        role='dialog'
        aria-modal='true'
        aria-labelledby={titleId}
        ref={dialogRef}
        tabIndex={-1}
        data-state={state}
        className={cx('arc-modal', className)}
        style={maxWidth ? { maxWidth, ...props.style } : props.style}
      >
        <ArcadeMarquee
          tone={tone}
          size='md'
          trailing={
            onClose ? (
              <ArcadeButton
                tone='ghost'
                size='icon-xs'
                aria-label='close'
                onClick={onClose}
                className='text-inherit'
              >
                <X aria-hidden className='h-3.5 w-3.5' />
              </ArcadeButton>
            ) : null
          }
        >
          <span id={titleId}>{title}</span>
        </ArcadeMarquee>
        <div className='arc-modal-body'>{children}</div>
        {actions ? <div className='arc-modal-foot'>{actions}</div> : null}
      </div>
    </div>
  );
}

/* Physical toggle: a cream key thumb sliding in an inset track. Track
   fills with prize enamel when on. */
export function ArcadeSwitch({
  checked = false,
  onChange,
  disabled = false,
  label,
  className,
  ...props
}: Omit<ComponentPropsWithoutRef<'button'>, 'onChange'> & {
  checked?: boolean;
  onChange?: (next: boolean) => void;
  label?: string;
}) {
  return (
    <button
      {...props}
      type='button'
      role='switch'
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange?.(!checked)}
      className={cx('arc-switch', className)}
    >
      <span className='arc-switch-thumb' />
    </button>
  );
}

const ROLL_MS = 1100;

/* Star-flanked head for the amber balance panel — filled lucide Star
   in amber, mono is handled by CSS. */
function BalanceStar() {
  return (
    <span className='arc-balance-star'>
      <Star aria-hidden size={12} fill='currentColor' strokeWidth={0} />
    </span>
  );
}

/* The ticket dispenser: amber balance panel with a big mono count, a
   claim key, and a slot that prints a physical raffle ticket. On claim
   the count rolls up (rAF, easeOutCubic, no overshoot) and the ticket
   re-dispenses. Presentational/controllable — feed it the real balance
   and a claim handler so the daily-claim flow drives it. Reduced motion
   jumps the count and pins the ticket settled.

   Keep this controllable: `claimed` reflects real claim state, `onClaim`
   delegates to the live handler (streaks/caps/milestones stay server-side). */
export function ArcadeTicketDispenser({
  balance,
  claimAmount = 0,
  claimed = false,
  onClaim,
  claimDisabled = false,
  claimLabel,
  unitLabel = 'Tickets',
  serial,
  className,
  ...props
}: Omit<ComponentPropsWithoutRef<'section'>, 'onClick'> & {
  /** Current (settled) ticket balance to display. */
  balance: number;
  /** Amount the daily claim awards — printed on the ticket + claim key. */
  claimAmount?: number;
  /** Whether the daily reward is already claimed (drives ticket + key). */
  claimed?: boolean;
  /** Real claim action. May be async; the visual claim runs regardless. */
  onClaim?: () => Promise<void> | void;
  claimDisabled?: boolean;
  claimLabel?: ReactNode;
  unitLabel?: string;
  /** Override the printed serial; defaults to a derived ticket serial. */
  serial?: string;
}) {
  // The count we paint. Starts at balance; rolls toward balance whenever
  // balance changes (e.g. after a successful claim bumps the wallet).
  const [count, setCount] = useState(balance);
  // Remount key for the ticket SVG so its keyframe restarts each claim.
  const [bump, setBump] = useState(0);
  const rafRef = useRef<number | null>(null);
  const fromRef = useRef(balance);
  const prevBalanceRef = useRef(balance);

  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const rollTo = useCallback((from: number, to: number) => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (prefersReducedMotion()) {
      setCount(to);
      return;
    }
    const t0 = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / ROLL_MS);
      // easeOutCubic — calm settle, no overshoot.
      const eased = 1 - Math.pow(1 - p, 3);
      setCount(Math.round(from + (to - from) * eased));
      if (p < 1) rafRef.current = requestAnimationFrame(tick);
      else rafRef.current = null;
    };
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  // When the real balance changes (post-claim), roll up from the old value.
  useEffect(() => {
    if (balance === prevBalanceRef.current) return;
    rollTo(prevBalanceRef.current, balance);
    prevBalanceRef.current = balance;
  }, [balance, rollTo]);

  const handleClaim = useCallback(() => {
    if (claimed || claimDisabled) return;
    // Restart the dispense keyframe; the count roll-up is driven by the
    // balance change the real claim produces (see the effect above). If the
    // caller doesn't move the balance, optimistically roll by claimAmount.
    setBump((b) => b + 1);
    fromRef.current = count;
    const result = onClaim?.();
    if (result == null && claimAmount > 0) {
      rollTo(count, count + claimAmount);
      prevBalanceRef.current = count + claimAmount;
    }
  }, [claimed, claimDisabled, onClaim, claimAmount, count, rollTo]);

  const derivedSerial =
    serial ?? `MWY-${String(Math.max(0, Math.round(claimAmount))).padStart(5, '0')}`;
  const keyLabel =
    claimLabel ??
    (claimed
      ? 'Claimed today'
      : claimAmount > 0
        ? `Claim daily +${claimAmount}`
        : 'Claim daily');

  return (
    <section {...props} className={cx('arc-balance', className)}>
      <span className='arc-balance-head'>
        <BalanceStar />
        Your Ticket Balance
        <BalanceStar />
      </span>

      {/* Labelled with the final balance, so the live region says it once
          instead of every frame of the count. */}
      <span className='arc-balance-num' aria-live='polite'>
        <Num value={count} labelValue={balance} />
      </span>
      <span className='arc-balance-unit'>{unitLabel}</span>

      <ArcadeButton
        tone='default'
        className='arc-balance-claim'
        onClick={handleClaim}
        disabled={claimed || claimDisabled}
      >
        {keyLabel}
      </ArcadeButton>

      <div className='arc-dispenser' data-claimed={claimed || bump > 0 || undefined}>
        <span className='arc-slot' aria-hidden='true' />
        <svg
          key={bump}
          className='arc-ticket'
          viewBox='0 0 320 120'
          role='img'
          aria-label={
            claimAmount > 0
              ? `Daily ticket worth ${claimAmount}`
              : 'Daily ticket'
          }
        >
          <path
            className='arc-ticket-body'
            d='M20 8 h280 a8 8 0 0 1 8 8 v30 a14 14 0 0 0 0 28 v30 a8 8 0 0 1 -8 8 H20 a8 8 0 0 1 -8 -8 V82 a14 14 0 0 0 0 -28 V16 a8 8 0 0 1 8 -8 z'
          />
          <rect
            className='arc-ticket-inner'
            x='24'
            y='14'
            width='272'
            height='92'
            rx='5'
          />
          <line className='arc-ticket-perf' x1='84' y1='18' x2='84' y2='102' />
          <line className='arc-ticket-perf' x1='236' y1='18' x2='236' y2='102' />
          <text className='arc-ticket-side' x='54' y='60'>
            +{claimAmount}
          </text>
          <text className='arc-ticket-name' x='160' y='52'>
            ARCADE
          </text>
          <text className='arc-ticket-name' x='160' y='80'>
            TICKET
          </text>
          <text className='arc-ticket-serial' x='268' y='60'>
            {derivedSerial}
          </text>
        </svg>
      </div>
    </section>
  );
}
