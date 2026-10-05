import crypto from 'node:crypto';

import { readAccountSettings } from '@/features/account/account-settings';
import { getAccountData } from '@/server/accounts';
import { query } from '@/server/db/client';
import { broadcast } from '@/server/events';

export type NotificationInput = {
  userId: string;
  type: string;
  title: string;
  body: string;
  href?: string;
  preferenceKey?: string;
  /** Server-only idempotency key. Never returned by notification APIs. */
  dedupeKey?: string;
};

export type NotificationRecord = {
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

type NotificationRow = {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string;
  href: string | null;
  preference_key: string | null;
  read_at: string | number | null;
  created_at: string | number;
};

const MAX_TYPE_LENGTH = 80;
const MAX_TITLE_LENGTH = 140;
const MAX_BODY_LENGTH = 600;
const MAX_HREF_LENGTH = 300;
const MAX_PREFERENCE_KEY_LENGTH = 80;
const MAX_DEDUPE_KEY_LENGTH = 240;

let schemaReady: Promise<void> | null = null;

function toNumber(value: string | number | null | undefined) {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function clampText(value: string | null | undefined, max: number) {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

function normalizeHref(value: string | null | undefined) {
  const href = clampText(value, MAX_HREF_LENGTH);
  if (!href || !href.startsWith('/') || href.startsWith('//')) return null;
  return href;
}

function rowToNotification(row: NotificationRow): NotificationRecord {
  return {
    id: row.id,
    userId: row.user_id,
    type: row.type,
    title: row.title,
    body: row.body,
    href: row.href,
    preferenceKey: row.preference_key,
    readAt: toNumber(row.read_at),
    createdAt: toNumber(row.created_at) ?? 0,
  };
}

async function ensureNotificationSchema() {
  schemaReady ??= query(`
    CREATE TABLE IF NOT EXISTS arcade_notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES arcade_accounts(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      href TEXT,
      preference_key TEXT,
      read_at BIGINT,
      created_at BIGINT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_arcade_notifications_user_created
      ON arcade_notifications(user_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_arcade_notifications_user_unread
      ON arcade_notifications(user_id, read_at, created_at DESC);

    ALTER TABLE arcade_notifications
      ADD COLUMN IF NOT EXISTS dedupe_key TEXT;

    CREATE UNIQUE INDEX IF NOT EXISTS idx_arcade_notifications_user_dedupe
      ON arcade_notifications(user_id, dedupe_key)
      WHERE dedupe_key IS NOT NULL;
  `).then(() => undefined);

  await schemaReady;
}

function buildNotification(input: NotificationInput): NotificationRecord {
  const title = clampText(input.title, MAX_TITLE_LENGTH);
  const body = clampText(input.body, MAX_BODY_LENGTH);
  if (!title || !body) {
    throw new Error('Notification title and body are required.');
  }

  return {
    id: crypto.randomUUID(),
    userId: input.userId,
    type: clampText(input.type, MAX_TYPE_LENGTH) ?? 'general',
    title,
    body,
    href: normalizeHref(input.href),
    preferenceKey: clampText(input.preferenceKey, MAX_PREFERENCE_KEY_LENGTH),
    readAt: null,
    createdAt: Date.now(),
  };
}

async function shouldPersistNotification(notification: NotificationRecord) {
  if (!notification.preferenceKey) return true;
  try {
    const settingsData = await getAccountData(notification.userId, 'settings');
    const settings = readAccountSettings(settingsData?.value);
    if (notification.preferenceKey === 'game_notifications') {
      return settings.gameNotifications;
    }
    if (notification.preferenceKey === 'feedback_notifications') {
      return settings.feedbackNotifications;
    }
    return true;
  } catch (error) {
    console.error('Failed to read notification preferences:', error);
    return true;
  }
}

export async function createNotification(input: NotificationInput) {
  const notification = buildNotification(input);
  const dedupeKey = clampText(input.dedupeKey, MAX_DEDUPE_KEY_LENGTH);

  if (process.env.NODE_ENV === 'development') {
    console.debug('[arcade:notification]', notification);
  }

  try {
    if (!(await shouldPersistNotification(notification))) {
      return null;
    }

    await ensureNotificationSchema();
    const result = await query<NotificationRow>(
      `INSERT INTO arcade_notifications (
        id,
        user_id,
        type,
        title,
        body,
        href,
        preference_key,
        dedupe_key,
        read_at,
        created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULL, $9)
      ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
      RETURNING id, user_id, type, title, body, href, preference_key, read_at, created_at`,
      [
        notification.id,
        notification.userId,
        notification.type,
        notification.title,
        notification.body,
        notification.href,
        notification.preferenceKey,
        dedupeKey,
        notification.createdAt,
      ],
    );
    const inserted = result.rows[0];
    if (!inserted) return null;
    const record = rowToNotification(inserted);
    broadcast(`user:${notification.userId}`, { type: 'notification' });
    return record;
  } catch (error) {
    console.error('Failed to persist notification:', error);
    // Callers use a non-null record as their delivery acknowledgement. Never
    // return the in-memory draft when the INSERT failed.
    return null;
  }
}

/** Resolve a server-owned notification family without exposing its key. */
export async function markNotificationsReadByDedupePrefix(input: {
  dedupePrefix: string;
  now?: number;
}) {
  const prefix = clampText(input.dedupePrefix, MAX_DEDUPE_KEY_LENGTH);
  if (!prefix) return 0;
  await ensureNotificationSchema();
  const result = await query<{ user_id: string }>(
    `UPDATE arcade_notifications
        SET read_at = COALESCE(read_at, $1)
      WHERE dedupe_key LIKE $2 AND read_at IS NULL
      RETURNING user_id`,
    [input.now ?? Date.now(), `${prefix}%`],
  );
  const userIds = [...new Set(result.rows.map((row) => row.user_id))];
  if (userIds.length > 0) {
    broadcast(userIds.map((userId) => `user:${userId}`), { type: 'notification' });
  }
  return result.rowCount ?? 0;
}

export async function createBulkNotifications(inputs: NotificationInput[]) {
  return Promise.all(inputs.map((input) => createNotification(input)));
}

export async function listNotificationsForUser(userId: string, limit = 30) {
  await ensureNotificationSchema();
  const result = await query<NotificationRow>(
    `SELECT id, user_id, type, title, body, href, preference_key, read_at, created_at
     FROM arcade_notifications
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [userId, Math.max(1, Math.min(100, Math.trunc(limit)))],
  );
  return result.rows.map(rowToNotification);
}

export async function getUnreadNotificationCount(userId: string) {
  await ensureNotificationSchema();
  const result = await query<{ count: string }>(
    `SELECT COUNT(*) as count
     FROM arcade_notifications
     WHERE user_id = $1 AND read_at IS NULL`,
    [userId],
  );
  return Number(result.rows[0]?.count ?? 0);
}

export async function markNotificationRead(input: {
  userId: string;
  notificationId: string;
}) {
  await ensureNotificationSchema();
  const result = await query<NotificationRow>(
    `UPDATE arcade_notifications
     SET read_at = COALESCE(read_at, $1)
     WHERE id = $2 AND user_id = $3
     RETURNING id, user_id, type, title, body, href, preference_key, read_at, created_at`,
    [Date.now(), input.notificationId, input.userId],
  );
  if (!result.rows[0]) return null;
  broadcast(`user:${input.userId}`, { type: 'notification' });
  return rowToNotification(result.rows[0]);
}

export async function markAllNotificationsRead(userId: string) {
  await ensureNotificationSchema();
  const result = await query<{ id: string }>(
    `UPDATE arcade_notifications
     SET read_at = COALESCE(read_at, $1)
     WHERE user_id = $2 AND read_at IS NULL
     RETURNING id`,
    [Date.now(), userId],
  );
  if ((result.rowCount ?? 0) > 0) {
    broadcast(`user:${userId}`, { type: 'notification' });
  }
  return result.rowCount ?? 0;
}
