// ---------------------------------------------------------------------------
// Rolling-window leaderboards (24h / 7d / 30d / all-time) for score-based games.
//
// The per-game *_scores tables only keep each user's personal best, so they
// can't answer "best in the last 7 days". Every accepted score submission is
// ALSO appended to `game_score_events` (via recordScoreEvent). Windowed boards
// read that event log; the all-time board keeps reading the per-game best table
// (full history, including scores set before this log existed).
//
// Elo/PvP games (chess, 8-ball, connect-four, checkers) are NOT here — they use
// permanent rating ladders and are read through their own elo-leaderboard
// routes. Elo is never reset.
// ---------------------------------------------------------------------------
import crypto from 'node:crypto';

import { query } from '@/server/db/client';
import { isGuestUserId } from '@/server/auth/guest';

export type LeaderboardWindow = '1d' | '7d' | '30d' | 'all';

export const LEADERBOARD_WINDOWS: { key: LeaderboardWindow; label: string }[] = [
  { key: '1d', label: 'Last 24 hours' },
  { key: '7d', label: 'Last 7 days' },
  { key: '30d', label: 'Last 30 days' },
  { key: 'all', label: 'All-time' },
];

type ScoreDirection = 'high' | 'low'; // high = bigger is better

/** One selectable mode/difficulty for a mode-split board. `key` is the stable
 *  value sent to the API + stored (as text) in game_score_events.mode. */
export type ScoreMode = { key: string; label: string };

export type ScoreLeaderboardGame = {
  slug: string;
  /** Display label for the metric (e.g. "Score", "Best time", "WPM"). */
  metricLabel: string;
  direction: ScoreDirection;
  /** Existing per-user best table backing the all-time board. */
  bestTable: string;
  /** Column on bestTable that holds the leaderboard metric. */
  bestColumn: string;
  /** Per-mode split (typing durations, puzzle difficulty tiers). When present,
   *  every board filters to a SINGLE mode: windowed boards read only events whose
   *  `mode` matches (NULL-mode legacy events excluded); all-time reads the
   *  per-(user, mode) best table filtered by {@link modeColumn}, which is complete. */
  modes?: readonly ScoreMode[];
  /** bestTable column storing the mode/difficulty for the all-time mode filter.
   *  Cast to text at query time so an INTEGER `mode` column (typing) and a TEXT
   *  `difficulty` column (sudoku/minesweeper) both compare against the string key. */
  modeColumn?: string;
  /** Derive the all-time board from the (post-rescale-only) event log rather than
   *  the per-user best table. Used where the best table mixes score scales after a
   *  live rescale (gopher/tumbler/swerve — see gopher/score/route.ts combo-scoring
   *  note) and by reaction-time so all-time and windowed agree on one
   *  MIN(best_time) semantic. See ERA-HANDLING note below. */
  allTimeFromEvents?: boolean;
};

// Tin duck's rules versions: the stored key is the `rules` column (and the
// event's `mode`). The first is the default board.
const TIN_DUCK_MODES: readonly ScoreMode[] = [
  { key: '2', label: 'thirty seconds' },
  { key: '1', label: 'last season' },
];
// High striker's rules versions: the stored key is the `rules` column (and the
// event's `mode`). The first is the default board.
const HIGH_STRIKER_MODES: readonly ScoreMode[] = [
  { key: '3', label: 'endless' },
  { key: '2', label: 'last season' },
];
// Stacker endless's rules versions: the stored key is the `rules` column (and
// the event's `mode`). The first is the default board.
const STACK_MODES: readonly ScoreMode[] = [
  { key: '2', label: 'endless' },
  { key: '1', label: 'last season' },
];
// Difficulty tiers mirror the generators (server/arcade/{sudoku,minesweeper}-generator.ts).
const SUDOKU_MODES: readonly ScoreMode[] = [
  { key: 'easy', label: 'Easy' },
  { key: 'medium', label: 'Medium' },
  { key: 'hard', label: 'Hard' },
  { key: 'expert', label: 'Expert' },
  { key: 'evil', label: 'Evil' },
];
const MINESWEEPER_MODES: readonly ScoreMode[] = [
  { key: 'beginner', label: 'Beginner' },
  { key: 'intermediate', label: 'Intermediate' },
  { key: 'expert', label: 'Expert' },
];
const TYPING_MODES: readonly ScoreMode[] = [
  { key: '15', label: '15s' },
  { key: '30', label: '30s' },
  { key: '60', label: '60s' },
];

// The score-based arcade games that get rolling windowed boards. Daily-puzzle
// games (connections / word-grid / pangram) and elo games are intentionally
// excluded — they have their own surfaces.
//
// ERA-HANDLING (gopher/tumbler/swerve): a 2026-07 live combo/precision rescale
// left legacy pre-rescale rows in the *_scores best tables on a ~10-50x smaller
// scale than current runs, so an all-time board that reads those tables mixes
// incomparable scores. The event log records the server-authoritative
// (current-scale) score for every accepted run, so we derive all-time for these
// three from the event log (allTimeFromEvents) — least-misleading, fully
// read-path, no destructive rewrite of the score tables.
export const SCORE_LEADERBOARD_GAMES: Record<string, ScoreLeaderboardGame> = {
  snake: { slug: 'snake', metricLabel: 'Score', direction: 'high', bestTable: 'snake_scores', bestColumn: 'score' },
  'flappy-bird': { slug: 'flappy-bird', metricLabel: 'Score', direction: 'high', bestTable: 'flappy_bird_scores', bestColumn: 'score' },
  '2048': { slug: '2048', metricLabel: 'Score', direction: 'high', bestTable: 'game_2048_scores', bestColumn: 'score' },
  tetris: { slug: 'tetris', metricLabel: 'Score', direction: 'high', bestTable: 'tetris_scores', bestColumn: 'score' },
  breakout: { slug: 'breakout', metricLabel: 'Score', direction: 'high', bestTable: 'breakout_scores', bestColumn: 'score' },
  // Rules 2 (time-based, harder as you climb) has its own board; rules 1 stays readable as last season's.
  stack: { slug: 'stack', metricLabel: 'Score', direction: 'high', bestTable: 'stack_scores', bestColumn: 'score', modes: STACK_MODES, modeColumn: 'rules' },
  sequence: { slug: 'sequence', metricLabel: 'Level', direction: 'high', bestTable: 'sequence_scores', bestColumn: 'score' },
  gopher: { slug: 'gopher', metricLabel: 'Score', direction: 'high', bestTable: 'gopher_scores', bestColumn: 'score', allTimeFromEvents: true },
  ricochet: { slug: 'ricochet', metricLabel: 'Score', direction: 'high', bestTable: 'ricochet_scores', bestColumn: 'score' },
  swerve: { slug: 'swerve', metricLabel: 'Score', direction: 'high', bestTable: 'swerve_scores', bestColumn: 'score', allTimeFromEvents: true },
  tumbler: { slug: 'tumbler', metricLabel: 'Score', direction: 'high', bestTable: 'tumbler_scores', bestColumn: 'score', allTimeFromEvents: true },
  'log-splitter': { slug: 'log-splitter', metricLabel: 'Score', direction: 'high', bestTable: 'log_splitter_scores', bestColumn: 'score' },
  'knife-booth': { slug: 'knife-booth', metricLabel: 'Score', direction: 'high', bestTable: 'knife_booth_scores', bestColumn: 'score' },
  'melon-chop': { slug: 'melon-chop', metricLabel: 'Score', direction: 'high', bestTable: 'melon_chop_scores', bestColumn: 'score' },
  // Rules 2 (the thirty second gallery) has its own board; rules 1 stays readable as last season's.
  'tin-duck': { slug: 'tin-duck', metricLabel: 'Score', direction: 'high', bestTable: 'tin_duck_scores', bestColumn: 'score', modes: TIN_DUCK_MODES, modeColumn: 'rules' },
  'boardwalk-hop': { slug: 'boardwalk-hop', metricLabel: 'Score', direction: 'high', bestTable: 'boardwalk_hop_scores', bestColumn: 'score' },
  // Rules 2 (five swings) has its own board; rules 1 stays readable as last season's.
  'high-striker': { slug: 'high-striker', metricLabel: 'Score', direction: 'high', bestTable: 'high_striker_scores', bestColumn: 'score', modes: HIGH_STRIKER_MODES, modeColumn: 'rules' },
  'skee-ball': { slug: 'skee-ball', metricLabel: 'Score', direction: 'high', bestTable: 'skee_ball_scores', bestColumn: 'score' },
  gunrush: { slug: 'gunrush', metricLabel: 'Score', direction: 'high', bestTable: 'gunrush_scores', bestColumn: 'score' },
  'ticket-stop': { slug: 'ticket-stop', metricLabel: 'Score', direction: 'high', bestTable: 'ticket_stop_lock_scores', bestColumn: 'score' },
  'ring-toss': { slug: 'ring-toss', metricLabel: 'Score', direction: 'high', bestTable: 'ring_toss_scores', bestColumn: 'score' },
  // Derby: a race won, by its time (ms from the gate to the wire); one event
  // per win, written when the race settles. All time reads the events too.
  derby: { slug: 'derby', metricLabel: 'Fastest win', direction: 'low', bestTable: 'derby_stats', bestColumn: 'best_win_ms', allTimeFromEvents: true },
  math: { slug: 'math', metricLabel: 'Score', direction: 'high', bestTable: 'math_scores', bestColumn: 'score' },
  'blitz-tactics': { slug: 'blitz-tactics', metricLabel: 'Solved', direction: 'high', bestTable: 'blitz_tactics_scores', bestColumn: 'score' },
  // NOTE: coin-flip is intentionally omitted — it's now a wager game
  // (arcade-coin-flip via /api/wagers/*); its old streak score route is unused.
  'typing-test': { slug: 'typing-test', metricLabel: 'WPM', direction: 'high', bestTable: 'typing_test_scores', bestColumn: 'wpm', modes: TYPING_MODES, modeColumn: 'mode' },
  // reaction-time all-time from events: the best table keeps only the best-average
  // run's best_time (upsert by composite score), which disagrees with the windowed
  // MIN(best_time). Reading events makes both the true fastest single reaction.
  'reaction-time': { slug: 'reaction-time', metricLabel: 'Best time', direction: 'low', bestTable: 'reaction_time_scores', bestColumn: 'best_time', allTimeFromEvents: true },
  sudoku: { slug: 'sudoku', metricLabel: 'Solve time', direction: 'low', bestTable: 'sudoku_scores', bestColumn: 'solve_time_ms', modes: SUDOKU_MODES, modeColumn: 'difficulty' },
  'bubble-shooter': { slug: 'bubble-shooter', metricLabel: 'Score', direction: 'high', bestTable: 'bubble_shooter_scores', bestColumn: 'score' },
  'gem-swap': { slug: 'gem-swap', metricLabel: 'Score', direction: 'high', bestTable: 'gem_swap_scores', bestColumn: 'score' },
  'sky-climber': { slug: 'sky-climber', metricLabel: 'Height', direction: 'high', bestTable: 'sky_climber_scores', bestColumn: 'score' },
  minesweeper: { slug: 'minesweeper', metricLabel: 'Solve time', direction: 'low', bestTable: 'minesweeper_scores', bestColumn: 'solve_time_ms', modes: MINESWEEPER_MODES, modeColumn: 'difficulty' },
  // punch-card renders its own per-size boards on the page (sizes aren't
  // comparable), but stays registered so the window API serves it.
  'punch-card': { slug: 'punch-card', metricLabel: 'Solve time', direction: 'low', bestTable: 'punch_card_scores', bestColumn: 'solve_time_ms' },
};

export function isScoreLeaderboardGame(slug: string): boolean {
  return Object.prototype.hasOwnProperty.call(SCORE_LEADERBOARD_GAMES, slug);
}

/** The selectable modes for a mode-split game, or null if it has none. */
export function getGameModes(slug: string): readonly ScoreMode[] | null {
  return SCORE_LEADERBOARD_GAMES[slug]?.modes ?? null;
}

/** True when `mode` is a valid key for a mode-split game. */
export function isValidGameMode(slug: string, mode: string): boolean {
  const modes = SCORE_LEADERBOARD_GAMES[slug]?.modes;
  return !!modes && modes.some((m) => m.key === mode);
}

/** Resolve a raw mode param to a valid key for a mode-split game, defaulting to
 *  the first mode. Returns null for games that have no mode split. */
export function resolveGameMode(slug: string, mode: string | number | null | undefined): string | null {
  const modes = SCORE_LEADERBOARD_GAMES[slug]?.modes;
  if (!modes || modes.length === 0) return null;
  const asStr = mode == null ? null : String(mode);
  if (asStr && modes.some((m) => m.key === asStr)) return asStr;
  return modes[0].key;
}

// Sequential positional-parameter builder for the dynamically-composed queries
// below. All table/column names come from the internal config (never user
// input); only values flow through here as bound $N parameters.
class ParamList {
  readonly values: unknown[] = [];
  add(value: unknown): string {
    this.values.push(value);
    return `$${this.values.length}`;
  }
}

/**
 * Append an accepted score to the event log. Call this from a score route
 * AFTER the score has passed validation/anti-cheat and been saved. Best-effort:
 * a failure here must never break the score save, so callers should not await
 * it in a way that can reject the request (wrap in try/catch or .catch()).
 *
 * `score` must be the same numeric metric the game's leaderboard ranks on
 * (e.g. snake score, reaction best_time in ms, typing wpm).
 *
 * `mode` is the typing duration / puzzle difficulty for mode-split games
 * (typing-test, sudoku, minesweeper); stored as text and used to filter windowed
 * boards to a single mode. Omit for games with no mode split.
 */
export async function recordScoreEvent(input: {
  gameSlug: string;
  userId: string;
  userName: string;
  score: number;
  mode?: string | number | null;
  createdAt?: number;
}): Promise<void> {
  if (isGuestUserId(input.userId)) return;
  if (!isScoreLeaderboardGame(input.gameSlug)) return;
  if (!Number.isFinite(input.score)) return;
  await query(
    `INSERT INTO game_score_events (id, game_slug, od_user_id, user_name, score, created_at, mode)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      crypto.randomUUID(),
      input.gameSlug,
      input.userId,
      input.userName,
      input.score,
      input.createdAt ?? Date.now(),
      input.mode == null ? null : String(input.mode),
    ],
  );
}

export type LeaderboardEntry = {
  odUserId: string;
  userName: string;
  score: number;
  rank: number;
};

const WINDOW_MS: Record<Exclude<LeaderboardWindow, 'all'>, number> = {
  '1d': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
};

/**
 * Describes where a (game, window, mode) leaderboard reads from and how it
 * aggregates, so the top-N and single-user-rank queries stay in lockstep.
 *
 * All-time reads the per-user best table (full history) EXCEPT when
 * `allTimeFromEvents` (gopher/tumbler/swerve/reaction-time) — see the config
 * ERA-HANDLING note. 1d/7d/30d always read the event log. Mode-split games filter
 * to one mode: the best table via `modeColumn`, the event log via `mode`
 * (NULL-mode legacy events are naturally excluded).
 */
function buildWindowSource(
  game: ScoreLeaderboardGame,
  window: LeaderboardWindow,
  mode: string | null,
  pb: ParamList,
): { table: string; column: string; where: string } {
  const fromBestTable =
    window === 'all' && !game.allTimeFromEvents;

  if (fromBestTable) {
    const conds: string[] = [];
    if (mode && game.modeColumn) {
      conds.push(`${game.modeColumn}::text = ${pb.add(mode)}`);
    }
    return {
      table: game.bestTable,
      column: game.bestColumn,
      where: conds.length ? `WHERE ${conds.join(' AND ')}` : '',
    };
  }

  // Event-log source: all-time-from-events, or any 1d/7d/30d window.
  const conds: string[] = [`game_slug = ${pb.add(game.slug)}`];
  if (window !== 'all') {
    conds.push(`created_at >= ${pb.add(Date.now() - WINDOW_MS[window])}`);
  }
  if (mode && game.modes) {
    conds.push(`mode = ${pb.add(mode)}`);
  }
  return {
    table: 'game_score_events',
    column: 'score',
    where: `WHERE ${conds.join(' AND ')}`,
  };
}

/**
 * Best score per user for a game within a window, optionally filtered to a mode.
 * See {@link buildWindowSource} for the source/aggregation rules.
 */
export async function getScoreLeaderboardWindow(
  slug: string,
  window: LeaderboardWindow,
  limit = 50,
  mode?: string | number | null,
): Promise<LeaderboardEntry[]> {
  const game = SCORE_LEADERBOARD_GAMES[slug];
  if (!game) return [];
  const dir = game.direction === 'high' ? 'DESC' : 'ASC';
  const agg = game.direction === 'high' ? 'MAX' : 'MIN';
  const cap = Math.min(Math.max(limit, 1), 200);
  const resolvedMode = resolveGameMode(slug, mode);

  const pb = new ParamList();
  const src = buildWindowSource(game, window, resolvedMode, pb);
  const limitParam = pb.add(cap);

  const rows = (
    await query<{ od_user_id: string; user_name: string; score: number }>(
      `SELECT od_user_id,
              MAX(user_name) AS user_name,
              ${agg}(${src.column}) AS score
       FROM ${src.table}
       ${src.where}
       GROUP BY od_user_id
       ORDER BY score ${dir}, od_user_id
       LIMIT ${limitParam}`,
      pb.values,
    )
  ).rows;

  return rows.map((r, i) => ({
    odUserId: r.od_user_id,
    userName: r.user_name,
    score: Number(r.score),
    rank: i + 1,
  }));
}

/**
 * Read-only rank of a single user on a (game, window, mode) board, for the
 * "your rank" affordance when the viewer is outside the visible top-N. Rank =
 * (# of distinct users with a strictly better aggregated score) + 1, matching
 * {@link getScoreLeaderboardWindow}'s ordering. Returns null if the user has no
 * qualifying score in the window.
 */
export async function getUserRankInWindow(
  slug: string,
  window: LeaderboardWindow,
  userId: string,
  mode?: string | number | null,
): Promise<{ rank: number; score: number } | null> {
  const game = SCORE_LEADERBOARD_GAMES[slug];
  if (!game || !userId) return null;
  const agg = game.direction === 'high' ? 'MAX' : 'MIN';
  const betterOp = game.direction === 'high' ? '>' : '<';
  const resolvedMode = resolveGameMode(slug, mode);

  // 1) The viewer's own aggregated score in this window.
  const pbMine = new ParamList();
  const srcMine = buildWindowSource(game, window, resolvedMode, pbMine);
  const userCond = `od_user_id = ${pbMine.add(userId)}`;
  const mineWhere = srcMine.where
    ? `${srcMine.where} AND ${userCond}`
    : `WHERE ${userCond}`;
  const mineRow = (
    await query<{ score: number | null }>(
      `SELECT ${agg}(${srcMine.column}) AS score FROM ${srcMine.table} ${mineWhere}`,
      pbMine.values,
    )
  ).rows[0];
  if (!mineRow || mineRow.score == null) return null;
  const myScore = Number(mineRow.score);

  // 2) How many distinct users beat it.
  const pbAhead = new ParamList();
  const srcAhead = buildWindowSource(game, window, resolvedMode, pbAhead);
  const scoreParam = pbAhead.add(myScore);
  const aheadRow = (
    await query<{ ahead: number }>(
      `SELECT count(*)::int AS ahead FROM (
         SELECT od_user_id, ${agg}(${srcAhead.column}) AS s
         FROM ${srcAhead.table}
         ${srcAhead.where}
         GROUP BY od_user_id
       ) t
       WHERE t.s ${betterOp} ${scoreParam}`,
      pbAhead.values,
    )
  ).rows[0];

  return { rank: Number(aheadRow?.ahead ?? 0) + 1, score: myScore };
}

/**
 * The viewer's row and the `span` rows above and below it, for the "scores
 * around you" block of a board. Same grouping and ordering as
 * {@link getScoreLeaderboardWindow}, with ties broken by user id so the order
 * is stable. `rank` is a competition rank (ties share it), the same number
 * {@link getUserRankInWindow} returns. Empty when the user has no score in the
 * window.
 */
export async function getScoresAroundUser(
  slug: string,
  window: LeaderboardWindow,
  userId: string,
  mode?: string | number | null,
  span = 2,
): Promise<LeaderboardEntry[]> {
  const game = SCORE_LEADERBOARD_GAMES[slug];
  if (!game || !userId) return [];
  const dir = game.direction === 'high' ? 'DESC' : 'ASC';
  const agg = game.direction === 'high' ? 'MAX' : 'MIN';
  const resolvedMode = resolveGameMode(slug, mode);
  const reach = Math.min(Math.max(Math.floor(span), 1), 10);

  const pb = new ParamList();
  const src = buildWindowSource(game, window, resolvedMode, pb);
  const userParam = pb.add(userId);
  const reachParam = pb.add(reach);

  const rows = (
    await query<{ od_user_id: string; user_name: string; score: number; rnk: number }>(
      `WITH per_user AS (
         SELECT od_user_id,
                MAX(user_name) AS user_name,
                ${agg}(${src.column}) AS score
         FROM ${src.table}
         ${src.where}
         GROUP BY od_user_id
       ), ranked AS (
         SELECT od_user_id, user_name, score,
                RANK() OVER (ORDER BY score ${dir}) AS rnk,
                ROW_NUMBER() OVER (ORDER BY score ${dir}, od_user_id) AS rn
         FROM per_user
       ), me AS (
         SELECT rn FROM ranked WHERE od_user_id = ${userParam}
       )
       SELECT r.od_user_id, r.user_name, r.score, r.rnk::int AS rnk
       FROM ranked r, me
       WHERE r.rn BETWEEN me.rn - ${reachParam}::bigint AND me.rn + ${reachParam}::bigint
       ORDER BY r.rn`,
      pb.values,
    )
  ).rows;

  return rows.map((r) => ({
    odUserId: r.od_user_id,
    userName: r.user_name,
    score: Number(r.score),
    rank: Number(r.rnk),
  }));
}
