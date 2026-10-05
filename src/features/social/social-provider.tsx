'use client';

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import { subscribeLive } from '@/lib/liveEvents';
import { seedPresence } from '@/features/social/presence/presence-client';

import type {
  ConversationSummary,
  FriendSummary,
  SocialSnapshot,
  SocialThreadTarget,
} from './social-types';

type FriendPayload = {
  friends?: FriendSummary[];
  incoming?: FriendSummary[];
  outgoing?: FriendSummary[];
  error?: string;
};

type SocialContextValue = {
  snapshot: SocialSnapshot | null;
  loading: boolean;
  error: string | null;
  dockOpen: boolean;
  setDockOpen: (open: boolean) => void;
  activeThread: SocialThreadTarget | null;
  setActiveThread: (target: SocialThreadTarget | null) => void;
  socialUnread: number;
  refresh: () => Promise<void>;
  openLobby: () => void;
  openConversation: (targetUserId: string) => Promise<string>;
  updateFriendship: (
    friendshipId: string,
    action: 'accept' | 'decline' | 'remove',
  ) => Promise<void>;
  sendFriendRequest: (targetUserId: string) => Promise<void>;
  setLobbyRead: () => void;
};

const SocialContext = createContext<SocialContextValue | null>(null);

async function readFriendPayload(response: Response) {
  const payload = (await response.json().catch(() => ({}))) as FriendPayload;
  if (!response.ok) throw new Error(payload.error || 'Unable to update friends.');
  return payload;
}

export function SocialProvider({
  children,
  enabled = true,
}: {
  children: ReactNode;
  enabled?: boolean;
}) {
  const [snapshot, setSnapshot] = useState<SocialSnapshot | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const [dockOpen, setDockOpen] = useState(false);
  const [activeThread, setActiveThread] = useState<SocialThreadTarget | null>(null);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    try {
      const response = await fetch('/api/social/bootstrap', { cache: 'no-store' });
      const payload = (await response.json().catch(() => ({}))) as SocialSnapshot & {
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error || 'Unable to load social.');
      setSnapshot(payload);
      seedPresence(payload.presence ?? []);
      setError(null);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      setSnapshot(null);
      return;
    }
    void refresh();
  }, [enabled, refresh]);

  useEffect(() => {
    const userId = snapshot?.currentUser.userId;
    if (!userId) return;
    return subscribeLive([`user:${userId}`, 'social:lobby'], (payload) => {
      if (
        payload.type === 'message_updated' &&
        payload.kind === 'channel' &&
        typeof payload.senderUserId === 'string' &&
        payload.senderUserId !== userId &&
        !snapshot.blockedUserIds.includes(payload.senderUserId)
      ) {
        setSnapshot((current) => {
          if (!current) return current;
          const lobbyIsOpen = activeThread?.kind === 'lobby';
          return lobbyIsOpen
            ? current
            : { ...current, lobbyUnreadCount: current.lobbyUnreadCount + 1 };
        });
        return;
      }
      if (
        payload.type === 'message_updated' ||
        payload.type === 'notification' ||
        payload.type === 'activity'
      ) {
        void refresh();
      }
    });
  }, [activeThread?.kind, refresh, snapshot?.blockedUserIds, snapshot?.currentUser.userId]);

  const applyFriends = useCallback((payload: FriendPayload) => {
    setSnapshot((current) =>
      current
        ? {
            ...current,
            friends: payload.friends ?? [],
            incoming: payload.incoming ?? [],
            outgoing: payload.outgoing ?? [],
          }
        : current,
    );
  }, []);

  const updateFriendship = useCallback(
    async (friendshipId: string, action: 'accept' | 'decline' | 'remove') => {
      const payload = await readFriendPayload(
        await fetch('/api/friends', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ friendshipId, action }),
        }),
      );
      applyFriends(payload);
    },
    [applyFriends],
  );

  const sendFriendRequest = useCallback(
    async (targetUserId: string) => {
      const payload = await readFriendPayload(
        await fetch('/api/friends', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ targetUserId }),
        }),
      );
      applyFriends(payload);
    },
    [applyFriends],
  );

  const openConversation = useCallback(
    async (targetUserId: string) => {
      const response = await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetUserId }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        conversationId?: string;
        error?: string;
      };
      if (!response.ok || !payload.conversationId) {
        throw new Error(payload.error || 'Unable to open conversation.');
      }
      setActiveThread({ kind: 'dm', id: payload.conversationId });
      setDockOpen(true);
      await refresh();
      return payload.conversationId;
    },
    [refresh],
  );

  const openLobby = useCallback(() => {
    setActiveThread({ kind: 'lobby', id: 'arcade-lobby' });
    setDockOpen(true);
    setSnapshot((current) =>
      current ? { ...current, lobbyUnreadCount: 0 } : current,
    );
  }, []);

  const setLobbyRead = useCallback(() => {
    setSnapshot((current) =>
      current ? { ...current, lobbyUnreadCount: 0 } : current,
    );
  }, []);

  const socialUnread = useMemo(() => {
    if (!snapshot) return 0;
    const unreadDms = snapshot.conversations.filter(
      (conversation: ConversationSummary) => conversation.unreadCount > 0,
    ).length;
    return unreadDms + snapshot.incoming.length + (snapshot.lobbyUnreadCount > 0 ? 1 : 0);
  }, [snapshot]);

  const value = useMemo<SocialContextValue>(
    () => ({
      snapshot,
      loading,
      error,
      dockOpen,
      setDockOpen,
      activeThread,
      setActiveThread,
      socialUnread,
      refresh,
      openLobby,
      openConversation,
      updateFriendship,
      sendFriendRequest,
      setLobbyRead,
    }),
    [
      activeThread,
      dockOpen,
      error,
      loading,
      openConversation,
      openLobby,
      refresh,
      sendFriendRequest,
      setLobbyRead,
      snapshot,
      socialUnread,
      updateFriendship,
    ],
  );

  return <SocialContext.Provider value={value}>{children}</SocialContext.Provider>;
}

export function useSocial() {
  const context = useContext(SocialContext);
  if (!context) throw new Error('useSocial must be used inside SocialProvider.');
  return context;
}

export function useOptionalSocial() {
  return useContext(SocialContext);
}
