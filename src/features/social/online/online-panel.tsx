'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Gamepad2, MessageSquare, Swords, WifiOff } from 'lucide-react';

import { ArcadeButton } from '@/features/arcade/components/ui/arcade-ui';
import { ProfileAvatar } from '@/features/users/components/profile-avatar';

import { useFriendPresence, useOnlineFriendCount } from '../presence/presence-client';
import { PresenceDot, PresenceLabel } from '../presence/presence-indicator';
import { ArcadeLoading, ArcadeLoadingDots } from '@/features/arcade/components/ui/arcade-states';

type FriendSummary = {
  friendshipId: string;
  userId: string;
  name: string;
  imageUrl: string | null;
};

// Maps the in_game presence to its lobby, so "what they're playing" is one click away.
const GAME_LOBBY: Record<string, string> = {
  chess: '/chess',
  '8-ball': '/8-ball',
  'typing-duel': '/typing-test/duel',
};

export function OnlinePanel() {
  const [friends, setFriends] = useState<FriendSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const onlineCount = useOnlineFriendCount();

  useEffect(() => {
    let cancelled = false;
    void fetch('/api/friends', { cache: 'no-store' })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!cancelled && data?.friends) setFriends(data.friends as FriendSummary[]);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className='space-y-4'>
      <p className='text-sm text-faint'>
        {onlineCount > 0 ? `${onlineCount} friend${onlineCount === 1 ? '' : 's'} online` : 'No friends online right now'}
      </p>
      {loading ? (
        <div className='arcade-card flex items-center justify-center p-8 text-sm text-faint'>
          <ArcadeLoading label='Loading who is online.' />
        </div>
      ) : onlineCount === 0 ? (
        <div className='arcade-card flex flex-col items-center gap-2 p-8 text-center text-faint'>
          <WifiOff size={26} />
          <p className='text-sm'>When your friends come online, they’ll show up here.</p>
        </div>
      ) : (
        <div className='space-y-2'>
          {friends.map((friend) => (
            <OnlineFriendRow key={friend.userId} friend={friend} />
          ))}
        </div>
      )}
    </div>
  );
}

function OnlineFriendRow({ friend }: { friend: FriendSummary }) {
  const router = useRouter();
  const presence = useFriendPresence(friend.userId);
  const [opening, setOpening] = useState(false);
  const [challenging, setChallenging] = useState(false);

  const message = useCallback(async () => {
    setOpening(true);
    try {
      const response = await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetUserId: friend.userId }),
      });
      const data = (await response.json().catch(() => ({}))) as { conversationId?: string };
      if (response.ok && data.conversationId) router.push(`/social?view=dm&c=${data.conversationId}`);
    } finally {
      setOpening(false);
    }
  }, [friend.userId, router]);

  const challenge = useCallback(async () => {
    setChallenging(true);
    try {
      const response = await fetch('/api/games/chess/challenge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetUserId: friend.userId }),
      });
      const data = (await response.json().catch(() => ({}))) as { matchId?: string };
      if (response.ok && data.matchId) router.push(`/chess/${data.matchId}`);
    } finally {
      setChallenging(false);
    }
  }, [friend.userId, router]);

  if (!presence || presence.status === 'offline') return null;

  const lobby = presence.status === 'in_game' && presence.gameSlug ? GAME_LOBBY[presence.gameSlug] : null;

  return (
    <div className='arcade-card-inset flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between'>
      <Link href={`/u/${encodeURIComponent(friend.userId)}`} className='flex min-w-0 items-center gap-3'>
        <span className='relative'>
          <ProfileAvatar name={friend.name} imageUrl={friend.imageUrl} size='md' />
          <span className='absolute -bottom-0.5 -right-0.5'>
            <PresenceDot userId={friend.userId} className='ring-2 ring-black/40' />
          </span>
        </span>
        <span className='min-w-0'>
          <span className='block truncate text-sm font-semibold text-strong'>{friend.name}</span>
          <PresenceLabel userId={friend.userId} />
        </span>
      </Link>
      <div className='flex shrink-0 items-center gap-2'>
        {lobby ? (
          <ArcadeButton type='button' onClick={() => router.push(lobby)}>
            <Gamepad2 size={14} />
            Join
          </ArcadeButton>
        ) : null}
        <ArcadeButton type='button' onClick={() => void challenge()} disabled={challenging}>
          {challenging ? <ArcadeLoadingDots /> : <Swords size={14} />}
          Challenge
        </ArcadeButton>
        <ArcadeButton type='button' tone='primary' onClick={() => void message()} disabled={opening}>
          {opening ? <ArcadeLoadingDots /> : <MessageSquare size={14} />}
          Message
        </ArcadeButton>
      </div>
    </div>
  );
}
