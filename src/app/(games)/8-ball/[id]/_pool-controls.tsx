'use client';

/* The row under the table, inside the cabinet: spin on the cue ball, the
   power bar that fills as you pull back, the power in numbers, and the
   table menu. When it isn't your shot, the row says what is happening. */

import { useCallback, useRef, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { Menu } from 'lucide-react';

import { Num } from '@/features/arcade/components/ui/num';
import { axisSnap, clampToCircle } from './_spin-selector';

export type PowerDrag = {
  start: () => void;
  set: (power: number) => void;
  end: () => void;
  cancel: () => void;
};

function PowerBar({ power, drag, onPress }: { power: number; drag: PowerDrag | null; onPress: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const active = useRef(false);
  const read = (clientX: number) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return 0;
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  };
  return (
    <div
      ref={ref}
      className='pool-power'
      data-live={drag ? '' : undefined}
      role='meter'
      aria-label='power'
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(power * 100)}
      onPointerDown={(event) => {
        if (!drag) return;
        onPress();
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        active.current = true;
        drag.start();
        drag.set(read(event.clientX));
      }}
      onPointerMove={(event) => {
        if (!drag || !active.current) return;
        drag.set(read(event.clientX));
      }}
      onPointerUp={(event) => {
        if (!drag || !active.current) return;
        active.current = false;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
        drag.end();
      }}
      onPointerCancel={() => {
        if (!drag || !active.current) return;
        active.current = false;
        drag.cancel();
      }}
    >
      <span style={{ width: `${Math.round(power * 100)}%` }} />
    </div>
  );
}

export function PoolControls({
  note,
  spinX,
  spinY,
  onSpin,
  spinEnabled,
  power,
  onPress,
  onMenu,
  extra,
  powerDrag = null,
}: {
  /** Shown instead of spin and power: whose turn, waiting, nudge. */
  note?: ReactNode;
  spinX: number;
  spinY: number;
  onSpin: (x: number, y: number) => void;
  spinEnabled: boolean;
  power: number;
  /** Every input answers at once: the feel kit's press. */
  onPress: () => void;
  onMenu?: () => void;
  /** The hardcore pocket call, when the match has one. */
  extra?: ReactNode;
  /** Pull the power bar instead of the cue ball: press, slide right, let go. */
  powerDrag?: PowerDrag | null;
}) {
  return (
    <div className='pool-controls' data-surface='ink'>
      {note ? (
        <div className='pool-controls-note'>{note}</div>
      ) : (
        <>
          <SpinPad x={spinX} y={spinY} onChange={onSpin} enabled={spinEnabled} onPress={onPress} />
          {extra}
          <PowerBar power={power} drag={powerDrag} onPress={onPress} />
          <span className='pool-power-num'>
            <Num value={`${Math.round(power * 100)}%`} label={`${Math.round(power * 100)} percent power`} />
          </span>
        </>
      )}
      {onMenu ? (
        <button
          type='button'
          className='pool-icon-button'
          aria-label='table menu'
          aria-haspopup='dialog'
          onClick={() => {
            onPress();
            onMenu();
          }}
        >
          <Menu size={22} strokeWidth={2} strokeLinecap='square' aria-hidden />
        </button>
      ) : null}
    </div>
  );
}

/** The cue ball: press where the tip should strike. Double-tap or 0 to
 *  centre. Arrow keys step it. */
function SpinPad({
  x,
  y,
  onChange,
  enabled,
  onPress,
}: {
  x: number;
  y: number;
  onChange: (x: number, y: number) => void;
  enabled: boolean;
  onPress: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const set = useCallback(
    (clientX: number, clientY: number) => {
      const el = ref.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const rawX = ((clientX - rect.left) / rect.width) * 2 - 1;
      const rawY = ((clientY - rect.top) / rect.height) * 2 - 1;
      const [cx, cy] = clampToCircle(rawX, rawY);
      const [sx, sy] = axisSnap(cx, cy);
      // Screen up is topspin (positive y).
      onChange(Math.round(sx * 100) / 100, Math.round(-sy * 100) / 100);
    },
    [onChange],
  );

  const onDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!enabled) return;
    onPress();
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragging.current = true;
    set(event.clientX, event.clientY);
  };
  const onMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    set(event.clientX, event.clientY);
  };
  const onUp = (event: PointerEvent<HTMLDivElement>) => {
    dragging.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };
  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!enabled) return;
    const step = 0.25;
    let nx = x;
    let ny = y;
    if (event.key === 'ArrowLeft') nx -= step;
    else if (event.key === 'ArrowRight') nx += step;
    else if (event.key === 'ArrowUp') ny += step;
    else if (event.key === 'ArrowDown') ny -= step;
    else if (event.key === '0') {
      nx = 0;
      ny = 0;
    } else return;
    event.preventDefault();
    onPress();
    const [cx, cy] = clampToCircle(nx, ny);
    onChange(Math.round(cx * 100) / 100, Math.round(cy * 100) / 100);
  };

  const describe =
    Math.abs(x) < 0.05 && Math.abs(y) < 0.05
      ? 'centre'
      : `${y > 0.05 ? 'follow' : y < -0.05 ? 'draw' : ''}${Math.abs(x) > 0.05 ? `${Math.abs(y) > 0.05 ? ' and ' : ''}${x < 0 ? 'left' : 'right'} english` : ''}`;

  return (
    <div
      ref={ref}
      className='pool-spin'
      role='slider'
      tabIndex={enabled ? 0 : -1}
      aria-label='spin'
      aria-valuemin={-100}
      aria-valuemax={100}
      aria-valuenow={Math.round(y * 100)}
      aria-valuetext={describe}
      aria-disabled={!enabled}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onDoubleClick={() => enabled && onChange(0, 0)}
      onKeyDown={onKey}
    >
      <span
        className='pool-spin-dot'
        style={{ left: `${50 + x * 36}%`, top: `${50 - y * 36}%` }}
      />
    </div>
  );
}
