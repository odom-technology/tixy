'use client';

import Link from 'next/link';

import { isRouteActive } from '@/features/arcade/components/use-recent-games';
import { getPathRestriction } from '@/lib/site-availability';

import { useAccountSummary } from './use-account-summary';
import { GLOBAL_MOBILE_NAV_ITEMS } from './navigation-data';
import type { AppNavItem } from './navigation-data';
import { useOptionalSocial } from '@/features/social/social-provider';
import { AccountMenu } from './account-nav';
import { useSiteAvailability } from './site-availability-context';

function MobileNavLink({
  item,
  pathname,
  badge,
  unavailable,
}: {
  item: AppNavItem;
  pathname: string;
  badge?: number;
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
      className={`flex min-w-0 flex-col items-center justify-center gap-1 rounded-tag px-1 py-1.5 text-[10px] font-medium transition-colors duration-[140ms] ${
        active
          ? 'border border-ink bg-primary text-primary-on shadow-chip'
          : 'text-faint hover:text-strong'
      }`}
    >
      <span className='relative'><Icon size={16} aria-hidden />{badge ? <span className='arcade-num absolute -top-2 -right-3 rounded-full bg-[var(--tixy-red)] px-1 text-[8px] font-bold text-[var(--tixy-paper)]'>{badge > 9 ? '9+' : badge}</span> : null}</span>
      <span className='max-w-full truncate'>{item.mobileLabel ?? item.label}</span>
      {unavailable ? <span className='text-[8px] font-bold uppercase leading-none'>Closed</span> : null}
    </Link>
  );
}

export function GlobalMobileNav({ pathname }: { pathname: string }) {
  const availability = useSiteAvailability();
  const { socialUnread } = useAccountSummary();
  const social = useOptionalSocial();

  return (
    <nav
      aria-label='Primary'
      className='arc-dock fixed inset-x-0 bottom-0 z-50 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 sm:hidden'
    >
      <ul className='mx-auto grid w-full max-w-md grid-cols-[repeat(5,minmax(min-content,1fr))] gap-1'>
        {GLOBAL_MOBILE_NAV_ITEMS.map((item) => (
          <li key={item.href} className='min-w-0'>
            <MobileNavLink
              item={item}
              pathname={pathname}
              badge={item.href === '/social' ? (social?.socialUnread ?? socialUnread) : undefined}
              unavailable={item.href === '/'
                ? !availability.sections.games
                : Boolean(getPathRestriction(availability, item.href))}
            />
          </li>
        ))}
        <li className='min-w-0'><AccountMenu mobile /></li>
      </ul>
    </nav>
  );
}
