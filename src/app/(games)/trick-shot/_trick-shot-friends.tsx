'use client';

/* Friends on one card: each friend's best try today and the tries it took,
   "maple 3/3 clear, 4 tries", in the board's order. Shown once your own
   first try has saved; the route answers 403 to anyone without a try, so
   nobody reads ahead. Word grid's pattern. */

import { useEffect, useState } from 'react';

import { Num } from '@/features/arcade/components/ui/num';

export type TrickShotFriend = {
  userId: string;
  name: string;
  pots: number;
  ballCount: number;
  clear: boolean;
  scratch: boolean;
  score: number;
  /** Tries to reach that best. */
  tries: number;
};

export const friendLine = (friend: Pick<TrickShotFriend, 'pots' | 'ballCount'>) => `${friend.pots}/${friend.ballCount}`;

/** Loads once `enabled`, and again when the tab comes back. Quiet on error. */
export function useTrickShotFriends(enabled: boolean, refreshKey = 0): TrickShotFriend[] {
  const [friends, setFriends] = useState<TrickShotFriend[]>([]);

  useEffect(() => {
    if (!enabled) {
      setFriends([]);
      return;
    }
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch('/api/games/trick-shot/friends', { cache: 'no-store' });
        if (!res.ok) return;
        const payload = (await res.json().catch(() => null)) as { friends?: TrickShotFriend[] } | null;
        if (!cancelled && Array.isArray(payload?.friends)) setFriends(payload.friends);
      } catch {
        /* the table works without them */
      }
    };
    void load();
    const onVisible = () => {
      if (!document.hidden) void load();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [enabled, refreshKey]);

  return friends;
}

export function TrickShotFriends({ friends, limit }: { friends: TrickShotFriend[]; limit: number }) {
  if (friends.length === 0) return null;
  const shown = friends.slice(0, limit);
  const rest = friends.length - shown.length;
  return (
    <div className='trick-friends-card'>
      <ul className='trick-friends' aria-label="Friends' best tries today">
        {shown.map((friend) => (
          <li key={friend.userId} className='trick-friend'>
            <span className='trick-friend-name'>{friend.name}</span>
            <span className='trick-friend-score'>
              <Num
                value={friendLine(friend)}
                label={`${friend.pots} of ${friend.ballCount}${friend.clear ? ', cleared' : ''}`}
              />
              {friend.clear ? <span className='trick-friend-clear'>clear</span> : null}
              <span className='trick-friend-tries'>
                <Num value={friend.tries} /> {friend.tries === 1 ? 'try' : 'tries'}
              </span>
            </span>
          </li>
        ))}
      </ul>
      {rest > 0 ? <p className='trick-friends-more'>{rest} more.</p> : null}
    </div>
  );
}
