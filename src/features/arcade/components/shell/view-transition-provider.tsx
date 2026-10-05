'use client';

import { useEffect } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';

/**
 * Keeps the main landmark named for the View Transitions API so shell
 * navigations can morph content. Cross-document transitions use the CSS
 * `@view-transition { navigation: auto }` rule in globals.css.
 *
 * Soft App Router navigations that support the API inherit the same named
 * transition when the browser applies same-document VT (Chrome 126+).
 */
export function ViewTransitionProvider() {
  const pathname = usePathname();
  const search = useSearchParams();

  useEffect(() => {
    const main = document.getElementById('main-content');
    if (main) main.style.viewTransitionName = 'arcade-main';
    return () => {
      if (main) main.style.viewTransitionName = '';
    };
  }, [pathname, search]);

  return null;
}
