import { gameName } from '@/features/arcade/components/home/home-on-now';

import type { FriendPresence } from './presence/presence-client';

/* "3m", "2h", "4d": how long ago, in one short number. */
export function shortAgo(timestamp: number, now = Date.now()) {
  const diff = Math.max(0, now - timestamp);
  if (diff < 60_000) return 'now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  return `${Math.floor(diff / 86_400_000)}d`;
}

export function isOn(presence: FriendPresence | undefined) {
  return Boolean(presence && presence.status !== 'offline');
}

/* What a friend is doing, in the home's words: "playing chess", "on the
   floor", "away", "seen 2h ago". */
export function presenceLine(presence: FriendPresence | undefined) {
  if (!presence) return 'not on';
  if (presence.status === 'in_game') return `playing ${gameName(presence.gameSlug) ?? 'a game'}`;
  if (presence.status === 'online') return 'on the floor';
  if (presence.status === 'away') return 'away';
  if (!presence.lastSeenAt) return 'not on';
  const ago = shortAgo(presence.lastSeenAt);
  return ago === 'now' ? 'just left' : `seen ${ago} ago`;
}
