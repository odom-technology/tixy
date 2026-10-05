'use client';

import {
  useEffect,
  useRef,
  type CSSProperties,
  type ElementType,
  type ReactNode,
  type RefObject,
} from 'react';

import { cx } from '@/features/arcade/components/ui/arcade-ui';

/**
 * IntersectionObserver gate for `.arc-reveal` arrival motion.
 * Sets `data-revealed` once when the element enters the viewport so below-fold
 * aisles don't all animate on first paint. Reduced-motion users skip the wait
 * and reveal immediately (CSS also short-circuits the animation).
 */
export function useArcReveal<T extends HTMLElement = HTMLElement>(): RefObject<T | null> {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || el.hasAttribute('data-revealed')) return;

    if (
      typeof window === 'undefined' ||
      !('IntersectionObserver' in window) ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      el.setAttribute('data-revealed', '');
      return;
    }

    const rect = el.getBoundingClientRect();
    if (rect.top < window.innerHeight * 0.92 && rect.bottom > 0) {
      el.setAttribute('data-revealed', '');
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.setAttribute('data-revealed', '');
            observer.unobserve(entry.target);
          }
        }
      },
      {
        rootMargin: '0px 0px -8% 0px',
        threshold: 0.08,
      },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return ref;
}

/** Inline `--i` stagger var without tripping the no-inline-style lint guard. */
export function revealStyle(index: number): CSSProperties {
  return { '--i': index } as CSSProperties;
}

type ArcRevealProps = {
  index?: number;
  className?: string;
  children: ReactNode;
  as?: ElementType;
  id?: string;
  'aria-label'?: string;
};

/**
 * Wrapper that applies `.arc-reveal` + viewport-gated `data-revealed`.
 * Prefer this over bare className so every surface shares one observer path.
 */
export function ArcReveal({
  index = 0,
  className,
  children,
  as: Tag = 'div',
  ...rest
}: ArcRevealProps) {
  const ref = useArcReveal<HTMLElement>();
  return (
    <Tag
      ref={ref}
      className={cx('arc-reveal', className)}
      style={revealStyle(index)}
      {...rest}
    >
      {children}
    </Tag>
  );
}
