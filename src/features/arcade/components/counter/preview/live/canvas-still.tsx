'use client';

import { useEffect, useRef } from 'react';

/** One frame of a canvas game, drawn by the game's own draw code at the
 *  size of its box. `draw` gets the context with nothing applied, the box's
 *  CSS size and the device pixel ratio; it redraws when the box resizes, when
 *  `deps` change and once the fonts are in. */
export function CanvasStill({
  draw,
  deps,
  label,
}: {
  draw: (ctx: CanvasRenderingContext2D, width: number, height: number, dpr: number) => void;
  deps: readonly unknown[];
  label?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawRef = useRef(draw);
  drawRef.current = draw;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let frame = 0;
    const paint = () => {
      frame = 0;
      const rect = canvas.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = Math.round(rect.width * dpr);
      const h = Math.round(rect.height * dpr);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, w, h);
      drawRef.current(ctx, rect.width, rect.height, dpr);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(paint);
    };
    schedule();
    const observer = new ResizeObserver(schedule);
    observer.observe(canvas);
    let alive = true;
    void document.fonts?.ready.then(() => {
      if (alive) schedule();
    });
    return () => {
      alive = false;
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return <canvas ref={canvasRef} className='pp-canvas' role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true} />;
}
