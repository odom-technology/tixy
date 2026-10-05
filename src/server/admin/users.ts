import { query, queryOne } from '@/server/db/client';
import { listAdminAudit, decodeCursor, encodeCursor, AuditCursorError } from '@/server/admin/audit';
import { getAntiCheatPlayRestriction } from '@/server/arcade/anti-cheat-logs';
import { currentSeason, seasonTierFromXp } from '@/server/arcade/battlepass/seasons';
import { getGameBanStatus } from '@/server/arcade/game-bans';
import { getAccountLevelState, levelFromXp } from '@/server/arcade/levels';
import { ledgerRowLabel, ledgerRowMetaSummary } from '@/server/arcade/rewards/wallet';

/* Read-only queries behind the admin user console. Nothing here writes, and
   nothing here returns a password hash, a session token or an IP address.
   Email is returned because operators look people up by it; it is matched on
   the server and never logged. */

/** A bad query parameter or cursor. The route turns it into a 400. */
export class AdminQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdminQueryError';
  }
}

const likeEscape = (value: string) => value.replace(/[\\%_]/g, (c) => `\\${c}`);

const clampLimit = (value: number | null | undefined, fallback: number, max: number) => {
  if (value === null || value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(max, Math.trunc(value)));
};

function cursorOrThrow(cursor: string): unknown[] {
  try {
    return decodeCursor(cursor);
  } catch (error) {
    if (error instanceof AuditCursorError) throw new AdminQueryError('Invalid cursor.');
    throw error;
  }
}

// ── User list ────────────────────────────────────────────────────────────────

export const USER_SORTS = ['created', 'last_login', 'balance', 'level'] as const;
export type UserSort = (typeof USER_SORTS)[number];

/* Level is a monotone function of lifetime XP (an old level floor can hold a
   level up past its XP, which this ordering ignores), so the level sort orders
   by XP. Balance is earned plus bought tickets. */
const SORT_EXPR: Record<UserSort, string> = {
  created: 'a.created_at',
  last_login: 'COALESCE(a.last_login_at, 0)',
  balance: 'COALESCE(w.credits, 0) + COALESCE(w.store_credits, 0)',
  level: 'COALESCE(x.xp, 0)',
};

export type AdminUserListInput = {
  q?: string | null;
  status?: string | null;
  role?: string | null;
  sort?: string | null;
  dir?: string | null;
  cursor?: string | null;
  limit?: number | null;
};

export type AdminUserRow = {
  id: string;
  username: string | null;
  displayName: string;
  imageUrl: string | null;
  email: string;
  status: string;
  roles: string[];
  createdAt: number;
  lastLoginAt: number | null;
  tickets: number;
  boughtTickets: number;
  level: number;
};

type UserDbRow = {
  id: string;
  username: string | null;
  image_url: string | null;
  email: string;
  status: string;
  roles: string[] | null;
  created_at: string;
  last_login_at: string | null;
  tickets: string;
  bought: string;
  xp: string;
  level_floor: number;
  sort_value: string;
};

const USER_FROM = `
  FROM arcade_accounts a
  LEFT JOIN wallets w ON w.user_id = a.id
  LEFT JOIN user_account_xp x ON x.user_id = a.id`;

export async function listAdminUsers(input: AdminUserListInput = {}) {
  const sort = (input.sort ?? 'created') as UserSort;
  if (!USER_SORTS.includes(sort)) throw new AdminQueryError('Invalid sort.');
  const dir = (input.dir ?? 'desc').toLowerCase();
  if (dir !== 'asc' && dir !== 'desc') throw new AdminQueryError('Invalid dir.');
  const status = input.status ?? 'all';
  if (!['active', 'suspended', 'deleted', 'all'].includes(status)) {
    throw new AdminQueryError('Invalid status.');
  }
  const role = input.role ?? 'all';
  if (!['admin', 'player', 'all'].includes(role)) throw new AdminQueryError('Invalid role.');
  const limit = clampLimit(input.limit, 50, 100);

  const params: unknown[] = [];
  const add = (value: unknown) => {
    params.push(value);
    return `$${params.length}`;
  };
  const clauses: string[] = [];
  if (status !== 'all') clauses.push(`a.status = ${add(status)}`);
  // `player` means an account that does not hold the admin role.
  if (role === 'admin') {
    clauses.push(`EXISTS (SELECT 1 FROM arcade_account_roles r WHERE r.user_id = a.id AND r.role = 'admin')`);
  } else if (role === 'player') {
    clauses.push(`NOT EXISTS (SELECT 1 FROM arcade_account_roles r WHERE r.user_id = a.id AND r.role = 'admin')`);
  }
  const q = input.q?.trim();
  if (q) {
    const like = add(`%${likeEscape(q.toLowerCase())}%`);
    const exact = add(q);
    clauses.push(
      `(a.username_normalized LIKE ${like} ESCAPE '\\'
        OR a.email_normalized LIKE ${like} ESCAPE '\\'
        OR a.id = ${exact})`,
    );
  }
  const totalParams = [...params];
  const totalClauses = [...clauses];

  const expr = SORT_EXPR[sort];
  const cmp = dir === 'asc' ? '>' : '<';
  if (input.cursor) {
    const parts = cursorOrThrow(input.cursor);
    const [cSort, cDir, value, id] = parts;
    if (
      parts.length !== 4 ||
      cSort !== sort ||
      cDir !== dir ||
      typeof value !== 'number' ||
      !Number.isFinite(value) ||
      typeof id !== 'string' ||
      !id
    ) {
      throw new AdminQueryError('Invalid cursor.');
    }
    const v = add(value);
    const i = add(id);
    clauses.push(`((${expr})::bigint, a.id) ${cmp} (${v}::bigint, ${i}::text)`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const order = dir.toUpperCase();
  const limitParam = add(limit + 1);
  const result = await query<UserDbRow>(
    `SELECT a.id, a.username, a.image_url, a.email, a.status,
            (SELECT COALESCE(array_agg(r.role ORDER BY r.role), '{}') FROM arcade_account_roles r WHERE r.user_id = a.id) AS roles,
            a.created_at::text AS created_at, a.last_login_at::text AS last_login_at,
            COALESCE(w.credits, 0)::text AS tickets, COALESCE(w.store_credits, 0)::text AS bought,
            COALESCE(x.xp, 0)::text AS xp, COALESCE(x.level_floor, 1) AS level_floor,
            (${expr})::bigint::text AS sort_value
     ${USER_FROM}
     ${where}
     ORDER BY (${expr})::bigint ${order}, a.id ${order}
     LIMIT ${limitParam}`,
    params,
  );
  const totalWhere = totalClauses.length ? `WHERE ${totalClauses.join(' AND ')}` : '';
  const total = await query<{ n: string }>(
    `SELECT COUNT(*)::text AS n ${USER_FROM} ${totalWhere}`,
    totalParams,
  );

  const page = result.rows.slice(0, limit);
  const last = page[page.length - 1];
  const users: AdminUserRow[] = page.map((row) => ({
    id: row.id,
    username: row.username,
    displayName: row.username ?? row.email.split('@')[0] ?? 'player',
    imageUrl: row.image_url,
    email: row.email,
    status: row.status,
    roles: row.roles && row.roles.length > 0 ? row.roles : ['player'],
    createdAt: Number(row.created_at),
    lastLoginAt: row.last_login_at === null ? null : Number(row.last_login_at),
    tickets: Number(row.tickets),
    boughtTickets: Number(row.bought),
    level: levelFromXp(Number(row.xp), row.level_floor),
  }));
  return {
    users,
    nextCursor:
      result.rows.length > limit && last
        ? encodeCursor([sort, dir, Number(last.sort_value), last.id])
        : null,
    total: Number(total.rows[0]?.n ?? 0),
  };
}

// ── One profile ──────────────────────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;

export async function getAdminUserProfile(userId: string) {
  const account = await queryOne<UserDbRow & { updated_at: string; deleted_at: string | null }>(
    `SELECT a.id, a.username, a.image_url, a.email, a.status,
            (SELECT COALESCE(array_agg(r.role ORDER BY r.role), '{}') FROM arcade_account_roles r WHERE r.user_id = a.id) AS roles,
            a.created_at::text AS created_at, a.last_login_at::text AS last_login_at,
            a.deleted_at::text AS deleted_at, a.updated_at::text AS updated_at,
            COALESCE(w.credits, 0)::text AS tickets, COALESCE(w.store_credits, 0)::text AS bought,
            COALESCE(x.xp, 0)::text AS xp, COALESCE(x.level_floor, 1) AS level_floor,
            '0' AS sort_value
     ${USER_FROM}
     WHERE a.id = $1`,
    [userId],
  );
  if (!account) return null;

  const now = Date.now();
  const season = currentSeason(now);
  const [
    levelState,
    seasonRow,
    owned,
    equipped,
    gameBan,
    antiCheatRestriction,
    moderation,
    audit,
    earned,
    runs,
    flags,
    purchases,
  ] = await Promise.all([
    getAccountLevelState(userId),
    queryOne<{ xp: string }>(
      `SELECT xp::text AS xp FROM user_season_progress WHERE user_id = $1 AND season_key = $2`,
      [userId, season.key],
    ),
    queryOne<{ n: string }>(`SELECT COUNT(*)::text AS n FROM user_owned_items WHERE user_id = $1`, [userId]),
    queryOne<{ n: string }>(`SELECT COUNT(*)::text AS n FROM user_equipped_items WHERE user_id = $1`, [userId]),
    getGameBanStatus(userId),
    getAntiCheatPlayRestriction(userId),
    query<{
      id: string;
      action: string;
      reason: string | null;
      actor_user_id: string | null;
      actor_name: string | null;
      created_at: string;
      expires_at: string | null;
    }>(
      `SELECT m.id, m.action, m.reason, m.actor_user_id, u.username AS actor_name,
              m.created_at::text AS created_at, m.expires_at::text AS expires_at
       FROM arcade_account_moderation_actions m
       LEFT JOIN arcade_accounts u ON u.id = m.actor_user_id
       WHERE m.user_id = $1
       ORDER BY m.created_at DESC
       LIMIT 20`,
      [userId],
    ),
    listAdminAudit({ targetType: 'user', targetId: userId, limit: 20, skipTotal: true }),
    query<{ days: number; tickets: string }>(
      `SELECT d.days, COALESCE(SUM(l.amount), 0)::text AS tickets
       FROM (VALUES (7), (30)) AS d(days)
       LEFT JOIN currency_ledger l
         ON l.user_id = $1 AND l.source_type = 'game_reward' AND l.created_at >= $2::bigint - d.days * $3::bigint
       GROUP BY d.days`,
      [userId, now, DAY_MS],
    ),
    query<{ days: number; runs: string }>(
      `SELECT d.days, COUNT(e.id)::text AS runs
       FROM (VALUES (7), (30)) AS d(days)
       LEFT JOIN game_score_events e
         ON e.od_user_id = $1 AND e.created_at >= $2::bigint - d.days * $3::bigint
       GROUP BY d.days`,
      [userId, now, DAY_MS],
    ),
    query<{
      id: string;
      ts: string;
      game_type: string;
      score: number;
      result: string;
      reason: string | null;
      stage: string | null;
    }>(
      `SELECT id, ts::text AS ts, game_type, score, result, reason, stage
       FROM anti_cheat_logs
       WHERE user_id = $1 AND result IN ('flag', 'reject')
       ORDER BY ts DESC
       LIMIT 10`,
      [userId],
    ),
    query<{
      id: string;
      pack_id: string;
      tickets_granted: number;
      amount_total: number;
      currency: string;
      status: string;
      created_at: string;
      fulfilled_at: string | null;
      reversed_at: string | null;
      reversal_status: string | null;
    }>(
      `SELECT id, pack_id, tickets_granted, amount_total, currency, status,
              created_at::text AS created_at, fulfilled_at::text AS fulfilled_at,
              reversed_at::text AS reversed_at, reversal_status
       FROM ticket_purchases
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 20`,
      [userId],
    ),
  ]);

  const byDays = <T extends { days: number }>(rows: T[], days: number) =>
    rows.find((row) => Number(row.days) === days);
  const seasonXp = Number(seasonRow?.xp ?? 0);
  const roles = account.roles && account.roles.length > 0 ? account.roles : ['player'];

  return {
    id: account.id,
    username: account.username,
    displayName: account.username ?? account.email.split('@')[0] ?? 'player',
    imageUrl: account.image_url,
    email: account.email,
    status: account.status,
    roles,
    createdAt: Number(account.created_at),
    updatedAt: Number(account.updated_at),
    lastLoginAt: account.last_login_at === null ? null : Number(account.last_login_at),
    deletedAt: account.deleted_at === null ? null : Number(account.deleted_at),
    wallet: { tickets: Number(account.tickets), boughtTickets: Number(account.bought) },
    level: { level: levelState.level, xp: levelState.xp, tier: levelState.tier },
    season: {
      key: season.key,
      xp: seasonXp,
      tier: seasonTierFromXp(season, seasonXp),
      maxTier: season.maxTier,
    },
    itemsOwned: Number(owned?.n ?? 0),
    itemsEquipped: Number(equipped?.n ?? 0),
    gameBan,
    antiCheatRestriction,
    moderationHistory: moderation.rows.map((row) => ({
      id: row.id,
      action: row.action,
      reason: row.reason,
      actorUserId: row.actor_user_id,
      actorName: row.actor_name,
      createdAt: Number(row.created_at),
      expiresAt: row.expires_at === null ? null : Number(row.expires_at),
    })),
    audit: audit.rows,
    activity: {
      last7Days: {
        runs: Number(byDays(runs.rows, 7)?.runs ?? 0),
        tickets: Number(byDays(earned.rows, 7)?.tickets ?? 0),
      },
      last30Days: {
        runs: Number(byDays(runs.rows, 30)?.runs ?? 0),
        tickets: Number(byDays(earned.rows, 30)?.tickets ?? 0),
      },
    },
    antiCheatFlags: flags.rows.map((row) => ({
      id: row.id,
      ts: Number(row.ts),
      gameType: row.game_type,
      score: Number(row.score),
      result: row.result,
      reason: row.reason,
      stage: row.stage,
    })),
    purchases: purchases.rows.map((row) => ({
      id: row.id,
      packId: row.pack_id,
      ticketsGranted: Number(row.tickets_granted),
      amountTotal: Number(row.amount_total),
      currency: row.currency,
      status: row.status,
      createdAt: Number(row.created_at),
      fulfilledAt: row.fulfilled_at === null ? null : Number(row.fulfilled_at),
      reversedAt: row.reversed_at === null ? null : Number(row.reversed_at),
      reversalStatus: row.reversal_status,
    })),
  };
}

// ── Ledger ───────────────────────────────────────────────────────────────────

export type AdminLedgerInput = {
  userId: string;
  source?: string | null;
  ledger?: string | null;
  cursor?: string | null;
  limit?: number | null;
};

type LedgerDbRow = {
  id: string;
  ledger: 'earned' | 'bought';
  source_type: string;
  amount: string;
  balance_after: string;
  created_at: string;
  created_by: string | null;
  created_by_name: string | null;
  meta_json: string | null;
};

export async function listUserLedger(input: AdminLedgerInput) {
  const ledger = input.ledger ?? 'all';
  if (!['earned', 'bought', 'all'].includes(ledger)) throw new AdminQueryError('Invalid ledger.');
  const limit = clampLimit(input.limit, 50, 100);
  const source = input.source?.trim() || null;
  if (source && !/^[\w.-]{1,60}$/.test(source)) throw new AdminQueryError('Invalid source.');

  const params: unknown[] = [input.userId];
  const sourceClause = source ? (params.push(source), `AND source_type = $${params.length}`) : '';
  const branch = (table: string, label: string) => `
    SELECT id, '${label}' AS ledger, source_type, amount::text AS amount, balance_after::text AS balance_after,
           created_at, created_by, meta_json
    FROM ${table}
    WHERE user_id = $1 ${sourceClause}`;
  const branches: string[] = [];
  if (ledger !== 'bought') branches.push(branch('currency_ledger', 'earned'));
  if (ledger !== 'earned') branches.push(branch('store_credit_ledger', 'bought'));

  let keyset = '';
  if (input.cursor) {
    const parts = cursorOrThrow(input.cursor);
    const [createdAt, cLedger, id] = parts;
    if (
      parts.length !== 3 ||
      typeof createdAt !== 'number' ||
      !Number.isSafeInteger(createdAt) ||
      (cLedger !== 'earned' && cLedger !== 'bought') ||
      typeof id !== 'string' ||
      !id
    ) {
      throw new AdminQueryError('Invalid cursor.');
    }
    params.push(createdAt, cLedger, id);
    keyset = `WHERE (m.created_at, m.ledger, m.id) < ($${params.length - 2}::bigint, $${params.length - 1}::text, $${params.length}::text)`;
  }
  params.push(limit + 1);
  const result = await query<LedgerDbRow>(
    `SELECT m.id, m.ledger, m.source_type, m.amount, m.balance_after, m.created_at::text AS created_at,
            m.created_by, u.username AS created_by_name, m.meta_json
     FROM (${branches.join(' UNION ALL ')}) m
     LEFT JOIN arcade_accounts u ON u.id = m.created_by
     ${keyset}
     ORDER BY m.created_at DESC, m.ledger DESC, m.id DESC
     LIMIT $${params.length}`,
    params,
  );

  const page = result.rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    rows: page.map((row) => ({
      id: row.id,
      ledger: row.ledger,
      sourceType: row.source_type,
      label: ledgerRowLabel(row.source_type, row.meta_json),
      amount: Number(row.amount),
      balanceAfter: Number(row.balance_after),
      createdAt: Number(row.created_at),
      createdBy: row.created_by_name ?? row.created_by,
      meta: ledgerRowMetaSummary(row.meta_json),
    })),
    nextCursor:
      result.rows.length > limit && last
        ? encodeCursor([Number(last.created_at), last.ledger, last.id])
        : null,
  };
}
