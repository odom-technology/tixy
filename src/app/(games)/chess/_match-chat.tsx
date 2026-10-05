'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { MessageCircle, Send } from 'lucide-react';
import { ArcadeButton } from '@/features/arcade/components/ui/arcade-ui';
import { subscribeLive } from '@/lib/liveEvents';
import { startVisiblePolling } from '@/features/arcade/lib/visible-polling';

type ChatMessage = {
  id: string;
  matchId: string;
  userId: string;
  userName: string;
  type: 'message' | 'reaction';
  content: string;
  createdAt: number;
};

const REACTION_EMOJIS = ['👏', '😂', '😮', '🔥', '😭', '♟', '💀', '🤝'];
const CHAT_MAX_LENGTH = 200;

type Props = {
  matchId: string;
  userId: string;
  /** If true, the chat is disabled (bot match or chat unavailable). */
  disabled?: boolean;
};

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function MatchChat({ matchId, userId, disabled = false }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [unread, setUnread] = useState(0);
  const [expanded, setExpanded] = useState(() => {
    if (typeof window !== 'undefined' && window.innerWidth >= 1024) return true;
    return false;
  });
  const latestTsRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, []);

  // Initial load
  useEffect(() => {
    if (disabled) return;
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(`/api/games/chess/match/${matchId}/chat`, { cache: 'no-store' });
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { messages?: ChatMessage[] };
        if (cancelled) return;
        if (Array.isArray(data.messages) && data.messages.length > 0) {
          setMessages(data.messages);
          latestTsRef.current = data.messages[data.messages.length - 1].createdAt;
        }
      } catch { /* silent */ }
    };
    void load();
    return () => { cancelled = true; };
  }, [matchId, disabled]);

  // SSE + polling fallback to pick up new messages
  useEffect(() => {
    if (disabled) return;
    const refresh = async () => {
      try {
        const res = await fetch(
          `/api/games/chess/match/${matchId}/chat?since=${latestTsRef.current}`,
          { cache: 'no-store' },
        );
        if (!res.ok) return;
        const data = (await res.json()) as { messages?: ChatMessage[] };
        if (!Array.isArray(data.messages) || data.messages.length === 0) return;
        setMessages((prev) => {
          const existingIds = new Set(prev.map((m) => m.id));
          const additions = data.messages!.filter((m) => !existingIds.has(m.id));
          if (additions.length === 0) return prev;
          latestTsRef.current = additions[additions.length - 1].createdAt;
          const fromOthers = additions.filter((m) => m.userId !== userId).length;
          if (fromOthers > 0 && !expanded) setUnread((n) => n + fromOthers);
          return [...prev, ...additions];
        });
      } catch { /* silent */ }
    };
    // `chessChat` is a site-wide channel; filter by this match's id so we
    // don't refetch every time someone chats in a different match.
    const unsub = subscribeLive(['chessChat'], (payload) => {
      if (payload && payload.matchId && payload.matchId !== matchId) return;
      void refresh();
    });
    const stopPolling = startVisiblePolling(refresh, 5000);
    return () => { unsub(); stopPolling(); };
  }, [matchId, userId, disabled, expanded]);

  // Auto-scroll on new messages or when expanding
  useEffect(() => {
    if (!expanded) return;
    scrollToBottom();
  }, [messages.length, expanded, scrollToBottom]);

  const send = useCallback(async (content: string, type: 'message' | 'reaction' = 'message') => {
    if (sending || disabled) return;
    const trimmed = content.trim();
    if (!trimmed) return;
    setSending(true);
    setSendError(null);
    try {
      const res = await fetch(`/api/games/chess/match/${matchId}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: trimmed, type }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        setSendError(typeof payload.error === 'string' ? payload.error : 'Send failed.');
        return;
      }
      const data = (await res.json()) as { message?: ChatMessage };
      if (data.message) {
        setMessages((prev) => {
          if (prev.some((m) => m.id === data.message!.id)) return prev;
          latestTsRef.current = data.message!.createdAt;
          return [...prev, data.message!];
        });
      }
      if (type === 'message') setDraft('');
    } catch {
      setSendError('Network error.');
    } finally {
      setSending(false);
    }
  }, [matchId, sending, disabled]);

  const handleOpen = () => {
    setExpanded(true);
    setUnread(0);
  };

  if (disabled) {
    return (
      <div className='rounded-panel border border-soft bg-panel p-3 text-center text-xs text-faint'>
        Chat is unavailable in bot matches.
      </div>
    );
  }

  if (!expanded) {
    return (
      <ArcadeButton
        tone='info'
        size='sm'
        className='w-full'
        onClick={handleOpen}
      >
        <MessageCircle size={16} />
        Match chat
        {unread > 0 && (
          <span className='arcade-num flex h-5 min-w-5 items-center justify-center rounded-full border border-ink bg-key-face px-1.5 text-[11px] font-bold text-key-face-on'>
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </ArcadeButton>
    );
  }

  const ordered = [...messages].sort((a, b) => a.createdAt - b.createdAt);

  return (
    <div className='flex flex-col overflow-hidden rounded-panel border-2 border-ink bg-panel shadow-panel'>
      <div className='flex items-center justify-between border-b border-soft px-3 py-2'>
        <div className='flex items-center gap-1.5 text-sm font-semibold text-strong'>
          <MessageCircle size={14} className='text-tickets-text' />
          Match chat
        </div>
        <ArcadeButton
          tone='ghost'
          size='xs'
          onClick={() => setExpanded(false)}
        >
          Hide
        </ArcadeButton>
      </div>

      <div
        ref={scrollRef}
        className='flex flex-col gap-1 overflow-y-auto px-3 py-2 text-sm'
        // Fixed height instead of grow-to-fit — the chat's height shouldn't
        // pump the surrounding layout as messages land. New messages scroll
        // into view automatically via the effect below.
        style={{ height: '260px' }}
      >
        {ordered.length === 0 ? (
          <div className='py-6 text-center text-xs text-faint'>No messages yet.</div>
        ) : (
          ordered.map((m) => {
            const isMine = m.userId === userId;
            const isReaction = m.type === 'reaction';
            if (isReaction) {
              return (
                <div
                  key={m.id}
                  className='flex items-center gap-1.5 text-xs text-faint'
                >
                  <span className='text-base leading-none'>{m.content}</span>
                  <span className='font-medium text-strong/80'>{m.userName}</span>
                  <span className='ml-auto text-[10px]'>{formatTime(m.createdAt)}</span>
                </div>
              );
            }
            return (
              <div
                key={m.id}
                className={`flex flex-col ${isMine ? 'items-end' : 'items-start'}`}
              >
                <div className='mb-0.5 flex items-center gap-1.5 text-[10px] text-faint'>
                  <span className='font-medium text-strong/80'>
                    {isMine ? 'you' : m.userName}
                  </span>
                  <span>{formatTime(m.createdAt)}</span>
                </div>
                <div
                  className={`max-w-[85%] whitespace-pre-wrap break-words rounded-well px-2.5 py-1 text-sm ${
                    isMine
                      ? 'border border-ink bg-info text-info-on'
                      : 'border border-soft bg-raised text-strong'
                  }`}
                >
                  {m.content}
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className='border-t border-soft px-2 py-2'>
        <div className='mb-1.5 flex flex-wrap gap-1'>
          {REACTION_EMOJIS.map((emoji) => (
            <button
              key={emoji}
              type='button'
              onClick={() => void send(emoji, 'reaction')}
              disabled={sending}
              className='h-7 w-7 rounded-tag bg-well text-base transition hover:bg-raised disabled:opacity-50'
              aria-label={`React with ${emoji}`}
            >
              {emoji}
            </button>
          ))}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send(draft);
          }}
          className='flex items-center gap-1.5'
        >
          <input
            type='text'
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={CHAT_MAX_LENGTH}
            placeholder='Send a message'
            disabled={sending}
            className='arcade-input min-w-0 flex-1 px-2.5 py-1.5 text-sm'
          />
          <ArcadeButton
            type='submit'
            tone='info'
            size='icon-sm'
            disabled={sending || !draft.trim()}
            aria-label='Send message'
          >
            <Send size={14} />
          </ArcadeButton>
        </form>
        {sendError && (
          <p className='mt-1 text-[11px] text-danger-text'>{sendError}</p>
        )}
      </div>
    </div>
  );
}
