import crypto from 'node:crypto';

import { query, queryOne } from '@/server/db/client';

export type FeedbackCategory =
  | 'bug'
  | 'game_request'
  | 'account'
  | 'layout'
  | 'performance'
  | 'privacy'
  | 'purchase'
  | 'ads'
  | 'other';

export type FeedbackStatus = 'open' | 'resolved' | 'dismissed';

export type FeedbackEntry = {
  id: string;
  userId: string | null;
  userName: string | null;
  email: string | null;
  category: FeedbackCategory;
  rating: number | null;
  message: string;
  pagePath: string | null;
  status: FeedbackStatus;
  adminNote: string | null;
  statusUpdatedBy: string | null;
  statusUpdatedAt: number | null;
  createdAt: number;
  updatedAt: number;
};

type FeedbackRow = {
  id: string;
  date_key: string;
  user_id: string | null;
  user_name: string | null;
  email: string | null;
  category: FeedbackCategory;
  rating: string | number | null;
  message: string;
  page_path: string | null;
  status: FeedbackStatus;
  admin_note: string | null;
  status_updated_by: string | null;
  status_updated_at: string | number | null;
  user_agent: string | null;
  created_at: string | number;
  updated_at: string | number;
};

const FEEDBACK_CATEGORIES = new Set<FeedbackCategory>([
  'bug',
  'game_request',
  'account',
  'layout',
  'performance',
  'privacy',
  'purchase',
  'ads',
  'other',
]);

const MAX_MESSAGE_LENGTH = 3000;
const MAX_PATH_LENGTH = 300;
const MAX_EMAIL_LENGTH = 254;
const MAX_NAME_LENGTH = 120;
const MAX_USER_AGENT_LENGTH = 300;
const MAX_ADMIN_NOTE_LENGTH = 1200;

let schemaReady: Promise<void> | null = null;

const getDateKey = (ts: number = Date.now()) =>
  new Date(ts).toISOString().slice(0, 10);

const toNumber = (value: string | number | null | undefined) => {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const clampText = (value: string | null | undefined, max: number) => {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
};

const rowToFeedback = (row: FeedbackRow): FeedbackEntry => ({
  id: row.id,
  userId: row.user_id,
  userName: row.user_name,
  email: row.email,
  category: row.category,
  rating: toNumber(row.rating),
  message: row.message,
  pagePath: row.page_path,
  status: row.status,
  adminNote: row.admin_note,
  statusUpdatedBy: row.status_updated_by,
  statusUpdatedAt: toNumber(row.status_updated_at),
  createdAt: toNumber(row.created_at) ?? 0,
  updatedAt: toNumber(row.updated_at) ?? 0,
});

async function ensureFeedbackSchema() {
  schemaReady ??= query(`
    CREATE TABLE IF NOT EXISTS arcade_feedback (
      id TEXT PRIMARY KEY,
      date_key TEXT NOT NULL,
      user_id TEXT,
      user_name TEXT,
      email TEXT,
      category TEXT NOT NULL,
      rating INTEGER,
      message TEXT NOT NULL,
      page_path TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      admin_note TEXT,
      status_updated_by TEXT,
      status_updated_at BIGINT,
      user_agent TEXT,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    );

    ALTER TABLE arcade_feedback
      ADD COLUMN IF NOT EXISTS admin_note TEXT;

    ALTER TABLE arcade_feedback
      ADD COLUMN IF NOT EXISTS status_updated_by TEXT;

    ALTER TABLE arcade_feedback
      ADD COLUMN IF NOT EXISTS status_updated_at BIGINT;

    CREATE INDEX IF NOT EXISTS idx_arcade_feedback_date
      ON arcade_feedback(date_key, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_arcade_feedback_user
      ON arcade_feedback(user_id, created_at DESC);
  `).then(() => undefined);

  await schemaReady;
}

function normalizeCategory(value: unknown): FeedbackCategory {
  if (typeof value !== 'string') return 'other';
  const normalized = value.trim().toLowerCase().replaceAll('-', '_');
  return FEEDBACK_CATEGORIES.has(normalized as FeedbackCategory)
    ? (normalized as FeedbackCategory)
    : 'other';
}

function normalizeRating(value: unknown) {
  if (value === null || value === undefined || value === '') return null;
  const rating = Number(value);
  if (!Number.isFinite(rating)) return null;
  return Math.max(1, Math.min(5, Math.round(rating)));
}

function normalizeEmail(value: string | null | undefined) {
  const email = clampText(value, MAX_EMAIL_LENGTH);
  if (!email) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.toLowerCase())) {
    throw new Error('Enter a valid contact email.');
  }
  return email;
}

const isDateKey = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);

export async function createFeedback(input: {
  userId?: string | null;
  userName?: string | null;
  email?: string | null;
  category?: unknown;
  rating?: unknown;
  message?: string | null;
  pagePath?: string | null;
  userAgent?: string | null;
}) {
  await ensureFeedbackSchema();

  const message = clampText(input.message, MAX_MESSAGE_LENGTH);
  if (!message || message.length < 10) {
    throw new Error('Feedback must be at least 10 characters.');
  }

  const category = normalizeCategory(input.category);
  const email = normalizeEmail(input.email);
  if (!email && !input.userId && ['account', 'purchase', 'privacy'].includes(category)) {
    throw new Error('Enter an email address so we can respond to this request.');
  }

  const now = Date.now();
  const id = crypto.randomUUID();

  const result = await query<FeedbackRow>(
    `INSERT INTO arcade_feedback (
      id,
      date_key,
      user_id,
      user_name,
      email,
      category,
      rating,
      message,
      page_path,
      status,
      admin_note,
      status_updated_by,
      status_updated_at,
      user_agent,
      created_at,
      updated_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'open', NULL, NULL, NULL, $10, $11, $12)
    RETURNING id, date_key, user_id, user_name, email, category, rating, message, page_path, status, admin_note, status_updated_by, status_updated_at, user_agent, created_at, updated_at`,
    [
      id,
      getDateKey(now),
      clampText(input.userId, 80),
      clampText(input.userName, MAX_NAME_LENGTH),
      email,
      category,
      normalizeRating(input.rating),
      message,
      clampText(input.pagePath, MAX_PATH_LENGTH),
      clampText(input.userAgent, MAX_USER_AGENT_LENGTH),
      now,
      now,
    ],
  );

  return rowToFeedback(result.rows[0]);
}

export async function listFeedbackForUser(userId: string, limit = 10) {
  await ensureFeedbackSchema();
  const result = await query<FeedbackRow>(
    `SELECT id, date_key, user_id, user_name, email, category, rating, message, page_path, status, admin_note, status_updated_by, status_updated_at, user_agent, created_at, updated_at
     FROM arcade_feedback
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [userId, Math.max(1, Math.min(50, Math.trunc(limit)))],
  );
  return result.rows.map(rowToFeedback);
}

export async function listFeedback(input: {
  status?: FeedbackStatus | 'all' | null;
  category?: FeedbackCategory | 'all' | null;
  query?: string | null;
  limit?: number;
}) {
  await ensureFeedbackSchema();

  const limit = Math.max(1, Math.min(200, Math.trunc(input.limit ?? 100)));
  const status =
    input.status && input.status !== 'all' && isFeedbackStatus(input.status)
      ? input.status
      : null;
  const category =
    input.category && input.category !== 'all'
      ? normalizeCategory(input.category)
      : null;
  const search = input.query?.trim().toLowerCase() || null;
  const clauses: string[] = [];
  const args: unknown[] = [];

  if (status) {
    args.push(status);
    clauses.push(`status = $${args.length}`);
  }
  if (category) {
    args.push(category);
    clauses.push(`category = $${args.length}`);
  }
  if (search) {
    const like = `%${search}%`;
    args.push(like, like, like, like, search);
    const start = args.length - 4;
    clauses.push(`(
      LOWER(message) LIKE $${start}
      OR LOWER(COALESCE(user_name, '')) LIKE $${start + 1}
      OR LOWER(COALESCE(email, '')) LIKE $${start + 2}
      OR LOWER(COALESCE(page_path, '')) LIKE $${start + 3}
      OR id = $${start + 4}
    )`);
  }
  args.push(limit);

  const result = await query<FeedbackRow>(
    `SELECT id, date_key, user_id, user_name, email, category, rating, message, page_path, status, admin_note, status_updated_by, status_updated_at, user_agent, created_at, updated_at
     FROM arcade_feedback
     ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
     ORDER BY created_at DESC
     LIMIT $${args.length}`,
    args,
  );
  return result.rows.map(rowToFeedback);
}

export async function getFeedbackById(id: string) {
  await ensureFeedbackSchema();
  const trimmedId = id.trim();
  if (!trimmedId) return null;

  const result = await query<FeedbackRow>(
    `SELECT id, date_key, user_id, user_name, email, category, rating, message, page_path, status, admin_note, status_updated_by, status_updated_at, user_agent, created_at, updated_at
     FROM arcade_feedback
     WHERE id = $1
     LIMIT 1`,
    [trimmedId],
  );
  return result.rows[0] ? rowToFeedback(result.rows[0]) : null;
}

export async function updateFeedbackStatus(input: {
  id: string;
  status: FeedbackStatus;
  adminNote?: string | null;
  actorUserId?: string | null;
}) {
  await ensureFeedbackSchema();
  if (!isFeedbackStatus(input.status)) {
    throw new Error('Invalid feedback status.');
  }

  const now = Date.now();
  const result = await query<FeedbackRow>(
    `UPDATE arcade_feedback
     SET status = $1,
         admin_note = $2,
         status_updated_by = $3,
         status_updated_at = $4,
         updated_at = $5
     WHERE id = $6
     RETURNING id, date_key, user_id, user_name, email, category, rating, message, page_path, status, admin_note, status_updated_by, status_updated_at, user_agent, created_at, updated_at`,
    [
      input.status,
      clampText(input.adminNote, MAX_ADMIN_NOTE_LENGTH),
      clampText(input.actorUserId, 80),
      now,
      now,
      input.id.trim(),
    ],
  );
  if (!result.rows[0]) throw new Error('Feedback not found.');
  return rowToFeedback(result.rows[0]);
}

export async function getFeedbackLogs(requestedDateKey?: string) {
  await ensureFeedbackSchema();

  const latestDateRow = await queryOne<{ date_key: string }>(
    `SELECT date_key
     FROM arcade_feedback
     ORDER BY date_key DESC
     LIMIT 1`,
  );

  const dateKey = isDateKey(requestedDateKey ?? '')
    ? (requestedDateKey as string)
    : (latestDateRow?.date_key ?? getDateKey());

  const [entriesResult, availableDatesResult] = await Promise.all([
    query<FeedbackRow>(
      `SELECT id, date_key, user_id, user_name, email, category, rating, message, page_path, status, admin_note, status_updated_by, status_updated_at, user_agent, created_at, updated_at
       FROM arcade_feedback
       WHERE date_key = $1
       ORDER BY created_at DESC`,
      [dateKey],
    ),
    query<{ date_key: string }>(
      `SELECT DISTINCT date_key
       FROM arcade_feedback
       ORDER BY date_key DESC
       LIMIT 30`,
    ),
  ]);

  return {
    dateKey,
    availableDates: availableDatesResult.rows.map((row) => row.date_key),
    entries: entriesResult.rows.map((row) => {
      const entry = rowToFeedback(row);
      return {
        id: entry.id,
        reportId: entry.id,
        ts: entry.createdAt,
        dateKey,
        type: 'report_created' as const,
        status: entry.status,
        reason: entry.category,
        targetType: 'thread' as const,
        targetId: entry.id,
        threadId: entry.id,
        action: `Feedback submitted: ${entry.category.replaceAll('_', ' ')}`,
        userId: entry.userId,
        userName: entry.userName,
        details: [
          entry.rating ? `rating=${entry.rating}` : null,
          entry.pagePath ? `path=${entry.pagePath}` : null,
          entry.email ? `email=${entry.email}` : null,
          entry.adminNote ? `admin_note=${entry.adminNote}` : null,
          entry.message,
        ]
          .filter(Boolean)
          .join(' | '),
      };
    }),
  };
}

function isFeedbackStatus(value: string): value is FeedbackStatus {
  return value === 'open' || value === 'resolved' || value === 'dismissed';
}

export async function serializeFeedbackLogs(requestedDateKey?: string) {
  const { dateKey, entries } = await getFeedbackLogs(requestedDateKey);
  const header = `Feedback logs for ${dateKey}\n`;
  if (entries.length === 0) return `${header}No entries.\n`;

  return `${header}${entries
    .map((entry) =>
      [
        new Date(entry.ts).toISOString(),
        entry.reason,
        entry.userName || entry.userId || 'guest',
        entry.action,
        entry.details,
      ]
        .filter(Boolean)
        .join(' | '),
    )
    .join('\n')}\n`;
}
