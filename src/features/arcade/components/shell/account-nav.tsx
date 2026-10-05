'use client';

import { useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { Award, Bell, ChevronDown, CircleUserRound, Layers, LogIn, LogOut, Menu, MessageSquarePlus, Settings, Shield, UserPlus, UsersRound, type LucideIcon } from 'lucide-react';

import { ProfileAvatar } from '@/features/users/components/profile-avatar';
import { isRouteActive } from '@/features/arcade/components/use-recent-games';
import { useOptionalSocial } from '@/features/social/social-provider';
import { useAccountSummary } from './use-account-summary';

type MenuLinkProps = {
  href: string;
  label: string;
  icon: LucideIcon;
  pathname: string;
  close: () => void;
  badge?: number;
  activeOverride?: boolean;
};

function MenuLink({ href, label, icon: Icon, pathname, close, badge, activeOverride }: MenuLinkProps) {
  const active = activeOverride ?? isRouteActive(pathname, href.split('?')[0]);
  return (
    <Link href={href} onClick={close} aria-current={active ? 'page' : undefined}
      className={`flex min-h-10 items-center gap-3 rounded-key px-3 py-2 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${active ? 'bg-primary text-primary-on' : 'text-body hover:bg-raised hover:text-strong'}`}>
      <Icon size={16} aria-hidden />
      <span className='flex-1'>{label}</span>
      {badge ? <span className='arcade-num rounded-full border border-ink bg-tickets px-1.5 py-0.5 text-[10px] font-bold text-tickets-on'>{badge > 99 ? '99+' : badge}</span> : null}
    </Link>
  );
}

/** Shared desktop account menu and mobile dock menu. */
export function AccountMenu({ mobile = false }: { mobile?: boolean }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { account, unreadCount, socialUnread, loaded, isAdmin } = useAccountSummary();
  const social = useOptionalSocial();
  const visibleSocialUnread = social?.socialUnread ?? socialUnread;
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
        requestAnimationFrame(() => buttonRef.current?.focus());
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    panelRef.current?.querySelector<HTMLAnchorElement>('a')?.focus();
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const close = () => setOpen(false);
  const name = account?.username ?? account?.email ?? 'Account';
  const authNext = pathname && pathname !== '/' ? `?next=${encodeURIComponent(pathname)}` : '';
  const active = open || ['/profile', '/settings', '/admin'].some((href) => isRouteActive(pathname, href));

  return (
    <div ref={rootRef} onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
    }} className={`relative ${mobile ? 'w-full' : 'shrink-0'}`}>
      <button ref={buttonRef} type='button'
        aria-label={`${open ? 'Close' : 'Open'} ${mobile ? 'menu' : account ? `account menu for ${name}` : 'account menu'}${visibleSocialUnread ? `, ${visibleSocialUnread} unread` : ''}`}
        aria-expanded={open} aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((value) => !value)}
        disabled={!loaded}
        className={mobile
          ? `relative flex w-full min-w-0 flex-col items-center justify-center gap-1 rounded-tag px-1 py-1.5 text-[10px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-primary ${account ? (active ? 'text-strong' : 'text-faint hover:text-strong') : active ? 'border border-ink bg-primary text-primary-on shadow-chip' : 'border border-transparent text-faint hover:text-strong'}`
          : account
            ? 'relative flex h-10 items-center rounded-full transition-[filter] hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary'
            : `flex h-10 items-center gap-2 rounded-key border px-2.5 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-primary ${active ? 'border-ink bg-primary text-primary-on shadow-chip' : 'border-soft text-body hover:bg-raised hover:text-strong'}`}>
        {/* Signed in, the button is the avatar: a circle, with nothing drawn
            behind it. The ring only shows while the menu or an account page
            is open. */}
        {account ? (
          <ProfileAvatar
            name={account.username ?? name}
            imageUrl={account.imageUrl ?? null}
            size={mobile ? '2xs' : 'sm'}
            ring={active ? 'currentColor' : undefined}
          />
        ) : mobile ? <Menu size={16} aria-hidden /> : <LogIn size={16} aria-hidden />}
        {mobile ? <span className='max-w-full truncate'>Menu</span> : account ? null : <span className='hidden max-w-28 truncate lg:inline'>{loaded ? 'sign in' : 'account'}</span>}
        {!mobile && !account ? <ChevronDown size={14} aria-hidden className={open ? 'rotate-180' : ''} /> : null}
        {!mobile && visibleSocialUnread > 0 ? <span className='arcade-num absolute -top-1 -right-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[var(--tixy-red)] px-1 text-[10px] font-bold text-[var(--tixy-paper)]'>{visibleSocialUnread > 99 ? '99+' : visibleSocialUnread}</span> : null}
        {mobile && visibleSocialUnread > 0 ? <span className='arcade-num absolute -top-1 right-1 rounded-full bg-[var(--tixy-red)] px-1 text-[8px] font-bold text-[var(--tixy-paper)]'>{visibleSocialUnread > 9 ? '9+' : visibleSocialUnread}</span> : null}
      </button>
      {open ? (
        <div id={menuId} ref={panelRef}
          className={`absolute right-0 z-[60] w-72 max-h-[calc(100dvh-7rem)] overflow-y-auto rounded-panel border-2 border-ink bg-panel p-2 shadow-panel ${mobile ? 'bottom-[calc(100%+0.75rem)]' : 'top-[calc(100%+0.75rem)]'}`}>
          {account ? (
            <>
              <div className='border-b border-soft px-3 py-2'>
                <p className='truncate text-sm font-bold text-strong'>{name}</p>
                <p className='truncate text-xs text-faint'>{account.email}</p>
              </div>
              <nav aria-label='Account menu' className='space-y-0.5 py-2'>
                {mobile ? <>
                  <MenuLink href='/players' label='players' icon={UsersRound} pathname={pathname} close={close} />
                </> : null}
                {mobile ? <div className='mx-3 my-1 border-t border-soft' /> : null}
                <MenuLink href='/profile' label='profile' icon={CircleUserRound} pathname={pathname} close={close} />
                <MenuLink href='/settings' label='settings' icon={Settings} pathname={pathname} close={close} />
                <MenuLink href='/social?view=alerts' label='alerts' icon={Bell} pathname={pathname} close={close} badge={unreadCount} activeOverride={pathname === '/social' && searchParams.get('view') === 'alerts'} />
                <div className='mx-3 my-1 border-t border-soft' />
                <MenuLink href='/achievements' label='achievements' icon={Award} pathname={pathname} close={close} />
                <MenuLink href='/inventory' label='inventory' icon={Layers} pathname={pathname} close={close} />
                {isAdmin ? <div className='border-t border-soft pt-2'><MenuLink href='/admin' label='admin' icon={Shield} pathname={pathname} close={close} /></div> : null}
                <MenuLink href='/feedback' label='feedback' icon={MessageSquarePlus} pathname={pathname} close={close} />
              </nav>
              <div className='border-t border-soft pt-2'><MenuLink href='/signout' label='sign out' icon={LogOut} pathname={pathname} close={close} /></div>
            </>
          ) : (
            <nav aria-label='Site menu' className='space-y-0.5'>
              {mobile ? <>
                <MenuLink href='/players' label='players' icon={UsersRound} pathname={pathname} close={close} />
              </> : null}
              <MenuLink href={`/signin${authNext}`} label='sign in' icon={LogIn} pathname={pathname} close={close} />
              <MenuLink href={`/signup${authNext}`} label='create account' icon={UserPlus} pathname={pathname} close={close} />
              <MenuLink href='/feedback' label='feedback' icon={MessageSquarePlus} pathname={pathname} close={close} />
            </nav>
          )}
        </div>
      ) : null}
    </div>
  );
}
