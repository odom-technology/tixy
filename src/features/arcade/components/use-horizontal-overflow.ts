'use client';

import { useEffect, useRef, useState } from 'react';

/* Tracks whether a horizontal scroll strip actually overflows its box, so the
   `.arc-scroll-fade` edge mask can be applied only when there is hidden
   content to hint at. (Unconditional use of the mask permanently dims the
   first/last items of rows that fit — e.g. the top nav on wide desktops.)
   Attach `ref` to the overflow-x-auto element; `overflowing` re-checks on
   element and content resizes. */
export function useHorizontalOverflow<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [overflowing, setOverflowing] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const check = () => {
      // Some strips own their scrolling one level down (e.g. `.arc-seg` has
      // its own overflow-x:auto), so the wrapper itself never overflows —
      // check the first child too. The edge mask on the wrapper still fades
      // the child's clipped edges since they share the same box.
      const child = el.firstElementChild;
      setOverflowing(
        el.scrollWidth - el.clientWidth > 1 ||
          (child !== null && child.scrollWidth - child.clientWidth > 1),
      );
    };
    check();

    const observer = new ResizeObserver(check);
    observer.observe(el);
    // Content width changes (fonts, added items) move scrollWidth without
    // resizing the box itself — watch the first child too.
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    return () => observer.disconnect();
  }, []);

  return { ref, overflowing };
}
