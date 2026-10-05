'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { ChevronDown, MessageCircle, Send, X } from 'lucide-react';
import { subscribeLive } from '@/lib/liveEvents';
import { startVisiblePolling } from '@/features/arcade/lib/visible-polling';
import { ArcadeButton } from '@/features/arcade/components/ui/arcade-ui';

type ChatMessage = {
  id: string;
  matchId: string;
  userId: string;
  userName: string;
  type: 'message' | 'reaction';
  content: string;
  createdAt: number;
};

const REACTION_EMOJIS = ['👏', '😂', '😮', '🔥', '😭', '🎱', '💀', '🤝'];
const CHAT_MAX_LENGTH = 200;
const SCROLL_NEAR_BOTTOM_PX = 36;
const CHAT_OPEN_PREF_PREFIX = 'pool-chat-open:';

type MatchChatProps = {
  matchId: string;
  userId: string;
  /** Player IDs — used to identify spectator messages in chat. */
  player1Id?: string;
  player2Id?: string;
};

function formatMessageTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });
}

function getChatOpenPref(matchId: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.sessionStorage.getItem(`${CHAT_OPEN_PREF_PREFIX}${matchId}`) === '1';
  } catch {
    return false;
  }
}

function setChatOpenPref(matchId: string, open: boolean): void {
  try {
    window.sessionStorage.setItem(`${CHAT_OPEN_PREF_PREFIX}${matchId}`, open ? '1' : '0');
  } catch {
    // best effort
  }
}

function ReactionToast({ emoji, name }: { emoji: string; name: string }) {
  return (
    <div
      className='animate-[reaction-pop_2s_ease-out_forwards] pointer-events-none absolute left-1/2 bottom-full mb-2 flex -translate-x-1/2 items-center gap-1.5 whitespace-nowrap rounded-full border-2 border-ink bg-panel px-3 py-1.5 text-sm shadow-chip'
    >
      <span className='text-lg'>{emoji}</span>
      <span className='text-xs text-body'>{name}</span>
    </div>
  );
}

export function MatchChat({ matchId, userId, player1Id, player2Id }: MatchChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isOpen, setIsOpen] = useState(() => {
    // Auto-open on desktop (lg = 1024px+)
    if (typeof window !== 'undefined' && window.innerWidth >= 1024) return true;
    return getChatOpenPref(matchId);
  });
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [openUnreadCount, setOpenUnreadCount] = useState(0);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const [reactionToast, setReactionToast] = useState<{
    emoji: string;
    name: string;
    id: string;
  } | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesViewportRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const isOpenRef = useRef(isOpen);
  const latestTimestampRef = useRef(0);
  const shouldAutoScrollRef = useRef(true);

  useEffect(() => {
    isOpenRef.current = isOpen;
    setChatOpenPref(matchId, isOpen);
  }, [isOpen, matchId]);

  // Scroll the message list only. scrollIntoView would also scroll the page,
  // and under the game shell the chat sits below the table.
  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    const viewport = messagesViewportRef.current;
    if (!viewport) return;
    viewport.scrollTo({ top: viewport.scrollHeight, behavior });
  }, []);

  const evaluateScrollPosition = useCallback(() => {
    const viewport = messagesViewportRef.current;
    if (!viewport) return;
    const distanceFromBottom =
      viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
    const nearBottom = distanceFromBottom <= SCROLL_NEAR_BOTTOM_PX;
    shouldAutoScrollRef.current = nearBottom;
    setShowJumpToLatest(!nearBottom);
    if (nearBottom) {
      setOpenUnreadCount(0);
    }
  }, []);

  const handleJumpToLatest = useCallback(() => {
    shouldAutoScrollRef.current = true;
    setShowJumpToLatest(false);
    setOpenUnreadCount(0);
    scrollToBottom('smooth');
  }, [scrollToBottom]);

  // Load initial messages
  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch(`/api/games/8-ball/match/${matchId}/chat`, {
          cache: 'no-store',
        });
        if (!res.ok) return;
        const data = (await res.json()) as { messages?: ChatMessage[] };
        if (Array.isArray(data.messages) && data.messages.length > 0) {
          setMessages(data.messages);
          latestTimestampRef.current =
            data.messages[data.messages.length - 1].createdAt;
        } else {
          setMessages([]);
        }
      } catch {
        // silent
      }
    };
    void load();
  }, [matchId]);

  // SSE subscription for live chat messages
  useEffect(() => {
    const unsubscribe = subscribeLive(['poolChat'], async () => {
      try {
        const res = await fetch(
          `/api/games/8-ball/match/${matchId}/chat?since=${latestTimestampRef.current}`,
          { cache: 'no-store' },
        );
        if (!res.ok) return;
        const data = (await res.json()) as { messages?: ChatMessage[] };
        if (!Array.isArray(data.messages) || data.messages.length === 0) return;

        setMessages((prev) => {
          const existingIds = new Set(prev.map((m) => m.id));
          const newMsgs = data.messages!.filter((m) => !existingIds.has(m.id));
          if (newMsgs.length === 0) return prev;

          latestTimestampRef.current = newMsgs[newMsgs.length - 1].createdAt;

          for (const msg of newMsgs) {
            if (msg.type === 'reaction' && msg.userId !== userId) {
              setReactionToast({ emoji: msg.content, name: msg.userName, id: msg.id });
            }
          }

          const opponentMsgs = newMsgs.filter((m) => m.userId !== userId);
          if (!isOpenRef.current) {
            if (opponentMsgs.length > 0) {
              setUnreadCount((count) => count + opponentMsgs.length);
            }
          } else if (!shouldAutoScrollRef.current && opponentMsgs.length > 0) {
            setOpenUnreadCount((count) => count + opponentMsgs.length);
            setShowJumpToLatest(true);
          }

          return [...prev, ...newMsgs];
        });
      } catch {
        // silent
      }
    });

    // Polling fallback — SSE may drop; poll every 5s to catch missed messages
    const stopPolling = startVisiblePolling(async () => {
      try {
        const res = await fetch(
          `/api/games/8-ball/match/${matchId}/chat?since=${latestTimestampRef.current}`,
          { cache: 'no-store' },
        );
        if (!res.ok) return;
        const data = (await res.json()) as { messages?: ChatMessage[] };
        if (!Array.isArray(data.messages) || data.messages.length === 0) return;

        setMessages((prev) => {
          const existingIds = new Set(prev.map((m) => m.id));
          const newMsgs = data.messages!.filter((m) => !existingIds.has(m.id));
          if (newMsgs.length === 0) return prev;
          latestTimestampRef.current = newMsgs[newMsgs.length - 1].createdAt;
          const opponentMsgs = newMsgs.filter((m) => m.userId !== userId);
          if (!isOpenRef.current && opponentMsgs.length > 0) {
            setUnreadCount((count) => count + opponentMsgs.length);
          }
          return [...prev, ...newMsgs];
        });
      } catch { /* silent */ }
    }, 5000);

    return () => { unsubscribe(); stopPolling(); };
  }, [matchId, userId]);

  // Keep view pinned if user is already at latest
  useEffect(() => {
    if (!isOpen) return;
    if (shouldAutoScrollRef.current) {
      scrollToBottom('smooth');
    } else {
      setShowJumpToLatest(true);
    }
  }, [messages.length, isOpen, scrollToBottom]);

  // Clear reaction toast after 2s
  useEffect(() => {
    if (!reactionToast) return;
    const timer = window.setTimeout(() => setReactionToast(null), 2000);
    return () => window.clearTimeout(timer);
  }, [reactionToast]);

  // Close on Escape while panel is open
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setIsOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen]);

  // Focus input when opened
  useEffect(() => {
    if (!isOpen) return;
    const id = window.setTimeout(() => {
      // No focus on touch screens: it would open the keyboard over the table.
      if (!window.matchMedia('(pointer: coarse)').matches) {
        inputRef.current?.focus({ preventScroll: true });
      }
      evaluateScrollPosition();
      scrollToBottom('auto');
    }, 0);
    return () => window.clearTimeout(id);
  }, [isOpen, evaluateScrollPosition, scrollToBottom]);

  const sendMessage = useCallback(
    async (content: string, type: 'message' | 'reaction' = 'message') => {
      if (sending) return;
      const trimmed = content.trim();
      if (!trimmed) return;

      setSending(true);
      setSendError(null);

      try {
        const res = await fetch(`/api/games/8-ball/match/${matchId}/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: trimmed, type }),
        });

        if (!res.ok) {
          let message = 'Could not send chat message.';
          try {
            const payload = (await res.json()) as { error?: string };
            if (typeof payload.error === 'string' && payload.error.trim()) {
              message = payload.error;
            }
          } catch {
            // ignore parse failure
          }
          setSendError(message);
          return;
        }

        const data = (await res.json()) as { message?: ChatMessage };
        if (data.message) {
          setMessages((prev) => {
            if (prev.some((m) => m.id === data.message!.id)) return prev;
            latestTimestampRef.current = data.message!.createdAt;
            return [...prev, data.message!];
          });
        }
        if (type === 'message') {
          setDraft('');
        }
      } catch {
        setSendError('Network error while sending.');
      } finally {
        setSending(false);
      }
    },
    [matchId, sending],
  );

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    void sendMessage(draft);
  };

  const handleOpen = () => {
    setIsOpen(true);
    setUnreadCount(0);
  };

  const textMessages = messages.filter((m) => m.type === 'message');
  const recentReactions = messages
    .filter((m) => m.type === 'reaction')
    .slice(-10)
    .reverse();

  return (
    <>
      <style
        dangerouslySetInnerHTML={{
          __html: `
        @keyframes reaction-pop {
          0% { opacity: 0; transform: translateX(-50%) translateY(10px) scale(0.8); }
          15% { opacity: 1; transform: translateX(-50%) translateY(0) scale(1.1); }
          25% { transform: translateX(-50%) translateY(0) scale(1); }
          80% { opacity: 1; }
          100% { opacity: 0; transform: translateX(-50%) translateY(-20px) scale(0.9); }
        }
      `,
        }}
      />

      {!isOpen && (
        <div className='relative w-full'>
          <ArcadeButton
            tone='info'
            size='sm'
            className='w-full'
            onClick={handleOpen}
          >
            <MessageCircle size={17} />
            Match chat
            {unreadCount > 0 && (
              <span className='arcade-num flex h-5 min-w-5 items-center justify-center rounded-full border border-ink bg-key-face px-1.5 text-[11px] font-bold text-key-face-on'>
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </ArcadeButton>
          {reactionToast && (
            <ReactionToast emoji={reactionToast.emoji} name={reactionToast.name} />
          )}
        </div>
      )}

      {/* Fixed (not max-)height on lg+ so the chat widget doesn't pump
          the surrounding layout as messages land. Messages scroll into
          view inside the viewport. Mobile keeps the existing h-48 viewport. */}
      {isOpen && (
        <div className='w-full min-w-[18rem] max-w-[27rem] overflow-hidden rounded-cabinet border-2 border-ink bg-panel shadow-cabinet lg:flex lg:h-[28rem] lg:max-w-none lg:flex-col xl:h-[34rem]'>
          <div className='flex items-center justify-between border-b border-soft px-4 py-2.5'>
            <div className='flex items-center gap-2'>
              <span className='arcade-kicker text-sm text-faint'>
                Match chat
              </span>
              <span className='inline-flex items-center rounded-full border border-ink bg-prize px-1.5 py-0.5 text-[11px] font-bold text-prize-on'>
                Live
              </span>
            </div>
            <ArcadeButton
              tone='ghost'
              size='icon-sm'
              onClick={() => setIsOpen(false)}
              aria-label='Close chat'
            >
              <X size={16} />
            </ArcadeButton>
          </div>

          <div className='flex items-center gap-1 border-b border-soft px-3 py-2'>
            {REACTION_EMOJIS.map((emoji) => (
              <button
                key={emoji}
                type='button'
                onClick={() => void sendMessage(emoji, 'reaction')}
                disabled={sending}
                className='flex h-8 w-8 items-center justify-center rounded-tag text-lg transition hover:bg-raised disabled:opacity-40'
                title={`Send ${emoji}`}
                aria-label={`Send ${emoji} reaction`}
              >
                {emoji}
              </button>
            ))}
          </div>

          {recentReactions.length > 0 && (
            <div className='border-b border-soft px-3 py-1.5'>
              <div className='flex items-center gap-1 overflow-x-auto pb-0.5'>
                {recentReactions.map((reaction) => {
                  const isMine = reaction.userId === userId;
                  return (
                    <span
                      key={reaction.id}
                      className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] ${
                        isMine
                          ? 'border-ink bg-info text-info-on'
                          : 'border-soft bg-raised text-faint'
                      }`}
                      title={`${reaction.userName} • ${formatMessageTime(reaction.createdAt)}`}
                    >
                      <span className='text-sm leading-none'>{reaction.content}</span>
                      <span className='max-w-20 truncate'>
                        {isMine ? 'You' : reaction.userName}
                      </span>
                    </span>
                  );
                })}
              </div>
            </div>
          )}

          <div className='relative lg:flex-1 lg:min-h-0 lg:overflow-hidden'>
            <div
              ref={messagesViewportRef}
              onScroll={evaluateScrollPosition}
              className='h-48 space-y-1.5 overflow-y-auto px-3 py-2.5 lg:h-full'
            >
              {textMessages.length === 0 && (
                <p className='py-8 text-center text-sm text-faint'>
                  No messages yet. Say something.
                </p>
              )}
              {textMessages.map((msg) => {
                const isMe = msg.userId === userId;
                const isMsgFromSpectator = player1Id && player2Id
                  ? msg.userId !== player1Id && msg.userId !== player2Id
                  : false;
                return (
                  <div
                    key={msg.id}
                    className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}
                  >
                    <div className='max-w-[82%]'>
                      <div
                        className={`break-words rounded-well px-3 py-1.5 text-sm ${
                          isMe
                            ? isMsgFromSpectator
                              ? 'border border-ink bg-primary text-primary-on'
                              : 'border border-ink bg-info text-info-on'
                            : 'border border-soft bg-raised text-body'
                        }`}
                      >
                        {!isMe && (
                          <p className='mb-0.5 text-[10px] font-medium text-faint'>
                            {msg.userName}
                            {isMsgFromSpectator && (
                              <span className='ml-1.5 inline-flex items-center rounded-full border border-soft bg-raised px-1.5 py-0 text-[9px] font-semibold text-faint'>
                                Spectator
                              </span>
                            )}
                          </p>
                        )}
                        <p>{msg.content}</p>
                      </div>
                      <p className={`mt-0.5 text-[10px] text-faint ${isMe ? 'text-right' : 'text-left'}`}>
                        {formatMessageTime(msg.createdAt)}
                      </p>
                    </div>
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>

            {showJumpToLatest && (
              <ArcadeButton
                tone='ghost'
                size='xs'
                className='absolute bottom-2 right-2'
                onClick={handleJumpToLatest}
              >
                <ChevronDown size={12} />
                Latest
                {openUnreadCount > 0 && (
                  <span className='arcade-num rounded-full border border-ink bg-key-face px-1 text-[10px] font-bold text-key-face-on'>
                    {openUnreadCount > 99 ? '99+' : openUnreadCount}
                  </span>
                )}
              </ArcadeButton>
            )}
          </div>

          <form onSubmit={handleSubmit} className='border-t border-soft px-3 py-2.5'>
            <div className='flex items-center gap-2'>
              <input
                ref={inputRef}
                type='text'
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value.slice(0, CHAT_MAX_LENGTH));
                  if (sendError) setSendError(null);
                }}
                placeholder='Type a message...'
                maxLength={CHAT_MAX_LENGTH}
                className='arcade-input flex-1 px-3 py-2 text-sm'
                disabled={sending}
              />
              <ArcadeButton
                type='submit'
                tone='primary'
                size='icon-sm'
                disabled={sending || !draft.trim()}
                aria-label='Send message'
              >
                <Send size={15} />
              </ArcadeButton>
            </div>
            <div className='mt-1 flex items-center justify-between'>
              <p className='text-[10px] text-faint'>
                Enter to send
              </p>
              <p className='text-[10px] text-faint'>
                {draft.length}/{CHAT_MAX_LENGTH}
              </p>
            </div>
            {sendError && (
              <p className='mt-1 text-[10px] text-danger-text'>
                {sendError}
              </p>
            )}
          </form>
        </div>
      )}
    </>
  );
}
