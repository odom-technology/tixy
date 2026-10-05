/**
 * Integration regression for renamed accounts and historical leaderboard names.
 * Uses real account profile updates and the Snake leaderboard GET handler.
 *
 * LEADERBOARD_TEST_DATABASE_URL=postgres://.../arcade_leaderboard_test \
 *   npm run test:leaderboard-identities
 *
 * Explicit test database only; never loads .env files. Fixtures are uniquely
 * identified and removed, and the database name must end in _leaderboard_test.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { Pool } from 'pg';

const databaseUrl = process.env.LEADERBOARD_TEST_DATABASE_URL;
if (!databaseUrl) {
  console.log('Skipped database integration: set LEADERBOARD_TEST_DATABASE_URL to an isolated *_leaderboard_test database.');
  process.exit(0);
}

const databaseName = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
assert.ok(databaseName.endsWith('_leaderboard_test'), 'Refusing to write outside a *_leaderboard_test database.');
assert.equal(globalThis.__arcadePgPool, undefined, 'Run this test in its own process.');
process.env.DATABASE_URL = databaseUrl;
process.env.ARCADE_ADMIN_EMAILS = '';

const pool = new Pool({ connectionString: databaseUrl });
globalThis.__arcadePgPool = pool;

const { createAccount, updateAccountProfile } = await import('../src/server/accounts');
const { withCurrentLeaderboardNames } = await import('../src/server/arcade/leaderboard-identities');
const { noStoreJson } = await import('../src/app/api/games/_shared/leaderboard-helpers');
const { GET: snakeLeaderboard } = await import('../src/app/api/games/snake/leaderboard/route');

const suffix = randomUUID().replaceAll('-', '').slice(0, 10);
const accountIds: string[] = [];
const scoreIds: string[] = [];
const guestId = `leaderboard-guest-${suffix}`;

type ScoreEntry = { id: string; userId: string; userName: string; score: number };
async function snakeRows() {
  const response = await snakeLeaderboard(new Request('http://localhost/api/games/snake/leaderboard?limit=all'));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const body = await response.json() as { leaderboard: ScoreEntry[] };
  return body.leaderboard.filter((entry) => scoreIds.includes(entry.id));
}

try {
  // Account schema is initialized by the real createAccount path; the Snake
  // table has the exact production columns and uniqueness constraint.
  await pool.query(`CREATE TABLE IF NOT EXISTS snake_scores (
    id TEXT PRIMARY KEY, od_user_id TEXT NOT NULL UNIQUE,
    user_name TEXT NOT NULL, score INTEGER NOT NULL, created_at BIGINT NOT NULL
  )`);
  const leader = await createAccount({ email: `leader-${suffix}@example.test`, username: `old_${suffix}` });
  accountIds.push(leader.id);
  const runnerUp = await createAccount({ email: `runner-${suffix}@example.test`, username: `runner_${suffix}` });
  accountIds.push(runnerUp.id);
  for (const [userId, userName, score] of [
    [leader.id, leader.username, 500],
    [runnerUp.id, runnerUp.username, 300],
    [guestId, 'Guest score owner', 100],
  ] as const) {
    const id = `leaderboard-score-${randomUUID()}`;
    scoreIds.push(id);
    await pool.query(
      'INSERT INTO snake_scores (id, od_user_id, user_name, score, created_at) VALUES ($1, $2, $3, $4, $5)',
      [id, userId, userName, score, Date.now()],
    );
  }

  const before = await snakeRows();
  assert.deepEqual(before.map((row) => row.userId), [leader.id, runnerUp.id, guestId]);
  assert.equal(before[0]?.userName, leader.username);
  const renamed = `new_${suffix}`;
  await updateAccountProfile({ userId: leader.id, username: renamed });
  const after = await snakeRows();
  assert.equal(after[0]?.userName, renamed, 'A profile rename must appear without submitting another score.');
  const ranking = (entries: ScoreEntry[]) => entries.map(({ id, userId, score }) => ({ id, userId, score }));
  assert.deepEqual(ranking(after), ranking(before), 'Renaming must preserve score IDs, scores, and rank order.');
  assert.equal(after[1]?.userName, runnerUp.username);
  assert.equal(after[2]?.userName, 'Guest score owner', 'Unregistered players keep their historical display name.');
  const stored = await pool.query<{ user_name: string }>('SELECT user_name FROM snake_scores WHERE od_user_id = $1', [leader.id]);
  assert.equal(stored.rows[0]?.user_name, leader.username, 'Read-time names do not rewrite historical score snapshots.');
  console.log('Passed: actual profile rename immediately updates Snake GET; scores, ranks, and guest names stay intact.');

  const response = await noStoreJson({
    leaderboard: [{ odUserId: runnerUp.id, userName: 'Old runner', score: 30 }],
    currentUserEntry: { userId: leader.id, userName: 'Old leader', score: 50, rank: 101 },
    player: { userId: leader.id, userName: 'Old leader', totalWins: 5 },
  });
  const payload = await response.json();
  assert.equal(payload.leaderboard[0].userName, runnerUp.username);
  assert.equal(payload.currentUserEntry.userName, renamed, 'The separate current-user row outside the visible rankings is refreshed.');
  assert.equal(payload.player.userName, renamed);
  assert.equal(payload.currentUserEntry.rank, 101);
  assert.equal(payload.player.totalWins, 5);
  console.log('Passed: odUserId rows, current-user entries, and player summaries use current names.');

  let acquisitions = 0;
  const acquired = () => { acquisitions += 1; };
  pool.on('acquire', acquired);
  try {
    const repeated = Array.from({ length: 200 }, (_, index) => ({
      userId: index % 2 ? leader.id : runnerUp.id, userName: 'Stale name', rank: index + 1,
    }));
    const original = structuredClone(repeated);
    const hydrated = await withCurrentLeaderboardNames(repeated);
    assert.equal(acquisitions, 1, 'Names are resolved in one batched query, not one query per score.');
    assert.deepEqual(repeated, original, 'The resolver does not mutate source score rows.');
    assert.equal(hydrated[1]?.userName, renamed);
    acquisitions = 0;
    assert.deepEqual(await withCurrentLeaderboardNames([]), []);
    assert.equal(acquisitions, 0, 'An empty leaderboard does not query accounts.');
  } finally {
    pool.off('acquire', acquired);
  }
  console.log('Passed: 200 entries resolve in a single query; empty boards need no query.');

  await updateAccountProfile({ userId: leader.id, username: null });
  const unnamed = await snakeRows();
  assert.equal(unnamed[0]?.userName, 'Player', 'Removing a username must not expose an email or leave the stale name.');
  assert.deepEqual(ranking(unnamed), ranking(before));
  const guestOnly = [{ userName: 'Legacy guest', score: 10 }];
  assert.deepEqual(await withCurrentLeaderboardNames(guestOnly), guestOnly);
  const error = await noStoreJson({ error: 'Existing error response' }, 400);
  assert.equal(error.status, 400);
  assert.deepEqual(await error.json(), { error: 'Existing error response' });
  console.log('Passed: cleared usernames use Player, legacy guests and error payloads remain unchanged.');
} finally {
  await pool.query('DELETE FROM snake_scores WHERE id = ANY($1::text[])', [scoreIds]);
  await pool.query('DELETE FROM arcade_accounts WHERE id = ANY($1::text[])', [accountIds]);
  await pool.end();
  globalThis.__arcadePgPool = undefined;
}
