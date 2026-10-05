/**
 * Verifies scripts/play-report.ts against a known fixture.
 *
 *   docker exec arcade-dev-postgres createdb -U arcade arcade_report
 *   DATABASE_URL=postgres://.../arcade_report npm run db:migrate
 *   DATABASE_URL=postgres://.../arcade_report npm run test:play-report
 *
 * It needs a database, so it is not part of test:game-invariants. It refuses to
 * run unless the database it reached ends in `_report` (checked in the URL and
 * again with SELECT current_database()). It seeds the fixture from
 * scripts/seed-play-report-fixture.ts, creates a role that can only SELECT,
 * runs the report as that role in a child process, and asserts the numbers. The
 * expected values below are worked out from the fixture rows by hand; each
 * block names the rows it counts and says which review finding it covers.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { Client } from 'pg';

import { assertReadStatement, bindNamed, createReadOnlyRunner } from './play-report-db';
import {
  assertConnectedToReportDatabase,
  assertReportDatabase,
  databaseNameOf,
  FIXTURE_ADMIN_EMAILS,
  FIXTURE_SINCE,
  FIXTURE_UNTIL,
  seedFixture,
} from './seed-play-report-fixture';

const url = process.env.DATABASE_URL;
assertReportDatabase(url);

const root = process.cwd();
const tsx = path.join(root, 'node_modules', '.bin', 'tsx');
const ROLE = 'tixy_report_fixture';

type Game = Record<string, unknown> & { slug: string };
type Report = {
  meta: Record<string, unknown>;
  warnings: string[];
  cut_check: { valid: boolean; problems: string[] };
  sources: { id: string; status: string; rows_in_window: number; partial: boolean }[];
  test_rules: { id: string; accounts_in_database: number; accounts_active_in_window: number; accounts_excluded: number }[];
  test_traffic: { guest_ids_active: number; bot_ids_active: number; ids_without_account_row: number; schema_flag_columns: string[] };
  games: Game[];
  candidates: string[];
  not_judged: { slug: string; reason: string }[];
};

function runReport(extraArgs: string[], env: Record<string, string | undefined> = {}, databaseUrl: string = url as string) {
  const result = spawnSync(
    tsx,
    ['scripts/play-report.ts', '--since', FIXTURE_SINCE, '--until', FIXTURE_UNTIL, '--tz', 'UTC', ...extraArgs],
    {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, DATABASE_URL: databaseUrl, ARCADE_ADMIN_EMAILS: FIXTURE_ADMIN_EMAILS, ...env },
    },
  );
  assert.equal(result.status, 0, `report exited with ${result.status}: ${result.stderr}`);
  return result.stdout;
}

const gameOf = (report: Report, slug: string): Game => {
  const game = report.games.find((candidate) => candidate.slug === slug);
  assert.ok(game, `${slug} is in the report`);
  return game;
};

function expectGame(report: Report, slug: string, expected: Record<string, unknown>) {
  const game = gameOf(report, slug);
  for (const [key, value] of Object.entries(expected)) {
    assert.deepEqual(game[key], value, `${slug}.${key}: expected ${JSON.stringify(value)}, got ${JSON.stringify(game[key])}`);
  }
}

const withoutClock = (report: Report) => ({ ...report, meta: { ...report.meta, generated_at: null } });

async function main() {
  // 1. The seeder refuses a database name that does not end in _report, and a
  // connection that reached a different database than the URL says.
  const wrongUrl = new URL(url as string);
  wrongUrl.pathname = '/arcade_not_a_fixture';
  const refused = spawnSync(tsx, ['scripts/seed-play-report-fixture.ts'], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, DATABASE_URL: wrongUrl.toString() },
  });
  assert.notEqual(refused.status, 0, 'the seeder must refuse a database not ending in _report');
  assert.match(refused.stderr, /must end in _report/);

  const otherUrl = new URL(url as string);
  otherUrl.pathname = '/postgres';
  const other = new Client({ connectionString: otherUrl.toString() });
  await other.connect();
  await assert.rejects(assertConnectedToReportDatabase(other), /current_database/);
  await assert.rejects(seedFixture(other), /current_database/, 'seedFixture checks the connected database before any write');
  await other.end();
  console.log('ok: seeder refuses a URL and a connection that do not end in _report');

  // 2. Static check: the report and its database layer hold no write statement.
  for (const file of ['play-report.ts', 'play-report-db.ts']) {
    const source = readFileSync(path.join(root, 'scripts', file), 'utf8');
    assert.doesNotMatch(
      source,
      /\b(INSERT INTO|UPDATE \w+ SET|DELETE FROM|TRUNCATE|DROP TABLE|ALTER TABLE|CREATE TABLE|CREATE INDEX|GRANT|VACUUM)\b/,
      `${file} must hold no write statement`,
    );
  }
  assert.match(readFileSync(path.join(root, 'scripts', 'play-report-db.ts'), 'utf8'), /SET TRANSACTION READ ONLY/);
  console.log('ok: no write statement in the report or its database layer');

  // 3. Seed, then count rows so a write by anything below would show.
  const client = new Client({ connectionString: url });
  await client.connect();
  const tables = [
    'arcade_accounts', 'arcade_account_roles', 'game_score_events', 'game_sessions', 'arcade_round_history', 'pool_matches',
    'arcade_multiplayer_sessions', 'arcade_multiplayer_session_players', 'derby_bets', 'derby_rounds', 'word_grid_scores',
    'connections_scores', 'game_time_metrics_daily', 'anti_cheat_logs', 'product_analytics_events',
  ];
  const counts = async () => {
    const out: Record<string, number> = {};
    for (const table of tables) out[table] = Number((await client.query(`SELECT COUNT(*) AS n FROM ${table}`)).rows[0].n);
    return out;
  };
  try {
    await client.query('BEGIN');
    await seedFixture(client);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    await client.end();
    throw error;
  }
  const before = await counts();
  const databaseName = (await client.query<{ name: string }>('SELECT current_database() AS name')).rows[0]!.name;
  console.log(`ok: seeded ${databaseNameOf(url)} (${Object.values(before).reduce((a, b) => a + b, 0)} rows)`);

  // 4. The database layer refuses writes. The guard stops anything that is not a single
  // SELECT, WITH or SHOW; Postgres stops a write hidden inside a WITH.
  assert.throws(() => assertReadStatement("DELETE FROM game_score_events"), /Refusing/);
  assert.throws(() => assertReadStatement('SELECT 1; DELETE FROM game_score_events'), /Refusing/);
  assert.throws(() => bindNamed('SELECT $missing', {}), /Unknown query parameter/);
  const runner = createReadOnlyRunner(client, { statementTimeoutMs: 5000, lockTimeoutMs: 1000 });
  await assert.rejects(runner.run((q) => q('DELETE FROM game_score_events')), /Refusing/);
  await assert.rejects(
    runner.run((q) => q('WITH gone AS (DELETE FROM game_score_events RETURNING 1) SELECT * FROM gone')),
    /read-only transaction/,
  );
  await assert.rejects(runner.run((q) => q('SELECT pg_sleep(3)', {}).then(() => q('SELECT pg_sleep(10)'))), /timeout/);
  assert.deepEqual((await runner.run((q) => q('SELECT 1 AS one')))[0], { one: 1 });
  assert.equal(runner.stats().verifiedReadOnly, true);
  assert.deepEqual(await counts(), before, 'a refused write changed the data');
  console.log('ok: the database layer refuses writes, and times out a slow statement');

  // 5. A role that can only SELECT. The report runs as this role; a write by the role is refused.
  assert.match(databaseName, /^[a-z0-9_]+$/i);
  const password = randomBytes(12).toString('hex');
  const dropRole = async () => {
    await client.query(`DROP OWNED BY ${ROLE}`).catch(() => undefined);
    await client.query(`DROP ROLE IF EXISTS ${ROLE}`);
  };
  await dropRole();
  await client.query(`CREATE ROLE ${ROLE} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE`);
  const roleUrl = new URL(url as string);
  roleUrl.username = ROLE;
  roleUrl.password = password;
  let asRole: Report;
  let asOwner: Report;
  try {
    await client.query(`GRANT CONNECT ON DATABASE "${databaseName}" TO ${ROLE}`);
    await client.query(`GRANT USAGE ON SCHEMA public TO ${ROLE}`);
    await client.query(`GRANT SELECT (id, email, email_normalized, username_normalized, status) ON arcade_accounts TO ${ROLE}`);
    await client.query(
      `GRANT SELECT ON arcade_account_roles, game_sessions, arcade_round_history, derby_bets, game_score_events,
         word_grid_scores, pangram_scores, connections_scores, freecell_scores, game_time_metrics_daily, anti_cheat_logs,
         pool_matches, chess_matches, connect_four_matches, checkers_matches, reversi_matches, battleship_matches,
         arcade_multiplayer_sessions, arcade_multiplayer_session_players, product_analytics_events TO ${ROLE}`,
    );

    const roleClient = new Client({ connectionString: roleUrl.toString() });
    await roleClient.connect();
    await assert.rejects(roleClient.query('DELETE FROM game_score_events'), /permission denied/);
    await assert.rejects(roleClient.query("UPDATE arcade_accounts SET status = 'x'"), /permission denied/);
    await roleClient.end();

    asRole = JSON.parse(runReport(['--format=json'], {}, roleUrl.toString())) as Report;
    asOwner = JSON.parse(runReport(['--format=json'])) as Report;
    assert.deepEqual(withoutClock(asRole), withoutClock(asOwner), 'the SELECT-only role sees the same report as the owner');
  } finally {
    await dropRole();
  }
  const json = asOwner;
  console.log('ok: the report runs as a SELECT-only role, and a write by that role is refused');

  // 6. Main run, test traffic off.
  assert.equal(json.meta.read_only, true, 'every transaction was confirmed read only');
  assert.ok((json.meta.read_only_transactions as number) >= 20);
  assert.equal(json.meta.include_test, false);
  assert.equal(json.games.length, 70, '69 registry entries plus one game type that is not in the registry');

  // snake: score_events. Real: p01 3 events (2 days), p02 1, p03 2 (2 days), ghost 1 (no account row).
  // The p01 event 1 ms before the window and the p02 event at the end are outside it.
  // Test: admin 3, boss 1, qa1 2, qa2 1, qa3 1 = 5 accounts, 8 events.
  // Anti-cheat: p01 reject and p02 flag count; the pass and the admin reject do not.
  expectGame(json, 'snake', {
    placement: 'floor', group: 'quick-play', tracking: 'recorded', source_partial: false,
    players: 4, finished: 7, started: null, completion_rate: null, repeat_players: 2, median_days: 1.5,
    last_play: '2026-09-12', flagged_submissions: 2, guest_sessions: null, rematches: null, wagers_settled: null,
    test_players: 5, test_finished: 8, route_entries: 5, route_sessions: 3, route_completions: 2,
  });

  // plinko: game_sessions and arcade_round_history.
  // Real: p01 4 sessions, 3 rounds (a refund tag row is ignored); p04 2 sessions, 2 rounds, 1 abandoned.
  // Guest: 2 sessions. Test: admin 1 session, 1 round.
  expectGame(json, 'plinko', {
    tracking: 'recorded', players: 2, started: 6, finished: 4, completion_rate: 0.6667, repeat_players: 2, median_days: 2,
    wagers_settled: 5, guest_sessions: 2, guest_ids: 1, last_play: '2026-09-12', test_players: 1, test_finished: 1,
  });

  // 8-ball: pool_matches. In the window and started: the 00:10 match, two on day 1, three on day 2
  // (the lobby with no opponent is not started), two on day 3: 8 matches. Finished: 7 (the active one is not).
  // Rematches (finding 7): the 00:10 match, whose first match was created at 22:30 the evening before and
  // finished at 23:55, and the day 1 pair. The day 2 repeats are 24 hours and 45 minutes apart; the tournament pair does not count.
  // Finding 2: p13 only played bot:easy and has a time metric under 8-ball, so p13 is not a real player.
  // Finding 6: the match against the admin has one test player (the admin), not two.
  // Bot matches: p01 twice, p13 once.
  expectGame(json, '8-ball', {
    tracking: 'recorded', players: 3, started: 8, finished: 7, completion_rate: 0.875, repeat_players: 3, median_days: 3,
    rematches: 2, last_play: '2026-09-12', test_players: 1, test_finished: 1, bot_matches: 3, guest_sessions: null,
  });

  // typing duel: sessions s1 and s2 (second one 15 minutes after the first ended), s3; the waiting
  // session, the session before the window and the shared-table 21 session are not counted.
  expectGame(json, 'typing-duel', {
    tracking: 'recorded', players: 4, started: 3, finished: 3, completion_rate: 1, repeat_players: 0, median_days: 1,
    rematches: 1, last_play: '2026-09-11',
  });

  // word-grid: p01 on 2 days, p02 on 1; admin is test; p12's row is before the window.
  expectGame(json, 'word-grid', {
    tracking: 'recorded', players: 2, finished: 3, started: null, repeat_players: 1, median_days: 1.5,
    last_play: '2026-09-11', test_players: 1, test_finished: 1,
  });

  // Reserve games and the thresholds.
  expectGame(json, 'gopher', { players: 1, finished: 2, repeat_players: 0, test_players: 1, test_finished: 3 });
  expectGame(json, 'crash', { players: 1, started: 1, finished: 1, repeat_players: 0 });
  expectGame(json, 'breakout', { players: 10, finished: 10, repeat_players: 0 });
  expectGame(json, 'tetris', { players: 3, finished: 6, repeat_players: 3, median_days: 2 });
  expectGame(json, 'swerve', { tracking: 'recorded', players: 0, finished: 0, repeat_players: 0, last_play: null });

  // Finding 1: tin-duck has 2 score events for p08 on one day. Time metrics for p08 on a second day and
  // for p09 must add no player and no day, and the 4 + 2 + 1 runs must not replace the 2 finished.
  expectGame(json, 'tin-duck', { players: 1, finished: 2, repeat_players: 0, median_days: 1 });

  // minesweeper has no score events, so the 3 runs in game_time_metrics_daily count as finished.
  // Players are not taken from that table, so they are unknown, and the game is not judged.
  expectGame(json, 'minesweeper', { tracking: 'counts only', players: null, finished: 3, repeat_players: null, last_play: null });

  // derby: 3 bets, 2 settled rounds in history; the bet before the window is not counted.
  expectGame(json, 'derby', { placement: 'later', players: 2, started: 3, finished: 2, wagers_settled: 2, repeat_players: 0 });

  // A game type that is not in the registry.
  expectGame(json, 'mystery', { placement: 'not in registry', tracking: 'not in registry', players: 1, finished: 1 });

  // Tracking. air-hockey writes nothing anywhere. The per-game tables that have never held a row are unknown.
  expectGame(json, 'air-hockey', { tracking: 'not recorded', players: null, finished: null, last_play: null });
  for (const slug of ['chess', 'connect-four', 'checkers', 'reversi', 'battleship', 'pangram', 'freecell']) {
    expectGame(json, slug, { tracking: 'source empty', players: null, finished: null });
  }
  // connections has one test row on day 2 and nothing before the window: recorded, but the source is partial.
  expectGame(json, 'connections', { tracking: 'recorded', source_partial: true, players: 0, test_players: 1, test_finished: 1 });

  const sourceStatus = new Map(json.sources.map((entry) => [entry.id, entry]));
  assert.equal(sourceStatus.get('game_score_events')?.status, 'data in window');
  assert.equal(sourceStatus.get('pool_matches')?.rows_in_window, 12);
  assert.equal(sourceStatus.get('chess_matches')?.status, 'no rows in window');
  assert.equal(sourceStatus.get('anti_cheat_logs')?.rows_in_window, 3);
  assert.equal(sourceStatus.get('connections_scores')?.partial, true);
  assert.equal(sourceStatus.get('game_sessions')?.partial, false);

  // Candidates: reserve and retired, recorded, under 10 players and under 3 repeat players, source not partial.
  for (const slug of ['gopher', 'crash', 'typing-duel', 'swerve']) {
    assert.ok(json.candidates.includes(slug), `${slug} is a candidate`);
  }
  for (const slug of ['breakout', 'tetris', 'snake', 'plinko', 'derby', 'air-hockey', 'chess', 'mystery', 'minesweeper', 'connections']) {
    assert.ok(!json.candidates.includes(slug), `${slug} is not a candidate`);
  }
  const notJudged = new Map(json.not_judged.map((entry) => [entry.slug, entry.reason]));
  for (const slug of ['air-hockey', 'pangram', 'freecell', 'battleship', 'checkers', 'reversi']) {
    assert.ok(notJudged.has(slug), `${slug} is listed as not judged`);
  }
  assert.equal(notJudged.get('minesweeper'), 'counts only');
  assert.equal(notJudged.get('connections'), 'source starts after the window');
  assert.ok(!notJudged.has('gopher'));

  // Finding 3: no --relaunch, so the list is not valid for a cut. With one, the partial source still fails the check.
  assert.equal(json.cut_check.valid, false);
  assert.ok(json.cut_check.problems.some((problem) => problem.includes('--relaunch is not set')));
  const relaunched = JSON.parse(runReport(['--format=json', '--relaunch', FIXTURE_SINCE])) as Report;
  assert.ok(!relaunched.cut_check.problems.some((problem) => problem.includes('--relaunch')));
  assert.ok(relaunched.cut_check.problems.some((problem) => problem.includes('connections_scores has no rows before the window')));
  assert.equal(relaunched.cut_check.valid, false);
  const early = JSON.parse(runReport(['--format=json', '--relaunch', '2026-09-05'])) as Report;
  assert.ok(early.cut_check.problems.some((problem) => problem.includes('starts before the relaunch')));
  const shortWindow = JSON.parse(runReportWindow('2026-09-15', FIXTURE_UNTIL)) as Report;
  assert.ok(shortWindow.cut_check.problems.some((problem) => problem.includes('days and a cut needs 28')));

  // Test rules: counts per rule.
  const rule = (id: string) => json.test_rules.find((entry) => entry.id === id)!;
  assert.deepEqual(
    ['admin-role', 'admin-email', 'qa-local-part', 'reserved-domain', 'test-local-part', 'test-username', 'schema-flag'].map((id) => {
      const entry = rule(id);
      return [id, entry.accounts_in_database, entry.accounts_active_in_window, entry.accounts_excluded];
    }),
    [
      ['admin-role', 1, 1, 1],
      ['admin-email', 1, 1, 1],
      ['qa-local-part', 1, 1, 1],
      ['reserved-domain', 2, 2, 1], // qa1 is also on example.com, but the qa rule matched first
      ['test-local-part', 2, 1, 1], // agent-7 never played
      ['test-username', 0, 0, 0],
      ['schema-flag', 0, 0, 0],
    ],
  );
  assert.equal(json.test_traffic.guest_ids_active, 1);
  assert.equal(json.test_traffic.bot_ids_active, 2); // bot:medium and bot:easy
  assert.equal(json.test_traffic.ids_without_account_row, 1);
  assert.deepEqual(json.test_traffic.schema_flag_columns, []);
  console.log('ok: numbers match the fixture (test traffic off)');

  // 7. With test traffic included. Guests stay out of players.
  const withTest = JSON.parse(runReport(['--format=json', '--include-test'])) as Report;
  assert.equal(withTest.meta.include_test, true);
  expectGame(withTest, 'snake', { players: 9, finished: 15, repeat_players: 2 });
  expectGame(withTest, 'plinko', { players: 3, started: 7, finished: 5, guest_sessions: 2 });
  // 8-ball: 8 + 3 bot matches + 1 match against an admin. Finished: 7 + 2 bot + 1 admin. Players: p01, p02, p03, p05, admin, p13.
  expectGame(withTest, '8-ball', { players: 6, started: 12, finished: 10, rematches: 2 });
  console.log('ok: --include-test moves test traffic into the main numbers');

  // 8. Without the admin email list, the email-only admin counts as a player and the report says so.
  const noList = JSON.parse(runReport(['--format=json'], { ARCADE_ADMIN_EMAILS: '' })) as Report;
  expectGame(noList, 'snake', { players: 5, test_players: 4 });
  assert.ok(noList.warnings.some((warning) => warning.includes('ARCADE_ADMIN_EMAILS')));
  console.log('ok: a missing ARCADE_ADMIN_EMAILS is reported');

  // 9. Window edges follow --tz: midnight in New York is 04:00 UTC in September.
  const newYork = JSON.parse(runReport(['--format=json', '--tz', 'America/New_York'])) as Report;
  assert.equal(newYork.meta.since, '2026-09-01T04:00:00.000Z');
  assert.equal(newYork.meta.until, '2026-09-29T04:00:00.000Z');
  assert.equal(json.meta.since, '2026-09-01T00:00:00.000Z');
  console.log('ok: window dates follow --tz');

  // 10. Markdown and CSV.
  const markdown = runReport(['--format=md']);
  assert.ok(![0x2013, 0x2014].some((code) => markdown.includes(String.fromCharCode(code))), 'no en or em dashes in the report');
  const headings = [...markdown.matchAll(/^## (.+)$/gm)].map((match) => match[1]);
  assert.deepEqual(headings, ['Tracking check', 'Games', 'Test traffic', 'Route entries', 'Candidates']);
  assert.ok(markdown.indexOf('### Floor: with friends') < markdown.indexOf('### Floor: boardwalk'));
  assert.ok(markdown.indexOf('### Reserve') < markdown.indexOf('### Retired'));
  assert.ok(markdown.trimEnd().split('\n').pop()!.startsWith('Not judged'), 'the report ends with the candidates section');
  assert.match(markdown, /Not valid for a cut: .*--relaunch is not set/);
  assert.match(markdown, /\| plinko \| 2 \| 2 \| 6 \| 4 \| 66\.7% \| 2 \| 2 \| n\/a \| 5 \| 2026-09-12 \| recorded \|/);
  assert.match(markdown, /\| air-hockey \| unknown \|/);

  const csv = runReport(['--format=csv']).trimEnd().split('\n');
  assert.equal(csv.length, 71, 'a header and 70 games');
  assert.ok(csv[0]!.startsWith('slug,title,placement,group,tracking,players,'));
  assert.ok(csv.some((line) => line.startsWith('plinko,Plinko,floor,ticket-machines,recorded,2,2,1,6,4,0.6667,2,2,,5,2026-09-12')));
  console.log('ok: markdown and csv');

  // 11. Nothing was written.
  assert.deepEqual(await counts(), before, 'the report changed row counts');
  await client.end();
  console.log('ok: row counts unchanged after every run');

  // 12. A bad window fails without touching the database.
  const bad = spawnSync(tsx, ['scripts/play-report.ts', '--since', '2026-09-29', '--until', '2026-09-01'], {
    cwd: root, encoding: 'utf8', env: process.env,
  });
  assert.notEqual(bad.status, 0);
  console.log('play report verifier passed');
}

function runReportWindow(since: string, until: string): string {
  const result = spawnSync(
    tsx,
    ['scripts/play-report.ts', '--since', since, '--until', until, '--tz', 'UTC', '--relaunch', since, '--format=json'],
    { cwd: root, encoding: 'utf8', env: { ...process.env, ARCADE_ADMIN_EMAILS: FIXTURE_ADMIN_EMAILS } },
  );
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
