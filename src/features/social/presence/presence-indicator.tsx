'use client';

import { useFriendPresence, type PresenceStatus } from './presence-client';

const DOT_COLOR: Record<PresenceStatus, string> = {
  online: 'bg-emerald-500',
  in_game: 'bg-sky-500',
  away: 'bg-amber-500',
  offline: 'bg-slate-500',
};

const STATUS_LABEL: Record<PresenceStatus, string> = {
  online: 'Online',
  in_game: 'In game',
  away: 'Away',
  offline: 'Offline',
};

function prettyGame(slug: string | null): string {
  if (!slug) return 'a game';
  return slug
    .split('-')
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
    .join(' ');
}

/** A small status dot for a friend, driven by live presence. */
export function PresenceDot({ userId, className = '' }: { userId: string; className?: string }) {
  const presence = useFriendPresence(userId);
  const status = presence?.status ?? 'offline';
  return (
    <span
      className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${DOT_COLOR[status]} ${className}`}
      title={STATUS_LABEL[status]}
      aria-label={STATUS_LABEL[status]}
    />
  );
}

/** A short text line describing what a friend is doing (hidden when offline). */
export function PresenceLabel({ userId }: { userId: string }) {
  const presence = useFriendPresence(userId);
  if (!presence || presence.status === 'offline') return null;

  if (presence.status === 'in_game') {
    return <span className='text-xs font-medium text-sky-400'>Playing {prettyGame(presence.gameSlug)}</span>;
  }
  if (presence.status === 'away') {
    return <span className='text-xs font-medium text-amber-400'>Away</span>;
  }
  return <span className='text-xs font-medium text-emerald-400'>Online</span>;
}
