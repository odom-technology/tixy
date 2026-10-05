'use client';

import { Bell, Check, CheckCheck } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  ArcadeButton,
  ArcadeChip,
  ArcadeLinkButton,
  ArcadeNotice,
} from '@/features/arcade/components/ui/arcade-ui';
import { AppPageFrame } from '@/features/arcade/components/shell/page-frame';
import { fetchCurrentUserId } from '@/features/users/current-user-client';
import { subscribeLive } from '@/lib/liveEvents';
import { ArcadeLoadingDots } from '@/features/arcade/components/ui/arcade-states';

type NotificationRecord = {
  id: string;
  userId: string;
  type: string;
  title: string;
  body: string;
  href: string | null;
  preferenceKey: string | null;
  readAt: number | null;
  createdAt: number;
};

type NotificationPayload = {
  notifications?: NotificationRecord[];
  unreadCount?: number;
  error?: string;
};

type NotificationsClientProps = {
  initialNotifications: NotificationRecord[];
  initialUnreadCount: number;
  embedded?: boolean;
};

const panelClass = 'arcade-card p-5';

function formatDate(timestamp: number) {
  return new Intl.DateTimeFormat('en', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(timestamp));
}

async function readNotificationPayload(response: Response) {
  const payload = (await response.json().catch(() => ({}))) as NotificationPayload;
  if (!response.ok) throw new Error(payload.error || 'Request failed.');
  return payload;
}

export function NotificationsClient({
  initialNotifications,
  initialUnreadCount,
  embedded = false,
}: NotificationsClientProps) {
  const [notifications, setNotifications] = useState(initialNotifications);
  const [unreadCount, setUnreadCount] = useState(initialUnreadCount);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const grouped = useMemo(
    () =>
      [...notifications].sort((a, b) => {
        if (a.readAt && !b.readAt) return 1;
        if (!a.readAt && b.readAt) return -1;
        return b.createdAt - a.createdAt;
      }),
    [notifications],
  );

  const applyPayload = (payload: NotificationPayload) => {
    setNotifications(payload.notifications ?? []);
    setUnreadCount(payload.unreadCount ?? 0);
  };

  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/notifications', { cache: 'no-store' });
      const payload = await readNotificationPayload(response);
      setNotifications(payload.notifications ?? []);
      setUnreadCount(payload.unreadCount ?? 0);
    } catch {
      // Realtime refresh is best-effort; explicit read actions still show errors.
    }
  }, []);

  useEffect(() => {
    let unsubscribe: (() => void) | null = null;
    let cancelled = false;
    void fetchCurrentUserId().then((userId) => {
      if (cancelled || !userId) return;
      unsubscribe = subscribeLive([`user:${userId}`], (payload) => {
        if (payload.type === 'notification') void refresh();
      });
    });
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [refresh]);

  const markRead = async (notificationId: string) => {
    setBusyId(notificationId);
    setError(null);
    try {
      applyPayload(
        await readNotificationPayload(
          await fetch('/api/notifications', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'mark-read', notificationId }),
          }),
        ),
      );
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const markAllRead = async () => {
    setBusyId('all');
    setError(null);
    try {
      applyPayload(
        await readNotificationPayload(
          await fetch('/api/notifications', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'mark-all-read' }),
          }),
        ),
      );
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const content = (
    <section className='grid gap-4 md:grid-cols-[0.7fr_1.3fr]'>
      <div className={`${panelClass} space-y-3`}>
        <p className='text-xs font-semibold uppercase text-faint'>Unread alerts</p>
        <p className='text-3xl font-semibold tabular-nums'>{unreadCount}</p>
        <ArcadeButton type='button' tone='primary' onClick={() => void markAllRead()} disabled={unreadCount === 0 || busyId === 'all'}>
          {busyId === 'all' ? <ArcadeLoadingDots /> : <CheckCheck size={16} />} Mark all read
        </ArcadeButton>
      </div>
      <div className={`${panelClass} space-y-3`}>
        <h2 className='text-lg font-semibold'>Alert inbox</h2>
        {error ? <ArcadeNotice tone='danger'>{error}</ArcadeNotice> : null}
        {grouped.length === 0 ? <div className='arcade-card-inset px-4 py-8 text-center text-sm text-faint'>The alert board is clear.</div> : grouped.map((notification) => <NotificationRow key={notification.id} notification={notification} busy={busyId === notification.id} onMarkRead={markRead} />)}
      </div>
    </section>
  );

  if (embedded) return content;

  return (
    <AppPageFrame
      eyebrow='Alerts'
      title={
        <span className='flex items-center gap-3'>
          <Bell size={28} />
          Alert Board
        </span>
      }
      subtitle='Game invites, crew updates, and site notices land here.'
      contentClassName='space-y-6'
    >
        {content}
    </AppPageFrame>
  );
}

function NotificationRow({
  notification,
  busy,
  onMarkRead,
}: {
  notification: NotificationRecord;
  busy: boolean;
  onMarkRead: (notificationId: string) => Promise<void>;
}) {
  const isUnread = !notification.readAt;

  return (
    <article
      className={`arcade-card-inset p-4 transition ${
        isUnread ? 'bg-raised' : ''
      }`}
    >
      <div className='flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between'>
        <div className='min-w-0'>
          <div className='flex flex-wrap items-center gap-2'>
            {isUnread ? (
              <ArcadeChip tone='primary'>New</ArcadeChip>
            ) : null}
            <span className='text-xs text-faint'>
              {notification.type.replaceAll('_', ' ')}
            </span>
          </div>
          <h3 className='mt-2 text-base font-semibold text-strong'>
            {notification.title}
          </h3>
          <p className='mt-1 text-sm leading-6 text-faint'>
            {notification.body}
          </p>
          <p className='mt-2 text-xs text-faint'>
            {formatDate(notification.createdAt)}
          </p>
        </div>
        <div className='flex shrink-0 flex-wrap gap-2'>
          {notification.href ? (
            <ArcadeLinkButton
              href={notification.href}
              tone='primary'
              onClick={() => {
                if (isUnread) void onMarkRead(notification.id);
              }}
            >
              Open
            </ArcadeLinkButton>
          ) : null}
          {isUnread ? (
            <ArcadeButton
              type='button'
              tone='default'
              onClick={() => void onMarkRead(notification.id)}
              disabled={busy}
            >
              {busy ? <ArcadeLoadingDots /> : <Check size={14} />}
              Read
            </ArcadeButton>
          ) : null}
        </div>
      </div>
    </article>
  );
}
