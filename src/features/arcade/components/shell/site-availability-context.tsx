'use client';

import { usePathname, useRouter } from 'next/navigation';
import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react';

import {
  DEFAULT_SITE_AVAILABILITY,
  type SiteAvailabilityConfig,
} from '@/lib/site-availability';

const SiteAvailabilityContext = createContext<SiteAvailabilityConfig>(
  DEFAULT_SITE_AVAILABILITY,
);

export function SiteAvailabilityProvider({
  children,
  value,
}: {
  children: ReactNode;
  value: SiteAvailabilityConfig;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const previousPathname = useRef(pathname);

  useEffect(() => {
    if (previousPathname.current === pathname) return;
    previousPathname.current = pathname;
    // App Router preserves layouts across client navigation. Refresh the server
    // snapshot so availability edits appear on the next page without polling.
    router.refresh();
  }, [pathname, router]);

  return (
    <SiteAvailabilityContext.Provider value={value}>
      {children}
    </SiteAvailabilityContext.Provider>
  );
}

export function useSiteAvailability() {
  return useContext(SiteAvailabilityContext);
}
