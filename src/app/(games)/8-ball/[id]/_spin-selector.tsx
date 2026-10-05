'use client';

import { useRef, useCallback } from 'react';

type SpinSelectorProps = {
  spinX: number;
  spinY: number;
  onChange: (x: number, y: number) => void;
  visible: boolean;
};

const SIZE = 84; // slightly larger for better touch targets
const HALF = SIZE / 2;
const DOT_R = 6;

// Axis snapping: when the pointer is within this angle (radians) of a
// cardinal axis, snap to that axis. This makes pure follow/draw/english
// easy to hit precisely on touch devices without a steady hand.
const AXIS_SNAP_ANGLE = 0.18; // ~10 degrees

export function clampToCircle(x: number, y: number): [number, number] {
  const d = Math.sqrt(x * x + y * y);
  if (d <= 1) return [x, y];
  return [x / d, y / d];
}

/** Snap to the nearest cardinal axis if within AXIS_SNAP_ANGLE. */
export function axisSnap(x: number, y: number): [number, number] {
  const d = Math.sqrt(x * x + y * y);
  if (d < 0.15) return [x, y]; // too close to center, no snap
  const angle = Math.atan2(y, x);
  // Check proximity to each cardinal direction (0, PI/2, PI, -PI/2)
  const cardinals = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
  for (const c of cardinals) {
    let diff = angle - c;
    while (diff > Math.PI) diff -= 2 * Math.PI;
    while (diff < -Math.PI) diff += 2 * Math.PI;
    if (Math.abs(diff) < AXIS_SNAP_ANGLE) {
      // Snap: project onto this axis
      if (c === 0 || c === Math.PI) return [d * Math.sign(Math.cos(angle)), 0];
      return [0, d * Math.sign(Math.sin(angle))];
    }
  }
  return [x, y];
}

export function SpinSelector({ spinX, spinY, onChange, visible }: SpinSelectorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const handlePointer = useCallback(
    (clientX: number, clientY: number) => {
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const rawX = ((clientX - rect.left) / rect.width) * 2 - 1;
      const rawY = ((clientY - rect.top) / rect.height) * 2 - 1;
      const [clampedX, clampedY] = clampToCircle(rawX, rawY);
      const [sx, sy] = axisSnap(clampedX, clampedY);
      onChange(Math.round(sx * 100) / 100, Math.round(sy * 100) / 100);
    },
    [onChange],
  );

  const onDown = useCallback(
    (e: React.PointerEvent) => {
      e.stopPropagation();
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      dragging.current = true;
      handlePointer(e.clientX, e.clientY);
    },
    [handlePointer],
  );

  const onMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging.current) return;
      e.stopPropagation();
      handlePointer(e.clientX, e.clientY);
    },
    [handlePointer],
  );

  const onUp = useCallback((e: React.PointerEvent) => {
    dragging.current = false;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
  }, []);

  const onDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      onChange(0, 0);
    },
    [onChange],
  );

  if (!visible) return null;

  // Map normalized -1..1 → pixel position
  const dotX = HALF + spinX * (HALF - DOT_R - 2);
  // Invert Y: in the UI top = positive spinY (topspin), but in screen coords top = negative
  const dotY = HALF - spinY * (HALF - DOT_R - 2);

  const hasSpin = Math.abs(spinX) > 0.05 || Math.abs(spinY) > 0.05;

  return (
    <div
      className='select-none touch-none inline-block'
      style={{ width: SIZE + 18, height: SIZE + 28 }}
    >
      <div className='rounded-panel bg-panel border-2 border-ink p-2 pb-1 shadow-chip'>
        <div
          ref={containerRef}
          className='relative cursor-crosshair rounded-full border-2 border-ink'
          style={{ width: SIZE, height: SIZE, background: '#e8e8e8' }}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          onDoubleClick={onDoubleClick}
        >
          {/* Crosshair lines */}
          <div className='absolute left-1/2 top-2 bottom-2 w-px -translate-x-1/2 bg-well' />
          <div className='absolute top-1/2 left-2 right-2 h-px -translate-y-1/2 bg-well' />

          {/* Strike point dot */}
          <div
            className='absolute rounded-full shadow-sm'
            style={{
              width: DOT_R * 2,
              height: DOT_R * 2,
              left: dotX - DOT_R,
              top: dotY - DOT_R,
              backgroundColor: !hasSpin
                ? 'var(--border-ink)'
                : spinY > 0.05
                  ? 'var(--enamel-danger)' // topspin
                  : spinY < -0.05
                    ? 'var(--enamel-info)' // backspin
                    : 'var(--enamel-prize)', // pure sidespin
              border: '1.5px solid var(--border-ink)',
            }}
          />
        </div>

        {/* Label — includes type and magnitude for precision feedback */}
        <p className='mt-1 text-center text-[10px] text-faint leading-tight font-medium'>
          {hasSpin
            ? (() => {
                const mag = Math.sqrt(spinX * spinX + spinY * spinY);
                const strength = mag > 0.7 ? 'Max ' : mag > 0.4 ? '' : 'Light ';
                if (Math.abs(spinY) > 0.05 && Math.abs(spinX) > 0.05) {
                  return `${strength}${spinY > 0 ? 'Follow' : 'Draw'} + English`;
                }
                if (spinY > 0.05) return `${strength}Follow`;
                if (spinY < -0.05) return `${strength}Draw`;
                return `${strength}English`;
              })()
            : 'Center'}
        </p>
      </div>
    </div>
  );
}
