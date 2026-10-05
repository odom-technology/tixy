'use client';

import { useRouter } from 'next/navigation';
import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { Check } from 'lucide-react';

import { Namecard } from '@/features/users/components/namecard';
import { usePlayerCards } from '@/features/users/use-player-cards';
import { ArcadeButton, ArcadeAnchorButton } from '@/features/arcade/components/ui/arcade-ui';
import type {
  MultiplayerGameType,
  MultiplayerPlayMode,
  MultiplayerTargetKind,
} from '@/server/arcade/multiplayer';
import { useOptionalSocial } from '@/features/social/social-provider';
import { ArcadeLoadingDots } from '@/features/arcade/components/ui/arcade-states';

import './multiplayer-lobby.css';

export type MultiplayerFriendSummary = {
  friendshipId: string;
  userId: string;
  name: string;
  imageUrl: string | null;
  requestedAt: number;
};

export type MultiplayerInviteResult = {
  matchId?: string;
  targetKind?: MultiplayerTargetKind;
  targetId?: string;
  tableId?: string;
  openHref?: string;
  invite?: {
    code: string;
    href: string;
    url?: string;
    targetKind?: MultiplayerTargetKind;
    targetId?: string;
    targetHref?: string;
    targetUrl?: string;
    tableId?: string;
  };
};

type FriendPayload = {
  friends?: MultiplayerFriendSummary[];
  incoming?: MultiplayerFriendSummary[];
  outgoing?: MultiplayerFriendSummary[];
  error?: string;
};

type Props = {
  gameType: MultiplayerGameType;
  gameName: string;
  inviteSettings?: ReactNode;
  codeSettings?: ReactNode;
  onInviteFriend: (targetUserId: string) => Promise<MultiplayerInviteResult | void>;
  onCreateCodeInvite: () => Promise<MultiplayerInviteResult | void>;
  onJoinMatch: (matchId: string, inviteCode?: string) => Promise<void> | void;
  playMode?: MultiplayerPlayMode;
  targetLabel?: string;
  disabled?: boolean;
  className?: string;
};

export function MultiplayerSetupPanel({
  gameType,
  inviteSettings,
  codeSettings,
  onInviteFriend,
  onCreateCodeInvite,
  onJoinMatch,
  playMode = 'versus',
  targetLabel,
  disabled = false,
  className,
}: Props) {
  const router = useRouter();
  const [friends, setFriends] = useState<MultiplayerFriendSummary[]>([]);
  const [selectedFriendId, setSelectedFriendId] = useState('');
  const [friendLoading, setFriendLoading] = useState(true);
  const [inviteSubmitting, setInviteSubmitting] = useState(false);
  const [codeSubmitting, setCodeSubmitting] = useState(false);
  const [joinCode, setJoinCode] = useState('');
  const [joinSubmitting, setJoinSubmitting] = useState(false);
  const [createdInvite, setCreatedInvite] = useState<MultiplayerInviteResult | null>(null);
  const [copied, setCopied] = useState<'code' | 'link' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const social = useOptionalSocial();
  const socialSnapshot = social?.snapshot;

  const selectedFriend = useMemo(
    () => friends.find((friend) => friend.userId === selectedFriendId) ?? null,
    [friends, selectedFriendId],
  );

  // Equipped namecard cosmetics (background/frame/badge/name color/title) for
  // every visible friend so each preview/request row shows their full identity.
  const friendCards = usePlayerCards([
    ...friends.map((friend) => friend.userId),
  ]);

  const applyFriendPayload = useCallback((payload: FriendPayload) => {
    setFriends(payload.friends ?? []);
  }, []);

  const loadFriends = useCallback(async () => {
    if (socialSnapshot) {
      setFriends(socialSnapshot.friends);
      setFriendLoading(false);
      return;
    }
    setFriendLoading(true);
    try {
      const res = await fetch('/api/friends', { cache: 'no-store' });
      const payload = (await res.json()) as FriendPayload;
      if (!res.ok) throw new Error(payload.error || 'Your friends did not load. Try again.');
      applyFriendPayload(payload);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setFriendLoading(false);
    }
  }, [applyFriendPayload, socialSnapshot]);

  useEffect(() => {
    void loadFriends();
  }, [loadFriends]);

  useEffect(() => {
    if (friends.length === 0) {
      setSelectedFriendId('');
      return;
    }
    if (!friends.some((friend) => friend.userId === selectedFriendId)) {
      setSelectedFriendId(friends[0].userId);
    }
  }, [friends, selectedFriendId]);

  const inviteFriend = async () => {
    if (!selectedFriend) return;
    setInviteSubmitting(true);
    setError(null);
    try {
      await onInviteFriend(selectedFriend.userId);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setInviteSubmitting(false);
    }
  };

  const createCodeInvite = async () => {
    setCodeSubmitting(true);
    setError(null);
    try {
      const result = await onCreateCodeInvite();
      if (result && 'invite' in result && result.invite) {
        setCreatedInvite(result);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCodeSubmitting(false);
    }
  };

  const resolveAndJoinCode = async () => {
    const code = joinCode.trim();
    if (!code) return;
    setJoinSubmitting(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/games/multiplayer/code?gameType=${encodeURIComponent(gameType)}&code=${encodeURIComponent(code)}`,
        { cache: 'no-store' },
      );
      const payload = (await res.json()) as {
        invite?: {
          code: string;
          matchId?: string;
          targetId?: string;
          tableId?: string;
        };
        error?: string;
      };
      if (!res.ok || !payload.invite) {
        throw new Error(payload.error || 'No game has that code.');
      }
      const targetId =
        payload.invite.targetId ?? payload.invite.tableId ?? payload.invite.matchId;
      if (!targetId) throw new Error('That game is over.');
      await onJoinMatch(targetId, payload.invite.code);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setJoinSubmitting(false);
    }
  };

  const copyValue = async (value: string, kind: 'code' | 'link') => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(kind);
      window.setTimeout(() => setCopied(null), 1400);
    } catch {
      setError('Copying is blocked here. Select the link and copy it.');
    }
  };

  const createdInviteDetails = createdInvite?.invite ?? null;
  const targetNoun = targetLabel ?? (playMode === 'shared-table' ? 'Table' : 'Match');
  const createdTargetId =
    createdInvite?.targetId ?? createdInvite?.tableId ?? createdInvite?.matchId ?? null;
  const createdTargetHref = createdInvite
    ? createdInvite.openHref ??
      createdInviteDetails?.targetHref ??
      (gameType === 'chess' && createdInvite.matchId
        ? `/chess/${createdInvite.matchId}`
        : gameType === '8-ball' && createdInvite.matchId
          ? `/8-ball/${createdInvite.matchId}`
          : createdTargetId
            ? `/21?table=${encodeURIComponent(createdTargetId)}`
            : null)
    : null;
  const createCodeLabel =
    playMode === 'shared-table'
      ? `create ${targetNoun.toLowerCase()} code`
      : 'create code';

  return (
    <div className={['ml-dialog', className].filter(Boolean).join(' ')}>
      <section className='ml-card'>
        <h3>
          {playMode === 'shared-table' ? 'players' : 'friends'}
          <ArcadeButton
            tone='ghost'
            size='sm'
            onClick={() => {
              if (social && window.matchMedia('(min-width: 640px)').matches) social.setDockOpen(true);
              else router.push('/social?tab=friends');
            }}
          >
            find friends
          </ArcadeButton>
        </h3>

        <div className='ml-field'>
          <select
            value={selectedFriendId}
            aria-label='friend'
            onChange={(event) => setSelectedFriendId(event.target.value)}
            disabled={disabled || friendLoading || friends.length === 0}
            className='arcade-input min-w-0 px-3 disabled:opacity-60'
          >
            <option value=''>
              {friendLoading
                ? 'Loading friends.'
                : friends.length > 0
                  ? 'pick a friend'
                  : 'no friends yet'}
            </option>
            {friends.map((friend) => (
              <option key={friend.userId} value={friend.userId}>
                {friend.name}
              </option>
            ))}
          </select>
          <ArcadeButton
            tone='primary'
            onClick={() => void inviteFriend()}
            disabled={disabled || inviteSubmitting || !selectedFriend}
          >
            {inviteSubmitting ? <ArcadeLoadingDots /> : null}
            invite
          </ArcadeButton>
        </div>

        {selectedFriend && (
          <Namecard
            size='sm'
            cosmetics={{
              name: selectedFriend.name,
              avatarUrl: selectedFriend.imageUrl,
              flair: friendCards[selectedFriend.userId]?.flair,
            }}
          />
        )}

        {inviteSettings ? <div>{inviteSettings}</div> : null}
      </section>

      <section className='ml-card'>
        <h3>code or link</h3>

        {codeSettings ? <div>{codeSettings}</div> : null}

        <ArcadeButton onClick={() => void createCodeInvite()} disabled={disabled || codeSubmitting}>
          {codeSubmitting ? <ArcadeLoadingDots /> : null}
          {createCodeLabel}
        </ArcadeButton>

        {createdInviteDetails && (
          <div className='ml-code'>
            <div className='ml-code-row'>
              <span
                className='ml-code-value'
                aria-label={`code ${createdInviteDetails.code.split('').join(' ')}`}
              >
                {createdInviteDetails.code}
              </span>
              <ArcadeButton size='sm' onClick={() => void copyValue(createdInviteDetails.code, 'code')}>
                {copied === 'code' ? <Check size={14} strokeLinecap='square' aria-hidden /> : null}
                {copied === 'code' ? 'copied' : 'copy code'}
              </ArcadeButton>
            </div>
            <div className='ml-field'>
              <input
                readOnly
                aria-label='invite link'
                value={createdInviteDetails.url ?? createdInviteDetails.href}
                className='arcade-input min-w-0 px-3'
              />
              <ArcadeButton
                size='sm'
                onClick={() => void copyValue(createdInviteDetails.url ?? createdInviteDetails.href, 'link')}
              >
                {copied === 'link' ? <Check size={14} strokeLinecap='square' aria-hidden /> : null}
                {copied === 'link' ? 'copied' : 'copy link'}
              </ArcadeButton>
            </div>
            {createdTargetHref && (
              <ArcadeAnchorButton href={createdTargetHref} tone='primary' className='w-full justify-center'>
                open {targetNoun.toLowerCase()}
              </ArcadeAnchorButton>
            )}
          </div>
        )}

        <div className='ml-field'>
          <input
            type='text'
            value={joinCode}
            aria-label='game code'
            onChange={(event) => setJoinCode(event.target.value.toUpperCase())}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void resolveAndJoinCode();
              }
            }}
            placeholder='code'
            className='arcade-input arcade-num px-3 font-semibold tracking-[0.12em] uppercase placeholder:normal-case'
          />
          <ArcadeButton
            onClick={() => void resolveAndJoinCode()}
            disabled={disabled || joinSubmitting || !joinCode.trim()}
          >
            {joinSubmitting ? <ArcadeLoadingDots /> : null}
            join{playMode === 'shared-table' ? ` ${targetNoun.toLowerCase()}` : ''}
          </ArcadeButton>
        </div>
      </section>

      {error && (
        <p className='ml-error' role='alert'>
          {error}
        </p>
      )}
    </div>
  );
}
