'use client';

import Script from 'next/script';
import { usePathname } from 'next/navigation';
import {
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
} from 'react';

import { ARCADE_GAMES } from '@/features/arcade/components/arcade-game-registry';
import { canonicalGamePath } from '@/features/arcade/lib/game-renames';

declare global {
  interface Window {
    adsbygoogle?: unknown[];
  }
}

type AdSenseSlotProps = {
  clientId: string;
  slotId: string;
  label: string;
  className?: string;
};

const NON_GAME_PATHS = new Set(['/store', '/inventory', '/leaderboard']);

const splitEnvList = (value: string | undefined) =>
  (value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

const findGameForPath = (pathname: string) =>
  ARCADE_GAMES.find(
    (game) => pathname === game.href || pathname.startsWith(`${game.href}/`),
  );

const routeAdsDisabled = (pathname: string, disabledRoutes?: string) => {
  const disabled = splitEnvList(disabledRoutes);
  if (disabled.length === 0) return false;
  const matchingGame = findGameForPath(pathname);
  return disabled.some((entry) => {
    if (entry === pathname) return true;
    if (entry.startsWith('/') && pathname.startsWith(entry)) return true;
    return matchingGame?.slug === entry;
  });
};

function isEligibleGameAdPath(rawPathname: string, disabledRoutes?: string) {
  const pathname = canonicalGamePath(rawPathname);
  if (NON_GAME_PATHS.has(pathname)) return false;
  if (pathname.startsWith('/store/')) return false;
  if (pathname.startsWith('/inventory/')) return false;
  if (pathname.startsWith('/leaderboard/')) return false;
  const game = findGameForPath(pathname);
  if (!game || game.sectionId === 'wager') return false;
  if (routeAdsDisabled(pathname, disabledRoutes)) return false;
  return true;
}

function AdSenseSlot({
  clientId,
  slotId,
  label,
  className = '',
}: AdSenseSlotProps) {
  const pushedRef = useRef(false);

  useEffect(() => {
    if (pushedRef.current || !slotId || !clientId) return;
    try {
      window.adsbygoogle = window.adsbygoogle ?? [];
      window.adsbygoogle.push({});
      pushedRef.current = true;
    } catch (error) {
      console.warn('AdSense slot failed to load:', error);
    }
  }, [clientId, slotId]);

  return (
    <aside
      className={`mx-auto w-full max-w-5xl px-3 py-3 sm:px-4 ${className}`}
      aria-label={label}
    >
      <ins
        className='adsbygoogle block min-h-[90px] w-full overflow-hidden rounded-panel border border-soft bg-panel/60'
        style={{ display: 'block' }}
        data-ad-client={clientId}
        data-ad-slot={slotId}
        data-ad-format='auto'
        data-full-width-responsive='true'
      />
    </aside>
  );
}

export function GamePageAdFrame({
  children,
  canShowAds,
  clientId,
  topSlotId,
  bottomSlotId,
  adsEnabled = true,
  disabledRoutes,
}: {
  children: ReactNode;
  canShowAds: boolean;
  clientId?: string;
  topSlotId?: string;
  bottomSlotId?: string;
  adsEnabled?: boolean;
  disabledRoutes?: string;
}) {
  const pathname = usePathname();
  const shouldShowAds = useMemo(
    () =>
      Boolean(
        adsEnabled &&
          canShowAds &&
          clientId &&
          isEligibleGameAdPath(pathname, disabledRoutes),
      ),
    [adsEnabled, canShowAds, clientId, disabledRoutes, pathname],
  );

  if (!shouldShowAds) return <>{children}</>;

  return (
    <>
      <Script
        async
        src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(clientId!)}`}
        crossOrigin='anonymous'
        strategy='afterInteractive'
      />
      {topSlotId ? (
        <AdSenseSlot
          key={`${pathname}:top:${topSlotId}`}
          clientId={clientId!}
          slotId={topSlotId}
          label='Advertisement'
        />
      ) : null}
      {children}
      {bottomSlotId ? (
        <AdSenseSlot
          key={`${pathname}:bottom:${bottomSlotId}`}
          clientId={clientId!}
          slotId={bottomSlotId}
          label='Advertisement'
        />
      ) : null}
    </>
  );
}
