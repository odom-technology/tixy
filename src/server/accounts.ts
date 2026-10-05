import crypto from 'node:crypto';

import type { QueryResult, QueryResultRow } from 'pg';

import type { ArcadeIdentity } from '@/server/auth';
import { query, withTransaction } from '@/server/db/client';
import { broadcast } from '@/server/events';
import {
  DEFAULT_NEW_ACCOUNT_AVATAR,
  adminAvatarBySrc,
  isAvatarAssetPath,
  isDefaultAvatarSrc,
} from '@/features/users/avatars';

export const ACCOUNT_SESSION_COOKIE = 'arcade_session';
const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_LENGTH = 256;
const SCRYPT_N = 131_072;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEY_LENGTH = 64;
const SCRYPT_MAXMEM = 256 * 1024 * 1024;

/* Secure cookies only when the app is actually served over HTTPS —
   NODE_ENV alone breaks LAN/self-hosted HTTP, where browsers silently
   drop Secure cookies and sign-in appears to do nothing. */
export function shouldUseSecureSessionCookies() {
  const appUrl = process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? '';
  if (appUrl) return appUrl.startsWith('https://');
  return process.env.NODE_ENV === 'production';
}

export type AccountRole = 'admin' | 'player' | 'guest';
export type AccountStatus = 'active' | 'suspended' | 'deleted';

export type AccountPublicProfile = {
  id: string;
  email: string;
  username: string | null;
  imageUrl: string | null;
  status: AccountStatus;
  roles: AccountRole[];
  createdAt: number;
  updatedAt: number;
  lastLoginAt: number | null;
  deletedAt: number | null;
};

export type AccountSessionSummary = {
  id: string;
  isCurrent: boolean;
  createdAt: number;
  expiresAt: number;
  revokedAt: number | null;
  userAgent: string | null;
  ipAddress: string | null;
};

type AccountRow = {
  id: string;
  email: string;
  email_normalized: string;
  username: string | null;
  username_normalized: string | null;
  image_url: string | null;
  password_hash: string | null;
  status: AccountStatus;
  metadata_json: string | null;
  created_at: string | number;
  updated_at: string | number;
  last_login_at: string | number | null;
  deleted_at: string | number | null;
};

type SessionRow = {
  token_hash: string;
  user_id: string;
  created_at: string | number;
  expires_at: string | number;
  revoked_at: string | number | null;
  user_agent: string | null;
  ip_address: string | null;
};

type Queryable = {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<T>>;
};

const ACCOUNT_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const USERNAME_RE = /^[a-zA-Z0-9_-]{3,24}$/;
const DATA_KEY_RE = /^[a-zA-Z0-9_.:-]{1,80}$/;
const RESERVED_USERNAMES = new Set([
  'admin',
  'administrator',
  'api',
  'arcade',
  'me',
  'root',
  'staff',
  'support',
  'system',
]);

let schemaReady: Promise<void> | null = null;

async function ensureAccountSchema() {
  schemaReady ??= query(`
    CREATE TABLE IF NOT EXISTS arcade_accounts (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      email_normalized TEXT NOT NULL UNIQUE,
      username TEXT,
      username_normalized TEXT UNIQUE,
      image_url TEXT,
      password_hash TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      metadata_json TEXT,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL,
      last_login_at BIGINT,
      deleted_at BIGINT
    );

    CREATE TABLE IF NOT EXISTS arcade_account_roles (
      user_id TEXT NOT NULL REFERENCES arcade_accounts(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      granted_at BIGINT NOT NULL,
      granted_by TEXT,
      PRIMARY KEY (user_id, role)
    );

    CREATE TABLE IF NOT EXISTS arcade_account_sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES arcade_accounts(id) ON DELETE CASCADE,
      created_at BIGINT NOT NULL,
      expires_at BIGINT NOT NULL,
      revoked_at BIGINT,
      user_agent TEXT,
      ip_address TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_arcade_account_sessions_user
      ON arcade_account_sessions(user_id, expires_at);

    CREATE TABLE IF NOT EXISTS arcade_account_data (
      user_id TEXT NOT NULL REFERENCES arcade_accounts(id) ON DELETE CASCADE,
      key TEXT NOT NULL,
      value_json TEXT NOT NULL,
      updated_at BIGINT NOT NULL,
      PRIMARY KEY (user_id, key)
    );

    CREATE TABLE IF NOT EXISTS arcade_account_moderation_actions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES arcade_accounts(id) ON DELETE CASCADE,
      action TEXT NOT NULL,
      reason TEXT,
      actor_user_id TEXT,
      created_at BIGINT NOT NULL,
      expires_at BIGINT,
      metadata_json TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_arcade_account_moderation_user
      ON arcade_account_moderation_actions(user_id, created_at);
  `).then(() => undefined);

  await schemaReady;
}

const accountSelect = `
  id,
  email,
  email_normalized,
  username,
  username_normalized,
  image_url,
  password_hash,
  status,
  metadata_json,
  created_at,
  updated_at,
  last_login_at,
  deleted_at
`;

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function normalizeUsername(username: string | null | undefined) {
  const trimmed = username?.trim();
  return trimmed ? trimmed.toLowerCase() : null;
}

export function validateEmail(email: string) {
  const normalized = normalizeEmail(email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new Error('Enter a valid email address.');
  }
  return normalized;
}

export function validateUsername(username: string | null | undefined) {
  const normalized = normalizeUsername(username);
  if (!normalized) return null;
  if (!USERNAME_RE.test(username!.trim())) {
    throw new Error(
      'Username must be 3-24 characters using letters, numbers, underscores, or hyphens.',
    );
  }
  if (RESERVED_USERNAMES.has(normalized)) {
    throw new Error('That username is reserved.');
  }
  return normalized;
}

function toNumber(value: string | number | null | undefined) {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function toPublicAccount(row: AccountRow): Promise<AccountPublicProfile> {
  const activeRow = await applyExpiredSuspension(row);
  const roles = await getRolesForUser(activeRow.id);
  return {
    id: activeRow.id,
    email: activeRow.email,
    username: activeRow.username ?? null,
    imageUrl: visibleAvatarSource(activeRow.image_url, roles),
    status: activeRow.status,
    roles,
    createdAt: toNumber(activeRow.created_at) ?? 0,
    updatedAt: toNumber(activeRow.updated_at) ?? 0,
    lastLoginAt: toNumber(activeRow.last_login_at),
    deletedAt: toNumber(activeRow.deleted_at),
  };
}

function visibleAvatarSource(source: string | null, roles: AccountRole[]): string | null {
  const adminAvatar = source ? adminAvatarBySrc(source) : null;
  if (adminAvatar) return roles.includes('admin') ? adminAvatar.src : null;
  return source;
}

function toSessionSummary(
  row: SessionRow,
  currentTokenHash: string | null,
): AccountSessionSummary {
  return {
    id: row.token_hash,
    isCurrent: Boolean(currentTokenHash && row.token_hash === currentTokenHash),
    createdAt: toNumber(row.created_at) ?? 0,
    expiresAt: toNumber(row.expires_at) ?? 0,
    revokedAt: toNumber(row.revoked_at),
    userAgent: row.user_agent,
    ipAddress: row.ip_address,
  };
}

async function getAccountRowById(userId: string, client?: Queryable) {
  await ensureAccountSchema();
  const result = await (client ?? { query }).query<AccountRow>(
    `SELECT ${accountSelect}
     FROM arcade_accounts
     WHERE id = $1`,
    [userId],
  );
  return result.rows[0] ?? null;
}

export async function getRolesForUser(userId: string): Promise<AccountRole[]> {
  await ensureAccountSchema();
  const result = await query<{ role: string }>(
    `SELECT role
     FROM arcade_account_roles
     WHERE user_id = $1
     ORDER BY role`,
    [userId],
  );
  return result.rows.map((row) => row.role).filter(isAccountRole);
}

export function isAccountRole(role: string): role is AccountRole {
  return role === 'admin' || role === 'player' || role === 'guest';
}

export async function getAccountById(userId: string) {
  const row = await getAccountRowById(userId);
  return row ? toPublicAccount(row) : null;
}

/** Batch lookup — public profiles for many ids at once (for message/conversation hydration). */
export async function getAccountsByIds(ids: string[]) {
  if (ids.length === 0) return [];
  await ensureAccountSchema();
  const result = await query<AccountRow>(
    `SELECT ${accountSelect}
     FROM arcade_accounts
     WHERE id = ANY($1::text[])`,
    [ids],
  );
  return Promise.all(result.rows.map(toPublicAccount));
}

/** Public player discovery must never match or expose private email addresses. */
export async function searchAccountsByUsername(search: string, limit = 12) {
  await ensureAccountSchema();
  const normalized = search.trim().toLowerCase();
  if (!normalized) return [];
  const result = await query<AccountRow>(
    `SELECT ${accountSelect}
       FROM arcade_accounts
      WHERE status = 'active'
        AND username_normalized LIKE $1
      ORDER BY CASE WHEN username_normalized = $2 THEN 0 ELSE 1 END,
               username_normalized ASC
      LIMIT $3`,
    [`%${normalized}%`, normalized, Math.max(1, Math.min(30, Math.trunc(limit)))],
  );
  return Promise.all(result.rows.map(toPublicAccount));
}

export async function getAccountByEmail(email: string) {
  await ensureAccountSchema();
  const result = await query<AccountRow>(
    `SELECT ${accountSelect}
     FROM arcade_accounts
     WHERE email_normalized = $1`,
    [normalizeEmail(email)],
  );
  return result.rows[0] ? toPublicAccount(result.rows[0]) : null;
}

export async function getAccountByUsername(username: string) {
  await ensureAccountSchema();
  const result = await query<AccountRow>(
    `SELECT ${accountSelect}
     FROM arcade_accounts
     WHERE username_normalized = $1`,
    [normalizeUsername(username)],
  );
  return result.rows[0] ? toPublicAccount(result.rows[0]) : null;
}

export async function createAccount(input: {
  email: string;
  password?: string;
  username?: string | null;
  imageUrl?: string | null;
  metadata?: unknown;
  roles?: AccountRole[];
  createdBy?: string | null;
}) {
  await ensureAccountSchema();
  const emailNormalized = validateEmail(input.email);
  const usernameNormalized = validateUsername(input.username);
  const username = usernameNormalized ? input.username!.trim() : null;
  const passwordHash = input.password ? await hashPassword(input.password) : null;
  const now = Date.now();
  const id = crypto.randomUUID();

  try {
    await withTransaction(async (client) => {
      const countResult = await client.query<{ count: string }>(
        'SELECT COUNT(*) as count FROM arcade_accounts',
      );
      const roles = buildInitialRoles({
        email: emailNormalized,
        requestedRoles: input.roles,
        isFirstAccount: Number(countResult.rows[0]?.count ?? 0) === 0,
      });
      const requestedImageUrl = input.imageUrl?.trim() || null;
      const adminAvatar = requestedImageUrl ? adminAvatarBySrc(requestedImageUrl) : null;
      if (adminAvatar && !roles.includes('admin')) {
        throw new Error('This avatar is only available to admins.');
      }
      const imageUrl = adminAvatar?.src ?? requestedImageUrl ?? DEFAULT_NEW_ACCOUNT_AVATAR;

      await client.query(
        `INSERT INTO arcade_accounts (
          id,
          email,
          email_normalized,
          username,
          username_normalized,
          image_url,
          password_hash,
          status,
          metadata_json,
          created_at,
          updated_at,
          last_login_at,
          deleted_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', $8, $9, $10, NULL, NULL)`,
        [
          id,
          input.email.trim(),
          emailNormalized,
          username,
          usernameNormalized,
          imageUrl,
          passwordHash,
          input.metadata === undefined ? null : JSON.stringify(input.metadata),
          now,
          now,
        ],
      );

      for (const role of roles) {
        await client.query(
          `INSERT INTO arcade_account_roles (user_id, role, granted_at, granted_by)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (user_id, role) DO NOTHING`,
          [id, role, now, input.createdBy ?? null],
        );
      }
    });
  } catch (error) {
    if ((error as { code?: string }).code === '23505') {
      throw new Error('Unique constraint failed for account.');
    }
    throw error;
  }

  const account = await getAccountById(id);
  if (!account) throw new Error('Account could not be created.');
  return account;
}

export async function authenticateAccount(input: {
  emailOrUsername: string;
  password: string;
}) {
  if (input.password.length > PASSWORD_MAX_LENGTH) {
    throw new Error('Invalid email, username, or password.');
  }
  await ensureAccountSchema();
  const lookup = input.emailOrUsername.trim();
  const result = lookup.includes('@')
    ? await query<AccountRow>(
        `SELECT ${accountSelect}
         FROM arcade_accounts
         WHERE email_normalized = $1`,
        [normalizeEmail(lookup)],
      )
    : await query<AccountRow>(
        `SELECT ${accountSelect}
         FROM arcade_accounts
         WHERE username_normalized = $1`,
        [normalizeUsername(lookup)],
      );
  const row = result.rows[0];
  if (!row || !row.password_hash) {
    // Perform a dummy verification with the same scrypt cost so a missing
    // account takes comparable time to a wrong password (anti-enumeration).
    await verifyPassword(input.password, await getDummyPasswordHash());
    throw new Error('Invalid email, username, or password.');
  }
  if (!(await verifyPassword(input.password, row.password_hash))) {
    throw new Error('Invalid email, username, or password.');
  }
  if (row.status === 'deleted') {
    throw new Error('This account has been deleted.');
  }
  if (row.status === 'suspended') {
    throw new Error('This account is suspended.');
  }
  const now = Date.now();
  await query(
    `UPDATE arcade_accounts
     SET last_login_at = $1, updated_at = $2
     WHERE id = $3`,
    [now, now, row.id],
  );
  if (passwordHashNeedsUpgrade(row.password_hash)) {
    await query(
      `UPDATE arcade_accounts
       SET password_hash = $1, updated_at = $2
       WHERE id = $3`,
      [await hashPassword(input.password), now, row.id],
    );
  }
  return toPublicAccount({ ...row, last_login_at: now, updated_at: now });
}

export async function createAccountSession(input: {
  userId: string;
  userAgent?: string | null;
  ipAddress?: string | null;
}) {
  await ensureAccountSchema();
  const token = crypto.randomBytes(32).toString('base64url');
  const tokenHash = hashSessionToken(token);
  const now = Date.now();
  const expiresAt = now + ACCOUNT_SESSION_TTL_MS;
  await query(
    `INSERT INTO arcade_account_sessions (
      token_hash,
      user_id,
      created_at,
      expires_at,
      revoked_at,
      user_agent,
      ip_address
    )
    VALUES ($1, $2, $3, $4, NULL, $5, $6)`,
    [
      tokenHash,
      input.userId,
      now,
      expiresAt,
      input.userAgent ?? null,
      input.ipAddress ?? null,
    ],
  );
  return { token, tokenHash, expiresAt };
}

export async function getIdentityForSessionToken(
  token: string,
): Promise<ArcadeIdentity | null> {
  await ensureAccountSchema();
  const tokenHash = hashSessionToken(token);
  const sessionResult = await query<SessionRow>(
    `SELECT token_hash, user_id, created_at, expires_at, revoked_at, user_agent, ip_address
     FROM arcade_account_sessions
     WHERE token_hash = $1`,
    [tokenHash],
  );
  const session = sessionResult.rows[0];
  if (
    !session ||
    session.revoked_at ||
    (toNumber(session.expires_at) ?? 0) <= Date.now()
  ) {
    return null;
  }

  const row = await getAccountRowById(session.user_id);
  const activeRow = row ? await applyExpiredSuspension(row) : null;
  if (!activeRow || activeRow.status !== 'active') return null;
  const roles = await getRolesForUser(activeRow.id);
  return {
    userId: activeRow.id,
    email: activeRow.email,
    name: activeRow.username || activeRow.email,
    imageUrl: visibleAvatarSource(activeRow.image_url, roles),
    roles,
  };
}

export async function revokeAccountSession(token: string) {
  await ensureAccountSchema();
  await query(
    `UPDATE arcade_account_sessions
     SET revoked_at = $1
     WHERE token_hash = $2 AND revoked_at IS NULL`,
    [Date.now(), hashSessionToken(token)],
  );
}

export async function revokeAllAccountSessions(userId: string) {
  await ensureAccountSchema();
  await query(
    `UPDATE arcade_account_sessions
     SET revoked_at = $1
     WHERE user_id = $2 AND revoked_at IS NULL`,
    [Date.now(), userId],
  );
}

export async function listAccountSessions(input: {
  userId: string;
  currentToken?: string | null;
  limit?: number;
}) {
  await ensureAccountSchema();
  const currentTokenHash = input.currentToken
    ? hashSessionToken(input.currentToken)
    : null;
  const result = await query<SessionRow>(
    `SELECT token_hash, user_id, created_at, expires_at, revoked_at, user_agent, ip_address
     FROM arcade_account_sessions
     WHERE user_id = $1
       AND revoked_at IS NULL
       AND expires_at > $2
     ORDER BY created_at DESC
     LIMIT $3`,
    [
      input.userId,
      Date.now(),
      Math.max(1, Math.min(50, Math.trunc(input.limit ?? 20))),
    ],
  );
  return result.rows.map((row) => toSessionSummary(row, currentTokenHash));
}

export async function revokeOtherAccountSessions(input: {
  userId: string;
  currentToken: string;
}) {
  await ensureAccountSchema();
  const result = await query(
    `UPDATE arcade_account_sessions
     SET revoked_at = $1
     WHERE user_id = $2
       AND token_hash <> $3
       AND revoked_at IS NULL`,
    [Date.now(), input.userId, hashSessionToken(input.currentToken)],
  );
  return result.rowCount ?? 0;
}

/**
 * Validate a requested avatar against the curated registry. Returns the path to
 * store in image_url. Throws if the user picked something they may not use.
 */
async function resolveAvatarSelection(
  userId: string,
  requested: string | null | undefined,
  current: string | null,
): Promise<string | null> {
  const selected = requested === undefined ? current : requested?.trim() || null;
  const adminAvatar = selected ? adminAvatarBySrc(selected) : null;
  if (adminAvatar) {
    const roles = await getRolesForUser(userId);
    if (roles.includes('admin')) return adminAvatar.src;
    // Omitted fields must not preserve a privileged selection after role removal.
    if (requested === undefined) return null;
    throw new Error('This avatar is only available to admins.');
  }
  if (requested === undefined) return current; // field omitted → unchanged
  const trimmed = requested?.trim() || '';
  if (!trimmed) return null; // explicit clear → initials fallback
  if (isDefaultAvatarSrc(trimmed)) return trimmed; // free default — always ok
  // Any avatar-slot cosmetic the user OWNS (store-bought OR battlepass-claimed)
  // is allowed. We match by the curated in-repo image path so this works for
  // store avatars, season/battlepass avatars, and any future avatar cosmetic
  // without needing them all hardcoded in the registry.
  if (!isAvatarAssetPath(trimmed)) {
    throw new Error('Invalid avatar selection.');
  }
  const owned = await query(
    `SELECT 1
       FROM user_owned_items o
       JOIN store_items i ON i.id = o.item_id
      WHERE o.user_id = $1
        AND i.game_type = 'profile'
        AND i.slots_json LIKE '%avatar%'
        AND (i.asset_ref::jsonb ->> 'imageUrl') = $2
      LIMIT 1`,
    [userId, trimmed],
  );
  if ((owned.rowCount ?? 0) === 0) throw new Error('You do not own that avatar.');
  return trimmed;
}

export async function updateAccountProfile(input: {
  userId: string;
  username?: string | null;
  imageUrl?: string | null;
}) {
  const current = await getAccountRowById(input.userId);
  if (!current) throw new Error('Account not found.');
  if (current.status === 'deleted') throw new Error('Account has been deleted.');

  const usernameNormalized =
    input.username === undefined
      ? current.username_normalized
      : validateUsername(input.username);
  const username =
    input.username === undefined
      ? current.username
      : usernameNormalized
        ? input.username!.trim()
        : null;
  // Avatars are no longer free-text URLs. image_url may only ever be a curated
  // in-repo avatar path: a free default, an admin-only choice, or an owned cosmetic. Empty
  // clears back to the initials fallback. Anything else is rejected.
  const imageUrl = await resolveAvatarSelection(input.userId, input.imageUrl, current.image_url);

  try {
    await query(
      `UPDATE arcade_accounts
       SET username = $1,
           username_normalized = $2,
           image_url = $3,
           updated_at = $4
       WHERE id = $5 AND status != 'deleted'`,
      [username, usernameNormalized, imageUrl, Date.now(), input.userId],
    );
  } catch (error) {
    if ((error as { code?: string }).code === '23505') {
      throw new Error('Unique constraint failed for account.');
    }
    throw error;
  }

  const updated = await getAccountById(input.userId);
  if (!updated) throw new Error('Account not found.');
  broadcast('gameLeaderboards', { reason: 'profile-updated', userId: input.userId });
  return updated;
}

export async function updateAccountPassword(input: {
  userId: string;
  currentPassword: string;
  newPassword: string;
}) {
  const current = await getAccountRowById(input.userId);
  if (!current) throw new Error('Account not found.');
  if (current.status !== 'active') throw new Error('Account is not active.');
  if (!current.password_hash) {
    throw new Error('This account does not have a local password.');
  }
  if (!(await verifyPassword(input.currentPassword, current.password_hash))) {
    throw new Error('Current password is incorrect.');
  }
  if (input.currentPassword === input.newPassword) {
    throw new Error('New password must be different.');
  }

  await query(
    `UPDATE arcade_accounts
     SET password_hash = $1, updated_at = $2
     WHERE id = $3 AND status = 'active'`,
    [await hashPassword(input.newPassword), Date.now(), input.userId],
  );
}

export async function resetAccountPassword(input: {
  userId: string;
  newPassword: string;
}) {
  const current = await getAccountRowById(input.userId);
  if (!current) throw new Error('Account not found.');
  if (current.status !== 'active') throw new Error('Account is not active.');

  await query(
    `UPDATE arcade_accounts
     SET password_hash = $1, updated_at = $2
     WHERE id = $3 AND status = 'active'`,
    [await hashPassword(input.newPassword), Date.now(), input.userId],
  );
}

export async function setAccountStatus(input: {
  userId: string;
  status: AccountStatus;
  actorUserId?: string | null;
  reason?: string | null;
  expiresAt?: number | null;
  metadata?: unknown;
}) {
  if (!['active', 'suspended', 'deleted'].includes(input.status)) {
    throw new Error('Invalid account status.');
  }
  const account = await getAccountById(input.userId);
  if (!account) throw new Error('Account not found.');

  const now = Date.now();
  await withTransaction(async (client) => {
    await client.query(
      `UPDATE arcade_accounts
       SET status = $1, deleted_at = $2, updated_at = $3
       WHERE id = $4`,
      [input.status, input.status === 'deleted' ? now : null, now, input.userId],
    );
    await client.query(
      `INSERT INTO arcade_account_moderation_actions (
        id,
        user_id,
        action,
        reason,
        actor_user_id,
        created_at,
        expires_at,
        metadata_json
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        crypto.randomUUID(),
        input.userId,
        input.status,
        input.reason?.trim() || null,
        input.actorUserId ?? null,
        now,
        input.expiresAt ?? null,
        input.metadata === undefined ? null : JSON.stringify(input.metadata),
      ],
    );
    if (input.status !== 'active') {
      await client.query(
        `UPDATE arcade_account_sessions
         SET revoked_at = $1
         WHERE user_id = $2 AND revoked_at IS NULL`,
        [now, input.userId],
      );
    }
  });

  const updated = await getAccountById(input.userId);
  if (!updated) throw new Error('Account not found.');
  return updated;
}

export async function grantRole(input: {
  userId: string;
  role: AccountRole;
  grantedBy?: string | null;
}) {
  if (!isAccountRole(input.role)) throw new Error('Invalid role.');
  if (!(await getAccountById(input.userId))) throw new Error('Account not found.');
  await query(
    `INSERT INTO arcade_account_roles (user_id, role, granted_at, granted_by)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, role) DO NOTHING`,
    [input.userId, input.role, Date.now(), input.grantedBy ?? null],
  );
  return getAccountById(input.userId);
}

export async function revokeRole(input: {
  userId: string;
  role: AccountRole;
}) {
  if (input.role === 'player') throw new Error('The base player role cannot be removed.');
  if (!isAccountRole(input.role)) throw new Error('Invalid role.');
  await withTransaction(async (client) => {
    const selectedAvatar = input.role === 'admin'
      ? await client.query<{ image_url: string | null }>(
          `SELECT image_url FROM arcade_accounts WHERE id = $1 FOR UPDATE`,
          [input.userId],
        )
      : null;
    await client.query(
      `DELETE FROM arcade_account_roles
       WHERE user_id = $1 AND role = $2`,
      [input.userId, input.role],
    );
    const imageUrl = selectedAvatar?.rows[0]?.image_url;
    if (imageUrl && adminAvatarBySrc(imageUrl)) {
      await client.query(
        `UPDATE arcade_accounts
         SET image_url = NULL, updated_at = $1
         WHERE id = $2`,
        [Date.now(), input.userId],
      );
    }
  });
  return getAccountById(input.userId);
}

export async function listAccounts(input: {
  query?: string;
  status?: AccountStatus | 'all';
  limit?: number;
}) {
  await ensureAccountSchema();
  const limit = Math.max(1, Math.min(200, Math.trunc(input.limit ?? 50)));
  const status = input.status && input.status !== 'all' ? input.status : null;
  const search = input.query?.trim().toLowerCase() || null;
  const clauses: string[] = [];
  const args: unknown[] = [];

  if (status) {
    args.push(status);
    clauses.push(`status = $${args.length}`);
  }
  if (search) {
    const like = `%${search}%`;
    args.push(like, like, search);
    const start = args.length - 2;
    clauses.push(`(
      email_normalized LIKE $${start}
      OR username_normalized LIKE $${start + 1}
      OR id = $${start + 2}
    )`);
  }
  args.push(limit);

  const result = await query<AccountRow>(
    `SELECT ${accountSelect}
     FROM arcade_accounts
     ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
     ORDER BY created_at DESC
     LIMIT $${args.length}`,
    args,
  );
  return Promise.all(result.rows.map(toPublicAccount));
}

export async function saveAccountData(input: {
  userId: string;
  key: string;
  value: unknown;
}) {
  await ensureAccountSchema();
  const key = validateDataKey(input.key);
  const valueJson = JSON.stringify(input.value);
  await query(
    `INSERT INTO arcade_account_data (user_id, key, value_json, updated_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, key) DO UPDATE SET
       value_json = EXCLUDED.value_json,
       updated_at = EXCLUDED.updated_at`,
    [input.userId, key, valueJson, Date.now()],
  );
  return getAccountData(input.userId, key);
}

export async function getAccountData(userId: string, key: string) {
  await ensureAccountSchema();
  const result = await query<{
    user_id?: string;
    key: string;
    value_json: string;
    updated_at: string | number;
  }>(
    `SELECT key, value_json, updated_at
     FROM arcade_account_data
     WHERE user_id = $1 AND key = $2`,
    [userId, validateDataKey(key)],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    key: row.key,
    value: parseJson(row.value_json),
    updatedAt: toNumber(row.updated_at) ?? 0,
  };
}

export async function listAccountDataForUsers(userIds: string[], key: string) {
  await ensureAccountSchema();
  const uniqueUserIds = Array.from(
    new Set(userIds.map((userId) => userId.trim()).filter(Boolean)),
  ).slice(0, 200);
  if (uniqueUserIds.length === 0) {
    return new Map<string, Awaited<ReturnType<typeof getAccountData>>>();
  }

  const result = await query<{
    user_id: string;
    key: string;
    value_json: string;
    updated_at: string | number;
  }>(
    `SELECT user_id, key, value_json, updated_at
     FROM arcade_account_data
     WHERE key = $1 AND user_id = ANY($2::text[])`,
    [validateDataKey(key), uniqueUserIds],
  );

  return new Map(
    result.rows.map((row) => [
      row.user_id,
      {
        key: row.key,
        value: parseJson(row.value_json),
        updatedAt: toNumber(row.updated_at) ?? 0,
      },
    ]),
  );
}

export async function listAccountData(userId: string) {
  await ensureAccountSchema();
  const result = await query<{
    key: string;
    value_json: string;
    updated_at: string | number;
  }>(
    `SELECT key, value_json, updated_at
     FROM arcade_account_data
     WHERE user_id = $1
     ORDER BY key`,
    [userId],
  );
  return result.rows.map((row) => ({
    key: row.key,
    value: parseJson(row.value_json),
    updatedAt: toNumber(row.updated_at) ?? 0,
  }));
}

export async function deleteAccountData(userId: string, key: string) {
  await ensureAccountSchema();
  await query(
    `DELETE FROM arcade_account_data
     WHERE user_id = $1 AND key = $2`,
    [userId, validateDataKey(key)],
  );
}

export function hashSessionToken(token: string) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function getSessionMaxAgeSeconds(expiresAt: number) {
  return Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
}

function validateDataKey(key: string) {
  const trimmed = key.trim();
  if (!DATA_KEY_RE.test(trimmed)) {
    throw new Error(
      'Data key may only contain letters, numbers, dots, colons, underscores, and hyphens.',
    );
  }
  return trimmed;
}

function validatePasswordLength(password: string) {
  if (password.length < PASSWORD_MIN_LENGTH) {
    throw new Error(`Password must be at least ${PASSWORD_MIN_LENGTH} characters.`);
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    throw new Error(`Password must be at most ${PASSWORD_MAX_LENGTH} characters.`);
  }
}

function deriveScryptKey(
  password: string,
  salt: string,
  keyLength: number,
  params: { N: number; r: number; p: number },
) {
  return new Promise<Buffer>((resolve, reject) => {
    crypto.scrypt(
      password,
      salt,
      keyLength,
      { ...params, maxmem: SCRYPT_MAXMEM },
      (error, derivedKey) => {
        if (error) reject(error);
        else resolve(derivedKey);
      },
    );
  });
}

async function hashPassword(password: string) {
  validatePasswordLength(password);
  const salt = crypto.randomBytes(16).toString('base64url');
  const hash = await deriveScryptKey(password, salt, SCRYPT_KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt}$${hash.toString('base64url')}`;
}

let dummyPasswordHash: Promise<string> | null = null;

/**
 * A throwaway hash using the same scrypt parameters as hashPassword, used to
 * equalize timing between unknown-account and wrong-password signin failures.
 */
function getDummyPasswordHash() {
  if (!dummyPasswordHash) {
    dummyPasswordHash = hashPassword(crypto.randomBytes(24).toString('base64url'));
  }
  return dummyPasswordHash;
}

function passwordHashNeedsUpgrade(encoded: string) {
  const [scheme, n, r, p] = encoded.split('$');
  return (
    scheme !== 'scrypt' ||
    Number(n) !== SCRYPT_N ||
    Number(r) !== SCRYPT_R ||
    Number(p) !== SCRYPT_P
  );
}

async function verifyPassword(password: string, encoded: string) {
  if (password.length > PASSWORD_MAX_LENGTH) return false;
  const [scheme, n, r, p, salt, expected] = encoded.split('$');
  if (scheme !== 'scrypt' || !n || !r || !p || !salt || !expected) return false;
  const params = { N: Number(n), r: Number(r), p: Number(p) };
  if (!Number.isFinite(params.N) || !Number.isFinite(params.r) || !Number.isFinite(params.p)) {
    return false;
  }
  try {
    const expectedBuffer = Buffer.from(expected, 'base64url');
    const actual = await deriveScryptKey(password, salt, expectedBuffer.length, params);
    return (
      actual.length === expectedBuffer.length &&
      crypto.timingSafeEqual(actual, expectedBuffer)
    );
  } catch {
    return false;
  }
}

function buildInitialRoles(input: {
  email: string;
  requestedRoles?: AccountRole[];
  isFirstAccount: boolean;
}) {
  const roles = new Set<AccountRole>(['player']);
  const adminEmails = new Set(
    (process.env.ARCADE_ADMIN_EMAILS ?? '')
      .split(',')
      .map((email) => normalizeEmail(email))
      .filter(Boolean),
  );
  // Admin is granted by ARCADE_ADMIN_EMAILS match. First-account bootstrap is
  // disabled by default in production so a missing setting cannot turn the
  // first public signup into an administrator.
  const hasConfiguredAdmins = adminEmails.size > 0;
  const allowFirstAccountBootstrap =
    process.env.NODE_ENV !== 'production' ||
    process.env.ARCADE_ALLOW_FIRST_ADMIN_BOOTSTRAP === 'true';
  if (
    adminEmails.has(input.email) ||
    (input.isFirstAccount && !hasConfiguredAdmins && allowFirstAccountBootstrap)
  ) {
    roles.add('admin');
  }
  for (const role of input.requestedRoles ?? []) {
    if (isAccountRole(role)) roles.add(role);
  }
  return Array.from(roles);
}

function parseJson(value: string) {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

async function applyExpiredSuspension(row: AccountRow): Promise<AccountRow> {
  if (row.status !== 'suspended') return row;
  const result = await query<{ expires_at: string | number | null }>(
    `SELECT expires_at
     FROM arcade_account_moderation_actions
     WHERE user_id = $1 AND action = 'suspended'
     ORDER BY created_at DESC
     LIMIT 1`,
    [row.id],
  );
  const expiresAt = toNumber(result.rows[0]?.expires_at);
  if (!expiresAt || expiresAt > Date.now()) return row;

  const now = Date.now();
  await withTransaction(async (client) => {
    await client.query(
      `UPDATE arcade_accounts
       SET status = 'active', deleted_at = NULL, updated_at = $1
       WHERE id = $2`,
      [now, row.id],
    );
    await client.query(
      `INSERT INTO arcade_account_moderation_actions (
        id,
        user_id,
        action,
        reason,
        actor_user_id,
        created_at,
        expires_at,
        metadata_json
      )
      VALUES ($1, $2, 'suspension_expired', $3, 'system', $4, NULL, NULL)`,
      [crypto.randomUUID(), row.id, 'Temporary suspension expired', now],
    );
  });

  return {
    ...row,
    status: 'active',
    deleted_at: null,
    updated_at: now,
  };
}
