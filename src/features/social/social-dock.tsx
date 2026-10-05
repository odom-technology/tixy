'use client';

/* The social button in the bottom-right corner on desktop, and the panel it
   opens. The faces are friends who are on (or your friends, or you), each a
   circle with a paper ring drawn on the circle itself. The count is what is
   waiting for you: requests and unread chats. */

import { ChevronDown, X } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';

import { Num } from '@/features/arcade/components/ui/num';
import { ProfileAvatar } from '@/features/users/components/profile-avatar';
import { useOnlineFriends } from '@/features/social/presence/presence-client';

import { SocialExperience } from './social-experience';
import { useSocial } from './social-provider';

import './tixy-people.css';

const MATCH_ROUTE = /^\/(8-ball|chess|connect-four)\/[^/]+/;

const ICON = { size: 18, strokeWidth: 2, strokeLinecap: 'square' as const, 'aria-hidden': true };

export function SocialDock() {
  const pathname = usePathname();
  const social = useSocial();
  const online = useOnlineFriends();
  const unread = social.socialUnread;
  const lastUnread = useRef(unread);
  const [nudge, setNudge] = useState(0);

  /* A new request or message nudges the button once. */
  useEffect(() => {
    if (unread > lastUnread.current) setNudge((value) => value + 1);
    lastUnread.current = unread;
  }, [unread]);

  /* A challenge sent or accepted from the panel opens the match: get the
     panel out of the way of the table. */
  const { setDockOpen } = social;
  useEffect(() => {
    if (MATCH_ROUTE.test(pathname)) setDockOpen(false);
  }, [pathname, setDockOpen]);

  const hidden = !social.snapshot || pathname === '/social' || pathname.startsWith('/social/');
  const [footerClearance, setFooterClearance] = useState(20);

  // Keep both the launcher and open panel above visible footer content.
  // Measure its actual position so wrapped links and zoom need no fixed width.
  useLayoutEffect(() => {
    if (hidden) return;
    const footer = document.querySelector<HTMLElement>('[data-legal-footer]');
    if (!footer) return;
    let frame: number | null = null;
    const measure = () => {
      frame = null;
      const visibleFooter = Math.max(0, window.innerHeight - footer.getBoundingClientRect().top);
      const clearance = Math.max(20, Math.ceil(visibleFooter + 12));
      setFooterClearance((current) => current === clearance ? current : clearance);
    };
    const schedule = () => {
      if (frame === null) frame = window.requestAnimationFrame(measure);
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(footer);
    observer.observe(document.body);
    window.addEventListener('scroll', schedule, { passive: true, capture: true });
    window.addEventListener('resize', schedule, { passive: true });
    measure();
    return () => {
      observer.disconnect();
      window.removeEventListener('scroll', schedule, true);
      window.removeEventListener('resize', schedule);
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, [hidden, pathname]);

  if (hidden) return null;
  const dockStyle = { '--tp-footer-clearance': `${footerClearance}px` } as CSSProperties;

  const snapshot = social.snapshot!;
  const onlineIds = new Set(online.map((presence) => presence.userId));
  const onFriends = snapshot.friends.filter((friend) => onlineIds.has(friend.userId));
  const faces = (onFriends.length ? onFriends : snapshot.friends.length ? snapshot.friends : [snapshot.currentUser]).slice(0, 3);
  const line = onFriends.length
    ? `${onFriends.length} on now`
    : snapshot.friends.length
      ? `${snapshot.friends.length} ${snapshot.friends.length === 1 ? 'friend' : 'friends'}`
      : 'find friends';

  if (!social.dockOpen) {
    return (
      <button
        key={nudge}
        type='button'
        onClick={() => social.setDockOpen(true)}
        className='tp tp-launcher'
        style={dockStyle}
        data-arrived={nudge > 0 || undefined}
        aria-label={`open social, ${line}${unread ? `, ${unread} waiting` : ''}`}
      >
        <span className='tp-launcher-faces' aria-hidden>
          {faces.map((person) => (
            <ProfileAvatar key={person.userId} name={person.name} imageUrl={person.imageUrl} size='sm' />
          ))}
        </span>
        <span className='tp-launcher-text' aria-hidden>
          <strong>social</strong>
          <small>{line}</small>
        </span>
        {unread ? <span className='tp-count' aria-hidden>{unread > 99 ? '99+' : unread}</span> : null}
      </button>
    );
  }

  return (
    <aside className='tp tp-dock' style={dockStyle} aria-label='social'>
      <header className='tp-dock-head'>
        <h2>
          social
          {snapshot.friends.length ? (
            <small>
              <Num value={onFriends.length} /> of <Num value={snapshot.friends.length} /> on
            </small>
          ) : null}
        </h2>
        <button type='button' className='tp-btn' data-tone='bare' data-size='icon' onClick={() => social.setDockOpen(false)} aria-label='minimize social'>
          <ChevronDown {...ICON} />
        </button>
        <button
          type='button'
          className='tp-btn'
          data-tone='bare'
          data-size='icon'
          onClick={() => {
            social.setActiveThread(null);
            social.setDockOpen(false);
          }}
          aria-label='close social'
        >
          <X {...ICON} />
        </button>
      </header>
      <div className='min-h-0 flex-1'>
        <SocialExperience variant='dock' />
      </div>
    </aside>
  );
}
