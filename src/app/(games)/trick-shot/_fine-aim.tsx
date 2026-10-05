'use client';

/* The fine turn, after 8 Ball Pool's fine-tune wheel: a ridged wheel at
   the right edge of the table, in the room the table leaves. Every 3 px of
   drag is one grid step of 0.01 degrees; down turns the cue clockwise. The
   ridges move with the finger so it feels like a wheel under it. A quiet
   tick every 0.1 degrees. Arrow keys step it, shift for ten. */

import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';

import { hapticTick } from '@/features/arcade/lib/game-haptics';
import { SoundManager } from '@/features/arcade/lib/sound-manager';

const PX_PER_STEP = 3;
const TICK_EVERY = 10;

export function FineAim({
  enabled,
  onNudge,
  onPress,
}: {
  enabled: boolean;
  onNudge: (steps: number) => void;
  onPress: () => void;
}) {
  const [offset, setOffset] = useState(0);
  const drag = useRef<{ y: number; carry: number } | null>(null);
  const travelled = useRef(0);
  /** Steps turned since the page opened, for screen readers. */
  const [turned, setTurned] = useState(0);

  const step = (steps: number) => {
    if (steps === 0) return;
    onNudge(steps);
    setTurned((prev) => prev + steps);
    const before = Math.floor(travelled.current / TICK_EVERY);
    travelled.current += steps;
    const after = Math.floor(travelled.current / TICK_EVERY);
    if (before !== after) {
      SoundManager.play('arcadeTick', { volume: 0.18, pitch: steps > 0 ? 1.12 : 0.9 });
      hapticTick();
    }
  };

  const onDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!enabled) return;
    onPress();
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { y: event.clientY, carry: 0 };
  };
  const onMove = (event: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const moved = event.clientY - d.y;
    d.y = event.clientY;
    setOffset((prev) => prev + moved);
    const total = moved + d.carry;
    const steps = Math.trunc(total / PX_PER_STEP);
    d.carry = total - steps * PX_PER_STEP;
    step(steps);
  };
  const onUp = (event: PointerEvent<HTMLDivElement>) => {
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };
  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!enabled) return;
    const size = event.shiftKey ? 10 : 1;
    if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
      event.preventDefault();
      onPress();
      setOffset((prev) => prev - size * PX_PER_STEP);
      step(-size);
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
      event.preventDefault();
      onPress();
      setOffset((prev) => prev + size * PX_PER_STEP);
      step(size);
    }
  };

  return (
    <div
      className='trick-fine'
      role='slider'
      tabIndex={enabled ? 0 : -1}
      aria-label='fine aim'
      aria-orientation='vertical'
      aria-valuemin={-9999}
      aria-valuemax={9999}
      aria-valuenow={Math.max(-9999, Math.min(9999, turned))}
      aria-valuetext={`${(turned / 100).toFixed(2)} degrees`}
      aria-disabled={!enabled}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onKeyDown={onKey}
    >
      <span className='trick-fine-ridges' style={{ backgroundPositionY: `${offset}px` }} aria-hidden />
    </div>
  );
}
