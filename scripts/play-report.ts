/**
 * Play report for phase 8 of the tixy rev. 2 rebuild ("final cuts from real play").
 *
 *   npm run report:play -- --since 2026-10-05 --until 2026-11-02 --relaunch 2026-10-05 --out report.md
 *   npm run report:play -- --format=json
 *   npm run report:play -- --help
 *
 * Read only. Each source is read in its own short transaction with SET
 * TRANSACTION READ ONLY, a statement timeout and a low lock timeout (see
 * play-report-db.ts). It never writes, never deletes and never changes app
 * behaviour. Run it off-peak, with a read-only role, never during a deploy or a
 * migration.
 *
 * What the numbers mean, the test traffic rules and how to run it against
 * production are in docs/design/tixy-rebrand/PLAY_REPORT.md.
 */
import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

import { Client } from 'pg';

import { ARCADE_GAMES, getFloorGroups, getReserveGames } from '../src/features/arcade/components/arcade-game-registry';
import { gameSlugFromType } from '../src/lib/site-availability';
import { isArcadeGameType } from '../src/server/arcade/arcade-constants';
import { isScoreLeaderboardGame } from '../src/server/arcade/score-events';
import { createReadOnlyRunner, type ReadQuery } from './play-report-db';

// ---------------------------------------------------------------------------
// Test traffic rules, as data. Edit this block to change what counts as test
// traffic. Rules run in order; an account is excluded by the first rule it
// matches. Each rule has one comment saying why it exists.
// ---------------------------------------------------------------------------

type AccountRow = {
  id: string;
  email: string; // lowercased, '' when missing
  username: string; // lowercased, '' when missing
  roles: string[];
  status: string;
  schemaFlags: string[]; // names of test or bot columns that are true
};

type RuleContext = { adminEmails: Set<string> };

type TestRule = {
  id: string;
  label: string;
  matches: (account: AccountRow, ctx: RuleContext) => boolean;
};

const localPart = (email: string) => email.split('@')[0] ?? '';
const domainOf = (email: string) => (email.includes('@') ? (email.split('@').pop() ?? '') : '');

const TEST_RULES: TestRule[] = [
  {
    // Staff accounts hold the admin role in arcade_account_roles. Their play is
    // QA and demos, not players.
    id: 'admin-role',
    label: 'admin role',
    matches: (a) => a.roles.includes('admin'),
  },
  {
    // ARCADE_ADMIN_EMAILS grants admin at sign-up. This catches an address that
    // is on the list but has not got the role row (role removed, list edited).
    // Set the same env var when you run the report, or this rule matches nothing.
    id: 'admin-email',
    label: 'ARCADE_ADMIN_EMAILS',
    matches: (a, ctx) => a.email !== '' && ctx.adminEmails.has(a.email),
  },
  {
    // QA accounts the smoke test and the QA scripts create: qa-cards@example.com,
    // qa-wager1@example.com, qa-admin@example.com.
    id: 'qa-local-part',
    label: 'qa-* address',
    matches: (a) => /^qa[-_.+0-9]/.test(localPart(a.email)),
  },
  {
    // Reserved and non-routable domains are never real players: example.com,
    // example.org, example.net, *.test, *.invalid, *.localhost, @localhost.
    id: 'reserved-domain',
    label: 'example, test, invalid or localhost domain',
    matches: (a) => {
      const domain = domainOf(a.email);
      return (
        ['example.com', 'example.org', 'example.net', 'localhost', 'invalid'].includes(domain) ||
        /\.(test|invalid|localhost|example)$/.test(domain)
      );
    },
  },
  {
    // Throwaway accounts that agents and test runs register: test-*, tmp-*,
    // throwaway*, e2e-*, smoke-*, playwright-*, agent-*.
    id: 'test-local-part',
    label: 'test, tmp, e2e, smoke or agent address',
    matches: (a) => /^(test|tester|tmp|temp|throwaway|e2e|smoke|playwright|agent)([-_.+0-9]|$)/.test(localPart(a.email)),
  },
  {
    // Same patterns on the username, for accounts with a neutral address.
    id: 'test-username',
    label: 'test-style username',
    matches: (a) => /^(qa|test|tester|tmp|temp|throwaway|e2e|smoke|playwright|agent)[-_.0-9]/.test(a.username),
  },
  {
    // A test or bot flag in the schema, if one is ever added. None exists today:
    // arcade_accounts has no such column, and monetization_account_flags is a
    // chargeback flag. The script looks for these column names at run time.
    id: 'schema-flag',
    label: 'test or bot column on arcade_accounts',
    matches: (a) => a.schemaFlags.length > 0,
  },
];

// Candidate column names for the schema-flag rule. Only names listed here are
// ever put into SQL.
const SCHEMA_FLAG_COLUMNS = ['is_test', 'is_bot', 'test_account', 'is_test_account', 'is_synthetic', 'is_qa', 'is_internal'];

// Ids that are not accounts. Guests get their own column (they cannot be
// deduplicated across devices). Bot ids are opponents in match tables, and
// matches against them are reported on the bot line.
const GUEST_ID_PREFIX = 'guest:'; // server/auth/guest.ts createGuestUserId
const BOT_ID_PREFIX = 'bot:'; // server/arcade/*-bot.ts BOT_USER_ID_PREFIX

// A second match between the same players within this long of the first one
// finishing is a rematch. No stored rematch flag exists. A rematch from the end
// screen is a new direct challenge, but invited_user_id is cleared when the
// opponent joins (pool-match.ts joinMatch), so it cannot be told from any other
// match between the same two players. The rule therefore also counts queue
// pairings of the same two players. Documented in PLAY_REPORT.md.
const REMATCH_WINDOW_MS = 30 * 60 * 1000;

// Raw game types that are not one game. They are skipped, not reported.
const IGNORED_RAW_TYPES: Record<string, string> = {
  arcade: 'game_time_metrics_daily bucket shared by all ticket machines',
};

const DAY_MS = 86_400_000;
const REQUIRED_WINDOW_DAYS = 28;
const LOCK_TIMEOUT_MS = 2000;

// ---------------------------------------------------------------------------
// Sources, as data. SQL uses $since, $until (ms), $sinceTs, $untilTs (ISO
// strings for timestamptz columns), $lookback (ms) and $tz.
// ---------------------------------------------------------------------------

type Role = 'start' | 'finish' | 'audit' | 'start+finish';

type SourceBase = {
  id: string; // table name
  role: Role;
  /** Counts as a record that the game is tracked. Supporting sources do not. */
  primary: boolean;
  records: string;
  limits: string;
  covers: (slug: string) => boolean;
  /** FROM and WHERE for "is there any row before the window?" ending in a condition on the time column. */
  beforeFrom: string;
};

type GroupedSource = SourceBase & {
  kind: 'grouped';
  /** Rows: raw, uid, day, n, n_alt. */
  sql: string;
  /** Count rows by user and class but never add the user to players or days. */
  countsOnly?: boolean;
};
type MatchSource = SourceBase & { kind: 'matches'; slug: string };
type DuelSource = SourceBase & { kind: 'duels'; slug: string };
type Source = GroupedSource | MatchSource | DuelSource;

const dayOf = (columnMs: string) => `to_char(to_timestamp(${columnMs} / 1000.0) AT TIME ZONE $tz, 'YYYY-MM-DD')`;

const ARCADE_SLUGS = new Set(
  ARCADE_GAMES.filter((game) => game.arcadeHistoryType && isArcadeGameType(game.arcadeHistoryType)).map((game) => game.slug),
);

const only = (slug: string) => (candidate: string) => candidate === slug;

const MATCH_TABLES = [
  ['pool_matches', '8-ball'],
  ['chess_matches', 'chess'],
  ['connect_four_matches', 'connect-four'],
  ['checkers_matches', 'checkers'],
  ['reversi_matches', 'reversi'],
  ['battleship_matches', 'battleship'],
] as const;

const SOURCES: Source[] = [
  {
    id: 'game_sessions',
    kind: 'grouped',
    role: 'start',
    primary: true,
    records: 'ticket machine sessions started (rows with arcade_seed)',
    limits:
      'Skill game sessions are deleted when the score is saved and after 6 hours, so only ticket machines have a start record. A session abandoned before play is refunded and deleted after 30 minutes, which leaves no row.',
    covers: (slug) => ARCADE_SLUGS.has(slug) && slug !== 'derby',
    beforeFrom: 'game_sessions WHERE arcade_seed IS NOT NULL AND started_at < $since',
    sql: `SELECT game_type AS raw, od_user_id AS uid, ${dayOf('started_at')} AS day,
                 COUNT(*)::int AS n,
                 COUNT(*) FILTER (WHERE arcade_settled_at IS NOT NULL)::int AS n_alt
            FROM game_sessions
           WHERE arcade_seed IS NOT NULL AND started_at >= $since AND started_at < $until
           GROUP BY 1, 2, 3`,
  },
  {
    id: 'derby_bets',
    kind: 'grouped',
    role: 'start',
    primary: true,
    records: 'derby bets placed (one row per bet, not per player per race)',
    limits: 'A bet is the unit, so one player betting on three horses is three starts.',
    covers: only('derby'),
    beforeFrom: 'derby_bets WHERE created_at < $sinceTs::timestamptz',
    sql: `SELECT 'arcade-derby' AS raw, user_id AS uid,
                 to_char(created_at AT TIME ZONE $tz, 'YYYY-MM-DD') AS day,
                 COUNT(*)::int AS n,
                 COUNT(*) FILTER (WHERE settled_at IS NOT NULL)::int AS n_alt
            FROM derby_bets
           WHERE created_at >= $sinceTs::timestamptz AND created_at < $untilTs::timestamptz
           GROUP BY 1, 2, 3`,
  },
  {
    id: 'arcade_round_history',
    kind: 'grouped',
    role: 'finish',
    primary: true,
    records: 'ticket machine rounds settled (refunds are not rows; abandoned rounds are rows tagged abandoned)',
    limits: 'A round abandoned after play is settled as a loss by the 30 minute cleanup and counted as settled, not finished.',
    covers: (slug) => ARCADE_SLUGS.has(slug),
    beforeFrom: 'arcade_round_history WHERE created_at < $since',
    sql: `SELECT game_type AS raw, user_id AS uid, ${dayOf('created_at')} AS day,
                 COUNT(*)::int AS n,
                 COUNT(*) FILTER (WHERE outcome_json LIKE '%"abandoned":true%')::int AS n_alt
            FROM arcade_round_history
           WHERE created_at >= $since AND created_at < $until
             AND (outcome_json IS NULL OR outcome_json NOT LIKE '%"refunded":true%')
           GROUP BY 1, 2, 3`,
  },
  {
    id: 'game_score_events',
    kind: 'grouped',
    role: 'finish',
    primary: true,
    records: 'accepted score submissions by signed-in accounts (one row per finished run)',
    limits:
      'Guests are not saved. Written best-effort after the score is saved, so a failed write is lost. A snake run finished with a continue is not written. Only the games in SCORE_LEADERBOARD_GAMES write here.',
    covers: (slug) => isScoreLeaderboardGame(slug),
    beforeFrom: 'game_score_events WHERE created_at < $since',
    sql: `SELECT game_slug AS raw, od_user_id AS uid, ${dayOf('created_at')} AS day,
                 COUNT(*)::int AS n, 0 AS n_alt
            FROM game_score_events
           WHERE created_at >= $since AND created_at < $until
           GROUP BY 1, 2, 3`,
  },
  ...(
    [
      ['word_grid_scores', 'word-grid', 'daily word grid results, one row per player per day'],
      ['pangram_scores', 'pangram', 'daily pangram results, one row per player per day'],
      ['connections_scores', 'connections', 'daily connections results, one row per player per day'],
      ['freecell_scores', 'freecell', 'freecell solves, one row per player per deal'],
    ] as const
  ).map(
    ([table, slug, records]): GroupedSource => ({
      id: table,
      kind: 'grouped',
      role: 'finish',
      primary: true,
      records,
      limits:
        'Finish only, no start record. One row per player per puzzle, so finished means player-days, and replays of the same puzzle add nothing. Guests are not saved.',
      covers: only(slug),
      beforeFrom: `${table} WHERE created_at > 0 AND created_at < $since`,
      sql: `SELECT '${slug}' AS raw, od_user_id AS uid, ${dayOf('created_at')} AS day,
                   COUNT(*)::int AS n, 0 AS n_alt
              FROM ${table}
             WHERE created_at > 0 AND created_at >= $since AND created_at < $until
             GROUP BY 1, 2, 3`,
    }),
  ),
  {
    id: 'game_time_metrics_daily',
    kind: 'grouped',
    role: 'finish',
    primary: false,
    countsOnly: true,
    records: 'finished runs per player per day (run_count), written by the same score routes',
    limits:
      'A count of finished runs and nothing else. Used only for a game that has no rows in game_score_events, never for players or play days, and never for match games or the duel (the match code writes it for every human, bots included). Its day key follows the server time zone, not --tz. Pruned to the previous month and this month. Ticket machines share the arcade bucket and are ignored.',
    covers: () => false,
    beforeFrom: 'game_time_metrics_daily WHERE last_played_at < $since',
    sql: `SELECT game_type AS raw, user_id AS uid, date_key AS day,
                 COALESCE(SUM(run_count), 0)::int AS n, 0 AS n_alt
            FROM game_time_metrics_daily
           WHERE last_played_at >= $since AND last_played_at < $until
           GROUP BY 1, 2, 3`,
  },
  {
    id: 'anti_cheat_logs',
    kind: 'grouped',
    role: 'audit',
    primary: false,
    records: 'flagged and rejected score submissions (passes are logged only when ANTI_CHEAT_LOG_PASSES=true)',
    limits:
      'Purged after ANTI_CHEAT_LOG_RETENTION_DAYS, 14 by default, so a 28 day window is covered only if that is raised. Not a play record. Used for the flagged column only.',
    covers: () => false,
    beforeFrom: 'anti_cheat_logs WHERE ts < $since',
    sql: `SELECT game_type AS raw, user_id AS uid, ${dayOf('ts')} AS day,
                 COUNT(*)::int AS n,
                 COUNT(*) FILTER (WHERE result = 'reject')::int AS n_alt
            FROM anti_cheat_logs
           WHERE ts >= $since AND ts < $until AND result <> 'pass' AND user_id IS NOT NULL
           GROUP BY 1, 2, 3`,
  },
  ...MATCH_TABLES.map(
    ([table, slug]): MatchSource => ({
      id: table,
      kind: 'matches',
      slug,
      role: 'start+finish',
      primary: true,
      records: 'two-player matches: started when an opponent is seated, finished when completed or forfeited',
      limits:
        'Matches against bot opponents (bot:* ids) go on the bot line. No rematch flag is stored; rematches come from the 30 minute rule, which also counts queue pairings of the same two players. Tournament matches are counted but never as rematches.',
      covers: only(slug),
      beforeFrom: `${table} WHERE created_at < $since`,
    }),
  ),
  {
    id: 'arcade_multiplayer_sessions',
    kind: 'duels',
    slug: 'typing-duel',
    role: 'start+finish',
    primary: true,
    records: 'typing duel sessions (game_type typing-test, mode versus): started when active, finished when completed',
    limits:
      'The session game type is typing-test for the duel, so the report maps it to typing-duel. Shared-table 21 sessions are not counted as play.',
    covers: only('typing-duel'),
    beforeFrom: "arcade_multiplayer_sessions WHERE game_type = 'typing-test' AND mode = 'versus' AND created_at < $since",
  },
];

const MATCH_IDS = new Set(SOURCES.filter((source) => source.kind !== 'grouped').map((source) => source.id));

const FINISH_PRIORITY = [
  'arcade_round_history',
  ...MATCH_TABLES.map(([table]) => table),
  'arcade_multiplayer_sessions',
  'game_score_events',
  'word_grid_scores',
  'pangram_scores',
  'connections_scores',
  'freecell_scores',
  'game_time_metrics_daily',
];
const START_PRIORITY = ['game_sessions', 'derby_bets', ...MATCH_TABLES.map(([table]) => table), 'arcade_multiplayer_sessions'];

const ROUTE_SOURCE = {
  id: 'product_analytics_events',
  role: 'route entries',
  records: 'game page visits (game_started is a route entry, not a round) and game_completed events, by session',
  limits:
    'Includes guests, admins and QA browsers, and cannot be split. One event per client navigation. game_completed is sent from the shared result component only, and a duel reports it as typing-test.',
};

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

const HELP = `Play report (read only).

  npm run report:play -- [options]

  --since <date>       start of the window, inclusive. YYYY-MM-DD (00:00 in --tz) or an ISO time.
  --until <date>       end of the window, exclusive. Default: now. Default --since is 28 days before --until.
  --format md|csv|json default md.
  --out <file>         write to a file instead of stdout.
  --include-test       count admin, QA and bot traffic in the main numbers. Default off.
  --min-players <n>    candidates need fewer unique non-test players than this. Default 10.
  --min-repeat <n>     and fewer repeat players than this. Default 3.
  --relaunch <date>    the relaunch date. Without it the candidates list is marked not valid for a cut.
  --tz <name>          time zone for window dates and play days. Default UTC.
  --timeout-ms <n>     statement timeout per query. Default 30000.

Needs DATABASE_URL. The database is never written to. Run it off-peak.
`;

const { values: args } = parseArgs({
  options: {
    since: { type: 'string' },
    until: { type: 'string' },
    format: { type: 'string', default: 'md' },
    out: { type: 'string' },
    'include-test': { type: 'boolean', default: false },
    'min-players': { type: 'string', default: '10' },
    'min-repeat': { type: 'string', default: '3' },
    relaunch: { type: 'string' },
    tz: { type: 'string', default: 'UTC' },
    'timeout-ms': { type: 'string', default: '30000' },
    help: { type: 'boolean', default: false },
  },
  allowPositionals: false,
});

function fail(message: string): never {
  console.error(`play-report: ${message}`);
  process.exit(1);
}

if (args.help) {
  console.log(HELP);
  process.exit(0);
}

const FORMAT = args.format as 'md' | 'csv' | 'json';
if (!['md', 'csv', 'json'].includes(FORMAT)) fail('--format must be md, csv or json.');

const TZ = args.tz as string;
try {
  new Intl.DateTimeFormat('en-US', { timeZone: TZ });
} catch {
  fail(`--tz is not a time zone: ${TZ}`);
}

/** Offset of a time zone from UTC at an instant, in ms. */
function zoneOffsetMs(ms: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(ms));
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second')) - Math.floor(ms / 1000) * 1000;
}

/** Reads a wall-clock time written as if it were UTC as a time in --tz. */
function wallClockInZone(asUtcMs: number): number {
  const first = asUtcMs - zoneOffsetMs(asUtcMs);
  return asUtcMs - zoneOffsetMs(first);
}

function parseWhen(label: string, value: string): number {
  const hasZone = /(Z|[+-]\d{2}:?\d{2})$/i.test(value);
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const ms = Date.parse(dateOnly || hasZone ? (dateOnly ? `${value}T00:00:00Z` : value) : `${value}Z`);
  if (!Number.isFinite(ms)) fail(`${label} is not a date: ${value}`);
  return hasZone ? ms : wallClockInZone(ms);
}

const UNTIL_MS = args.until ? parseWhen('--until', args.until) : Date.now();
const SINCE_MS = args.since ? parseWhen('--since', args.since) : UNTIL_MS - REQUIRED_WINDOW_DAYS * DAY_MS;
if (SINCE_MS >= UNTIL_MS) fail('--since must be before --until.');
const RELAUNCH_MS = args.relaunch ? parseWhen('--relaunch', args.relaunch) : null;

const INCLUDE_TEST = Boolean(args['include-test']);
const MIN_PLAYERS = Number(args['min-players']);
const MIN_REPEAT = Number(args['min-repeat']);
const TIMEOUT_MS = Math.floor(Number(args['timeout-ms']));
if (!Number.isFinite(MIN_PLAYERS) || !Number.isFinite(MIN_REPEAT)) fail('--min-players and --min-repeat must be numbers.');
if (!Number.isInteger(TIMEOUT_MS) || TIMEOUT_MS < 1000) fail('--timeout-ms must be at least 1000.');

const dayFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const dayKey = (ms: number) => dayFormatter.format(new Date(ms));

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) fail('DATABASE_URL is required.');

function describeDatabase(url: string): { host: string; name: string } {
  try {
    const parsed = new URL(url);
    return { host: parsed.host || 'local socket', name: decodeURIComponent(parsed.pathname.replace(/^\//, '')) };
  } catch {
    return { host: 'unknown', name: 'unknown' };
  }
}

// ---------------------------------------------------------------------------
// Slug mapping and classification
// ---------------------------------------------------------------------------

const REGISTRY = new Map(ARCADE_GAMES.map((game) => [game.slug, game]));

/** Raw game type from any table to a registry slug. Uses gameSlugFromType. */
function slugOf(raw: string): string | null {
  if (raw in IGNORED_RAW_TYPES) return null;
  return gameSlugFromType(raw);
}

type Kind = 'real' | 'test' | 'bot' | 'guest';
type Classified = { kind: Kind; rule: string | null; noAccount: boolean };

function buildClassifier(accounts: Map<string, AccountRow>, ctx: RuleContext) {
  const cache = new Map<string, Classified>();
  return (uid: string): Classified => {
    const hit = cache.get(uid);
    if (hit) return hit;
    let result: Classified;
    if (uid.startsWith(GUEST_ID_PREFIX)) result = { kind: 'guest', rule: null, noAccount: false };
    else if (uid.startsWith(BOT_ID_PREFIX)) result = { kind: 'bot', rule: 'bot-id', noAccount: false };
    else {
      const account = accounts.get(uid);
      if (!account) result = { kind: 'real', rule: null, noAccount: true };
      else {
        const rule = TEST_RULES.find((candidate) => candidate.matches(account, ctx));
        result = rule ? { kind: 'test', rule: rule.id, noAccount: false } : { kind: 'real', rule: null, noAccount: false };
      }
    }
    cache.set(uid, result);
    return result;
  };
}

// ---------------------------------------------------------------------------
// Accumulation
// ---------------------------------------------------------------------------

type Bucket = {
  users: Map<string, Set<string>>; // uid -> play days
  src: Map<string, { n: number; nAlt: number }>;
  lastDay: string | null;
};

const newBucket = (): Bucket => ({ users: new Map(), src: new Map(), lastDay: null });

type MatchRecord = {
  participants: string[];
  createdAt: number;
  completedAt: number | null;
  started: boolean;
  finished: boolean;
  tournament: boolean;
  inWindow: boolean;
  kind: Kind; // bot > test > guest > real
};

type SlugData = {
  buckets: Record<Kind, Bucket>;
  flagged: Map<string, number>; // class -> flagged or rejected submissions
  matches: MatchRecord[];
  sourcesWithRows: Set<string>;
};

const slugData = new Map<string, SlugData>();
function dataFor(slug: string): SlugData {
  let data = slugData.get(slug);
  if (!data) {
    data = {
      buckets: { real: newBucket(), test: newBucket(), bot: newBucket(), guest: newBucket() },
      flagged: new Map(),
      matches: [],
      sourcesWithRows: new Set(),
    };
    slugData.set(slug, data);
  }
  return data;
}

function addToBucket(bucket: Bucket, sourceId: string, uid: string | null, day: string, n: number, nAlt: number) {
  const entry = bucket.src.get(sourceId) ?? { n: 0, nAlt: 0 };
  entry.n += n;
  entry.nAlt += nAlt;
  bucket.src.set(sourceId, entry);
  if (uid) {
    const days = bucket.users.get(uid) ?? new Set<string>();
    days.add(day);
    bucket.users.set(uid, days);
    if (!bucket.lastDay || day > bucket.lastDay) bucket.lastDay = day;
  }
}

function mergeBuckets(buckets: Bucket[]): Bucket {
  const merged = newBucket();
  for (const bucket of buckets) {
    for (const [uid, days] of bucket.users) {
      const target = merged.users.get(uid) ?? new Set<string>();
      for (const day of days) target.add(day);
      merged.users.set(uid, target);
    }
    for (const [id, value] of bucket.src) {
      const target = merged.src.get(id) ?? { n: 0, nAlt: 0 };
      target.n += value.n;
      target.nAlt += value.nAlt;
      merged.src.set(id, target);
    }
    if (bucket.lastDay && (!merged.lastDay || bucket.lastDay > merged.lastDay)) merged.lastDay = bucket.lastDay;
  }
  return merged;
}

// ---------------------------------------------------------------------------
// Report model
// ---------------------------------------------------------------------------

type Tracking =
  | 'recorded'
  | 'counts only'
  | 'source empty'
  | 'source unavailable'
  | 'not recorded'
  | 'not in registry';

type GameRow = {
  slug: string;
  title: string;
  placement: string; // floor, reserve, retired, merged, later, not in registry
  group: string | null;
  note: string | null; // merged into x
  tracking: Tracking;
  source_partial: boolean;
  players: number | null;
  guest_sessions: number | null;
  guest_ids: number | null;
  started: number | null;
  finished: number | null;
  completion_rate: number | null;
  repeat_players: number | null;
  median_days: number | null;
  rematches: number | null;
  wagers_settled: number | null;
  last_play: string | null;
  flagged_submissions: number | null;
  test_players: number | null;
  test_finished: number | null;
  bot_matches: number | null;
  route_entries: number | null;
  route_sessions: number | null;
  route_completions: number | null;
};

type SourceStatus = {
  id: string;
  role: string;
  records: string;
  limits: string;
  status: 'data in window' | 'no rows in window' | 'table missing' | 'query failed';
  rows_in_window: number;
  rows_before_window: boolean | null;
  last_row_in_window: string | null;
  partial: boolean;
  error: string | null;
};

const median = (values: number[]) => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};

type Counted = { id: string; count: number } | null;

function pickCount(bucket: Bucket, priority: string[], pick: (id: string, v: { n: number; nAlt: number }) => number, usable: Set<string>): Counted {
  for (const id of priority) {
    if (!usable.has(id)) continue;
    const value = bucket.src.get(id);
    if (value && pick(id, value) > 0) return { id, count: pick(id, value) };
  }
  return null;
}

/** Finished games in a bucket, taken from the first source that has any. */
function finishedPick(bucket: Bucket, wager: boolean, usable: Set<string>): Counted {
  if (wager) {
    const history = bucket.src.get('arcade_round_history');
    return { id: 'arcade_round_history', count: history ? history.n - history.nAlt : 0 };
  }
  // Match and duel sources store matches started in n and matches finished in nAlt.
  return pickCount(bucket, FINISH_PRIORITY, (id, v) => (MATCH_IDS.has(id) ? v.nAlt : v.n), usable);
}

function countRematches(matches: MatchRecord[], kinds: Kind[]): number {
  const eligible = matches.filter((match) => match.started && kinds.includes(match.kind)).sort((a, b) => a.createdAt - b.createdAt);
  const last = new Map<string, MatchRecord>();
  let count = 0;
  for (const match of eligible) {
    const key = [...match.participants].sort().join('|');
    const previous = last.get(key);
    if (
      previous &&
      match.inWindow &&
      !previous.tournament &&
      !match.tournament &&
      previous.completedAt !== null &&
      match.createdAt - previous.completedAt >= 0 &&
      match.createdAt - previous.completedAt <= REMATCH_WINDOW_MS
    ) {
      count += 1;
    }
    last.set(key, match);
  }
  return count;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

type GroupedRow = { raw: string; uid: string; day: string; n: number; n_alt: number };
type MatchRow = {
  p1: string;
  p2: string | null;
  status: string;
  created_at: number;
  completed_at: number | null;
  tournament: boolean;
};
type DuelRow = { status: string; created_at: number; started_at: number | null; completed_at: number | null; players: string[] };

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error)).split('\n')[0]!.slice(0, 160);

async function main() {
  const client = new Client({ connectionString: databaseUrl, application_name: 'tixy-play-report' });
  await client.connect();
  try {
    const runner = createReadOnlyRunner(client, { statementTimeoutMs: TIMEOUT_MS, lockTimeoutMs: LOCK_TIMEOUT_MS });
    const windowParams = {
      since: SINCE_MS,
      until: UNTIL_MS,
      sinceTs: new Date(SINCE_MS).toISOString(),
      untilTs: new Date(UNTIL_MS).toISOString(),
      lookback: SINCE_MS - REMATCH_WINDOW_MS,
      tz: TZ,
    };

    // Which tables exist. A missing table is reported, never queried.
    const wanted = [...new Set([...SOURCES.map((s) => s.id), 'arcade_accounts', 'arcade_account_roles', ROUTE_SOURCE.id])];
    const tables = new Set(
      await runner.run(async (q) =>
        (
          await q<{ table_name: string }>(
            `SELECT table_name FROM information_schema.tables
              WHERE table_schema = ANY (current_schemas(false)) AND table_name = ANY ($names)`,
            { names: wanted },
          )
        ).map((row) => row.table_name),
      ),
    );
    if (!tables.has('arcade_accounts')) fail('arcade_accounts is not readable. This is not an arcade database, or the role has no grant.');

    // Accounts and test flags.
    const hasRoles = tables.has('arcade_account_roles');
    const { accountRows, flagColumns } = await runner.run(async (q) => {
      const columns = (
        await q<{ column_name: string }>(
          `SELECT column_name FROM information_schema.columns
            WHERE table_schema = ANY (current_schemas(false)) AND table_name = 'arcade_accounts' AND column_name = ANY ($names)`,
          { names: SCHEMA_FLAG_COLUMNS },
        )
      )
        .map((row) => row.column_name)
        .filter((name) => SCHEMA_FLAG_COLUMNS.includes(name));
      const flagSelect = columns.map((name) => `, COALESCE(a.${name}::text, '') AS flag_${name}`).join('');
      const rows = await q(
        `SELECT a.id, COALESCE(a.email_normalized, lower(a.email), '') AS email,
                COALESCE(a.username_normalized, '') AS username, a.status
                ${hasRoles ? ", COALESCE(array_agg(r.role) FILTER (WHERE r.role IS NOT NULL), '{}') AS roles" : ", '{}'::text[] AS roles"}
                ${flagSelect}
           FROM arcade_accounts a
           ${hasRoles ? 'LEFT JOIN arcade_account_roles r ON r.user_id = a.id' : ''}
          GROUP BY a.id`,
      );
      return { accountRows: rows, flagColumns: columns };
    });
    const accounts = new Map<string, AccountRow>();
    for (const row of accountRows) {
      accounts.set(String(row.id), {
        id: String(row.id),
        email: String(row.email ?? '').toLowerCase(),
        username: String(row.username ?? '').toLowerCase(),
        roles: (row.roles as string[]) ?? [],
        status: String(row.status ?? ''),
        schemaFlags: flagColumns.filter((name) => ['t', 'true', '1'].includes(String(row[`flag_${name}`]).toLowerCase())),
      });
    }

    const adminEmails = new Set(
      (process.env.ARCADE_ADMIN_EMAILS ?? '')
        .split(',')
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean),
    );
    const classify = buildClassifier(accounts, { adminEmails });

    const sourceStatus: SourceStatus[] = [];
    const activeUids = new Set<string>();
    const botIdsSeen = new Set<string>();
    const unmappedRaw = new Map<string, Set<string>>();
    const warnings: string[] = [];

    const ingestGrouped = (source: GroupedSource, rows: GroupedRow[], status: SourceStatus) => {
      for (const row of rows) {
        status.rows_in_window += row.n;
        if (!status.last_row_in_window || row.day > status.last_row_in_window) status.last_row_in_window = row.day;
        const slug = slugOf(row.raw);
        if (slug === null) continue;
        if (!REGISTRY.has(slug) && source.role !== 'audit') {
          const set = unmappedRaw.get(row.raw) ?? new Set<string>();
          set.add(source.id);
          unmappedRaw.set(row.raw, set);
        }
        const cls = classify(row.uid);
        const data = dataFor(slug);
        if (source.role === 'audit') {
          data.flagged.set(cls.kind, (data.flagged.get(cls.kind) ?? 0) + row.n);
          continue;
        }
        data.sourcesWithRows.add(source.id);
        addToBucket(data.buckets[cls.kind], source.id, source.countsOnly ? null : row.uid, row.day, row.n, row.n_alt);
        if (!source.countsOnly) activeUids.add(row.uid);
      }
    };

    const ingestMatches = (source: MatchSource | DuelSource, records: MatchRecord[], status: SourceStatus) => {
      const data = dataFor(source.slug);
      for (const match of records) {
        data.matches.push(match);
        if (!match.inWindow || !match.started) continue;
        status.rows_in_window += 1;
        const day = dayKey(match.createdAt);
        if (!status.last_row_in_window || day > status.last_row_in_window) status.last_row_in_window = day;
        data.sourcesWithRows.add(source.id);
        const humans = match.participants.filter((uid) => !uid.startsWith(BOT_ID_PREFIX));
        for (const uid of match.participants) if (uid.startsWith(BOT_ID_PREFIX)) botIdsSeen.add(uid);
        humans.forEach((uid, index) => {
          // The match is counted once, on its first human. Every human is a player.
          addToBucket(data.buckets[match.kind], source.id, uid, day, index === 0 ? 1 : 0, index === 0 && match.finished ? 1 : 0);
          activeUids.add(uid);
        });
      }
    };

    const kindOf = (participants: string[]): Kind => {
      const kinds = participants.map((uid) => classify(uid).kind);
      return kinds.includes('bot') ? 'bot' : kinds.includes('test') ? 'test' : kinds.includes('guest') ? 'guest' : 'real';
    };

    // One short read-only transaction per source. A failure is recorded and the
    // game's numbers become unknown; the other sources still run.
    for (const source of SOURCES) {
      const status: SourceStatus = {
        id: source.id,
        role: source.role,
        records: source.records,
        limits: source.limits,
        status: 'table missing',
        rows_in_window: 0,
        rows_before_window: null,
        last_row_in_window: null,
        partial: false,
        error: null,
      };
      sourceStatus.push(status);
      if (!tables.has(source.id)) continue;
      try {
        const fetched = await runner.run(async (q: ReadQuery) => {
          const before = await q(`SELECT 1 AS found FROM ${source.beforeFrom} LIMIT 1`, windowParams);
          if (source.kind === 'grouped') {
            return { before: before.length > 0, grouped: await q<GroupedRow>(source.sql, windowParams) };
          }
          if (source.kind === 'matches') {
            const rows = await q<MatchRow>(
              `SELECT player1_id AS p1, player2_id AS p2, status, created_at::float8 AS created_at,
                      completed_at::float8 AS completed_at, (tournament_match_id IS NOT NULL) AS tournament
                 FROM ${source.id}
                WHERE created_at < $until AND (created_at >= $lookback OR completed_at >= $lookback)`,
              windowParams,
            );
            return { before: before.length > 0, matches: rows };
          }
          const rows = await q<DuelRow>(
            `SELECT s.status, s.created_at::float8 AS created_at, s.started_at::float8 AS started_at,
                    s.completed_at::float8 AS completed_at, array_agg(p.user_id ORDER BY p.seat_index) AS players
               FROM arcade_multiplayer_sessions s
               JOIN arcade_multiplayer_session_players p ON p.session_id = s.id
              WHERE s.game_type = 'typing-test' AND s.mode = 'versus'
                AND s.created_at < $until AND (s.created_at >= $lookback OR s.completed_at >= $lookback)
              GROUP BY s.id`,
            windowParams,
          );
          return { before: before.length > 0, duels: rows };
        });
        status.rows_before_window = fetched.before;
        if ('grouped' in fetched && fetched.grouped) ingestGrouped(source as GroupedSource, fetched.grouped, status);
        if ('matches' in fetched && fetched.matches) {
          ingestMatches(
            source as MatchSource,
            fetched.matches.map((row) => {
              const participants = [row.p1, row.p2].filter((value): value is string => Boolean(value));
              return {
                participants,
                createdAt: row.created_at,
                completedAt: row.completed_at,
                started: Boolean(row.p2),
                finished: Boolean(row.p2) && (row.completed_at !== null || ['completed', 'forfeited'].includes(row.status)),
                tournament: row.tournament,
                inWindow: row.created_at >= SINCE_MS,
                kind: kindOf(participants),
              };
            }),
            status,
          );
        }
        if ('duels' in fetched && fetched.duels) {
          ingestMatches(
            source as DuelSource,
            fetched.duels.map((row) => ({
              participants: row.players,
              createdAt: row.created_at,
              completedAt: row.completed_at,
              started: ['active', 'completed'].includes(row.status) || row.started_at !== null,
              finished: row.status === 'completed' || row.completed_at !== null,
              tournament: false,
              inWindow: row.created_at >= SINCE_MS,
              kind: kindOf(row.players),
            })),
            status,
          );
        }
        status.partial = fetched.before === false && status.rows_in_window > 0;
        status.status = status.rows_in_window > 0 ? 'data in window' : 'no rows in window';
      } catch (error) {
        status.status = 'query failed';
        status.error = errorText(error);
      }
    }

    // Route entries from product analytics. Not separable from test traffic.
    const routeEntries = new Map<string, { entries: number; sessions: number; completions: number }>();
    const routeStatus: SourceStatus = {
      ...ROUTE_SOURCE,
      status: 'table missing',
      rows_in_window: 0,
      rows_before_window: null,
      last_row_in_window: null,
      partial: false,
      error: null,
    };
    if (tables.has(ROUTE_SOURCE.id)) {
      try {
        const fetched = await runner.run(async (q) => ({
          before: (await q('SELECT 1 AS found FROM product_analytics_events WHERE created_at < $since LIMIT 1', windowParams)).length > 0,
          rows: await q<{ slug: string; entries: number; sessions: number; completions: number }>(
            `SELECT game_slug AS slug,
                    COUNT(*) FILTER (WHERE event_name = 'game_started')::int AS entries,
                    COUNT(DISTINCT session_hash) FILTER (WHERE event_name = 'game_started')::int AS sessions,
                    COUNT(*) FILTER (WHERE event_name = 'game_completed')::int AS completions
               FROM product_analytics_events
              WHERE game_slug IS NOT NULL AND created_at >= $since AND created_at < $until
              GROUP BY 1`,
            windowParams,
          ),
        }));
        routeStatus.rows_before_window = fetched.before;
        for (const row of fetched.rows) {
          routeEntries.set(row.slug, { entries: row.entries, sessions: row.sessions, completions: row.completions });
          routeStatus.rows_in_window += row.entries + row.completions;
        }
        routeStatus.partial = !fetched.before && routeStatus.rows_in_window > 0;
        routeStatus.status = routeStatus.rows_in_window > 0 ? 'data in window' : 'no rows in window';
      } catch (error) {
        routeStatus.status = 'query failed';
        routeStatus.error = errorText(error);
      }
    }

    // Counts of accounts per test rule: in the database, active in the window,
    // and excluded (first matching rule).
    const ruleCounts = TEST_RULES.map((rule) => {
      let inDatabase = 0;
      let active = 0;
      let excluded = 0;
      for (const account of accounts.values()) {
        if (!rule.matches(account, { adminEmails })) continue;
        inDatabase += 1;
        if (activeUids.has(account.id)) active += 1;
      }
      for (const uid of activeUids) {
        const cls = classify(uid);
        if (cls.kind === 'test' && cls.rule === rule.id) excluded += 1;
      }
      return { id: rule.id, label: rule.label, accounts_in_database: inDatabase, accounts_active_in_window: active, accounts_excluded: excluded };
    });
    const guestIds = [...activeUids].filter((uid) => uid.startsWith(GUEST_ID_PREFIX)).length;
    const noAccountIds = [...activeUids].filter((uid) => classify(uid).noAccount).length;
    if (adminEmails.size === 0) {
      warnings.push('ARCADE_ADMIN_EMAILS is not set in this shell. Only the admin role finds admin accounts. Set it to the production value.');
    }

    const statusById = new Map(sourceStatus.map((s) => [s.id, s]));
    const readable = new Set(sourceStatus.filter((s) => s.status !== 'table missing' && s.status !== 'query failed').map((s) => s.id));
    const auditReadable = readable.has('anti_cheat_logs');
    // A source is alive when it has rows in the window. A table that serves one
    // game only (a match table, a daily table) is also alive when it holds older
    // rows, because an empty window then means nobody played, not that nothing is
    // written. Anything else with no rows is unknown.
    const isAlive = (source: Source) => {
      const status = statusById.get(source.id);
      if (!status || !readable.has(source.id)) return false;
      if (status.rows_in_window > 0) return true;
      const servesOneGame = ARCADE_GAMES.filter((game) => source.covers(game.slug)).length <= 1;
      return servesOneGame && status.rows_before_window === true;
    };

    // Games to report: every registry entry plus anything found in the data.
    const slugs: string[] = [...REGISTRY.keys()];
    for (const [slug, data] of slugData) {
      if (!REGISTRY.has(slug) && data.sourcesWithRows.size > 0) slugs.push(slug);
    }

    const mainKinds: Kind[] = INCLUDE_TEST ? ['real', 'test', 'bot'] : ['real'];
    const rows: GameRow[] = [];

    for (const slug of slugs) {
      const entry = REGISTRY.get(slug) ?? null;
      const data = slugData.get(slug) ?? dataFor(slug);
      const covering = entry ? SOURCES.filter((s) => s.primary && s.covers(slug)) : [];
      const alive = covering.filter((s) => isAlive(s));
      let tracking: Tracking;
      if (!entry) tracking = 'not in registry';
      else if (covering.length === 0) tracking = 'not recorded';
      else if (alive.length === 0) tracking = covering.some((s) => !readable.has(s.id)) ? 'source unavailable' : 'source empty';
      else tracking = 'recorded';
      const sourcePartial = alive.some((s) => statusById.get(s.id)?.partial === true);

      const wager = ARCADE_SLUGS.has(slug);
      const isMatchSlug = SOURCES.some((s) => s.kind !== 'grouped' && s.covers(slug));
      // Time metrics count finished runs for a game with no score events. Never
      // for match games, the duel or ticket machines, and never for players.
      const timeMetricsOk = !wager && !isMatchSlug && !data.sourcesWithRows.has('game_score_events');
      const usable = new Set([...readable].filter((id) => id !== 'game_time_metrics_daily' || timeMetricsOk));

      const main = mergeBuckets(mainKinds.map((kind) => data.buckets[kind]));
      const finishedFrom = tracking === 'recorded' || tracking === 'not in registry' ? finishedPick(main, wager, usable) : null;
      const countsOnly = tracking === 'recorded' && finishedFrom?.id === 'game_time_metrics_daily' && main.users.size === 0;
      if (countsOnly) tracking = 'counts only';

      const allUnknown = tracking === 'not recorded' || tracking === 'source empty' || tracking === 'source unavailable';
      const playersUnknown = allUnknown || countsOnly;
      const hasMatches = isMatchSlug || data.matches.length > 0;

      const startPick = pickCount(main, START_PRIORITY, (_id, v) => v.n, usable);
      const startCovered = SOURCES.some((s) => START_PRIORITY.includes(s.id) && s.covers(slug) && usable.has(s.id));
      const started = allUnknown || countsOnly ? null : startPick ? startPick.count : startCovered ? 0 : null;
      const finished = allUnknown ? null : (finishedFrom?.count ?? 0);
      const wagersSettled = allUnknown || !wager ? null : (main.src.get('arcade_round_history')?.n ?? 0);

      const dayCounts = [...main.users.values()].map((days) => days.size);
      const guestRecorded = wager && !allUnknown;
      const guestBucket = data.buckets.guest;
      const testBucket = data.buckets.test;
      const botBucket = data.buckets.bot;
      const testFinished = allUnknown ? null : (finishedPick(testBucket, wager, usable)?.count ?? 0);
      // Only the test accounts count, not a real opponent in the same match.
      const testPlayers = allUnknown || countsOnly ? null : [...testBucket.users.keys()].filter((uid) => classify(uid).kind === 'test').length;
      const flaggedMain = mainKinds.reduce((sum, kind) => sum + (data.flagged.get(kind) ?? 0), 0);
      const route = routeEntries.get(slug) ?? null;
      const placement = entry?.placement;

      rows.push({
        slug,
        title: entry?.title ?? slug,
        placement: placement ? placement.status : 'not in registry',
        group: placement && 'group' in placement ? placement.group : null,
        note: placement && placement.status === 'merged' ? `merged into ${placement.into}` : null,
        tracking,
        source_partial: sourcePartial,
        players: playersUnknown ? null : main.users.size,
        guest_sessions: guestRecorded ? (guestBucket.src.get('game_sessions')?.n ?? guestBucket.src.get('derby_bets')?.n ?? 0) : null,
        guest_ids: guestRecorded ? guestBucket.users.size : null,
        started,
        finished,
        completion_rate: started && finished !== null && started > 0 ? Math.round((finished / started) * 10000) / 10000 : null,
        repeat_players: playersUnknown ? null : dayCounts.filter((count) => count >= 2).length,
        median_days: playersUnknown ? null : median(dayCounts),
        rematches: playersUnknown || !hasMatches ? null : countRematches(data.matches, mainKinds),
        wagers_settled: wagersSettled,
        last_play: playersUnknown ? null : main.lastDay,
        flagged_submissions: allUnknown || !auditReadable ? null : flaggedMain,
        test_players: testPlayers,
        test_finished: testFinished,
        bot_matches: allUnknown || !hasMatches ? null : [...botBucket.src.entries()].filter(([id]) => MATCH_IDS.has(id)).reduce((sum, [, v]) => sum + v.n, 0),
        route_entries: route?.entries ?? 0,
        route_sessions: route?.sessions ?? 0,
        route_completions: route?.completions ?? 0,
      });
    }

    const runnerStats = runner.stats();
    const meta = {
      generated_at: new Date().toISOString(),
      database: describeDatabase(databaseUrl as string),
      read_only: runnerStats.verifiedReadOnly,
      read_only_transactions: runnerStats.transactions,
      statement_timeout_ms: TIMEOUT_MS,
      lock_timeout_ms: LOCK_TIMEOUT_MS,
      since: new Date(SINCE_MS).toISOString(),
      until: new Date(UNTIL_MS).toISOString(),
      window_days: Math.round(((UNTIL_MS - SINCE_MS) / DAY_MS) * 100) / 100,
      time_zone: TZ,
      include_test: INCLUDE_TEST,
      min_players: MIN_PLAYERS,
      min_repeat: MIN_REPEAT,
      relaunch: RELAUNCH_MS === null ? null : new Date(RELAUNCH_MS).toISOString(),
      admin_emails_configured: adminEmails.size,
    };

    // Is this report good enough to cut a game on?
    const cutProblems: string[] = [];
    const windowDays = (UNTIL_MS - SINCE_MS) / DAY_MS;
    if (windowDays < REQUIRED_WINDOW_DAYS - 0.01) cutProblems.push(`the window is ${meta.window_days} days and a cut needs ${REQUIRED_WINDOW_DAYS}`);
    if (RELAUNCH_MS === null) cutProblems.push('--relaunch is not set, so play from before the relaunch cannot be ruled out');
    else {
      if (SINCE_MS < RELAUNCH_MS) cutProblems.push(`the window starts before the relaunch on ${dayKey(RELAUNCH_MS)}`);
      const daysSince = (Math.min(UNTIL_MS, Date.now()) - RELAUNCH_MS) / DAY_MS;
      if (daysSince < REQUIRED_WINDOW_DAYS - 0.01) cutProblems.push(`${Math.max(0, Math.floor(daysSince))} days of play since the relaunch and a cut needs ${REQUIRED_WINDOW_DAYS}`);
    }
    for (const status of sourceStatus) {
      if (status.status === 'table missing') cutProblems.push(`${status.id} is missing or not readable`);
      else if (status.status === 'query failed') cutProblems.push(`${status.id} failed to read (${status.error})`);
      else if (status.partial && SOURCES.find((s) => s.id === status.id)?.primary) cutProblems.push(`${status.id} has no rows before the window`);
    }
    if (routeStatus.status === 'table missing' || routeStatus.status === 'query failed') warnings.push(`${routeStatus.id}: ${routeStatus.status}. Route entries are unknown.`);
    const partialOthers = [...sourceStatus.filter((s) => !SOURCES.find((x) => x.id === s.id)?.primary), routeStatus].filter(
      (s) => s.partial && (s.status === 'data in window' || s.status === 'no rows in window'),
    );
    if (partialOthers.length) {
      warnings.push(`These supporting sources have no rows before the window starts on ${dayKey(SINCE_MS)}: ${partialOthers.map((s) => s.id).join(', ')}.`);
    }

    const judged = (row: GameRow) => row.tracking === 'recorded' && !row.source_partial;
    const listed = rows.filter((row) => row.placement === 'retired' || row.placement === 'reserve');
    const candidates = listed.filter((row) => judged(row) && (row.players as number) < MIN_PLAYERS && (row.repeat_players as number) < MIN_REPEAT);
    const notJudged = listed
      .filter((row) => !judged(row))
      .map((row) => ({ slug: row.slug, reason: row.tracking === 'recorded' ? 'source starts after the window' : row.tracking }));

    const report = {
      meta,
      warnings,
      cut_check: { valid: cutProblems.length === 0, problems: cutProblems },
      sources: [...sourceStatus, routeStatus],
      test_rules: ruleCounts,
      test_traffic: {
        guest_ids_active: guestIds,
        bot_ids_active: botIdsSeen.size,
        ids_without_account_row: noAccountIds,
        schema_flag_columns: flagColumns,
      },
      games: rows,
      candidates: candidates.map((row) => row.slug),
      not_judged: notJudged,
      unmapped_raw_types: [...unmappedRaw.entries()].map(([raw, from]) => ({ raw, sources: [...from] })),
    };

    const output = FORMAT === 'json' ? `${JSON.stringify(report, null, 2)}\n` : FORMAT === 'csv' ? renderCsv(report.games) : renderMarkdown(report);
    if (args.out) {
      writeFileSync(args.out, output);
      console.error(`play-report: wrote ${args.out}`);
    } else {
      process.stdout.write(output);
    }
  } finally {
    await client.end().catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

type Report = {
  meta: Record<string, unknown> & { since: string; until: string; window_days: number; database: { host: string; name: string } };
  warnings: string[];
  cut_check: { valid: boolean; problems: string[] };
  sources: SourceStatus[];
  test_rules: { id: string; label: string; accounts_in_database: number; accounts_active_in_window: number; accounts_excluded: number }[];
  test_traffic: { guest_ids_active: number; bot_ids_active: number; ids_without_account_row: number; schema_flag_columns: string[] };
  games: GameRow[];
  candidates: string[];
  not_judged: { slug: string; reason: string }[];
  unmapped_raw_types: { raw: string; sources: string[] }[];
};

const CSV_COLUMNS: (keyof GameRow)[] = [
  'slug', 'title', 'placement', 'group', 'tracking', 'players', 'guest_sessions', 'guest_ids', 'started', 'finished',
  'completion_rate', 'repeat_players', 'median_days', 'rematches', 'wagers_settled', 'last_play', 'flagged_submissions',
  'test_players', 'test_finished', 'bot_matches', 'route_entries', 'route_sessions', 'route_completions', 'source_partial',
];

function renderCsv(games: GameRow[]): string {
  const cell = (value: unknown) => {
    if (value === null || value === undefined) return '';
    const text = String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return `${[CSV_COLUMNS.join(','), ...games.map((game) => CSV_COLUMNS.map((column) => cell(game[column])).join(','))].join('\n')}\n`;
}

const isUnknown = (row: GameRow) => row.tracking === 'not recorded' || row.tracking === 'source empty' || row.tracking === 'source unavailable';
const show = (value: number | string | null) => (value === null ? 'unknown' : String(value));
const showDays = (value: number | null, known: boolean) =>
  value === null ? (known ? 'none' : 'unknown') : Number.isInteger(value) ? String(value) : value.toFixed(1);
const showRate = (row: GameRow) => (row.completion_rate === null ? 'n/a' : `${(row.completion_rate * 100).toFixed(1)}%`);

function table(headers: string[], body: string[][]): string {
  const line = (cells: string[]) => `| ${cells.join(' | ')} |`;
  return [line(headers), line(headers.map(() => '---')), ...body.map(line)].join('\n');
}

function gameTable(rows: GameRow[]): string {
  return table(
    ['game', 'players', 'guest sessions', 'started', 'finished', 'completion', 'repeat players', 'median days', 'rematches', 'settled', 'last play', 'tracking'],
    rows.map((row) => [
      row.slug,
      show(row.players),
      row.guest_sessions === null ? 'not recorded' : String(row.guest_sessions),
      row.started === null ? (isUnknown(row) ? 'unknown' : 'n/a') : String(row.started),
      show(row.finished),
      showRate(row),
      show(row.repeat_players),
      showDays(row.median_days, !isUnknown(row) && row.tracking !== 'counts only'),
      row.rematches === null ? 'n/a' : String(row.rematches),
      row.wagers_settled === null ? 'n/a' : String(row.wagers_settled),
      row.last_play ?? (isUnknown(row) || row.tracking === 'counts only' ? 'unknown' : 'none'),
      row.tracking + (row.source_partial ? ', source starts after window' : ''),
    ]),
  );
}

function renderMarkdown(report: Report): string {
  const { meta } = report;
  const out: string[] = [];
  const push = (...lines: string[]) => out.push(...lines);
  const gamesBySlug = new Map(report.games.map((game) => [game.slug, game]));

  push('# Play report', '');
  push(
    `Window: ${String(meta.since).slice(0, 10)} to ${String(meta.until).slice(0, 10)} UTC, ${meta.window_days} days, window dates and play days in ${meta.time_zone}. The end is not included.`,
    `Database: ${meta.database.host}/${meta.database.name}. ${meta.read_only_transactions} read only transactions (confirmed: ${meta.read_only ? 'yes' : 'no'}), statement timeout ${meta.statement_timeout_ms} ms, lock timeout ${meta.lock_timeout_ms} ms.`,
    `Generated: ${meta.generated_at}.`,
    meta.include_test
      ? 'Test traffic: included in the numbers below (admin, QA and bot opponents). Guests stay in their own column.'
      : 'Test traffic: left out of the numbers below and listed in its own section. Guests are in their own column.',
    '',
  );

  // Tracking check.
  push('## Tracking check', '');
  push('Run this before reading the numbers. A game with no recorded source shows unknown, not 0.', '');
  push(
    table(
      ['source', 'role', 'rows in window', 'rows before window', 'last row in window', 'status'],
      report.sources.map((source) => [
        source.id,
        source.role,
        String(source.rows_in_window),
        source.rows_before_window === null ? 'unknown' : source.rows_before_window ? 'yes' : 'no',
        source.last_row_in_window ?? 'none',
        source.status + (source.error ? `: ${source.error}` : '') + (source.partial && !source.error && source.status !== 'table missing' ? ', starts after window' : ''),
      ]),
    ),
    '',
  );
  for (const warning of report.warnings) push(`- ${warning}`);
  if (report.warnings.length) push('');
  const list = (rows: GameRow[]) => rows.map((game) => game.slug).join(', ') || 'none';
  const notRecorded = report.games.filter((game) => game.tracking === 'not recorded');
  const sourceEmpty = report.games.filter((game) => game.tracking === 'source empty');
  const unavailable = report.games.filter((game) => game.tracking === 'source unavailable');
  const countsOnly = report.games.filter((game) => game.tracking === 'counts only');
  const partial = report.games.filter((game) => game.source_partial);
  const noStart = report.games.filter((game) => game.tracking === 'recorded' && game.started === null);
  push(
    `Games no source records (${notRecorded.length}): ${list(notRecorded)}.`,
    `Games whose sources have no rows in the window (${sourceEmpty.length}): ${list(sourceEmpty)}.`,
    `Games whose sources are missing or failed to read (${unavailable.length}): ${list(unavailable)}.`,
    `Games with finished runs from time metrics only, players unknown (${countsOnly.length}): ${list(countsOnly)}.`,
    `Games whose source has no rows before the window (${partial.length}): ${list(partial)}.`,
    `Games with a finish record and no start record, so no completion rate (${noStart.length}): ${list(noStart)}.`,
    '',
  );
  push('What each source records and where it falls short:', '');
  const described = new Map<string, string[]>();
  for (const source of report.sources) {
    const key = `${source.records}. ${source.limits}`;
    described.set(key, [...(described.get(key) ?? []), source.id]);
  }
  for (const [text, ids] of described) push(`- ${ids.join(', ')}: ${text}`);
  push('');

  // Tables per placement group.
  const sections: { heading: string; rows: GameRow[] }[] = [];
  for (const { group, games } of getFloorGroups()) {
    sections.push({ heading: `Floor: ${group.label}`, rows: games.map((game) => gamesBySlug.get(game.slug)!).filter(Boolean) });
  }
  const reserveSlugs = new Set(getReserveGames().map((game) => game.slug));
  sections.push({ heading: 'Reserve', rows: getReserveGames().map((game) => gamesBySlug.get(game.slug)!).filter(Boolean) });
  for (const status of ['retired', 'merged', 'later'] as const) {
    sections.push({
      heading: status[0]!.toUpperCase() + status.slice(1),
      rows: ARCADE_GAMES.filter((game) => game.placement.status === status && !reserveSlugs.has(game.slug))
        .map((game) => gamesBySlug.get(game.slug)!)
        .filter(Boolean),
    });
  }
  sections.push({ heading: 'Not in the registry', rows: report.games.filter((game) => game.tracking === 'not in registry') });

  push('## Games', '');
  push('Players are signed-in accounts that are not test traffic. Repeat players played on 2 or more days. Settled counts ticket machine rounds. Columns are defined in PLAY_REPORT.md.', '');
  for (const section of sections) {
    if (section.rows.length === 0) continue;
    push(`### ${section.heading}`, '', gameTable(section.rows), '');
    const merged = section.rows.filter((row) => row.note);
    if (merged.length) push(merged.map((row) => `${row.slug}: ${row.note}.`).join(' '), '');
  }
  if (report.unmapped_raw_types.length) {
    push(
      `Raw game types found in the data that map to no registry slug: ${report.unmapped_raw_types.map((item) => `${item.raw} (${item.sources.join(', ')})`).join('; ')}.`,
      '',
    );
  }

  // Test traffic.
  push('## Test traffic', '');
  push(meta.include_test ? 'Included in the numbers above because of --include-test. Counts per rule:' : 'Not in the numbers above. Counts per rule:', '');
  push(
    table(
      ['rule', 'accounts in database', 'accounts active in window', 'excluded by this rule'],
      report.test_rules.map((rule) => [rule.label, String(rule.accounts_in_database), String(rule.accounts_active_in_window), String(rule.accounts_excluded)]),
    ),
    '',
  );
  const excludedTotal = report.test_rules.reduce((sum, rule) => sum + rule.accounts_excluded, 0);
  push(
    `Accounts excluded in the window: ${excludedTotal}. Bot ids active: ${report.test_traffic.bot_ids_active}. Guest ids active: ${report.test_traffic.guest_ids_active} (own column). Ids with no account row, counted as players: ${report.test_traffic.ids_without_account_row}.`,
    report.test_traffic.schema_flag_columns.length
      ? `Schema flag columns found: ${report.test_traffic.schema_flag_columns.join(', ')}.`
      : 'No test or bot flag column exists on arcade_accounts, so that rule matches nothing.',
    'A match with a bot opponent is bot traffic. A match between a player and a test account is test traffic, and only the test account counts as a test player.',
    '',
  );
  const testRows = report.games.filter((game) => (game.test_players ?? 0) > 0 || (game.test_finished ?? 0) > 0 || (game.bot_matches ?? 0) > 0);
  if (testRows.length) {
    push(
      table(
        ['game', 'test players', 'test finished', 'bot matches'],
        testRows.map((game) => [game.slug, show(game.test_players), show(game.test_finished), game.bot_matches === null ? 'n/a' : String(game.bot_matches)]),
      ),
      '',
    );
    push(
      `Total: ${testRows.reduce((sum, game) => sum + (game.test_players ?? 0), 0)} test player-games, ${testRows.reduce((sum, game) => sum + (game.test_finished ?? 0), 0)} test finished, ${testRows.reduce((sum, game) => sum + (game.bot_matches ?? 0), 0)} bot matches.`,
      '',
    );
  } else {
    push('No test traffic in the window.', '');
  }

  // Route entries.
  const routeRows = report.games.filter((game) => (game.route_entries ?? 0) > 0 || (game.route_completions ?? 0) > 0);
  push('## Route entries', '');
  push('Visits to each game page, all traffic together. Test traffic and guests cannot be split out, and an entry is a page view, not a round. A duel completion is recorded under typing-test.', '');
  if (routeRows.length) {
    push(
      table(
        ['game', 'entries', 'sessions', 'completions'],
        [...routeRows].sort((a, b) => (b.route_entries ?? 0) - (a.route_entries ?? 0)).map((game) => [game.slug, String(game.route_entries), String(game.route_sessions), String(game.route_completions)]),
      ),
      '',
    );
  } else {
    push('No route entries in the window.', '');
  }

  // Candidates.
  const candidateRows = report.candidates.map((slug) => gamesBySlug.get(slug)!);
  push('## Candidates', '');
  if (!report.cut_check.valid) {
    push(`Not valid for a cut: ${report.cut_check.problems.join('; ')}.`, '');
  }
  push(
    `Retired and reserve games with fewer than ${meta.min_players} unique non-test players and fewer than ${meta.min_repeat} repeat players in the window, a recorded source, and a source with rows before the window. A candidate is a question for Odom, not a decision. A cut needs tracking verified, 28 days of play after the relaunch, and a redirect for every game cut.`,
    '',
  );
  if (candidateRows.length) {
    push(
      table(
        ['game', 'placement', 'players', 'repeat players', 'finished', 'last play'],
        candidateRows
          .sort((a, b) => (a.players as number) - (b.players as number) || a.slug.localeCompare(b.slug))
          .map((game) => [game.slug, game.placement, show(game.players), show(game.repeat_players), show(game.finished), game.last_play ?? 'none']),
      ),
      '',
    );
  } else {
    push('No candidates in this window.', '');
  }
  if (report.not_judged.length) {
    push(`Not judged, because the numbers are unknown or the source is partial (${report.not_judged.length}): ${report.not_judged.map((item) => `${item.slug} (${item.reason})`).join(', ')}.`, '');
  }

  return `${out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
}

main().catch((error) => {
  console.error(`play-report: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});

