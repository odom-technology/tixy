import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { createPattern, RULES_VERSION } from '../src/features/arcade/lib/starter-match/engine';

// Never load application .env files or silently skip an integration test.
const databaseUrl = process.env.STARTER_GAME_TEST_DATABASE_URL;
if (!databaseUrl || new URL(databaseUrl).pathname !== '/arcade_starter_game_test') {
  throw new Error('STARTER_GAME_TEST_DATABASE_URL must target the disposable arcade_starter_game_test database.');
}
assert.equal(globalThis.__arcadePgPool, undefined, 'Run this test in a separate process.');
process.env.DATABASE_URL = databaseUrl;
process.env.GAME_SESSION_SECRET = 'isolated-starter-game-regression-secret';
const pool = new Pool({ connectionString: databaseUrl });
globalThis.__arcadePgPool = pool;
const users = [`starter-${randomUUID()}`, `starter-${randomUUID()}`];
let failure: unknown;

try {
  for (const migration of ['0001_accounts.sql', '0002_player_runtime.sql', '0004_core_economy_time.sql', '0075_starter_match.sql']) {
    await pool.query(await readFile(new URL(`../src/server/db/migrations/${migration}`, import.meta.url), 'utf8'));
  }
  const { startPatternRun, submitPatternRun, getPatternLeaderboard, StarterMatchError } = await import('../src/server/arcade/starter-match');
  const { createGameSession } = await import('../src/server/arcade/game-session');
  const { DEFAULT_SITE_AVAILABILITY } = await import('../src/lib/site-availability');
  const { getSiteAvailabilitySettings, saveSiteAvailabilityConfig } = await import('../src/server/site-settings');
  const { noStoreJson } = await import('../src/app/api/games/_shared/leaderboard-helpers');
  const { checkSessionStartLimit, checkScoreSubmitLimit } = await import('../src/server/arcade/game-rate-limit');
  const { getGameBanStatus } = await import('../src/server/arcade/game-bans');
  for (const [index, user] of users.entries()) {
    await pool.query(`INSERT INTO arcade_accounts
      (id, email, email_normalized, username, username_normalized, display_name, created_at, updated_at)
      VALUES ($1, $2, $2, $3, $3, $3, $4, $4)`, [user, `${user}@example.test`, `starter_${index}_${randomUUID().slice(0, 8)}`, Date.now()]);
    await pool.query('INSERT INTO wallets (user_id, credits, updated_at) VALUES ($1, 100, $2)', [user, Date.now()]);
  }
  const ledgerBefore = Number((await pool.query('SELECT count(*) FROM currency_ledger')).rows[0].count);
  const sessionsBefore = Number((await pool.query('SELECT count(*) FROM game_sessions WHERE od_user_id = $1', [users[0]])).rows[0].count);
  await pool.query('ALTER TABLE starter_match_sessions ADD CONSTRAINT starter_start_failure CHECK (false) NOT VALID');
  try {
    await assert.rejects(startPatternRun(users[0]));
    assert.equal(Number((await pool.query('SELECT count(*) FROM game_sessions WHERE od_user_id = $1', [users[0]])).rows[0].count), sessionsBefore, 'A failed rules write leaves no orphan session.');
  } finally {
    await pool.query('ALTER TABLE starter_match_sessions DROP CONSTRAINT starter_start_failure');
  }
  const run = await startPatternRun(users[0]);
  const payload = { sessionToken: run.sessionToken, rulesVersion: RULES_VERSION, choices: createPattern(run.seed), score: 99999999, seed: 0 };
  await assert.rejects(submitPatternRun(users[1], 'Other player', payload), (error: unknown) => error instanceof StarterMatchError && error.status === 403);
  await assert.rejects(submitPatternRun(users[0], 'Player', { ...payload, sessionToken: `${run.sessionToken}x` }));
  for (const invalid of [null, [], {}, { ...payload, rulesVersion: 2 }, { ...payload, choices: [4, 4, 4, 4, 4, 4, 4, 4] }, { ...payload, choices: Array(7).fill(0) }]) {
    await assert.rejects(submitPatternRun(users[0], 'Player', invalid), (error: unknown) => error instanceof StarterMatchError && error.status === 400);
  }
  // Concurrent retry must produce one receipt and one personal best.
  assert.deepEqual(await Promise.all(Array.from({ length: 5 }, () => submitPatternRun(users[0], 'Historical name', payload))), [800, 800, 800, 800, 800]);
  assert.equal(Number((await pool.query('SELECT count(*) FROM starter_match_runs WHERE user_id = $1', [users[0]])).rows[0].count), 1);
  assert.equal(await submitPatternRun(users[0], 'Player', payload), 800, 'Lost responses can be retried.');
  await assert.rejects(submitPatternRun(users[0], 'Player', { ...payload, choices: payload.choices.map((choice) => (choice + 1) % 4) }), (error: unknown) => error instanceof StarterMatchError && error.status === 409);
  await pool.query('UPDATE starter_match_runs SET rules = 2 WHERE user_id = $1', [users[0]]);
  await assert.rejects(submitPatternRun(users[0], 'Player', payload), (error: unknown) => error instanceof StarterMatchError && error.status === 409);
  await pool.query('UPDATE starter_match_runs SET rules = 1 WHERE user_id = $1', [users[0]]);
  const worse = await startPatternRun(users[0]);
  assert.equal(await submitPatternRun(users[0], 'Player', { sessionToken: worse.sessionToken, rulesVersion: 1, choices: createPattern(worse.seed).map((choice) => (choice + 1) % 4) }), 0);
  assert.equal((await getPatternLeaderboard()).find((row) => row.userId === users[0])?.score, 800, 'Worse runs preserve the personal best.');
  await pool.query('UPDATE arcade_accounts SET username = $1 WHERE id = $2', ['renamed_starter', users[0]]);
  const board = await noStoreJson({ leaderboard: await getPatternLeaderboard() });
  assert.equal(board.headers.get('cache-control'), 'no-store');
  assert.equal((await board.json()).leaderboard.find((row: { userId: string }) => row.userId === users[0]).userName, 'renamed_starter');

  const wrongGame = await createGameSession(users[0], 'snake');
  await assert.rejects(submitPatternRun(users[0], 'Player', { ...payload, sessionToken: wrongGame.token }));
  const expired = await startPatternRun(users[0]);
  await pool.query('UPDATE game_sessions SET started_at = $1 WHERE id = $2', [Date.now() - 16 * 60_000, expired.sessionToken.split(':')[0]]);
  await assert.rejects(submitPatternRun(users[0], 'Player', { ...payload, sessionToken: expired.sessionToken }));
  const oldRules = await startPatternRun(users[0]);
  await pool.query('UPDATE starter_match_sessions SET rules = 2 WHERE id = $1', [oldRules.sessionToken.split(':')[0]]);
  await assert.rejects(submitPatternRun(users[0], 'Player', { ...payload, sessionToken: oldRules.sessionToken }), (error: unknown) => error instanceof StarterMatchError && error.status === 409);
  assert.equal((await pool.query('SELECT id FROM game_sessions WHERE id = $1', [oldRules.sessionToken.split(':')[0]])).rowCount, 1, 'Rules mismatch cannot consume an older run.');

  // Force a persistence failure: consuming a session must roll back with the score.
  const rollbackRun = await startPatternRun(users[1]);
  const rollbackPayload = { sessionToken: rollbackRun.sessionToken, rulesVersion: 1, choices: createPattern(rollbackRun.seed) };
  await pool.query(`ALTER TABLE starter_match_scores ADD CONSTRAINT starter_regression_failure CHECK (user_id <> '${users[1]}')`);
  await assert.rejects(submitPatternRun(users[1], 'Player', rollbackPayload));
  assert.equal((await pool.query('SELECT id FROM game_sessions WHERE id = $1', [rollbackRun.sessionToken.split(':')[0]])).rowCount, 1);
  assert.equal((await pool.query('SELECT id FROM starter_match_runs WHERE user_id = $1', [users[1]])).rowCount, 0);
  await pool.query('ALTER TABLE starter_match_scores DROP CONSTRAINT starter_regression_failure');
  assert.equal(await submitPatternRun(users[1], 'Player', rollbackPayload), 800);

  const inFlight = await startPatternRun(users[1]);
  const originalAvailability = await getSiteAvailabilitySettings();
  const paused = await saveSiteAvailabilityConfig({ config: { ...DEFAULT_SITE_AVAILABILITY, disabledGames: ['starter-match'] }, expectedUpdatedAt: originalAvailability.updatedAt });
  try {
    await assert.rejects(startPatternRun(users[0]), /unavailable/i);
    assert.equal(await submitPatternRun(users[1], 'Player', { sessionToken: inFlight.sessionToken, rulesVersion: 1, choices: createPattern(inFlight.seed) }), 800, 'Existing runs can finish while paused.');
  } finally {
    await saveSiteAvailabilityConfig({ config: originalAvailability.config, expectedUpdatedAt: paused.updatedAt });
  }
  for (let i = 0; i < 10; i++) assert.equal((await checkSessionStartLimit(users[0], 'starter-match')).ok, true);
  assert.equal((await checkSessionStartLimit(users[0], 'starter-match')).ok, false);
  assert.equal((await checkScoreSubmitLimit(users[0], 'starter-match')).ok, true);
  assert.equal((await checkScoreSubmitLimit(users[0], 'starter-match')).ok, false);
  await pool.query('INSERT INTO game_bans (user_id, banned_at, is_indefinite) VALUES ($1, $2, true)', [users[0], Date.now()]);
  assert.equal((await getGameBanStatus(users[0])).isBanned, true);
  assert.equal(Number((await pool.query('SELECT credits FROM wallets WHERE user_id = $1', [users[0]])).rows[0].credits), 100);
  assert.equal(Number((await pool.query('SELECT count(*) FROM currency_ledger')).rows[0].count), ledgerBefore, 'Starter never writes rewards.');
  console.log('Starter integration: ownership/signatures, malformed input, replay, concurrent retries, best scores, renamed accounts, expiry, rollback, availability, limits, and no rewards passed.');
} catch (error) {
  failure = error;
} finally {
  await pool.query('ALTER TABLE IF EXISTS starter_match_sessions DROP CONSTRAINT IF EXISTS starter_start_failure');
  await pool.query('ALTER TABLE IF EXISTS starter_match_scores DROP CONSTRAINT IF EXISTS starter_regression_failure');
  for (const table of ['game_bans', 'game_rate_events', 'wallets']) await pool.query(`DELETE FROM ${table} WHERE user_id = ANY($1)`, [users]);
  await pool.query('DELETE FROM game_sessions WHERE od_user_id = ANY($1)', [users]);
  await pool.query('DELETE FROM arcade_accounts WHERE id = ANY($1)', [users]);
  await pool.end();
}
if (failure) console.error(failure);
// game-session owns a periodic cleanup timer; this standalone test has finished.
process.exit(failure ? 1 : 0);
