import { query } from '@/server/db/client';

/* The admin audit log. Append-only: this module inserts and reads, nothing
   updates or deletes a row, and nothing should. A correction is a new row.

   Details are a record of what was asked for, not a copy of the request: only
   allowlisted keys, only scalars and short arrays of scalars, strings cut to
   300 characters, and any value that looks like an email, a secret, image
   data or a message body is dropped. */

export type AuditSpec = {
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  reason?: string | null;
  details?: Record<string, unknown> | null;
};

export type AdminAuditEntry = AuditSpec & {
  actorUserId: string;
  actorName?: string | null;
  method: string;
  route: string;
  status: number;
  correlationId?: string | null;
};

const DETAIL_KEYS = new Set([
  'action',
  'userId',
  'itemId',
  'itemIds',
  'amount',
  'currencyType',
  'reason',
  'role',
  'status',
  'table',
  'id',
  'game',
  'mode',
  'grantToAll',
  'removeFromAll',
  'banHours',
  'banMinutes',
  'banIndefinite',
  'expiresAt',
  'active',
  'key',
  'section',
  'month',
  'rules',
  'slugs',
  'dryRun',
  'date',
  'puzzleDate',
  'clearAll',
  // visibility fields
  'creditsEnabled',
  'gameCreditsEnabled',
  // route outcome counts and ops
  'op',
  'count',
  'visible',
  'hidden',
  'blackout',
  'slug',
]);

const MAX_STRING = 300;
const MAX_ARRAY = 50;

const EMAIL_RE = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const DATA_URI_RE = /^data:/i;
const JWT_RE = /^eyJ[\w-]+\.[\w-]+\.[\w-]+$/;
const BLOB_RE = /^[A-Za-z0-9+/_=-]{120,}$/;

function sanitizeScalar(value: unknown): string | number | boolean | null | undefined {
  if (value === null) return null;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (
    EMAIL_RE.test(trimmed) ||
    DATA_URI_RE.test(trimmed) ||
    JWT_RE.test(trimmed) ||
    BLOB_RE.test(trimmed)
  ) {
    return undefined;
  }
  return trimmed.length > MAX_STRING ? trimmed.slice(0, MAX_STRING) : trimmed;
}

export function sanitizeAuditDetails(input: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return out;
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (!DETAIL_KEYS.has(key)) continue;
    if (Array.isArray(value)) {
      const items = value
        .slice(0, MAX_ARRAY)
        .map(sanitizeScalar)
        .filter((item) => item !== undefined);
      out[key] = items;
      continue;
    }
    const scalar = sanitizeScalar(value);
    if (scalar !== undefined) out[key] = scalar;
  }
  return out;
}

function cut(value: string | null | undefined, max: number) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

/** Writes one row. Never throws: a failed audit write is logged and returns false. */
export async function recordAdminAction(entry: AdminAuditEntry): Promise<boolean> {
  try {
    const reasonRaw = cut(entry.reason ?? null, 500);
    const reason = reasonRaw && !EMAIL_RE.test(reasonRaw) ? reasonRaw : null;
    await query(
      `INSERT INTO admin_audit_log
         (created_at, actor_user_id, actor_name, action, method, route,
          target_type, target_id, reason, details, status, correlation_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12)`,
      [
        Date.now(),
        entry.actorUserId,
        cut(entry.actorName ?? null, 120),
        cut(entry.action, 120) ?? 'unknown',
        entry.method.toUpperCase(),
        entry.route.split('?')[0].slice(0, 300),
        cut(entry.targetType ?? null, 60),
        cut(entry.targetId ?? null, 200),
        reason,
        JSON.stringify(sanitizeAuditDetails(entry.details ?? {})),
        Math.trunc(entry.status),
        cut(entry.correlationId ?? null, 100),
      ],
    );
    return true;
  } catch (err) {
    console.error('[admin-audit] write failed', err instanceof Error ? err.message : 'unknown');
    return false;
  }
}

export type AuditFilters = {
  actor?: string | null;
  action?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  from?: number | null;
  to?: number | null;
};

export type AuditRow = {
  id: string;
  createdAt: number;
  actorUserId: string;
  actorName: string | null;
  action: string;
  method: string;
  route: string;
  targetType: string | null;
  targetId: string | null;
  targetName: string | null;
  reason: string | null;
  details: Record<string, unknown>;
  status: number;
  correlationId: string | null;
};

export class AuditCursorError extends Error {
  constructor() {
    super('Invalid cursor.');
    this.name = 'AuditCursorError';
  }
}

export function encodeCursor(parts: unknown[]) {
  return Buffer.from(JSON.stringify(parts), 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string): unknown[] {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (!Array.isArray(parsed)) throw new Error('shape');
    return parsed;
  } catch {
    throw new AuditCursorError();
  }
}

function decodeAuditCursor(cursor: string): { createdAt: number; id: string } {
  const parts = decodeCursor(cursor);
  const [createdAt, id] = parts;
  if (
    parts.length !== 2 ||
    typeof createdAt !== 'number' ||
    !Number.isSafeInteger(createdAt) ||
    typeof id !== 'string' ||
    !/^\d{1,18}$/.test(id)
  ) {
    throw new AuditCursorError();
  }
  return { createdAt, id };
}

type DbRow = {
  id: string;
  created_at: string;
  actor_user_id: string;
  actor_name: string | null;
  actor_username: string | null;
  action: string;
  method: string;
  route: string;
  target_type: string | null;
  target_id: string | null;
  target_username: string | null;
  reason: string | null;
  details: Record<string, unknown> | null;
  status: number;
  correlation_id: string | null;
};

function toRow(row: DbRow): AuditRow {
  return {
    id: row.id,
    createdAt: Number(row.created_at),
    actorUserId: row.actor_user_id,
    actorName: row.actor_username ?? row.actor_name,
    action: row.action,
    method: row.method,
    route: row.route,
    targetType: row.target_type,
    targetId: row.target_id,
    targetName: row.target_username,
    reason: row.reason,
    details: row.details ?? {},
    status: row.status,
    correlationId: row.correlation_id,
  };
}

function buildWhere(filters: AuditFilters, params: unknown[]) {
  const clauses: string[] = [];
  const add = (value: unknown) => {
    params.push(value);
    return `$${params.length}`;
  };
  const actor = filters.actor?.trim();
  if (actor) {
    const a = add(actor);
    const lower = add(actor.toLowerCase());
    clauses.push(
      `(l.actor_user_id = ${a} OR l.actor_user_id IN (SELECT id FROM arcade_accounts WHERE username_normalized = ${lower}))`,
    );
  }
  const action = filters.action?.trim();
  if (action) {
    if (action.endsWith('*')) {
      const prefix = action.slice(0, -1).replace(/[\\%_]/g, (c) => `\\${c}`);
      clauses.push(`l.action LIKE ${add(`${prefix}%`)}`);
    } else {
      clauses.push(`l.action = ${add(action)}`);
    }
  }
  if (filters.targetType?.trim()) clauses.push(`l.target_type = ${add(filters.targetType.trim())}`);
  if (filters.targetId?.trim()) clauses.push(`l.target_id = ${add(filters.targetId.trim())}`);
  if (typeof filters.from === 'number') clauses.push(`l.created_at >= ${add(filters.from)}`);
  if (typeof filters.to === 'number') clauses.push(`l.created_at <= ${add(filters.to)}`);
  return clauses;
}

const SELECT = `
  SELECT l.id::text AS id, l.created_at::text AS created_at, l.actor_user_id, l.actor_name,
         a.username AS actor_username,
         l.action, l.method, l.route, l.target_type, l.target_id,
         t.username AS target_username,
         l.reason, l.details, l.status, l.correlation_id
  FROM admin_audit_log l
  LEFT JOIN arcade_accounts a ON a.id = l.actor_user_id
  LEFT JOIN arcade_accounts t ON l.target_type = 'user' AND t.id = l.target_id`;

export type AuditListInput = AuditFilters & {
  cursor?: string | null;
  limit?: number | null;
  /** Skips the COUNT, for callers that page through and don't show a total. */
  skipTotal?: boolean;
};

export type AuditListResult = {
  rows: AuditRow[];
  nextCursor: string | null;
  total: number;
};

export async function listAdminAudit(input: AuditListInput = {}): Promise<AuditListResult> {
  const limit = Math.max(1, Math.min(200, Math.trunc(input.limit ?? 50) || 50));
  const params: unknown[] = [];
  const clauses = buildWhere(input, params);
  const countParams = [...params];
  const countClauses = [...clauses];

  if (input.cursor) {
    const { createdAt, id } = decodeAuditCursor(input.cursor);
    params.push(createdAt, id);
    clauses.push(`(l.created_at, l.id) < ($${params.length - 1}, $${params.length}::bigint)`);
  }
  params.push(limit + 1);
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const result = await query<DbRow>(
    `${SELECT} ${where} ORDER BY l.created_at DESC, l.id DESC LIMIT $${params.length}`,
    params,
  );
  const countWhere = countClauses.length ? `WHERE ${countClauses.join(' AND ')}` : '';
  const total = input.skipTotal
    ? null
    : await query<{ n: string }>(
        `SELECT COUNT(*)::text AS n FROM admin_audit_log l ${countWhere}`,
        countParams,
      );

  const page = result.rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    rows: page.map(toRow),
    nextCursor:
      result.rows.length > limit && last ? encodeCursor([Number(last.created_at), last.id]) : null,
    total: Number(total?.rows[0]?.n ?? 0),
  };
}

export const AUDIT_EXPORT_CAP = 5000;

/** Filtered rows, newest first, in batches, up to the cap. For the CSV export. */
export async function* streamAdminAudit(
  filters: AuditFilters,
  cap = AUDIT_EXPORT_CAP,
): AsyncGenerator<AuditRow[]> {
  let cursor: string | null = null;
  let sent = 0;
  while (sent < cap) {
    const batch: AuditListResult = await listAdminAudit({
      ...filters,
      cursor,
      limit: Math.min(200, cap - sent),
      skipTotal: true,
    });
    if (batch.rows.length === 0) return;
    sent += batch.rows.length;
    yield batch.rows;
    if (!batch.nextCursor) return;
    cursor = batch.nextCursor;
  }
}
