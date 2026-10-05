'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useMemo } from 'react';

import { cx } from '@/features/arcade/components/ui/arcade-ui';

function parseDisabledRoutes(disabledRoutes: string) {
  return new Set(
    disabledRoutes
      .split(',')
      .map((route) => route.trim().replace(/^\/+|\/+$/g, ''))
      .filter(Boolean),
  );
}

declare global {
  interface Window {
    adsbygoogle?: unknown[];
  }
}

function isRouteDisabledForAds(pathname: string, disabledRoutes: Set<string>) {
  const segments = pathname.split('/').filter(Boolean);
  if (segments.length === 0) return false;

  const routeCandidates = [
    segments[0],
    segments.slice(0, 2).join('/'),
    segments.join('/'),
  ];
  return routeCandidates.some((candidate) => disabledRoutes.has(candidate));
}

export function AdsenseSlot({
  clientId,
  disabledRoutes,
  enabled,
  slotId,
  position,
  className,
}: {
  clientId: string;
  disabledRoutes: string;
  enabled: boolean;
  slotId?: string;
  position: 'top' | 'bottom';
  className?: string;
}) {
  const pathname = usePathname();
  const disabledRouteSet = useMemo(
    () => parseDisabledRoutes(disabledRoutes),
    [disabledRoutes],
  );
  const shouldRender =
    enabled &&
    Boolean(clientId) &&
    Boolean(slotId) &&
    !isRouteDisabledForAds(pathname, disabledRouteSet);

  useEffect(() => {
    if (!shouldRender) return;

    try {
      window.adsbygoogle = window.adsbygoogle || [];
      window.adsbygoogle.push({});
    } catch {
      // Ad loading failures should not interrupt game pages.
    }
  }, [pathname, shouldRender, slotId]);

  if (!shouldRender || !slotId) return null;

  return (
    <aside
      aria-label='Advertisement'
      className={cx(
        'mx-auto w-full max-w-[76rem]',
        position === 'top' ? 'mb-3' : 'mt-3',
        className,
      )}
    >
      <div className='rounded-panel border border-soft bg-well px-3 py-2 text-center shadow-chip'>
        <p className='mb-2 text-[10px] font-semibold uppercase tracking-wide text-faint'>
          Advertisement
        </p>
        <ins
          className='adsbygoogle block min-h-[90px] w-full'
          data-ad-client={clientId}
          data-ad-slot={slotId}
          data-ad-format='auto'
          data-full-width-responsive='true'
        />
      </div>
    </aside>
  );
}
