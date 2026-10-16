import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { createBoard, toggleCell, CELLS, MAX_MOVES, replayLights, RULES_VERSION } from '../src/features/arcade/lib/lights-out/engine';

function solution(seed: number): number[] {
  const board = createBoard(seed);
  let best: number[] | undefined;
  for (let mask = 1; mask < 1 << CELLS; mask++) {
    const moves = Array.from({ length: CELLS }, (_, index) => index).filter((index) => mask & (1 << index));
    if (best && moves.length >= best.length) continue;
    let candidate = [...board];
    for (const move of moves) candidate = toggleCell(candidate, move);
    if (!candidate.some(Boolean)) best = moves;
  }
  assert.ok(best);
  return best;
}
function failedMoves(seed: number): number[] {
  const board = createBoard(seed);
  const move = Array.from({ length: CELLS }, (_, index) => index).find((index) => toggleCell(board, index).some(Boolean))!;
  return Array(MAX_MOVES).fill(move);
}

// Never load application .env files or silently skip an integration test.
const databaseUrl = process.env.LIGHTS_OUT_TEST_DATABASE_URL;
if (!databaseUrl || new URL(databaseUrl).pathname !== '/arcade_lights_out_test') {
  throw new Error('LIGHTS_OUT_TEST_DATABASE_URL must target the disposable arcade_lights_out_test database.');
}
assert.equal(globalThis.__arcadePgPool, undefined, 'Run this test in a separate process.');
process.env.DATABASE_URL = databaseUrl;
process.env.GAME_SESSION_SECRET = 'isolated-lights-out-regression-secret';
const pool = new Pool({ connectionString: databaseUrl });
globalThis.__arcadePgPool = pool;
const users = [`lights-${randomUUID()}`, `lights-${randomUUID()}`];
let failure: unknown;

try {
  for (const migration of ['0001_accounts.sql', '0002_player_runtime.sql', '0004_core_economy_time.sql', '0075_starter_match.sql', '0076_lights_out.sql']) {
    await pool.query(await readFile(new URL(`../src/server/db/migrations/${migration}`, import.meta.url), 'utf8'));
  }
  const { startLightsRun, submitLightsRun, getLightsLeaderboard, LightsOutError } = await import('../src/server/arcade/lights-out');
  const { createGameSession } = await import('../src/server/arcade/game-session');
  const { DEFAULT_SITE_AVAILABILITY } = await import('../src/lib/site-availability');
  const { getSiteAvailabilitySettings, saveSiteAvailabilityConfig } = await import('../src/server/site-settings');
  const { noStoreJson } = await import('../src/app/api/games/_shared/leaderboard-helpers');
  const { checkSessionStartLimit, checkScoreSubmitLimit } = await import('../src/server/arcade/game-rate-limit');
  const { getGameBanStatus } = await import('../src/server/arcade/game-bans');
  for (const [index, user] of users.entries()) {
    await pool.query(`INSERT INTO arcade_accounts
      (id, email, email_normalized, username, username_normalized, display_name, created_at, updated_at)
      VALUES ($1, $2, $2, $3, $3, $3, $4, $4)`, [user, `${user}@example.test`, `lights_${index}_${randomUUID().slice(0, 8)}`, Date.now()]);
    await pool.query('INSERT INTO wallets (user_id, credits, updated_at) VALUES ($1, 100, $2)', [user, Date.now()]);
  }
  const sessionsBefore = Number((await pool.query('SELECT count(*) FROM game_sessions WHERE od_user_id = $1', [users[0]])).rows[0].count);
  await pool.query('ALTER TABLE lights_out_sessions ADD CONSTRAINT lights_start_failure CHECK (false) NOT VALID');
  try {
    await assert.rejects(startLightsRun(users[0]));
    assert.equal(Number((await pool.query('SELECT count(*) FROM game_sessions WHERE od_user_id = $1', [users[0]])).rows[0].count), sessionsBefore, 'A failed rules write leaves no orphan session.');
  } finally { await pool.query('ALTER TABLE lights_out_sessions DROP CONSTRAINT lights_start_failure'); }
  const accountDataBefore = (await pool.query('SELECT * FROM arcade_account_data WHERE user_id = ANY($1) ORDER BY user_id, key', [users])).rows;
  const ledgerBefore = Number((await pool.query('SELECT count(*) FROM currency_ledger')).rows[0].count);
  const run = await startLightsRun(users[0]);
  const expected = replayLights(run.seed, solution(run.seed));
  const expectedResult = { score: expected.score, solved: expected.solved, moves: expected.moves };
  const payload = { sessionToken: run.sessionToken, rulesVersion: RULES_VERSION, moves: solution(run.seed), score: 99999999, seed: 0 };
  await assert.rejects(submitLightsRun(users[1], 'Other player', payload), (error: unknown) => error instanceof LightsOutError && error.status === 403);
  await assert.rejects(submitLightsRun(users[0], 'Player', { ...payload, sessionToken: `${run.sessionToken}x` }));
  for (const invalid of [null, [], {}, { ...payload, rulesVersion: 2 }, { ...payload, moves: [9] }, { ...payload, moves: [] }, { ...payload, moves: Array(25).fill(0) }, { ...payload, moves: [...payload.moves, 0] }]) {
    await assert.rejects(submitLightsRun(users[0], 'Player', invalid), (error: unknown) => error instanceof LightsOutError && error.status === 400);
  }
  // A solution for different content cannot claim this signed session's puzzle.
  let foreignSeed = (run.seed + 1) % 2 ** 31;
  while (JSON.stringify(createBoard(foreignSeed)) === JSON.stringify(createBoard(run.seed))) foreignSeed = (foreignSeed + 1) % 2 ** 31;
  await assert.rejects(submitLightsRun(users[0], 'Player', { ...payload, seed: foreignSeed, moves: solution(foreignSeed) }), (error: unknown) => error instanceof LightsOutError && error.status === 400);
  // Concurrent retry must produce one receipt and one personal best.
  assert.deepEqual(await Promise.all(Array.from({ length: 5 }, () => submitLightsRun(users[0], 'Historical name', payload))), Array(5).fill(expectedResult));
  assert.equal(Number((await pool.query('SELECT count(*) FROM lights_out_runs WHERE user_id = $1', [users[0]])).rows[0].count), 1);
  assert.deepEqual(await submitLightsRun(users[0], 'Player', payload), expectedResult, 'Lost responses can be retried.');
  await assert.rejects(submitLightsRun(users[0], 'Player', { ...payload, moves: failedMoves(run.seed) }), (error: unknown) => error instanceof LightsOutError && error.status === 409);
  await pool.query('UPDATE lights_out_runs SET rules = 2 WHERE user_id = $1', [users[0]]);
  await assert.rejects(submitLightsRun(users[0], 'Player', payload), (error: unknown) => error instanceof LightsOutError && error.status === 409);
  await pool.query('UPDATE lights_out_runs SET rules = 1 WHERE user_id = $1', [users[0]]);
  const worse = await startLightsRun(users[0]);
  assert.deepEqual(await submitLightsRun(users[0], 'Player', { sessionToken: worse.sessionToken, rulesVersion: 1, moves: failedMoves(worse.seed), score: 999999, seed: run.seed }), { score: 0, solved: false, moves: MAX_MOVES });
  assert.equal((await getLightsLeaderboard()).find((row) => row.userId === users[0])?.score, expectedResult.score, 'Worse runs preserve the personal best.');
  await pool.query('UPDATE arcade_accounts SET username = $1 WHERE id = $2', ['renamed_lights', users[0]]);
  const board = await noStoreJson({ leaderboard: await getLightsLeaderboard() });
  assert.equal(board.headers.get('cache-control'), 'no-store');
  assert.equal((await board.json()).leaderboard.find((row: { userId: string }) => row.userId === users[0]).userName, 'renamed_lights');

  const wrongGame = await createGameSession(users[0], 'starter-match');
  await assert.rejects(submitLightsRun(users[0], 'Player', { ...payload, sessionToken: wrongGame.token }));
  const { startPatternRun, submitPatternRun } = await import('../src/server/arcade/starter-match');
  const starter = await startPatternRun(users[0]);
  await assert.rejects(submitLightsRun(users[0], 'Player', { ...payload, sessionToken: starter.sessionToken }));
  const lightsOnly = await startLightsRun(users[0]);
  await assert.rejects(submitPatternRun(users[0], 'Player', { sessionToken: lightsOnly.sessionToken, rulesVersion: 1, choices: Array(8).fill(0) }));
  assert.equal((await pool.query('SELECT id FROM starter_match_runs WHERE user_id = ANY($1)', [users])).rowCount, 0);
  const expired = await startLightsRun(users[0]);
  await pool.query('UPDATE game_sessions SET started_at = $1 WHERE id = $2', [Date.now() - 16 * 60_000, expired.sessionToken.split(':')[0]]);
  await assert.rejects(submitLightsRun(users[0], 'Player', { ...payload, sessionToken: expired.sessionToken, moves: solution(expired.seed) }));
  const oldRules = await startLightsRun(users[0]);
  await pool.query('UPDATE lights_out_sessions SET rules = 2 WHERE id = $1', [oldRules.sessionToken.split(':')[0]]);
  await assert.rejects(submitLightsRun(users[0], 'Player', { ...payload, sessionToken: oldRules.sessionToken, moves: solution(oldRules.seed) }), (error: unknown) => error instanceof LightsOutError && error.status === 409);
  assert.equal((await pool.query('SELECT id FROM game_sessions WHERE id = $1', [oldRules.sessionToken.split(':')[0]])).rowCount, 1, 'Rules mismatch cannot consume an older run.');

  // Force a persistence failure: consuming a session must roll back with the score.
  const rollbackRun = await startLightsRun(users[1]);
  const rollbackExpected = replayLights(rollbackRun.seed, solution(rollbackRun.seed));
  const rollbackPayload = { sessionToken: rollbackRun.sessionToken, rulesVersion: 1, moves: solution(rollbackRun.seed) };
  await pool.query(`ALTER TABLE lights_out_scores ADD CONSTRAINT lights_regression_failure CHECK (user_id <> '${users[1]}')`);
  await assert.rejects(submitLightsRun(users[1], 'Player', rollbackPayload));
  assert.equal((await pool.query('SELECT id FROM game_sessions WHERE id = $1', [rollbackRun.sessionToken.split(':')[0]])).rowCount, 1);
  assert.equal((await pool.query('SELECT id FROM lights_out_runs WHERE user_id = $1', [users[1]])).rowCount, 0);
  await pool.query('ALTER TABLE lights_out_scores DROP CONSTRAINT lights_regression_failure');
  assert.deepEqual(await submitLightsRun(users[1], 'Player', rollbackPayload), { score: rollbackExpected.score, solved: true, moves: rollbackExpected.moves });

  const inFlight = await startLightsRun(users[1]);
  const originalAvailability = await getSiteAvailabilitySettings();
  const paused = await saveSiteAvailabilityConfig({ config: { ...DEFAULT_SITE_AVAILABILITY, disabledGames: ['lights-out'] }, expectedUpdatedAt: originalAvailability.updatedAt });
  try {
    await assert.rejects(startLightsRun(users[0]), /unavailable/i);
    assert.equal((await submitLightsRun(users[1], 'Player', { sessionToken: inFlight.sessionToken, rulesVersion: 1, moves: solution(inFlight.seed) })).solved, true, 'Existing runs can finish while paused.');
  } finally {
    await saveSiteAvailabilityConfig({ config: originalAvailability.config, expectedUpdatedAt: paused.updatedAt });
  }
  const sectionOriginal = await getSiteAvailabilitySettings();
  const sectionPaused = await saveSiteAvailabilityConfig({ config: { ...DEFAULT_SITE_AVAILABILITY, sections: { ...DEFAULT_SITE_AVAILABILITY.sections, games: false } }, expectedUpdatedAt: sectionOriginal.updatedAt });
  try { await assert.rejects(startLightsRun(users[0]), /unavailable/i); }
  finally { await saveSiteAvailabilityConfig({ config: sectionOriginal.config, expectedUpdatedAt: sectionPaused.updatedAt }); }
  for (let i = 0; i < 10; i++) assert.equal((await checkSessionStartLimit(users[0], 'lights-out')).ok, true);
  assert.equal((await checkSessionStartLimit(users[0], 'lights-out')).ok, false);
  assert.equal((await checkScoreSubmitLimit(users[0], 'lights-out')).ok, true);
  assert.equal((await checkScoreSubmitLimit(users[0], 'lights-out')).ok, false);
  await pool.query('INSERT INTO game_bans (user_id, banned_at, is_indefinite) VALUES ($1, $2, true)', [users[0], Date.now()]);
  assert.equal((await getGameBanStatus(users[0])).isBanned, true);
  assert.equal(Number((await pool.query('SELECT credits FROM wallets WHERE user_id = $1', [users[0]])).rows[0].credits), 100);
  assert.equal(Number((await pool.query('SELECT count(*) FROM currency_ledger')).rows[0].count), ledgerBefore, 'Lights Out never writes rewards.');
  assert.equal((await pool.query('SELECT * FROM game_daily_earnings WHERE user_id = ANY($1)', [users])).rowCount, 0);
  assert.deepEqual((await pool.query('SELECT * FROM arcade_account_data WHERE user_id = ANY($1) ORDER BY user_id, key', [users])).rows, accountDataBefore, 'XP, achievements, and player data stay unchanged.');
  console.log('Lights Out integration: ownership/signatures, malformed input, replay, concurrent retries, best scores, renamed accounts, expiry, rollback, availability, limits, and no rewards passed.');
} catch (error) {
  failure = error;
} finally {
  await pool.query('ALTER TABLE IF EXISTS lights_out_sessions DROP CONSTRAINT IF EXISTS lights_start_failure');
  await pool.query('ALTER TABLE IF EXISTS lights_out_scores DROP CONSTRAINT IF EXISTS lights_regression_failure');
  for (const table of ['game_bans', 'game_rate_events', 'wallets']) await pool.query(`DELETE FROM ${table} WHERE user_id = ANY($1)`, [users]);
  await pool.query('DELETE FROM game_sessions WHERE od_user_id = ANY($1)', [users]);
  await pool.query('DELETE FROM arcade_accounts WHERE id = ANY($1)', [users]);
  await pool.end();
}
if (failure) console.error(failure);
// game-session owns a periodic cleanup timer; this standalone test has finished.
process.exit(failure ? 1 : 0);
