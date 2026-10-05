'use client';

/* What you can do with another player, wherever they show up: add them,
   answer their request, or (once you are friends) challenge them to a game
   in one tap and message them. Removing a friend asks once. */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { MessageCircle, UserMinus, X } from 'lucide-react';

import { SoundManager } from '@/features/arcade/lib/sound-manager';
import { useOptionalSocial } from '@/features/social/social-provider';

import { ChallengeButton } from './challenge-button';

import './tixy-people.css';

export type FriendRelationship =
  | { status: 'none' }
  | { status: 'self' }
  | { status: 'friends'; friendshipId: string }
  | { status: 'incoming'; friendshipId: string }
  | { status: 'outgoing'; friendshipId: string };

type FriendPayload = {
  friendship?: {
    id?: string;
    requesterUserId?: string;
    recipientUserId?: string;
    status?: 'pending' | 'accepted';
  };
  conversationId?: string;
  error?: string;
};

const ICON = { size: 16, strokeWidth: 2, strokeLinecap: 'square' as const, 'aria-hidden': true };

function relationshipFromFriendship(
  friendship: FriendPayload['friendship'],
  currentUserId: string,
): FriendRelationship {
  if (!friendship?.id) return { status: 'none' };
  if (friendship.status === 'accepted') {
    return { status: 'friends', friendshipId: friendship.id };
  }
  if (friendship.recipientUserId === currentUserId) {
    return { status: 'incoming', friendshipId: friendship.id };
  }
  return { status: 'outgoing', friendshipId: friendship.id };
}

async function readPayload(response: Response) {
  const payload = (await response.json().catch(() => ({}))) as FriendPayload;
  if (!response.ok) throw new Error(payload.error || 'That did not go through.');
  return payload;
}

export function FriendActionBar({
  currentUserId,
  targetUserId,
  targetName,
  viewerKind,
  initialRelationship,
  profileHref,
  compact = false,
  onChange,
}: {
  currentUserId: string | null;
  targetUserId: string;
  targetName: string;
  viewerKind: 'account' | 'guest' | 'visitor';
  initialRelationship: FriendRelationship;
  profileHref: string;
  /** In a list row: only the one main button, and message as an icon. */
  compact?: boolean;
  /** After an add, accept, decline or remove went through. */
  onChange?: (relationship: FriendRelationship) => void;
}) {
  const router = useRouter();
  const social = useOptionalSocial();
  const [relationship, setRelationship] = useState(initialRelationship);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setRelationship(initialRelationship), [initialRelationship]);

  const settle = (next: FriendRelationship) => {
    setRelationship(next);
    onChange?.(next);
    void social?.refresh();
  };

  const run = async (key: string, task: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    try {
      await task();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const sendRequest = () =>
    run('add', async () => {
      if (!currentUserId) return;
      const payload = await readPayload(
        await fetch('/api/friends', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ targetUserId }),
        }),
      );
      settle(relationshipFromFriendship(payload.friendship, currentUserId));
    });

  const updateFriendship = (action: 'accept' | 'decline' | 'remove') =>
    run(action, async () => {
      if (relationship.status !== 'friends' && relationship.status !== 'incoming' && relationship.status !== 'outgoing') return;
      if (action === 'accept') SoundManager.play('boardSelect', { volume: 0.5 });
      await readPayload(
        await fetch('/api/friends', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ friendshipId: relationship.friendshipId, action }),
        }),
      );
      setConfirmRemove(false);
      settle(action === 'accept' ? { status: 'friends', friendshipId: relationship.friendshipId } : { status: 'none' });
    });

  const startConversation = () =>
    run('message', async () => {
      if (social) {
        const conversationId = await social.openConversation(targetUserId);
        if (!window.matchMedia('(min-width: 640px)').matches) {
          router.push(`/social?view=dm&c=${encodeURIComponent(conversationId)}`);
        }
        return;
      }
      const payload = await readPayload(
        await fetch('/api/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ targetUserId }),
        }),
      );
      if (!payload.conversationId) throw new Error('That chat did not open.');
      router.push(`/social?view=dm&c=${payload.conversationId}`);
    });

  if (relationship.status === 'self') return null;

  let controls: React.ReactNode;
  if (viewerKind !== 'account') {
    controls = (
      <Link href={`/signin?next=${encodeURIComponent(profileHref)}`} className='tp-btn' data-size='sm'>
        <span>sign in to add</span>
      </Link>
    );
  } else if (relationship.status === 'friends') {
    controls = (
      <>
        <ChallengeButton userId={targetUserId} name={targetName} />
        {compact ? (
          <button type='button' className='tp-btn' data-tone='bare' data-size='icon' disabled={busy === 'message'} onClick={() => void startConversation()} aria-label={`message ${targetName}`}>
            <MessageCircle {...ICON} />
          </button>
        ) : (
          <>
            <button type='button' className='tp-btn' data-tone='quiet' data-size='sm' disabled={busy === 'message'} onClick={() => void startConversation()}>
              <MessageCircle {...ICON} />
              <span>message</span>
            </button>
            {confirmRemove ? (
              <>
                <button type='button' className='tp-btn' data-tone='danger' data-size='sm' data-busy={busy === 'remove' || undefined} disabled={busy === 'remove'} onClick={() => void updateFriendship('remove')}>
                  <span>remove friend</span>
                </button>
                <button type='button' className='tp-btn' data-tone='bare' data-size='sm' onClick={() => setConfirmRemove(false)}>
                  <span>keep</span>
                </button>
              </>
            ) : (
              <button type='button' className='tp-btn' data-tone='bare' data-size='icon' onClick={() => setConfirmRemove(true)} aria-label={`remove ${targetName} as a friend`}>
                <UserMinus {...ICON} />
              </button>
            )}
          </>
        )}
      </>
    );
  } else if (relationship.status === 'incoming') {
    controls = (
      <>
        <button type='button' className='tp-btn' data-size='sm' data-busy={busy === 'accept' || undefined} disabled={busy != null} onClick={() => void updateFriendship('accept')} aria-label={`accept ${targetName}`}>
          <span>accept</span>
        </button>
        {compact ? (
          <button type='button' className='tp-btn' data-tone='bare' data-size='icon' disabled={busy != null} onClick={() => void updateFriendship('decline')} aria-label={`decline ${targetName}`}>
            <X {...ICON} />
          </button>
        ) : (
          <button type='button' className='tp-btn' data-tone='quiet' data-size='sm' disabled={busy != null} onClick={() => void updateFriendship('decline')} aria-label={`decline ${targetName}`}>
            <span>decline</span>
          </button>
        )}
      </>
    );
  } else if (relationship.status === 'outgoing') {
    controls = (
      <button type='button' className='tp-btn' data-tone='quiet' data-size='sm' disabled={busy === 'remove'} onClick={() => void updateFriendship('remove')} aria-label={`cancel friend request to ${targetName}`}>
        <span>{compact ? 'sent' : 'cancel request'}</span>
      </button>
    );
  } else {
    controls = (
      <button type='button' className='tp-btn' data-size='sm' data-busy={busy === 'add' || undefined} disabled={busy === 'add'} onClick={() => void sendRequest()} aria-label={`add ${targetName} as a friend`}>
        <span>{busy === 'add' ? 'adding' : compact ? 'add' : 'add friend'}</span>
      </button>
    );
  }

  return (
    <div className='tp-row-actions' style={{ flexWrap: 'wrap', justifyContent: 'flex-end' }}>
      {controls}
      {error ? (
        <p role='alert' className='tp-error' style={{ flexBasis: '100%', margin: 0, textAlign: 'right' }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
