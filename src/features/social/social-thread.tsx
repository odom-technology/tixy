'use client';

import Link from 'next/link';
import {
  ArrowLeft,
  Flag,
  MoreHorizontal,
  Send,
  ShieldBan,
  Trash2,
  UsersRound,
} from 'lucide-react';
import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react';

import { ArcadeButton, ArcadeNotice } from '@/features/arcade/components/ui/arcade-ui';
import { ProfileAvatar } from '@/features/users/components/profile-avatar';
import { subscribeLive } from '@/lib/liveEvents';

import { ChallengeButton } from './challenge-button';
import { useFriendPresence } from './presence/presence-client';
import { presenceLine } from './presence-line';
import { useSocial } from './social-provider';
import type { SocialMessage, SocialThreadTarget } from './social-types';
import { ArcadeLoading, ArcadeLoadingDots } from '@/features/arcade/components/ui/arcade-states';

function formatMessageTime(timestamp: number) {
  return new Intl.DateTimeFormat('en', {
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(timestamp));
}

export function SocialThread({
  target,
  onBack,
}: {
  target: SocialThreadTarget;
  onBack: () => void;
}) {
  const { snapshot, refresh, setLobbyRead } = useSocial();
  const [messages, setMessages] = useState<SocialMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [menuId, setMenuId] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const isLobby = target.kind === 'lobby';
  const conversation = snapshot?.conversations.find((item) => item.id === target.id);
  const other = conversation?.otherMembers[0] ?? null;

  const load = useCallback(async () => {
    try {
      const endpoint = isLobby ? '/api/social/lobby?limit=100' : `/api/messages/${target.id}`;
      const response = await fetch(endpoint, { cache: 'no-store' });
      const payload = (await response.json().catch(() => ({}))) as {
        messages?: SocialMessage[];
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error || 'Unable to load messages.');
      setMessages(payload.messages ?? []);
      setError(null);
      if (isLobby) {
        setLobbyRead();
        void fetch('/api/social/lobby/read', { method: 'POST' });
      } else {
        void fetch(`/api/messages/${target.id}/read`, { method: 'POST' }).then(() => refresh());
      }
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setLoading(false);
    }
  }, [isLobby, refresh, setLobbyRead, target.id]);

  useEffect(() => {
    setLoading(true);
    setMessages([]);
    void load();
  }, [load]);

  useEffect(() => {
    const topic = isLobby ? 'social:lobby' : `dm:${target.id}`;
    return subscribeLive([topic], (payload) => {
      if (payload.type === 'message_updated') void load();
    });
  }, [isLobby, load, target.id]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages]);

  const sendMessage = async (event: FormEvent) => {
    event.preventDefault();
    const content = draft.trim();
    if (!content || sending) return;
    setSending(true);
    setError(null);
    try {
      const endpoint = isLobby ? '/api/social/lobby' : `/api/messages/${target.id}`;
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        message?: SocialMessage;
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error || 'Unable to send message.');
      setDraft('');
      if (payload.message) {
        setMessages((current) =>
          current.some((message) => message.id === payload.message?.id)
            ? current
            : [
                ...current,
                {
                  ...payload.message!,
                  senderImageUrl:
                    payload.message!.senderImageUrl ?? snapshot?.currentUser.imageUrl ?? null,
                },
              ],
        );
      }
      void refresh();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setSending(false);
    }
  };

  const moderate = async (
    action: 'report' | 'block' | 'remove-message',
    message: SocialMessage,
  ) => {
    setMenuId(null);
    setError(null);
    try {
      const response = await fetch('/api/social/moderation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          messageId: message.id,
          targetUserId: message.senderUserId,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(payload.error || 'Unable to update this message.');
      await load();
      if (action === 'block') await refresh();
      if (action === 'report') setError('Thanks. The message was reported for review.');
    } catch (caught) {
      setError((caught as Error).message);
    }
  };

  const title = isLobby ? 'the lobby' : other?.name ?? 'chat';

  return (
    <div className='tp flex h-full min-h-0 flex-col'>
      <header className='tp-dock-head' style={{ padding: '4px 14px 10px 8px', flexWrap: 'wrap' }}>
        <button type='button' className='tp-btn' data-tone='bare' data-size='icon' onClick={onBack} aria-label='back to social'>
          <ArrowLeft size={18} strokeWidth={2} strokeLinecap='square' aria-hidden />
        </button>
        {isLobby ? (
          <span className='arc-avatar inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full' style={{ background: 'var(--tixy-ink)', color: 'var(--tixy-paper)' }}>
            <UsersRound size={17} strokeWidth={2} strokeLinecap='square' aria-hidden />
          </span>
        ) : other ? (
          <Link href={`/u/${encodeURIComponent(other.userId)}`} className='inline-flex rounded-full' aria-label={`${other.name}'s profile`}>
            <ProfileAvatar name={other.name} imageUrl={other.imageUrl} size='sm' />
          </Link>
        ) : null}
        <div className='tp-row-main'>
          <strong>{title}</strong>
          <small>{isLobby ? 'Everyone signed in. Slow mode is on.' : other ? <OtherLine userId={other.userId} /> : 'Friends only.'}</small>
        </div>
        {!isLobby && other ? <ChallengeButton userId={other.userId} name={other.name} /> : null}
      </header>

      <div className='min-h-0 flex-1 space-y-2 overflow-y-auto p-3' aria-live='polite'>
        {loading ? (
          <div className='flex h-full items-center justify-center text-sm text-faint'>
            <ArcadeLoading label='Loading messages.' />
          </div>
        ) : messages.length === 0 ? (
          <div className='flex h-full flex-col items-center justify-center px-6 text-center'>
            <p className='text-sm font-semibold text-strong'>No messages yet.</p>
            <p className='mt-1 text-xs leading-5 text-faint'>
              {isLobby ? 'Say hello to everyone on the floor.' : 'Say hello.'}
            </p>
          </div>
        ) : (
          messages.map((message, index) => {
            const mine = message.senderUserId === snapshot?.currentUser.userId;
            const showIdentity = isLobby && !mine;
            return (
              <div
                key={message.id}
                className={`arc-list-enter group flex gap-2 ${mine ? 'justify-end' : 'justify-start'}`}
                style={{ '--i': Math.min(index, 8) } as React.CSSProperties}
              >
                {showIdentity ? (
                  <Link href={`/u/${encodeURIComponent(message.senderUserId)}`} className='mt-4 shrink-0'>
                    <ProfileAvatar name={message.senderName} imageUrl={message.senderImageUrl ?? null} size='xs' />
                  </Link>
                ) : null}
                <div className={`relative max-w-[82%] ${mine ? 'items-end' : 'items-start'} flex flex-col`}>
                  {showIdentity ? (
                    <span className='mb-0.5 px-1 text-[10px] font-semibold text-faint'>{message.senderName}</span>
                  ) : null}
                  <div className='flex items-end gap-1'>
                    {!mine && isLobby && !message.deletedAt ? (
                      <div className='relative'>
                        <button
                          type='button'
                          onClick={() => setMenuId((current) => current === message.id ? null : message.id)}
                          className='rounded-full p-1 text-faint opacity-0 transition hover:bg-raised hover:text-strong group-hover:opacity-100 focus:opacity-100'
                          aria-label={`Actions for ${message.senderName}'s message`}
                        >
                          <MoreHorizontal size={14} />
                        </button>
                        {menuId === message.id ? (
                          <div className='arc-enter-scale absolute bottom-7 left-0 z-20 w-36 rounded-key border-2 border-ink bg-panel p-1 shadow-float'>
                            <button type='button' onClick={() => void moderate('report', message)} className='flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-body hover:bg-raised'>
                              <Flag size={13} /> report
                            </button>
                            <button type='button' onClick={() => void moderate('block', message)} className='flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-body hover:bg-raised'>
                              <ShieldBan size={13} /> block
                            </button>
                            {snapshot?.currentUser.isAdmin ? (
                              <button type='button' onClick={() => void moderate('remove-message', message)} className='flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-danger-text hover:bg-raised'>
                                <Trash2 size={13} /> remove
                              </button>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                    <div className={`rounded-2xl px-3 py-2 text-sm leading-5 ${message.deletedAt ? 'border border-dashed border-soft bg-transparent italic text-faint' : mine ? 'rounded-br-md bg-primary text-primary-on shadow-chip' : 'rounded-bl-md bg-raised text-strong'}`}>
                      {message.content}
                    </div>
                  </div>
                  <span className='mt-0.5 px-1 text-[9px] text-faint'>{formatMessageTime(message.createdAt)}</span>
                </div>
              </div>
            );
          })
        )}
        <div ref={endRef} />
      </div>

      <div className='border-t border-soft bg-panel p-2.5'>
        {error ? <ArcadeNotice tone={error.startsWith('Thanks') ? 'info' : 'danger'} className='mb-2 text-xs'>{error}</ArcadeNotice> : null}
        <form onSubmit={sendMessage} className='flex items-center gap-2'>
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            maxLength={200}
            placeholder={isLobby ? 'message the lobby' : `message ${title}`}
            className='arcade-input min-w-0 flex-1 px-3 py-2 text-sm'
            aria-label='Message'
          />
          <ArcadeButton type='submit' tone='primary' size='icon-sm' disabled={sending || !draft.trim()} aria-label='send'>
            {sending ? <ArcadeLoadingDots /> : <Send size={15} />}
          </ArcadeButton>
        </form>
      </div>
    </div>
  );
}

function OtherLine({ userId }: { userId: string }) {
  return <>{presenceLine(useFriendPresence(userId))}</>;
}
