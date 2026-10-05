'use client';

import Link from 'next/link';

import { TixyLogo } from '@/features/brand/tixy-brand';
import { isRouteActive } from '@/features/arcade/components/use-recent-games';
import { useHorizontalOverflow } from '@/features/arcade/components/use-horizontal-overflow';
import { getPathRestriction } from '@/lib/site-availability';

import { PLAY_NAV_ITEMS, type AppNavItem } from './navigation-data';
import { AccountMenu } from './account-nav';
import { useSiteAvailability } from './site-availability-context';

/* The top bar carries the primary play tabs; below sm the bottom dock takes
   over (the two never render at the same time). */
const TOP_NAV_ITEMS: AppNavItem[] = PLAY_NAV_ITEMS;

function TopNavLink({
  item,
  pathname,
  unavailable,
}: {
  item: AppNavItem;
  pathname: string;
  unavailable: boolean;
}) {
  const active = item.exact
    ? pathname === item.href
    : isRouteActive(pathname, item.href);
  const Icon = item.icon;

  return (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      aria-label={unavailable ? `${item.label} temporarily unavailable` : undefined}
      title={unavailable ? `${item.label} temporarily unavailable` : undefined}
      className={`group relative flex h-10 shrink-0 items-center gap-2 px-1.5 text-sm font-semibold transition-colors duration-150 ${
        active ? 'text-strong' : unavailable ? 'text-faint hover:text-strong' : 'text-body hover:text-strong'
      }`}
    >
      <Icon size={16} className={active ? 'text-primary-text' : 'text-faint'} aria-hidden />
      <span className='whitespace-nowrap'>{item.label}{unavailable ? ' · Closed' : ''}</span>
      {/* sliding enamel underline — grows in on active, peeks on hover */}
      <span
        aria-hidden
        className={`pointer-events-none absolute inset-x-1 bottom-0 h-[3px] origin-center rounded-full bg-primary shadow-chip transition-transform duration-200 ${
          active ? 'scale-x-100' : 'scale-x-0 group-hover:scale-x-50'
        }`}
      />
    </Link>
  );
}

function PrimaryNav({ pathname }: { pathname: string }) {
  const availability = useSiteAvailability();
  // Edge-fade the strip only while it actually clips (narrow viewports) —
  // on wide desktops the mask would permanently dim the first/last tabs.
  const { ref, overflowing } = useHorizontalOverflow<HTMLElement>();
  return (
    <nav
      ref={ref}
      aria-label='Primary'
      className={`arcade-scrollbar hidden min-w-0 overflow-x-auto sm:block${
        overflowing ? ' arc-scroll-fade' : ''
      }`}
    >
      <ul className='flex min-w-max items-center gap-1'>
        {TOP_NAV_ITEMS.map((item) => (
          <li key={item.href}>
            <TopNavLink
              item={item}
              pathname={pathname}
              unavailable={item.href === '/'
                ? !availability.sections.games
                : Boolean(getPathRestriction(availability, item.href))}
            />
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function AppTopNav({ pathname }: { pathname: string }) {
  return (
    <header className='arc-topbar sticky top-0 z-50'>
      <div className='mx-auto flex w-full max-w-[100rem] items-center gap-4 px-3 py-2.5 sm:px-4 lg:px-6'>
        {/* The tixy lockup. Its letters follow currentColor, so they read on
            paper and on the old dark themes. The name matches what it shows. */}
        <Link href='/' aria-label='tixy.lol' className='-mx-1 flex min-h-11 shrink-0 items-center rounded-key px-1 text-strong'>
          <TixyLogo height={30} className='block h-7 w-auto sm:h-[30px]' />
        </Link>
        <PrimaryNav pathname={pathname} />
        <div className='min-w-0 flex-1' />
        <div className='hidden sm:block'><AccountMenu /></div>
      </div>
    </header>
  );
}
