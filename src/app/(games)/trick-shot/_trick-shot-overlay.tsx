'use client';

/* Moments drawn over 8-ball's canvas, in the canvas's own place: a red
   ring at the pocket a ball nearly went in, and "Clear"
   over the table. PoolCanvas is used unchanged, so this layer reads where
   the canvas sits and maps table units the way PoolCanvas does, upright
   or across. */

import { useEffect, useState, type RefObject } from 'react';

import { CUSHION_WIDTH, POCKETS, TABLE_HEIGHT, TABLE_WIDTH } from '@/features/arcade/lib/pool-physics';

export type TrickMoment =
  | { id: number; kind: 'near'; pocket: number }
  | { id: number; kind: 'clear' }
  | { id: number; kind: 'scratch' };

type Rect = { left: number; top: number; width: number; height: number; upright: boolean };

const RAIL = CUSHION_WIDTH;
const TOTAL_W = TABLE_WIDTH + RAIL * 2;
const TOTAL_H = TABLE_HEIGHT + RAIL * 2;

/** Table units to a percentage of the canvas, as PoolCanvas draws them. */
function place(x: number, y: number, upright: boolean): { left: string; top: string } {
  if (upright) {
    return {
      left: `${((y + RAIL) / TOTAL_H) * 100}%`,
      top: `${((TOTAL_W - x - RAIL) / TOTAL_W) * 100}%`,
    };
  }
  return { left: `${((x + RAIL) / TOTAL_W) * 100}%`, top: `${((y + RAIL) / TOTAL_H) * 100}%` };
}

export function TrickShotOverlay({
  hostRef,
  moments,
  measureKey,
}: {
  hostRef: RefObject<HTMLDivElement | null>;
  moments: TrickMoment[];
  /** Changes when the canvas may have moved: the stage size, a new table. */
  measureKey: string;
}) {
  const [rect, setRect] = useState<Rect | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const measure = () => {
      const canvas = host.querySelector('canvas');
      if (!canvas) return;
      const h = host.getBoundingClientRect();
      const c = canvas.getBoundingClientRect();
      setRect({
        left: c.left - h.left,
        top: c.top - h.top,
        width: c.width,
        height: c.height,
        upright: c.height > c.width,
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    const canvas = host.querySelector('canvas');
    if (canvas) observer.observe(canvas);
    return () => observer.disconnect();
  }, [hostRef, measureKey]);

  if (!rect || moments.length === 0) return null;
  return (
    <div
      className='trick-overlay'
      style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
      aria-hidden
    >
      {moments.map((moment) => {
        if (moment.kind === 'near') {
          const pocket = POCKETS[moment.pocket]!;
          const at = place(pocket.x, pocket.y, rect.upright);
          return (
            <div key={moment.id} className='trick-near' style={at}>
              <span className='trick-near-ring' />
            </div>
          );
        }
        if (moment.kind === 'clear') {
          return (
            <div key={moment.id} className='trick-stamp'>
              Clear
            </div>
          );
        }
        return (
          <div key={moment.id} className='trick-stamp' data-tone='foul'>
            Scratch
          </div>
        );
      })}
    </div>
  );
}
