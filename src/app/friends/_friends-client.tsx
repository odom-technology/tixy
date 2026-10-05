'use client';

import {
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Check,
  Clock,
  MessageSquare,
  Search,
  UserMinus,
  UserPlus,
  Users,
  X,
} from 'lucide-react';

import {
  ArcadeButton,
  ArcadeInput,
  ArcadeNotice,
  ArcadeStat,
} from '@/features/arcade/components/ui/arcade-ui';
import { AppPageFrame } from '@/features/arcade/components/shell/page-frame';
import { PresenceDot, PresenceLabel } from '@/features/social/presence/presence-indicator';
import { ProfileAvatar } from '@/features/users/components/profile-avatar';
import { ArcadeLoading, ArcadeLoadingDots } from '@/features/arcade/components/ui/arcade-states';

type FriendSummary = {
  friendshipId: string;
  userId: string;
  name: string;
  imageUrl: string | null;
  requestedAt: number;
};

type FriendPayload = {
  friends?: FriendSummary[];
  incoming?: FriendSummary[];
  outgoing?: FriendSummary[];
  error?: string;
};

type FriendAction = 'accept' | 'decline' | 'remove';

const panelClass = 'arcade-card p-5';

function formatDate(timestamp: number) {
  if (!timestamp) return '';
  return new Intl.DateTimeFormat('en', {
    dateStyle: 'medium',
  }).format(new Date(timestamp));
}

function profileHref(friend: FriendSummary) {
  return `/u/${encodeURIComponent(friend.userId)}`;
}

async function readFriendPayload(response: Response) {
  const payload = (await response.json().catch(() => ({}))) as FriendPayload;
  if (!response.ok) throw new Error(payload.error || 'Request failed.');
  return payload;
}

export function FriendsClient() {
  const [friends, setFriends] = useState<FriendSummary[]>([]);
  const [incoming, setIncoming] = useState<FriendSummary[]>([]);
  const [outgoing, setOutgoing] = useState<FriendSummary[]>([]);
  const [lookup, setLookup] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [actionId, setActionId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const totalPending = incoming.length + outgoing.length;
  const sortedFriends = useMemo(
    () => [...friends].sort((a, b) => a.name.localeCompare(b.name)),
    [friends],
  );

  const applyPayload = useCallback((payload: FriendPayload) => {
    setFriends(payload.friends ?? []);
    setIncoming(payload.incoming ?? []);
    setOutgoing(payload.outgoing ?? []);
  }, []);

  const loadFriends = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      applyPayload(
        await readFriendPayload(await fetch('/api/friends', { cache: 'no-store' })),
      );
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setLoading(false);
    }
  }, [applyPayload]);

  useEffect(() => {
    void loadFriends();
  }, [loadFriends]);

  const submitRequest = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = lookup.trim();
    if (!value) return;
    setSubmitting(true);
    setNotice(null);
    setError(null);
    try {
      applyPayload(
        await readFriendPayload(
          await fetch('/api/friends', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lookup: value }),
          }),
        ),
      );
      setLookup('');
      setNotice('Friend request updated.');
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const startConversation = async (targetUserId: string) => {
    setNotice(null);
    setError(null);
    try {
      const response = await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetUserId }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        conversationId?: string;
        error?: string;
      };
      if (response.ok && data.conversationId) {
        router.push(`/social?view=dm&c=${data.conversationId}`);
      } else {
        setError(data.error || 'Unable to open conversation.');
      }
    } catch {
      setError('Unable to open conversation.');
    }
  };

  const updateFriendship = async (friendshipId: string, action: FriendAction) => {
    setActionId(friendshipId);
    setNotice(null);
    setError(null);
    try {
      applyPayload(
        await readFriendPayload(
          await fetch('/api/friends', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ friendshipId, action }),
          }),
        ),
      );
      setNotice(
        action === 'accept'
          ? 'Friend request accepted.'
          : action === 'decline'
            ? 'Friend request declined.'
            : 'Friend removed.',
      );
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setActionId(null);
    }
  };

  return (
    <AppPageFrame
      eyebrow='Crew'
      title={
        <span className='flex items-center gap-3'>
          <Users size={28} />
          Crew Lobby
        </span>
      }
      subtitle='Manage the players you can invite straight into multiplayer games.'
      contentClassName='space-y-6'
    >
        <section className='grid gap-4 md:grid-cols-3'>
          <SummaryTile label='Crew' value={friends.length} />
          <SummaryTile label='Incoming' value={incoming.length} />
          <SummaryTile label='Open Invites' value={totalPending} />
        </section>

        <form onSubmit={submitRequest} className={`${panelClass} grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]`}>
          <label className='block'>
            <span className='text-sm font-medium text-faint'>Player lookup</span>
            <ArcadeInput
              icon={<Search size={16} />}
              wrapClassName='mt-2'
              value={lookup}
              onChange={(event) => setLookup(event.target.value)}
              placeholder='Email or username'
            />
          </label>
          <ArcadeButton
            type='submit'
            tone='primary'
            disabled={submitting || !lookup.trim()}
            className='self-end'
          >
            {submitting ? <ArcadeLoadingDots /> : <UserPlus size={16} />}
            Invite player
          </ArcadeButton>
        </form>

        {notice ? <ArcadeNotice tone='success'>{notice}</ArcadeNotice> : null}
        {error ? <ArcadeNotice tone='danger'>{error}</ArcadeNotice> : null}

        <div className='grid gap-5 lg:grid-cols-[1.2fr_0.8fr]'>
          <section className={`${panelClass} space-y-3`}>
            <SectionTitle icon={<Users size={18} />} title='Crew' />
            {loading ? (
              <LoadingState />
            ) : sortedFriends.length > 0 ? (
              sortedFriends.map((friend) => (
                <FriendRow
                  key={friend.friendshipId}
                  friend={friend}
                  busy={actionId === friend.friendshipId}
                  showPresence
                  actions={
                    <>
                      <ArcadeButton
                        type='button'
                        onClick={() => void startConversation(friend.userId)}
                      >
                        <MessageSquare size={14} />
                        Message
                      </ArcadeButton>
                      <ArcadeButton
                        type='button'
                        tone='danger'
                        onClick={() => void updateFriendship(friend.friendshipId, 'remove')}
                        disabled={actionId === friend.friendshipId}
                      >
                        {actionId === friend.friendshipId ? (
                          <ArcadeLoadingDots />
                        ) : (
                          <UserMinus size={14} />
                        )}
                        Remove
                      </ArcadeButton>
                    </>
                  }
                />
              ))
            ) : (
              <EmptyState text='No crew members yet.' />
            )}
          </section>

          <section className='space-y-5'>
            <div className={`${panelClass} space-y-3`}>
              <SectionTitle icon={<Clock size={18} />} title='Incoming invites' />
              {loading ? (
                <LoadingState />
              ) : incoming.length > 0 ? (
                incoming.map((friend) => (
                  <FriendRow
                    key={friend.friendshipId}
                    friend={friend}
                    busy={actionId === friend.friendshipId}
                    actions={
                      <div className='flex gap-2'>
                        <ArcadeButton
                          type='button'
                          tone='success'
                          onClick={() => void updateFriendship(friend.friendshipId, 'accept')}
                          disabled={actionId === friend.friendshipId}
                          className='h-9 w-9 p-0'
                          aria-label='Accept friend request'
                        >
                          {actionId === friend.friendshipId ? (
                            <ArcadeLoadingDots />
                          ) : (
                            <Check size={16} />
                          )}
                        </ArcadeButton>
                        <ArcadeButton
                          type='button'
                          onClick={() => void updateFriendship(friend.friendshipId, 'decline')}
                          disabled={actionId === friend.friendshipId}
                          className='h-9 w-9 p-0'
                          aria-label='Decline friend request'
                        >
                          <X size={16} />
                        </ArcadeButton>
                      </div>
                    }
                  />
                ))
              ) : (
                <EmptyState text='No incoming invites.' />
              )}
            </div>

            <div className={`${panelClass} space-y-3`}>
              <SectionTitle icon={<Clock size={18} />} title='Sent invites' />
              {loading ? (
                <LoadingState />
              ) : outgoing.length > 0 ? (
                outgoing.map((friend) => (
                  <FriendRow
                    key={friend.friendshipId}
                    friend={friend}
                    busy={actionId === friend.friendshipId}
                    actions={
                      <ArcadeButton
                        type='button'
                        onClick={() => void updateFriendship(friend.friendshipId, 'remove')}
                        disabled={actionId === friend.friendshipId}
                      >
                        Cancel
                      </ArcadeButton>
                    }
                  />
                ))
              ) : (
                <EmptyState text='No sent invites.' />
              )}
            </div>
          </section>
        </div>
    </AppPageFrame>
  );
}

function SummaryTile({ label, value }: { label: string; value: number }) {
  return <ArcadeStat label={label} value={value} />;
}

function SectionTitle({ icon, title }: { icon: ReactNode; title: string }) {
  return (
    <h2 className='flex items-center gap-2 text-lg font-semibold'>
      <span className='text-primary-text'>{icon}</span>
      {title}
    </h2>
  );
}

function FriendRow({
  friend,
  actions,
  showPresence = false,
}: {
  friend: FriendSummary;
  busy: boolean;
  actions: ReactNode;
  showPresence?: boolean;
}) {
  return (
    <div className='arcade-card-inset flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between'>
      <Link href={profileHref(friend)} className='flex min-w-0 items-center gap-3'>
        <ProfileAvatar name={friend.name} imageUrl={friend.imageUrl} size='md' />
        <span className='min-w-0'>
          <span className='flex items-center gap-2'>
            {showPresence ? <PresenceDot userId={friend.userId} /> : null}
            <span className='block truncate text-sm font-semibold text-strong'>
              {friend.name}
            </span>
          </span>
          {showPresence ? (
            <PresenceLabel userId={friend.userId} />
          ) : (
            <span className='block text-xs text-faint'>
              {formatDate(friend.requestedAt)}
            </span>
          )}
        </span>
      </Link>
      <div className='flex shrink-0 items-center gap-2'>{actions}</div>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className='arcade-card-inset px-4 py-6 text-center text-sm text-faint'>
      {text}
    </div>
  );
}

function LoadingState() {
  return (
    <div className='arcade-card-inset flex items-center justify-center px-4 py-6 text-sm text-faint'>
      <ArcadeLoading label='Loading your friends.' />
    </div>
  );
}
