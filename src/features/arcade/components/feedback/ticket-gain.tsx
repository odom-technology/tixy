'use client';

import { useEffect, useRef, useState } from 'react';

import { ArcadeStub } from '@/features/arcade/components/ui/arcade-ui';
import { Num } from '@/features/arcade/components/ui/num';
import { feelReducedMotion, rollingValueAt } from '@/features/arcade/lib/game-feel';
import { useFeelReducedMotion } from '@/features/arcade/lib/use-game-feedback';
import { SoundManager } from '@/features/arcade/lib/sound-manager';

/* Tickets arrive (PLAN.md "Motion and sound"): stubs fly to the balance in
   an arc over 620 ms, a tick per stub; the balance punches and counts up
   over 700 ms, with a register ding. */
export const TICKET_FLIGHT_MS = 620;
export const TICKET_FLIGHT_STAGGER_MS = 80;
export const TICKET_COUNT_MS = 700;
const PUNCH_MS = 520;

/** The attribute a ticket balance carries so flights can find it. */
export const TICKET_BALANCE_ATTR = 'data-ticket-balance';

/**
 * Punch a ticket balance once: a short scale and tilt on the spring curve.
 * Two calls within one punch (a flight landing and the balance changing)
 * make one punch. Nothing under reduced motion.
 */
export function punchTicketBalance(el: Element | null | undefined) {
  if (!(el instanceof HTMLElement) || feelReducedMotion() || typeof el.animate !== 'function') return;
  const now = performance.now();
  const last = Number(el.dataset.punchedAt ?? 0);
  if (now - last < PUNCH_MS) return;
  el.dataset.punchedAt = String(now);
  el.animate(
    [
      { transform: 'none' },
      { transform: 'scale(1.16) rotate(-3deg)', offset: 0.3 },
      { transform: 'scale(0.97)', offset: 0.65 },
      { transform: 'none' },
    ],
    { duration: PUNCH_MS, easing: 'cubic-bezier(.2,1.5,.4,1)' },
  );
}

/**
 * A ticket count on a stub: rolls from `from` to `value` on the settle curve
 * and punches when it lands. For a result card's total or a claim. `play`
 * false shows the end with no motion; `delay` waits before rolling.
 */
export function TicketCountUp({
  value,
  from = 0,
  duration = TICKET_COUNT_MS,
  delay = 0,
  play = true,
  signed = true,
  size = 'md',
  sound = false,
  onDone,
  className,
}: {
  value: number;
  from?: number;
  duration?: number;
  delay?: number;
  play?: boolean;
  signed?: boolean;
  size?: 'sm' | 'md' | 'lg';
  /** A register ding when it lands. */
  sound?: boolean;
  onDone?: () => void;
  className?: string;
}) {
  const reduced = useFeelReducedMotion();
  const still = reduced || !play;
  const [shown, setShown] = useState(still ? value : from);
  const stubRef = useRef<HTMLSpanElement>(null);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    if (!play) {
      setShown(value);
      return;
    }
    const land = () => {
      punchTicketBalance(stubRef.current);
      if (sound && value > 0) SoundManager.play('registerDing');
      onDoneRef.current?.();
    };
    if (reduced) {
      setShown(value);
      land();
      return;
    }
    let frame = 0;
    setShown(from);
    const timer = window.setTimeout(() => {
      const started = performance.now();
      const tick = (now: number) => {
        const next = rollingValueAt(from, value, now - started, duration);
        setShown(next);
        if (next === value) land();
        else frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    }, delay);
    return () => {
      window.clearTimeout(timer);
      cancelAnimationFrame(frame);
    };
    // One roll per value; `from`, timing and sound are read when it starts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, play, reduced]);

  return (
    <span ref={stubRef} className={['tx-ticket-count', className].filter(Boolean).join(' ')}>
      <ArcadeStub size={size}>
        <Num value={shown} signed={signed} labelValue={value} labelSuffix='tickets' />
      </ArcadeStub>
    </span>
  );
}

type FlightPoint = Element | DOMRect | { x: number; y: number };

function centerOf(point: FlightPoint) {
  if (point instanceof Element) point = point.getBoundingClientRect();
  if ('width' in point) return { x: point.left + point.width / 2, y: point.top + point.height / 2 };
  return point;
}

/**
 * Fly stubs from `from` to the ticket balance (the game strip's, or any
 * element with `data-ticket-balance`) in an arc, a printer tick as each one
 * lands, then punch the balance and ding. Resolves when the last one lands.
 * Under reduced motion nothing flies: the balance just dings.
 */
export function flyTickets({
  from,
  to,
  count = 3,
  sound = true,
}: {
  from: FlightPoint;
  to?: Element | null;
  count?: number;
  sound?: boolean;
}): Promise<void> {
  if (typeof document === 'undefined') return Promise.resolve();
  const target = to ?? document.querySelector(`[${TICKET_BALANCE_ATTR}]`);
  if (!target || feelReducedMotion()) {
    if (sound) SoundManager.play('registerDing');
    return Promise.resolve();
  }
  const start = centerOf(from);
  const end = centerOf(target);
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const stubs = Math.max(1, Math.min(5, Math.round(count)));
  const flights: Promise<void>[] = [];
  for (let i = 0; i < stubs; i += 1) {
    const stub = document.createElement('div');
    stub.className = 'tx-fly-stub';
    stub.setAttribute('aria-hidden', 'true');
    stub.style.left = `${start.x}px`;
    stub.style.top = `${start.y}px`;
    document.body.appendChild(stub);
    const animation = stub.animate(
      [
        { transform: 'translate(-50%, -50%)', opacity: 1 },
        {
          transform: `translate(calc(-50% + ${dx * 0.45}px), calc(-50% + ${dy * 0.45 - 70}px)) rotate(-14deg) scale(1.1)`,
          opacity: 1,
          offset: 0.45,
        },
        { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) rotate(-4deg) scale(0.55)`, opacity: 0.9 },
      ],
      {
        duration: TICKET_FLIGHT_MS,
        delay: i * TICKET_FLIGHT_STAGGER_MS,
        easing: 'cubic-bezier(.45,0,.55,1)',
        fill: 'backwards',
      },
    );
    flights.push(
      animation.finished
        .catch(() => undefined)
        .then(() => {
          stub.remove();
          if (sound) SoundManager.play('printerTick', { volume: 0.8 });
        }),
    );
  }
  return Promise.all(flights).then(() => {
    punchTicketBalance(target);
    if (sound) SoundManager.play('registerDing');
  });
}
