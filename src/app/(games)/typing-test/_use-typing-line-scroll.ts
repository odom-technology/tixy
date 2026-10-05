'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';

type TypingLineScrollOptions = {
  currentWordIndex: number;
  layoutKey?: string | number;
  enabled?: boolean;
};

/**
 * Keeps the active row in the middle of a three-line reading window. The next
 * row is therefore visible before it becomes active, and row changes animate
 * by one measured line instead of snapping the active word to the top.
 */
export function useTypingLineScroll({
  currentWordIndex,
  layoutKey,
  enabled = true,
}: TypingLineScrollOptions) {
  const containerRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<number | null>(null);
  const [offset, setOffset] = useState(0);

  const measure = useCallback(() => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
    }

    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      const container = containerRef.current;
      if (!container || !enabled) {
        setOffset(0);
        return;
      }

      const activeWord = container.querySelector<HTMLElement>(
        `[data-word-index="${currentWordIndex}"]`,
      );
      if (!activeWord) return;

      const words = Array.from(
        container.querySelectorAll<HTMLElement>('[data-word-index]'),
      );
      const lineTops: number[] = [];
      for (const word of words) {
        const top = word.offsetTop;
        if (!lineTops.some((lineTop) => Math.abs(lineTop - top) < 2)) {
          lineTops.push(top);
        }
      }
      lineTops.sort((a, b) => a - b);

      const activeTop = activeWord.offsetTop;
      const activeLine = Math.max(
        0,
        lineTops.findIndex((lineTop) => Math.abs(lineTop - activeTop) < 2),
      );
      const firstVisibleLine = Math.max(0, activeLine - 1);
      const firstLineTop = lineTops[0] ?? 0;
      const nextOffset = Math.max(
        0,
        (lineTops[firstVisibleLine] ?? firstLineTop) - firstLineTop,
      );

      setOffset((previous) =>
        Math.abs(previous - nextOffset) < 0.5 ? previous : nextOffset,
      );
    });
  }, [currentWordIndex, enabled]);

  useEffect(() => {
    measure();
  }, [layoutKey, measure]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(container);
    window.addEventListener('resize', measure);
    void document.fonts?.ready.then(measure);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', measure);
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, [measure]);

  const style = useMemo<CSSProperties>(
    () => ({
      transform: `translate3d(0, ${-offset}px, 0)`,
    }),
    [offset],
  );

  return {
    containerRef,
    isScrolled: offset > 0,
    style,
    remeasure: measure,
  };
}
