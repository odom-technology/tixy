import { NextResponse } from 'next/server';

import { requireIdentity } from '@/server/auth';
import {
  getUnreadNotificationCount,
  listNotificationsForUser,
  markAllNotificationsRead,
  markNotificationRead,
} from '@/server/services/notifications';

export const dynamic = 'force-dynamic';

function readLimit(url: string) {
  const parsed = new URL(url);
  const value = Number(parsed.searchParams.get('limit') ?? 30);
  return Number.isFinite(value) ? value : 30;
}

async function readNotificationPayload(userId: string) {
  const [notifications, unreadCount] = await Promise.all([
    listNotificationsForUser(userId),
    getUnreadNotificationCount(userId),
  ]);
  return { notifications, unreadCount };
}

export async function GET(request: Request) {
  let identity;
  try {
    identity = await requireIdentity({ allowExternal: true });
  } catch {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }

  const [notifications, unreadCount] = await Promise.all([
    listNotificationsForUser(identity.userId, readLimit(request.url)),
    getUnreadNotificationCount(identity.userId),
  ]);
  return NextResponse.json({ notifications, unreadCount });
}

export async function PATCH(request: Request) {
  let identity;
  try {
    identity = await requireIdentity({ allowExternal: true });
  } catch {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }

  let body: {
    action?: 'mark-read' | 'mark-all-read';
    notificationId?: string;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });
  }

  try {
    if (body.action === 'mark-all-read') {
      await markAllNotificationsRead(identity.userId);
      return NextResponse.json(await readNotificationPayload(identity.userId));
    }

    if (body.action === 'mark-read' && body.notificationId?.trim()) {
      const notification = await markNotificationRead({
        userId: identity.userId,
        notificationId: body.notificationId.trim(),
      });
      if (!notification) {
        return NextResponse.json(
          { error: 'Notification not found.' },
          { status: 404 },
        );
      }
      return NextResponse.json(await readNotificationPayload(identity.userId));
    }

    return NextResponse.json({ error: 'Invalid notification action.' }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message || 'Unable to update notifications.' },
      { status: 400 },
    );
  }
}
