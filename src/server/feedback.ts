import crypto from 'node:crypto';

import { query, queryOne, withTransaction } from '@/server/db/client';

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

/** Safe ticket fields returned to players, without account/contact metadata. */
export type FeedbackTicketEntry = Pick<FeedbackEntry,
  'id' | 'category' | 'rating' | 'message' | 'pagePath' | 'status' |
  'adminNote' | 'createdAt' | 'updatedAt'>;

export type FeedbackComment = {
  id: string;
  authorName: string;
  authorRole: 'player' | 'admin';
  message: string;
  createdAt: number;
};

export type FeedbackViewer = { userId: string; isAdmin: boolean };

export class FeedbackError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = 'FeedbackError';
  }
}

export function toFeedbackTicketEntry(entry: FeedbackEntry): FeedbackTicketEntry {
  return {
    id: entry.id, category: entry.category, rating: entry.rating,
    message: entry.message, pagePath: entry.pagePath, status: entry.status,
    adminNote: entry.adminNote, createdAt: entry.createdAt, updatedAt: entry.updatedAt,
  };
}

type FeedbackCommentRow = {
  id: string;
  author_name: string;
  author_role: 'player' | 'admin';
  message: string;
  created_at: string | number;
};

const rowToComment = (row: FeedbackCommentRow): FeedbackComment => ({
  id: row.id, authorName: row.author_name, authorRole: row.author_role,
  message: row.message, createdAt: Number(row.created_at),
});

// Use the stored submission contact first, with account email for older tickets.
const EFFECTIVE_EMAIL = `COALESCE(NULLIF(email, ''), (
  SELECT NULLIF(a.email, '') FROM arcade_accounts a WHERE a.id = arcade_feedback.user_id
))`;
const FEEDBACK_SELECT = `id, date_key, user_id, user_name, ${EFFECTIVE_EMAIL} AS email,
  category, rating, message, page_path, status, admin_note, status_updated_by,
  status_updated_at, user_agent, created_at, updated_at`;

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
  if (value !== null && value !== undefined && typeof value !== 'string') {
    throw new FeedbackError('Expected text.', 400);
  }
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

    CREATE TABLE IF NOT EXISTS arcade_feedback_comments (
      id TEXT PRIMARY KEY,
      feedback_id TEXT NOT NULL REFERENCES arcade_feedback(id),
      author_user_id TEXT NOT NULL,
      author_name TEXT NOT NULL,
      author_role TEXT NOT NULL CHECK (author_role IN ('player', 'admin')),
      message TEXT NOT NULL CHECK (char_length(message) BETWEEN 1 AND 3000),
      created_at BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_feedback_comments_ticket
      ON arcade_feedback_comments(feedback_id, created_at, id);
    CREATE INDEX IF NOT EXISTS idx_feedback_comments_author
      ON arcade_feedback_comments(author_user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_arcade_feedback_updated
      ON arcade_feedback(updated_at DESC, id);

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
    throw new FeedbackError('Enter a valid contact email.', 400);
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

  if (typeof input.message !== 'string' || input.message.trim().length > MAX_MESSAGE_LENGTH) {
    throw new FeedbackError('Feedback must be 10 to 3000 characters.', 400);
  }
  const message = clampText(input.message, MAX_MESSAGE_LENGTH);
  if (!message || message.length < 10) {
    throw new FeedbackError('Feedback must be at least 10 characters.', 400);
  }

  const category = normalizeCategory(input.category);
  const email = normalizeEmail(input.email);
  if (!email && !input.userId && ['account', 'purchase', 'privacy'].includes(category)) {
    throw new FeedbackError('Enter an email address so we can respond to this request.', 400);
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
    `SELECT ${FEEDBACK_SELECT}
     FROM arcade_feedback
     WHERE user_id = $1
     ORDER BY updated_at DESC, id
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

  const limit = Math.max(1, Math.min(200, Number.isFinite(input.limit) ? Math.trunc(input.limit!) : 100));
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

  if (status === 'resolved') {
    clauses.push(`status IN ('resolved', 'dismissed')`);
  } else if (status) {
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
      OR LOWER(COALESCE(${EFFECTIVE_EMAIL}, '')) LIKE $${start + 2}
      OR LOWER(COALESCE(page_path, '')) LIKE $${start + 3}
      OR id = $${start + 4}
    )`);
  }
  args.push(limit);

  const result = await query<FeedbackRow>(
    `SELECT ${FEEDBACK_SELECT}
     FROM arcade_feedback
     ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
     ORDER BY updated_at DESC, id
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
    `SELECT ${FEEDBACK_SELECT}
     FROM arcade_feedback
     WHERE id = $1
     LIMIT 1`,
    [trimmedId],
  );
  return result.rows[0] ? rowToFeedback(result.rows[0]) : null;
}

/** Internal comment reader; HTTP/server consumers must authorize the ticket first. */
export async function listFeedbackComments(id: string, limit = 200) {
  await ensureFeedbackSchema();
  const boundedLimit = Number.isFinite(limit) ? Math.max(1, Math.min(200, Math.trunc(limit))) : 200;
  const result = await query<FeedbackCommentRow>(
    `SELECT id, author_name, author_role, message, created_at
     FROM arcade_feedback_comments WHERE feedback_id = $1
     ORDER BY created_at DESC, id DESC LIMIT $2`, [id, boundedLimit + 1],
  );
  return {
    comments: result.rows.slice(0, boundedLimit).reverse().map(rowToComment),
    hasMore: result.rows.length > boundedLimit,
  };
}

export async function getFeedbackConversation(id: string, viewer: FeedbackViewer) {
  const entry = await getFeedbackById(id);
  if (!entry || (!viewer.isAdmin && entry.userId !== viewer.userId)) {
    throw new FeedbackError('Feedback not found.', 404);
  }
  return {
    entry: toFeedbackTicketEntry(entry),
    ...await listFeedbackComments(entry.id),
    ...(viewer.isAdmin ? { contactEmail: entry.email } : {}),
  };
}

export function validateFeedbackCommentBody(body: unknown): string {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new FeedbackError('A message is required.', 400);
  }
  const input = body as Record<string, unknown>;
  if (Object.keys(input).some((key) => key !== 'message')) {
    throw new FeedbackError('Only a message can be submitted.', 400);
  }
  if (typeof input.message !== 'string') {
    throw new FeedbackError('A message is required.', 400);
  }
  const message = input.message.trim();
  if (!message || message.length > MAX_MESSAGE_LENGTH) {
    throw new FeedbackError('Replies must be 1 to 3000 characters.', 400);
  }
  return message;
}

export async function appendFeedbackComment(input: {
  id: string;
  userId: string;
  userName?: string | null;
  isAdmin: boolean;
  message: string;
}) {
  await ensureFeedbackSchema();
  const message = validateFeedbackCommentBody({ message: input.message });
  return withTransaction(async (client) => {
    // Status transitions take the same lock: a reply is either before closure or refused.
    const locked = await client.query<FeedbackRow>(
      `SELECT ${FEEDBACK_SELECT} FROM arcade_feedback WHERE id = $1 FOR UPDATE`, [input.id],
    );
    const row = locked.rows[0];
    if (!row || (!input.isAdmin && row.user_id !== input.userId)) {
      throw new FeedbackError('Feedback not found.', 404);
    }
    if (row.status !== 'open') {
      throw new FeedbackError('This ticket is resolved. An admin must reopen it before another reply.', 409);
    }
    const now = Math.max(Date.now(), Number(row.updated_at) + 1);
    if (!input.isAdmin) {
      // Persisted per-ticket bound survives restarts; the route also limits all owner replies.
      const recent = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM arcade_feedback_comments
         WHERE feedback_id = $1 AND author_user_id = $2 AND created_at > $3`,
        [input.id, input.userId, now - 60 * 60 * 1000],
      );
      if (Number(recent.rows[0].count) >= 20) {
        throw new FeedbackError('Too many replies. Please try again later.', 429);
      }
    }
    const comments = await client.query<FeedbackCommentRow>(
      `INSERT INTO arcade_feedback_comments
         (id, feedback_id, author_user_id, author_name, author_role, message, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, author_name, author_role, message, created_at`,
      [crypto.randomUUID(), row.id, input.userId,
        input.isAdmin ? 'Tixy team' : (clampText(input.userName, MAX_NAME_LENGTH) || 'Player'),
        input.isAdmin ? 'admin' : 'player', message, now],
    );
    const updated = await client.query<FeedbackRow>(
      `UPDATE arcade_feedback SET updated_at = $1 WHERE id = $2 RETURNING *`, [now, row.id],
    );
    return {
      entry: toFeedbackTicketEntry(rowToFeedback(updated.rows[0])),
      comment: rowToComment(comments.rows[0]),
      ownerUserId: row.user_id,
    };
  });
}

export async function updateFeedbackStatus(input: {
  id: string;
  status: FeedbackStatus;
  adminNote?: string | null;
  actorUserId?: string | null;
}) {
  await ensureFeedbackSchema();
  if (!isFeedbackStatus(input.status)) throw new FeedbackError('Invalid feedback status.', 400);
  if (input.adminNote !== undefined && input.adminNote !== null &&
      (typeof input.adminNote !== 'string' || input.adminNote.trim().length > MAX_ADMIN_NOTE_LENGTH)) {
    throw new FeedbackError('Admin notes must be at most 1200 characters.', 400);
  }
  return withTransaction(async (client) => {
    const previous = await client.query<FeedbackRow>(
      `SELECT ${FEEDBACK_SELECT} FROM arcade_feedback WHERE id = $1 FOR UPDATE`, [input.id.trim()],
    );
    const row = previous.rows[0];
    if (!row) throw new FeedbackError('Feedback not found.', 404);
    const now = Math.max(Date.now(), Number(row.updated_at) + 1);
    const note = clampText(input.adminNote, MAX_ADMIN_NOTE_LENGTH);
    // Legacy responses remain visible; replacement notes become additional messages.
    if (note && note !== row.admin_note) {
      if (row.status !== 'open') {
        throw new FeedbackError('This ticket is resolved. Reopen it before adding a reply.', 409);
      }
      await client.query(
        `INSERT INTO arcade_feedback_comments
           (id, feedback_id, author_user_id, author_name, author_role, message, created_at)
         VALUES ($1, $2, $3, 'Tixy team', 'admin', $4, $5)`,
        [crypto.randomUUID(), row.id, input.actorUserId || 'legacy-admin', note, now],
      );
    }
    const result = await client.query<FeedbackRow>(
      `UPDATE arcade_feedback
       SET status = $1, status_updated_by = $2, status_updated_at = $3, updated_at = $3
       WHERE id = $4 RETURNING *`,
      [input.status, clampText(input.actorUserId, 80), now, row.id],
    );
    return { ...rowToFeedback(result.rows[0]), email: row.email };
  });
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
      `SELECT ${FEEDBACK_SELECT}
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
