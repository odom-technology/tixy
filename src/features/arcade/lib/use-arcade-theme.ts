'use client';

import { useSyncExternalStore } from 'react';

import type { ArcadeThemeSystem } from '@/features/arcade/lib/arcade-themes';

/* The theme lives on <html data-arcade-theme> (the system: tixy or
   boardwalk) and <html data-tixy-scheme> (the colours). The layout sets
   them from the account, and settings swaps them live, so components that
   render a different tree per system (the ticket strip and the receipt
   under tixy) watch the attribute. Colour schemes are CSS only. */

function readTheme(): ArcadeThemeSystem | null {
  if (typeof document === 'undefined') return null;
  return (document.documentElement.dataset.arcadeTheme as ArcadeThemeSystem | undefined) ?? null;
}

function subscribe(onChange: () => void) {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') {
    return () => {};
  }
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-arcade-theme'],
  });
  return () => observer.disconnect();
}

/** The current theme system, or null during server render. */
export function useArcadeTheme(): ArcadeThemeSystem | null {
  return useSyncExternalStore(subscribe, readTheme, () => null);
}

/** True under every tixy colour scheme. */
export function useIsTixyTheme(): boolean {
  return useArcadeTheme() === 'tixy';
}
