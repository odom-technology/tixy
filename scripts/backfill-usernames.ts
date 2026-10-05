/**
 * Backfill: give every account a username so the app can collapse identity
 * to username only (gamertag and display_name are being removed).
 *
 * Derivation order per account: existing username, else gamertag, else
 * display_name, else email local part. Every candidate is sanitized and then
 * run through the same validateUsername/normalizeUsername rules accounts.ts
 * applies on signup (USERNAME_RE, reserved names). Collisions on
 * username_normalized get a numeric suffix.
 *
 * Idempotent: accounts that already have username + username_normalized are
 * untouched, so re-running (including on prod) is a no-op after the first
 * pass. Dry-run by default; pass --apply to write.
 *
 * Usage:
 *   tsx scripts/backfill-usernames.ts           # dry run, prints the plan
 *   tsx scripts/backfill-usernames.ts --apply   # writes inside one transaction
 */
import fs from 'node:fs/promises';
import path from 'node:path';

// Same env loading as scripts/migrate.ts so DATABASE_URL resolves before the
// (lazy) pg pool in @/server/db/client is first used.
async function loadEnvFile(filePath: string) {
  let text: string;
  try {
    text = await fs.readFile(filePath, 'utf8');
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      return;
    }
    throw error;
  }

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator === -1) continue;

    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (!key || process.env[key] !== undefined) continue;

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

for (const envFile of ['env/.env.local', 'env/.env', '.env.local', '.env']) {
  await loadEnvFile(path.join(process.cwd(), envFile));
}

const { normalizeUsername, validateUsername } = await import('@/server/accounts');
const { getPool } = await import('@/server/db/client');

const apply = process.argv.includes('--apply');

type Row = {
  id: string;
  email: string;
  username: string | null;
  username_normalized: string | null;
  gamertag: string | null;
  display_name: string | null;
};

/** Reduce arbitrary text to USERNAME_RE's alphabet; null if too little survives. */
function sanitize(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // fold é -> e rather than dropping it
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, 24);
  return cleaned.length >= 3 ? cleaned : null;
}

/** First candidate that passes accounts.ts validation, or null. */
function deriveBase(row: Row): string | null {
  const candidates = [
    row.username,
    row.gamertag,
    row.display_name,
    row.email.split('@')[0],
  ];
  for (const candidate of candidates) {
    const cleaned = sanitize(candidate);
    if (!cleaned) continue;
    try {
      validateUsername(cleaned);
      return cleaned;
    } catch {
      continue; // reserved name or otherwise invalid — try the next source
    }
  }
  return null;
}

function withSuffix(base: string, n: number): string {
  const suffix = String(n);
  return base.slice(0, 24 - suffix.length) + suffix;
}

const pool = getPool();
const client = await pool.connect();

try {
  await client.query('BEGIN');

  const taken = new Set(
    (
      await client.query<{ username_normalized: string }>(
        `SELECT username_normalized FROM arcade_accounts
         WHERE username_normalized IS NOT NULL`,
      )
    ).rows.map((r) => r.username_normalized),
  );

  // The 0016 migration drops gamertag/display_name; keep this script runnable
  // (still idempotent) on databases either side of that migration.
  const legacyColumns = new Set(
    (
      await client.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
         WHERE table_name = 'arcade_accounts'
           AND column_name IN ('gamertag', 'display_name')`,
      )
    ).rows.map((r) => r.column_name),
  );
  const legacySelect = ['gamertag', 'display_name']
    .map((column) => (legacyColumns.has(column) ? column : `NULL AS ${column}`))
    .join(', ');

  const pending = await client.query<Row>(
    `SELECT id, email, username, username_normalized, ${legacySelect}
     FROM arcade_accounts
     WHERE username IS NULL OR username_normalized IS NULL
     ORDER BY created_at`,
  );

  let updates = 0;
  for (const row of pending.rows) {
    const base =
      deriveBase(row) ?? `player-${row.id.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8)}`;
    let username = base;
    let normalized = normalizeUsername(username)!;
    for (let n = 2; taken.has(normalized); n += 1) {
      username = withSuffix(base, n);
      normalized = normalizeUsername(username)!;
    }
    taken.add(normalized);
    updates += 1;

    console.log(
      `${apply ? 'set' : 'would set'} ${row.email} (${row.id}) -> ${username}` +
        (row.username ? ` (had username ${JSON.stringify(row.username)})` : ''),
    );
    if (apply) {
      await client.query(
        `UPDATE arcade_accounts
         SET username = $1, username_normalized = $2, updated_at = $3
         WHERE id = $4`,
        [username, normalized, Date.now(), row.id],
      );
    }
  }

  await client.query(apply ? 'COMMIT' : 'ROLLBACK');
  console.log(
    `${updates} of ${pending.rowCount} account(s) ${apply ? 'updated' : 'planned'}; ` +
      (apply ? 'done.' : 'dry run only — pass --apply to write.'),
  );
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
  await pool.end();
}
