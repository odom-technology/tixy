/**
 * Seeds a small known fixture for scripts/play-report.ts.
 *
 *   DATABASE_URL=postgres://.../arcade_report npm run db:migrate
 *   DATABASE_URL=postgres://.../arcade_report tsx scripts/seed-play-report-fixture.ts
 *
 * Refuses to run unless the database name ends in `_report`. It checks the name
 * before it connects, then empties every table it writes to and inserts the
 * rows below. The expected report numbers are asserted in
 * scripts/verify-play-report.ts, which imports this file.
 *
 * Window the fixture is built for: 2026-09-01 to 2026-09-29, time zone UTC.
 * Day 0 is 2026-09-01, day 1 is 2026-09-10, day 2 is 2026-09-11, day 3 is
 * 2026-09-12.
 */
import { pathToFileURL } from 'node:url';

import { Client } from 'pg';

export const FIXTURE_SINCE = '2026-09-01';
export const FIXTURE_UNTIL = '2026-09-29';
export const FIXTURE_ADMIN_EMAILS = 'boss@fixture.lol,other@fixture.lol';

const D0 = '2026-09-01';
const D1 = '2026-09-10';
const D2 = '2026-09-11';
const D3 = '2026-09-12';
export const FIXTURE_DAYS = { D0, D1, D2, D3 };

/** Milliseconds for a UTC day and a time of day. */
const at = (day: string, time = '12:00:00.000') => Date.parse(`${day}T${time}Z`);

export function databaseNameOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));
  } catch {
    return null;
  }
}

export function assertReportDatabase(url: string | undefined): asserts url is string {
  const name = databaseNameOf(url);
  if (!name || !/_report$/.test(name)) {
    throw new Error(
      `Refusing to seed: the database name must end in _report, got ${name ? `"${name}"` : 'no DATABASE_URL'}.`,
    );
  }
}

/**
 * Asks the server which database this connection reached and refuses unless it
 * ends in _report. The URL check alone is not enough: a socket URL or a
 * `?db=` parameter can point the connection somewhere else.
 */
export async function assertConnectedToReportDatabase(client: Client): Promise<void> {
  const result = await client.query<{ name: string }>('SELECT current_database() AS name');
  const name = result.rows[0]?.name ?? '';
  if (!/_report$/.test(name)) {
    throw new Error(`Refusing to seed: the connection reached "${name}" (current_database), and the name must end in _report.`);
  }
}

const TABLES_TO_EMPTY = [
  'product_analytics_events',
  'anti_cheat_logs',
  'game_time_metrics_daily',
  'game_time_metrics_totals',
  'derby_bets',
  'derby_rounds',
  'arcade_multiplayer_session_players',
  'arcade_multiplayer_sessions',
  'pool_matches',
  'chess_matches',
  'connect_four_matches',
  'checkers_matches',
  'reversi_matches',
  'battleship_matches',
  'word_grid_scores',
  'pangram_scores',
  'connections_scores',
  'freecell_scores',
  'game_score_events',
  'arcade_round_history',
  'game_sessions',
  'arcade_account_roles',
  'arcade_accounts',
];

let counter = 0;
const uid = (prefix: string) => `${prefix}-${String(++counter).padStart(4, '0')}`;

export async function seedFixture(client: Client): Promise<void> {
  await assertConnectedToReportDatabase(client);
  counter = 0;
  for (const table of TABLES_TO_EMPTY) await client.query(`DELETE FROM ${table}`);

  // Accounts. Thirteen real players, then the accounts the rules must exclude.
  const account = async (id: string, email: string, roles: string[] = [], username: string | null = null) => {
    await client.query(
      `INSERT INTO arcade_accounts (id, email, email_normalized, username, username_normalized, created_at, updated_at)
       VALUES ($1, $2, $2, $3, $3, $4, $4)`,
      [id, email, username, at('2026-08-01')],
    );
    for (const role of roles) {
      await client.query('INSERT INTO arcade_account_roles (user_id, role, granted_at) VALUES ($1, $2, $3)', [id, role, at('2026-08-01')]);
    }
  };
  for (let i = 1; i <= 13; i += 1) {
    const n = String(i).padStart(2, '0');
    await account(`fx-p${n}`, `p${n}@mail.fixture.lol`);
  }
  await account('fx-admin', 'owner@fixture.lol', ['player', 'admin']); // admin-role
  await account('fx-boss', 'boss@fixture.lol'); // admin-email (set in the run's env)
  await account('fx-qa1', 'qa-cards@example.com'); // qa-local-part, also reserved-domain
  await account('fx-qa2', 'someone@example.com'); // reserved-domain
  await account('fx-qa3', 'test-user@fixture.lol'); // test-local-part
  await account('fx-qa4', 'agent-7@fixture.lol'); // test-local-part, never active

  const GUEST = 'guest:00000000-0000-4000-8000-00000000000a';

  const scoreEvent = (slug: string, user: string, ms: number) =>
    client.query(
      `INSERT INTO game_score_events (id, game_slug, od_user_id, user_name, score, created_at) VALUES ($1, $2, $3, $3, 100, $4)`,
      [uid('gse'), slug, user, ms],
    );

  // snake: floor, quick play. Real: p01 3 events on 2 days, p02 1, p03 2 on 2 days,
  // ghost (no account row) 1. Test: admin 3, boss 1, qa1 2, qa2 1, qa3 1.
  await scoreEvent('snake', 'fx-p01', at(D1, '09:00'));
  await scoreEvent('snake', 'fx-p01', at(D1, '09:05'));
  await scoreEvent('snake', 'fx-p01', at(D2, '09:00'));
  await scoreEvent('snake', 'fx-p02', at(D1, '10:00'));
  await scoreEvent('snake', 'fx-p03', at(D1, '11:00'));
  await scoreEvent('snake', 'fx-p03', at(D3, '11:00'));
  await scoreEvent('snake', 'fx-ghost', at(D2, '08:00'));
  for (let i = 0; i < 3; i += 1) await scoreEvent('snake', 'fx-admin', at(D1, `13:0${i}`));
  await scoreEvent('snake', 'fx-boss', at(D2, '13:00'));
  await scoreEvent('snake', 'fx-qa1', at(D1, '14:00'));
  await scoreEvent('snake', 'fx-qa1', at(D1, '14:05'));
  await scoreEvent('snake', 'fx-qa2', at(D1, '15:00'));
  await scoreEvent('snake', 'fx-qa3', at(D3, '15:00'));
  // Outside the window: one millisecond before the start, and exactly at the end.
  await scoreEvent('snake', 'fx-p01', at(D0, '00:00:00.000') - 1);
  await scoreEvent('snake', 'fx-p02', at(FIXTURE_UNTIL, '00:00:00.000'));

  // gopher: reserve. One real player twice on one day, so a candidate. qa1 3 times.
  await scoreEvent('gopher', 'fx-p07', at(D1, '09:00'));
  await scoreEvent('gopher', 'fx-p07', at(D1, '09:10'));
  for (let i = 0; i < 3; i += 1) await scoreEvent('gopher', 'fx-qa1', at(D2, `10:0${i}`));

  // breakout: reserve. Ten real players once each: not under the player threshold.
  for (let i = 1; i <= 10; i += 1) await scoreEvent('breakout', `fx-p${String(i).padStart(2, '0')}`, at(D1, `16:${String(i).padStart(2, '0')}`));

  // tetris: reserve. Three players on two days each: not under the repeat threshold.
  for (const user of ['fx-p01', 'fx-p02', 'fx-p03']) {
    await scoreEvent('tetris', user, at(D1, '17:00'));
    await scoreEvent('tetris', user, at(D2, '17:00'));
  }

  // tin-duck: floor, boardwalk. Two score events and a larger time metric: the score events win.
  await scoreEvent('tin-duck', 'fx-p08', at(D1, '18:00'));
  await scoreEvent('tin-duck', 'fx-p08', at(D1, '18:05'));
  const timeMetric = (user: string, game: string, day: string, runs: number) =>
    client.query(
      `INSERT INTO game_time_metrics_daily (user_id, game_type, date_key, duration_ms, run_count, first_played_at, last_played_at)
       VALUES ($1, $2, $3, 60000, $4, $5, $5)`,
      [user, game, day, runs, at(day, '18:30')],
    );
  // A time metric must never add players or play days to a game that has score events:
  // p08 gets a second day here (the server's day key can differ from --tz), p09 gets a row
  // with no score event at all.
  await timeMetric('fx-p08', 'tin-duck', D1, 4);
  await timeMetric('fx-p08', 'tin-duck', D2, 2);
  await timeMetric('fx-p09', 'tin-duck', D1, 1);
  // The match code writes a time metric for every human, bots included. p13 only played a bot.
  await timeMetric('fx-p13', '8-ball', D1, 2);
  // minesweeper: reserve. No score events, so the time metric is the finish source.
  await timeMetric('fx-p09', 'minesweeper', D1, 3);
  // The shared ticket machine bucket is ignored.
  await timeMetric('fx-p01', 'arcade', D1, 9);

  // Anti-cheat log: snake. Real: p01 reject, p02 flag. Test: admin reject. A pass is not counted.
  const antiCheat = (user: string, result: string, ms: number) =>
    client.query(
      `INSERT INTO anti_cheat_logs (id, date_key, ts, game_type, user_id, score, result) VALUES ($1, $2, $3, 'snake', $4, 10, $5)`,
      [uid('acl'), new Date(ms).toISOString().slice(0, 10), ms, user, result],
    );
  await antiCheat('fx-p01', 'reject', at(D1, '09:30'));
  await antiCheat('fx-p02', 'flag', at(D1, '10:30'));
  await antiCheat('fx-admin', 'reject', at(D1, '13:30'));
  await antiCheat('fx-p01', 'pass', at(D1, '09:40'));

  // Route entries: snake 5 entries from 3 sessions and 2 completions, one entry outside the window.
  const analytics = (event: string, session: string, ms: number) =>
    client.query(
      `INSERT INTO product_analytics_events (id, event_name, session_hash, is_authenticated, path, game_slug, source, created_at)
       VALUES ($1, $2, $3, false, '/snake', 'snake', 'game_route', $4)`,
      [uid('pae'), event, session, ms],
    );
  for (const [session, count] of [['s1', 3], ['s2', 1], ['s3', 1]] as const) {
    for (let i = 0; i < count; i += 1) await analytics('game_started', session, at(D1, `09:0${i}`));
  }
  await analytics('game_completed', 's1', at(D1, '09:30'));
  await analytics('game_completed', 's2', at(D1, '09:31'));
  await analytics('game_started', 's4', at(D0, '00:00:00.000') - 1);

  // word-grid: floor, daily. p01 on 2 days, p02 on 1, admin on 1.
  const dailyScore = (table: string, user: string, day: string) =>
    client.query(
      `INSERT INTO ${table} (id, od_user_id, user_name, puzzle_date, guesses, solved, time_seconds, created_at)
       VALUES ($1, $2, $2, $3, 4, true, 60, $4)`,
      [uid('wg'), user, day, at(day, '07:00')],
    );
  await dailyScore('word_grid_scores', 'fx-p01', D1);
  await dailyScore('word_grid_scores', 'fx-p01', D2);
  await dailyScore('word_grid_scores', 'fx-p02', D1);
  await dailyScore('word_grid_scores', 'fx-admin', D1);

  // connections: retired. One test row on day 2 and nothing before the window, so its
  // source starts after the window starts.
  await client.query(
    `INSERT INTO connections_scores (id, od_user_id, user_name, puzzle_date, mistakes, time_seconds, solved, created_at)
     VALUES ($1, 'fx-admin', 'fx-admin', $2, 0, 60, true, $3)`,
    [uid('cs'), D2, at(D2, '07:00')],
  );
  // Rows before the window so the sources that serve many games are not partial.
  await dailyScore('word_grid_scores', 'fx-p12', '2026-08-31');

  // Ticket machines. A session row is a start; a history row is a settled round.
  const session = (user: string, game: string, ms: number) =>
    client.query(
      `INSERT INTO game_sessions (id, od_user_id, game_type, started_at, last_action_at, action_count, pow_challenge_json,
                                  arcade_seed, arcade_wager, arcade_payout, arcade_settled_at)
       VALUES ($1, $2, $3, $4, $4, 0, '{}', 1, 10, 0, $4)`,
      [uid('gs'), user, game, ms],
    );
  const history = (user: string, game: string, ms: number, outcome: string | null = null) =>
    client.query(
      `INSERT INTO arcade_round_history (id, user_id, user_name, game_type, wager_amount, payout_amount, multiplier, seed, outcome_json, created_at)
       VALUES ($1, $2, $2, $3, 10, 0, 0, 1, $4, $5)`,
      [uid('arh'), user, game, outcome, ms],
    );

  // plinko: floor, ticket machines.
  // Real: p01 4 sessions (D1 x2, D2 x2), 3 settled rounds and 1 refund (no round row);
  // p04 2 sessions (D1, D3), 2 rounds with the D3 one abandoned.
  // Guest: 2 sessions, 1 round. Test: admin 1 session, 1 round. A refunded-tag row is ignored.
  await session('fx-p01', 'arcade-plinko', at(D1, '09:00'));
  await session('fx-p01', 'arcade-plinko', at(D1, '09:10'));
  await session('fx-p01', 'arcade-plinko', at(D2, '09:00'));
  await session('fx-p01', 'arcade-plinko', at(D2, '09:10'));
  await history('fx-p01', 'arcade-plinko', at(D1, '09:01'));
  await history('fx-p01', 'arcade-plinko', at(D2, '09:01'));
  await history('fx-p01', 'arcade-plinko', at(D2, '09:11'));
  await history('fx-p01', 'arcade-plinko', at(D1, '09:11'), '{"refunded":true}');
  await session('fx-p04', 'arcade-plinko', at(D1, '10:00'));
  await session('fx-p04', 'arcade-plinko', at(D3, '10:00'));
  await history('fx-p04', 'arcade-plinko', at(D1, '10:01'));
  await history('fx-p04', 'arcade-plinko', at(D3, '10:01'), '{"abandoned":true}');
  await session(GUEST, 'arcade-plinko', at(D1, '11:00'));
  await session(GUEST, 'arcade-plinko', at(D1, '11:10'));
  await history(GUEST, 'arcade-plinko', at(D1, '11:01'));
  await session('fx-admin', 'arcade-plinko', at(D1, '12:00'));
  await history('fx-admin', 'arcade-plinko', at(D1, '12:01'));

  // crash: reserve. One real player, one session, one round: a candidate.
  await session('fx-p08', 'arcade-crash', at(D1, '19:00'));
  await history('fx-p08', 'arcade-crash', at(D1, '19:01'));

  // Before the window: a dice session and round. Not counted, but they show the tables have older rows.
  await session('fx-p12', 'arcade-dice', at('2026-08-31', '12:00'));
  await history('fx-p12', 'arcade-dice', at('2026-08-31', '12:01'));

  // A game type that is not in the registry.
  await history('fx-p10', 'arcade-mystery', at(D1, '20:00'));

  // derby: later. 3 bets (p11 twice on D1, p12 once on D2), 2 settled with history rows.
  const round = await client.query<{ id: string }>(
    `INSERT INTO derby_rounds (seed, seed_hash, odds_json, phase, created_at, settled_at)
     VALUES ('s', 'h', '[]'::jsonb, 'settled', to_timestamp($1 / 1000.0), to_timestamp($1 / 1000.0)) RETURNING id`,
    [at(D1, '20:00')],
  );
  const roundId = round.rows[0]!.id;
  const bet = (user: string, horse: number, ms: number, settled: boolean) =>
    client.query(
      `INSERT INTO derby_bets (round_id, user_id, user_name, horse_idx, amount, multiplier, payout, settled_at, created_at)
       VALUES ($1, $2, $2, $3, 10, 2.5, 0, ${settled ? 'to_timestamp($4 / 1000.0)' : 'NULL'}, to_timestamp($4 / 1000.0))`,
      [roundId, user, horse, ms],
    );
  await bet('fx-p11', 0, at(D1, '20:05'), true);
  await bet('fx-p11', 1, at(D1, '20:06'), true);
  await bet('fx-p12', 2, at(D2, '20:05'), false);
  await bet('fx-p12', 3, at('2026-08-31', '20:05'), false);
  await history('fx-p11', 'arcade-derby', at(D1, '20:07'));
  await history('fx-p11', 'arcade-derby', at(D1, '20:08'));

  // Matches.
  const poolMatch = (
    player1: string,
    player2: string | null,
    createdMs: number,
    completedMs: number | null,
    status: string,
    tournament: string | null = null,
  ) =>
    client.query(
      `INSERT INTO pool_matches (id, player1_id, player1_name, player2_id, player2_name, status, current_turn, phase, balls_json,
                                 tournament_match_id, created_at, updated_at, completed_at)
       VALUES ($1, $2, $2, $3, $3, $4, $2, 'break', '[]', $5, $6, $6, $7)`,
      [uid('pm'), player1, player2, status, tournament, createdMs, completedMs],
    );
  // Created long before the window and finished at 23:55. The next match, 15 minutes later, is in
  // the window: a rematch. The lookback has to follow completed_at, not created_at.
  await poolMatch('fx-p01', 'fx-p02', at('2026-08-31', '22:30'), at('2026-08-31', '23:55'), 'completed');
  await poolMatch('fx-p01', 'fx-p02', at(D0, '00:10'), at(D0, '00:20'), 'completed');
  // Day 1: a match, then another 15 minutes after it finished: a rematch.
  await poolMatch('fx-p01', 'fx-p02', at(D1, '10:00'), at(D1, '10:20'), 'completed');
  await poolMatch('fx-p02', 'fx-p01', at(D1, '10:35'), at(D1, '10:55'), 'completed');
  // Day 2: same pair a day later (not a rematch); p01 against p03 twice, 45 minutes apart (not a rematch).
  await poolMatch('fx-p01', 'fx-p02', at(D2, '09:00'), at(D2, '09:30'), 'completed');
  await poolMatch('fx-p01', 'fx-p03', at(D2, '12:00'), at(D2, '12:30'), 'completed');
  await poolMatch('fx-p01', 'fx-p03', at(D2, '13:15'), at(D2, '13:20'), 'forfeited');
  // Day 3: a tournament match and one 5 minutes later that is still active. Neither is a rematch.
  await poolMatch('fx-p02', 'fx-p03', at(D3, '10:00'), at(D3, '10:30'), 'completed', 'fx-tournament-1');
  await poolMatch('fx-p02', 'fx-p03', at(D3, '10:35'), null, 'active');
  // A lobby nobody joined: not started.
  await poolMatch('fx-p04', null, at(D2, '15:00'), null, 'waiting');
  // Bot opponent: bot line.
  await poolMatch('fx-p01', 'bot:medium', at(D1, '14:00'), at(D1, '14:10'), 'completed');
  await poolMatch('fx-p01', 'bot:medium', at(D2, '14:00'), null, 'active');
  // p13 only plays a bot, and has a time metric under 8-ball. p13 is not a real player of 8-ball.
  await poolMatch('fx-p13', 'bot:easy', at(D1, '16:00'), at(D1, '16:10'), 'completed');
  // A player against an admin: test traffic.
  await poolMatch('fx-p05', 'fx-admin', at(D1, '15:00'), at(D1, '15:20'), 'completed');

  // Typing duel sessions (game_type typing-test, mode versus).
  const duel = async (players: string[], status: string, createdMs: number, startedMs: number | null, completedMs: number | null, gameType = 'typing-test', mode = 'versus') => {
    const id = uid('mp');
    await client.query(
      `INSERT INTO arcade_multiplayer_sessions (id, game_type, mode, status, owner_user_id, owner_user_name, min_players, max_players,
                                                current_player_count, created_at, updated_at, started_at, completed_at)
       VALUES ($1, $2, $3, $4, $5, $5, 2, 2, $6, $7, $7, $8, $9)`,
      [id, gameType, mode, status, players[0], players.length, createdMs, startedMs, completedMs],
    );
    for (const [seat, player] of players.entries()) {
      await client.query(
        `INSERT INTO arcade_multiplayer_session_players (session_id, user_id, user_name, seat_index, status, joined_at, updated_at)
         VALUES ($1, $2, $2, $3, 'seated', $4, $4)`,
        [id, player, seat, createdMs],
      );
    }
  };
  await duel(['fx-p03', 'fx-p04'], 'completed', at('2026-08-31', '10:00'), at('2026-08-31', '10:01'), at('2026-08-31', '10:05'));
  await duel(['fx-p01', 'fx-p02'], 'completed', at(D1, '11:00'), at(D1, '11:01'), at(D1, '11:05'));
  await duel(['fx-p01', 'fx-p02'], 'completed', at(D1, '11:20'), at(D1, '11:21'), at(D1, '11:25'));
  await duel(['fx-p03', 'fx-p04'], 'completed', at(D2, '11:00'), at(D2, '11:01'), at(D2, '11:05'));
  await duel(['fx-p01'], 'waiting', at(D2, '16:00'), null, null);
  await duel(['fx-p06'], 'active', at(D2, '17:00'), at(D2, '17:01'), null, 'blackjack', 'shared-table');
}

async function main() {
  const url = process.env.DATABASE_URL;
  assertReportDatabase(url);
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await assertConnectedToReportDatabase(client);
    await client.query('BEGIN');
    await seedFixture(client);
    await client.query('COMMIT');
    console.log(`Seeded the play report fixture into ${databaseNameOf(url)}.`);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
