'use client';

import { useCallback, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

import { ArcadeButton } from '@/features/arcade/components/ui/arcade-ui';
import { FEEL, feelReducedMotion } from '@/features/arcade/lib/game-feel';
import './machine-lever.css';

/** How far the arm swings when pulled, in degrees from upright. */
const PULL_DEG = 74;
/** A drag this far down (fraction of the throw) counts as a pull. */
const PULL_AT = 0.6;
/** Less than this and the press was a tap, which also pulls. */
const TAP_UNDER = 0.15;
/** Pixels of downward drag for a full throw. */
const THROW_PX = 56;

type MachineLeverProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'> & {
  /** Runs once per pull: a tap, a drag past the middle, Enter or Space on the focused lever. */
  onPull: () => void;
  /** The lever's label, one or two lowercase words. */
  children: ReactNode;
  /** A small figure printed beside the label: what the pull is worth. */
  detail?: ReactNode;
};

/**
 * A lever for a machine's `action`, in place of `MachineButton`. It is a real
 * button: a tap, Enter or Space pulls it, so keyboards and screen readers get
 * the same control. Dragging the ball down is the same pull. While a round
 * plays pass `aria-disabled` and the pull is ignored. Reduced motion skips the
 * swing. `useMachineKey` never pulls a lever that cashes out.
 */
export function MachineLever({ onPull, children, detail, className, ...props }: MachineLeverProps) {
  const arm = useRef<HTMLSpanElement>(null);
  const drag = useRef<{ startY: number; travel: number; id: number } | null>(null);
  const swallowClick = useRef(false);
  const inert = props['aria-disabled'] === true || props['aria-disabled'] === 'true';

  const swing = useCallback((from: number) => {
    const el = arm.current;
    if (!el || feelReducedMotion() || typeof el.animate !== 'function') return;
    el.animate(
      [
        { transform: `rotate(${from * PULL_DEG}deg)`, offset: 0 },
        { transform: `rotate(${PULL_DEG}deg)`, offset: from >= 1 ? 0 : 0.34, easing: 'cubic-bezier(.4,0,.6,1)' },
        { transform: 'rotate(0deg)', offset: 1, easing: FEEL.springEase },
      ],
      { duration: 480 },
    );
  }, []);

  const setAngle = (travel: number) => {
    const el = arm.current;
    if (el) el.style.transform = travel > 0 ? `rotate(${travel * PULL_DEG}deg)` : '';
  };

  const fire = useCallback(
    (from: number) => {
      swing(from);
      onPull();
    },
    [onPull, swing],
  );

  return (
    <ArcadeButton
      {...props}
      tone='primary'
      size='lg'
      className={['arc-machine-button', 'arc-lever', className].filter(Boolean).join(' ')}
      onClick={(event) => {
        if (swallowClick.current) {
          swallowClick.current = false;
          event.preventDefault();
          return;
        }
        if (inert) {
          event.preventDefault();
          return;
        }
        fire(0);
      }}
      onPointerDown={(event) => {
        if (inert || event.button !== 0) return;
        drag.current = { startY: event.clientY, travel: 0, id: event.pointerId };
        swallowClick.current = false;
      }}
      onPointerMove={(event) => {
        const d = drag.current;
        if (!d || d.id !== event.pointerId || feelReducedMotion()) return;
        d.travel = Math.min(1, Math.max(0, (event.clientY - d.startY) / THROW_PX));
        if (d.travel >= TAP_UNDER) {
          event.currentTarget.setPointerCapture?.(event.pointerId);
          setAngle(d.travel);
        }
      }}
      onPointerUp={(event) => {
        const d = drag.current;
        drag.current = null;
        if (!d || d.id !== event.pointerId) return;
        if (d.travel < TAP_UNDER) return;
        swallowClick.current = true;
        setAngle(0);
        if (d.travel >= PULL_AT) fire(d.travel);
        else swing(d.travel);
      }}
      onPointerCancel={() => {
        drag.current = null;
        setAngle(0);
      }}
    >
      <span className='arc-lever-label'>
        {children}
        {detail != null ? <span className='arc-lever-detail arcade-num'>{detail}</span> : null}
      </span>
      <span className='arc-lever-gear' aria-hidden>
        <span className='arc-lever-base' />
        <span ref={arm} className='arc-lever-arm'>
          <span className='arc-lever-ball' />
        </span>
      </span>
    </ArcadeButton>
  );
}
