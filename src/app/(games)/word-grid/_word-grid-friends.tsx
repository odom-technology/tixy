'use client';

import { useEffect, useState } from 'react';

import { Num } from '@/features/arcade/components/ui/num';

/* Friends' results for today, as score lines: "maple 3/6". Shown only after
   the player has finished and the score has saved. The route answers 403 to
   anyone who hasn't, so a player can't read ahead; a miss prints "x/6". */

export type FriendResult = {
  userId: string;
  name: string;
  solved: boolean;
  guesses: number | null;
};

export const scoreLine = (friend: FriendResult, maxGuesses: number) =>
  `${friend.solved && friend.guesses != null ? friend.guesses : 'x'}/${maxGuesses}`;

/** Loads today's friends' results once `enabled`, and again when the tab
 *  comes back, so a friend who finishes later shows up. Quiet on any error. */
export function useFriendResults(enabled: boolean): FriendResult[] {
  const [friends, setFriends] = useState<FriendResult[]>([]);

  useEffect(() => {
    if (!enabled) {
      setFriends([]);
      return;
    }
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch('/api/games/word-grid/friends', { cache: 'no-store' });
        if (!res.ok) return;
        const payload = (await res.json().catch(() => null)) as { friends?: FriendResult[] } | null;
        if (cancelled || !Array.isArray(payload?.friends)) return;
        setFriends(payload.friends);
      } catch {
        /* the board works without them */
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
  }, [enabled]);

  return friends;
}

export function FriendResults({
  friends,
  maxGuesses,
  limit,
}: {
  friends: FriendResult[];
  maxGuesses: number;
  /** How many lines to print; the rest fold into "2 more". */
  limit: number;
}) {
  if (friends.length === 0) return null;
  const shown = friends.slice(0, limit);
  const rest = friends.length - shown.length;
  return (
    <div>
      <ul className='wg-friends' aria-label="Friends' results">
        {shown.map((friend) => (
          <li key={friend.userId} className='wg-friend'>
            <span className='wg-friend-name'>{friend.name}</span>
            <span className='wg-friend-score'>
              <Num value={scoreLine(friend, maxGuesses)} label={`${friend.solved ? `solved in ${friend.guesses}` : 'missed'}, ${scoreLine(friend, maxGuesses)}`} />
            </span>
          </li>
        ))}
      </ul>
      {rest > 0 ? <p className='wg-friends-more'>{rest} more.</p> : null}
    </div>
  );
}
