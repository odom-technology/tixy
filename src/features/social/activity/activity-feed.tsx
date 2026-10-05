'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Award, ShoppingBag, Sparkles, Trophy, UserPlus, type LucideIcon } from 'lucide-react';

import { ProfileAvatar } from '@/features/users/components/profile-avatar';
import { subscribeLive } from '@/lib/liveEvents';
import { ArcadeLoading } from '@/features/arcade/components/ui/arcade-states';

type ActivityFeedItem = {
  id: string;
  userId: string;
  name: string;
  imageUrl: string | null;
  type: 'high_score' | 'match_win' | 'achievement' | 'purchase' | 'friend_added';
  payload: Record<string, unknown>;
  createdAt: number;
};

function prettyGame(slug: unknown): string {
  if (typeof slug !== 'string' || !slug) return 'a game';
  return slug
    .split('-')
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
    .join(' ');
}

function relativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d ago`;
  return new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(new Date(timestamp));
}

function describe(event: ActivityFeedItem): { Icon: LucideIcon; text: string } {
  switch (event.type) {
    case 'match_win':
      return { Icon: Trophy, text: `won a ${prettyGame(event.payload.game)} match` };
    case 'high_score':
      return { Icon: Sparkles, text: `set a new high score in ${prettyGame(event.payload.game)}` };
    case 'purchase':
      return { Icon: ShoppingBag, text: `unlocked ${typeof event.payload.itemName === 'string' ? event.payload.itemName : 'a new item'}` };
    case 'achievement':
      return { Icon: Award, text: `earned ${typeof event.payload.title === 'string' ? event.payload.title : 'an achievement'}` };
    case 'friend_added':
    default:
      return { Icon: UserPlus, text: 'made a new friend' };
  }
}

export function ActivityFeed({ currentUserId }: { currentUserId: string }) {
  const [events, setEvents] = useState<ActivityFeedItem[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/social/activity', { cache: 'no-store' });
      if (response.ok) {
        const data = (await response.json()) as { events?: ActivityFeedItem[] };
        setEvents(data.events ?? []);
      }
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(
    () =>
      subscribeLive([`user:${currentUserId}`], (payload) => {
        if (payload.type === 'activity') void load();
      }),
    [currentUserId, load],
  );

  return (
    <section className='arcade-card space-y-3 p-5'>
      <h2 className='text-lg font-semibold'>Friend activity</h2>
      {loading ? (
        <div className='flex items-center justify-center py-6 text-sm text-faint'>
          <ArcadeLoading label='Loading friend activity.' />
        </div>
      ) : events.length === 0 ? (
        <div className='arcade-card-inset px-4 py-6 text-center text-sm text-faint'>
          When your friends play, win, or unlock things, it shows up here.
        </div>
      ) : (
        <ul className='space-y-2'>
          {events.map((event) => {
            const { Icon, text } = describe(event);
            return (
              <li key={event.id} className='arcade-card-inset flex items-center gap-3 p-3'>
                <Link href={`/u/${encodeURIComponent(event.userId)}`} className='shrink-0'>
                  <ProfileAvatar name={event.name} imageUrl={event.imageUrl} size='sm' />
                </Link>
                <span className='min-w-0 flex-1 text-sm'>
                  <Link href={`/u/${encodeURIComponent(event.userId)}`} className='font-semibold text-strong hover:underline'>
                    {event.name}
                  </Link>{' '}
                  <span className='text-body'>{text}</span>
                </span>
                <span className='flex shrink-0 items-center gap-1.5 text-xs text-faint'>
                  <Icon size={14} />
                  {relativeTime(event.createdAt)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
