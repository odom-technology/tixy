'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';

import { subscribeLive } from '@/lib/liveEvents';

/** Server layout supplies this so known guests never probe protected APIs. */
export const AccountIdentityContext = createContext<boolean | null>(null);

export type AccountSummary = {
  id: string;
  username: string | null;
  email: string;
  roles: string[];
  /** The avatar the account has, as stored. ProfileAvatar draws it. */
  imageUrl?: string | null;
};

type AccountResponse = {
  account?: AccountSummary;
};

type UnreadResponse = {
  unreadCount?: number;
};

type AccountSummarySnapshot = {
  account: AccountSummary | null;
  unreadCount: number;
  unreadMessages: number;
};

let accountSummaryPromise: Promise<AccountSummarySnapshot> | null = null;

/** AppTopNav, mobile nav, account nav, and the guest nudge mount together. */
function loadSharedAccountSummary(): Promise<AccountSummarySnapshot> {
  if (accountSummaryPromise) return accountSummaryPromise;
  accountSummaryPromise = (async () => {
    try {
      const accountResponse = await fetch('/api/account/me', { cache: 'no-store' });
      if (!accountResponse.ok) {
        return { account: null, unreadCount: 0, unreadMessages: 0 };
      }

      const payload = (await accountResponse.json().catch(() => ({}))) as AccountResponse;
      const account = payload.account ?? null;
      if (!account) return { account: null, unreadCount: 0, unreadMessages: 0 };

      const [notificationResponse, messagesResponse] = await Promise.all([
        fetch('/api/notifications?limit=1', { cache: 'no-store' }),
        fetch('/api/messages/unread-count', { cache: 'no-store' }),
      ]);
      const [notificationPayload, messagesPayload] = await Promise.all([
        notificationResponse.ok
          ? notificationResponse.json().catch(() => ({}))
          : Promise.resolve({}),
        messagesResponse.ok
          ? messagesResponse.json().catch(() => ({}))
          : Promise.resolve({}),
      ]) as [UnreadResponse, UnreadResponse];
      return {
        account,
        unreadCount: Math.max(0, Number(notificationPayload.unreadCount ?? 0)),
        unreadMessages: Math.max(0, Number(messagesPayload.unreadCount ?? 0)),
      };
    } catch {
      return { account: null, unreadCount: 0, unreadMessages: 0 };
    }
  })();
  return accountSummaryPromise;
}

/* One fetch shape shared by every nav surface (sidebar, header buttons),
   so they always agree on who is signed in and what is unread. */
export function useAccountSummary() {
  const hasServerIdentity = useContext(AccountIdentityContext);
  const [account, setAccount] = useState<AccountSummary | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [unreadMessages, setUnreadMessages] = useState(0);
  const [loaded, setLoaded] = useState(hasServerIdentity === false);

  const refreshNotificationCount = useCallback(async () => {
    try {
      const response = await fetch('/api/notifications?limit=1', { cache: 'no-store' });
      if (!response.ok) return;
      const payload = (await response.json().catch(() => ({}))) as UnreadResponse;
      setUnreadCount(Math.max(0, Number(payload.unreadCount ?? 0)));
    } catch {
      // Badge refresh is best-effort; the notifications page remains canonical.
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    if (hasServerIdentity === false) {
      setAccount(null);
      setUnreadCount(0);
      setUnreadMessages(0);
      setLoaded(true);
      return () => {
        cancelled = true;
      };
    }

    async function loadAccount() {
      const next = await loadSharedAccountSummary();
      if (cancelled) return;
      setAccount(next.account);
      setUnreadCount(next.unreadCount);
      setUnreadMessages(next.unreadMessages);
      setLoaded(true);
    }

    void loadAccount();

    return () => {
      cancelled = true;
    };
  }, [hasServerIdentity]);

  useEffect(() => {
    if (!account?.id) return;
    const unsubscribe = subscribeLive([`user:${account.id}`], (payload) => {
      if (payload.type === 'notification') void refreshNotificationCount();
    });
    const onVisibilityChange = () => {
      if (!document.hidden) void refreshNotificationCount();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      unsubscribe();
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [account?.id, refreshNotificationCount]);

  return {
    account,
    unreadCount,
    unreadMessages,
    socialUnread: unreadCount + unreadMessages,
    loaded,
    isAdmin: account?.roles.includes('admin') ?? false,
  };
}
