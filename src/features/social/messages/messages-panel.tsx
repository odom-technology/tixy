'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { MessageSquare, Send } from 'lucide-react';

import { ArcadeButton } from '@/features/arcade/components/ui/arcade-ui';
import { subscribeLive } from '@/lib/liveEvents';
import { ProfileAvatar } from '@/features/users/components/profile-avatar';

import { PresenceDot } from '../presence/presence-indicator';
import { ArcadeLoading, ArcadeLoadingDots } from '@/features/arcade/components/ui/arcade-states';

type OtherMember = { userId: string; name: string; imageUrl: string | null };

type ConversationSummary = {
  id: string;
  gameType: string | null;
  otherMembers: OtherMember[];
  lastMessage: { content: string; type: string; senderUserId: string } | null;
  unreadCount: number;
  muted: boolean;
  updatedAt: number;
};

type Message = {
  id: string;
  conversationId: string;
  senderUserId: string;
  senderName: string;
  type: 'text' | 'reaction' | 'system';
  content: string;
  createdAt: number;
};

function otherOf(conversation: ConversationSummary): OtherMember {
  return conversation.otherMembers[0] ?? { userId: '', name: 'Player', imageUrl: null };
}

export function MessagesPanel({
  currentUserId,
  initialConversationId,
}: {
  currentUserId: string;
  initialConversationId?: string;
}) {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(initialConversationId ?? null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [loadingConversations, setLoadingConversations] = useState(true);
  const [sending, setSending] = useState(false);
  const threadEndRef = useRef<HTMLDivElement | null>(null);

  const loadConversations = useCallback(async () => {
    try {
      const response = await fetch('/api/messages', { cache: 'no-store' });
      if (response.ok) {
        const data = (await response.json()) as { conversations?: ConversationSummary[] };
        setConversations(data.conversations ?? []);
      }
    } catch {
      /* ignore */
    } finally {
      setLoadingConversations(false);
    }
  }, []);

  const loadMessages = useCallback(async (conversationId: string) => {
    try {
      const response = await fetch(`/api/messages/${conversationId}`, { cache: 'no-store' });
      if (response.ok) {
        const data = (await response.json()) as { messages?: Message[] };
        setMessages(data.messages ?? []);
      }
      void fetch(`/api/messages/${conversationId}/read`, { method: 'POST' });
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    if (activeId) void loadMessages(activeId);
  }, [activeId, loadMessages]);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ block: 'end' });
  }, [messages]);

  // Live: re-fetch on a new-message notice for my inbox or the open thread.
  useEffect(() => {
    const topics = [`user:${currentUserId}`];
    if (activeId) topics.push(`dm:${activeId}`);
    return subscribeLive(topics, (payload) => {
      if (payload.type !== 'message_updated') return;
      void loadConversations();
      if (activeId && payload.conversationId === activeId) void loadMessages(activeId);
    });
  }, [activeId, currentUserId, loadConversations, loadMessages]);

  const send = useCallback(async () => {
    const content = draft.trim();
    if (!content || !activeId || sending) return;
    setSending(true);
    try {
      const response = await fetch(`/api/messages/${activeId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      if (response.ok) {
        setDraft('');
        await loadMessages(activeId);
        await loadConversations();
      }
    } finally {
      setSending(false);
    }
  }, [draft, activeId, sending, loadMessages, loadConversations]);

  const activeConversation = conversations.find((conversation) => conversation.id === activeId) ?? null;

  return (
    <div className='grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]'>
      {/* Conversation list */}
      <aside className='arcade-card max-h-[70vh] overflow-y-auto p-2'>
        {loadingConversations ? (
          <div className='flex items-center justify-center p-6 text-sm text-faint'>
            <ArcadeLoading label='Loading your messages.' />
          </div>
        ) : conversations.length === 0 ? (
          <div className='p-6 text-center text-sm text-faint'>
            No conversations yet. Message a friend to start one.
          </div>
        ) : (
          conversations.map((conversation) => {
            const other = otherOf(conversation);
            const active = conversation.id === activeId;
            return (
              <button
                key={conversation.id}
                type='button'
                onClick={() => setActiveId(conversation.id)}
                className={`flex w-full items-center gap-3 rounded-lg p-2 text-left transition ${
                  active ? 'bg-[color:var(--arcade-accent-soft,rgba(255,255,255,0.08))]' : 'hover:bg-white/5'
                }`}
              >
                <span className='relative'>
                  <ProfileAvatar name={other.name} imageUrl={other.imageUrl} size='md' />
                  <span className='absolute -bottom-0.5 -right-0.5'>
                    <PresenceDot userId={other.userId} className='ring-2 ring-black/40' />
                  </span>
                </span>
                <span className='min-w-0 flex-1'>
                  <span className='flex items-center justify-between gap-2'>
                    <span className='truncate text-sm font-semibold text-strong'>{other.name}</span>
                    {conversation.unreadCount > 0 ? (
                      <span className='inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1.5 text-xs font-bold text-white'>
                        {conversation.unreadCount}
                      </span>
                    ) : null}
                  </span>
                  <span className='block truncate text-xs text-faint'>
                    {conversation.lastMessage
                      ? `${conversation.lastMessage.senderUserId === currentUserId ? 'You: ' : ''}${conversation.lastMessage.content}`
                      : 'No messages yet'}
                  </span>
                </span>
              </button>
            );
          })
        )}
      </aside>

      {/* Thread */}
      <section className='arcade-card flex max-h-[70vh] min-h-[420px] flex-col'>
        {!activeConversation && !activeId ? (
          <div className='flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center text-faint'>
            <MessageSquare size={28} />
            <p className='text-sm'>Select a conversation to start chatting.</p>
          </div>
        ) : (
          <>
            <header className='flex items-center gap-3 border-b border-white/10 p-3'>
              {activeConversation ? (
                <>
                  <ProfileAvatar
                    name={otherOf(activeConversation).name}
                    imageUrl={otherOf(activeConversation).imageUrl}
                    size='sm'
                  />
                  <span className='flex items-center gap-2 text-sm font-semibold text-strong'>
                    <PresenceDot userId={otherOf(activeConversation).userId} />
                    {otherOf(activeConversation).name}
                  </span>
                </>
              ) : (
                <span className='text-sm font-semibold text-strong'>Conversation</span>
              )}
            </header>

            <div className='flex-1 space-y-2 overflow-y-auto p-3'>
              {messages.map((message) => {
                const mine = message.senderUserId === currentUserId;
                return (
                  <div key={message.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                    <span
                      className={`max-w-[75%] rounded-2xl px-3 py-1.5 text-sm ${
                        message.type === 'reaction'
                          ? 'text-2xl'
                          : mine
                            ? 'bg-[color:var(--arcade-accent,#3b82f6)] text-white'
                            : 'bg-white/10 text-strong'
                      }`}
                    >
                      {message.content}
                    </span>
                  </div>
                );
              })}
              <div ref={threadEndRef} />
            </div>

            <form
              className='flex items-center gap-2 border-t border-white/10 p-3'
              onSubmit={(event) => {
                event.preventDefault();
                void send();
              }}
            >
              <input
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                maxLength={200}
                placeholder='Type a message…'
                className='min-w-0 flex-1 rounded-full border border-white/10 bg-black/20 px-4 py-2 text-sm text-strong outline-none focus:border-white/30'
              />
              <ArcadeButton type='submit' tone='primary' disabled={sending || !draft.trim()} className='h-10 w-10 p-0'>
                {sending ? <ArcadeLoadingDots /> : <Send size={16} />}
              </ArcadeButton>
            </form>
          </>
        )}
      </section>
    </div>
  );
}
