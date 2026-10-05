// ───────────────────────────────────────────────────────────────────────────
// Per-game profile stat blocks — powers the large "favorite game" showcase card
// on the profile + public profile, and the compact stat-highlight showcase slot.
//
// Every game gets a typed, render-ready stat block via getGameProfileStats().
// Reads are fail-soft: a missing table (fresh DB) or a player with no plays both
// resolve to `hasData: false` so the card shows a graceful "no data yet" state
// instead of throwing. No writes happen here (unlike getUserGameTimeMetrics,
// which backfills) — playtime is read straight from the totals table.
// ───────────────────────────────────────────────────────────────────────────

import { queryOne } from '@/server/db/client';

export type ProfileStatMetric = {
  label: string;
  value: string;
  /** Optional sub-line under the value (e.g. "peak 1840"). */
  hint?: string;
};

export type GameProfileTier = {
  name: string;
  color: string;
  rating: number;
};

export type GameProfileStats = {
  slug: string;
  title: string;
  /** Whether the player has any recorded activity for this game. */
  hasData: boolean;
  /** Ranked tier badge (ELO games only). */
  tier: GameProfileTier | null;
  /** A single headline stat for compact showcases ("2400 Elo", "Snake 18,400"). */
  headline: { label: string; value: string } | null;
  /** Grid of metrics for the large card. */
  metrics: ProfileStatMetric[];
  /** Lifetime playtime in ms, when tracked. */
  playtimeMs: number | null;
  /** Total games played, when known. */
  gamesPlayed: number | null;
};

// ─── ELO tiers (identical bands across pool/chess/connect-four/checkers) ──────

const ELO_TIERS = [
  { min: 0, max: 799, name: 'Beginner', color: '#9ca3af' },
  { min: 800, max: 999, name: 'Novice', color: '#a3e635' },
  { min: 1000, max: 1199, name: 'Intermediate', color: '#22c55e' },
  { min: 1200, max: 1399, name: 'Skilled', color: '#06b6d4' },
  { min: 1400, max: 1599, name: 'Advanced', color: '#3b82f6' },
  { min: 1600, max: 1799, name: 'Expert', color: '#8b5cf6' },
  { min: 1800, max: 1999, name: 'Master', color: '#f59e0b' },
  { min: 2000, max: 2199, name: 'Grandmaster', color: '#ef4444' },
  { min: 2200, max: Infinity, name: 'Legend', color: '#ec4899' },
] as const;

function eloTier(rating: number): { name: string; color: string } {
  const tier = ELO_TIERS.find((t) => rating >= t.min && rating <= t.max);
  return tier ? { name: tier.name, color: tier.color } : { name: 'Unranked', color: '#9ca3af' };
}

// ─── helpers ─────────────────────────────────────────────────────────────────

const toNum = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const fmt = (value: number): string => Math.round(value).toLocaleString();

function winRate(wins: number, total: number): string {
  if (total <= 0) return '0%';
  return `${Math.round((wins / total) * 100)}%`;
}

function formatDuration(ms: number): string {
  if (ms <= 0) return '0m';
  const totalMinutes = Math.floor(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${Math.max(1, Math.floor(ms / 1000))}s`;
}

function formatSeconds(seconds: number): string {
  if (seconds <= 0) return '—';
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  if (mins > 0) return `${mins}m ${secs.toString().padStart(2, '0')}s`;
  return `${secs}s`;
}

/**
 * Fail-soft single-row query: a missing table (42P01) or column (42703) — both
 * possible on a partially-migrated DB — resolves to null instead of throwing.
 */
async function safeRow<T extends Record<string, unknown>>(
  text: string,
  values: unknown[],
): Promise<T | null> {
  try {
    return await queryOne<T>(text, values);
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === '42P01' || code === '42703') return null;
    throw error;
  }
}

/** Lifetime playtime (ms) for a tracked game type. Read-only (no backfill). */
async function readPlaytimeMs(userId: string, gameType: string): Promise<number | null> {
  const row = await safeRow<{ total_duration_ms: string | number }>(
    `SELECT total_duration_ms
       FROM game_time_metrics_totals
      WHERE user_id = $1 AND game_type = $2
      LIMIT 1`,
    [userId, gameType],
  );
  if (!row) return null;
  const ms = toNum(row.total_duration_ms);
  return ms > 0 ? ms : null;
}

function emptyStats(slug: string, title: string): GameProfileStats {
  return {
    slug,
    title,
    hasData: false,
    tier: null,
    headline: null,
    metrics: [],
    playtimeMs: null,
    gamesPlayed: null,
  };
}

// ─── ELO board games ─────────────────────────────────────────────────────────

type EloRow = {
  elo_rating: number | string;
  total_wins: number | string;
  total_losses: number | string;
  total_draws?: number | string;
  total_games: number | string;
  peak_elo: number | string;
};

async function poolStats(userId: string, slug: string, title: string): Promise<GameProfileStats> {
  const [elo, stats, playtimeMs] = await Promise.all([
    safeRow<EloRow>(
      `SELECT elo_rating, total_wins, total_losses, total_games, peak_elo
         FROM pool_elo WHERE user_id = $1 LIMIT 1`,
      [userId],
    ),
    safeRow<{
      best_streak: number | string;
      total_shots: number | string;
      total_balls_pocketed: number | string;
    }>(
      `SELECT best_streak, total_shots, total_balls_pocketed
         FROM pool_stats WHERE user_id = $1 LIMIT 1`,
      [userId],
    ),
    readPlaytimeMs(userId, '8-ball'),
  ]);

  const games = toNum(elo?.total_games);
  if (!elo || games <= 0) return { ...emptyStats(slug, title), playtimeMs };

  const rating = toNum(elo.elo_rating);
  const wins = toNum(elo.total_wins);
  const losses = toNum(elo.total_losses);
  const tier = eloTier(rating);
  const shots = toNum(stats?.total_shots);
  const pocketed = toNum(stats?.total_balls_pocketed);
  const sinkRate = shots > 0 ? `${Math.round((pocketed / shots) * 100)}%` : '—';

  return {
    slug,
    title,
    hasData: true,
    tier: { ...tier, rating },
    headline: { label: 'Elo', value: fmt(rating) },
    gamesPlayed: games,
    playtimeMs,
    metrics: [
      { label: 'Elo rating', value: fmt(rating), hint: `Peak ${fmt(toNum(elo.peak_elo))}` },
      { label: 'Tier', value: tier.name },
      { label: 'Record', value: `${fmt(wins)}W · ${fmt(losses)}L` },
      { label: 'Win rate', value: winRate(wins, wins + losses) },
      { label: 'Sink rate', value: sinkRate, hint: `${fmt(pocketed)} balls` },
      { label: 'Best streak', value: fmt(toNum(stats?.best_streak)) },
      { label: 'Games', value: fmt(games) },
    ],
  };
}

async function chessStats(userId: string, slug: string, title: string): Promise<GameProfileStats> {
  const [elo, stats, playtimeMs] = await Promise.all([
    safeRow<EloRow>(
      `SELECT elo_rating, total_wins, total_losses, total_draws, total_games, peak_elo
         FROM chess_elo WHERE user_id = $1 LIMIT 1`,
      [userId],
    ),
    safeRow<{ best_streak: number | string; checkmates_given: number | string }>(
      `SELECT best_streak, checkmates_given
         FROM chess_stats WHERE user_id = $1 LIMIT 1`,
      [userId],
    ),
    readPlaytimeMs(userId, 'chess'),
  ]);

  const games = toNum(elo?.total_games);
  if (!elo || games <= 0) return { ...emptyStats(slug, title), playtimeMs };

  const rating = toNum(elo.elo_rating);
  const wins = toNum(elo.total_wins);
  const losses = toNum(elo.total_losses);
  const draws = toNum(elo.total_draws);
  const tier = eloTier(rating);

  return {
    slug,
    title,
    hasData: true,
    tier: { ...tier, rating },
    headline: { label: 'Elo', value: fmt(rating) },
    gamesPlayed: games,
    playtimeMs,
    metrics: [
      { label: 'Elo rating', value: fmt(rating), hint: `Peak ${fmt(toNum(elo.peak_elo))}` },
      { label: 'Tier', value: tier.name },
      { label: 'Record', value: `${fmt(wins)}W · ${fmt(losses)}L · ${fmt(draws)}D` },
      { label: 'Win rate', value: winRate(wins, wins + losses + draws) },
      { label: 'Checkmates', value: fmt(toNum(stats?.checkmates_given)) },
      { label: 'Best streak', value: fmt(toNum(stats?.best_streak)) },
      { label: 'Games', value: fmt(games) },
    ],
  };
}

/** Connect Four + Checkers share the same elo/stats shape (W/L/D). */
async function drawEloStats(
  userId: string,
  slug: string,
  title: string,
  eloTable: 'connect_four_elo' | 'checkers_elo',
  gameType: string,
): Promise<GameProfileStats> {
  const [elo, playtimeMs] = await Promise.all([
    safeRow<EloRow>(
      `SELECT elo_rating, total_wins, total_losses, total_draws, total_games, peak_elo
         FROM ${eloTable} WHERE user_id = $1 LIMIT 1`,
      [userId],
    ),
    readPlaytimeMs(userId, gameType),
  ]);

  const games = toNum(elo?.total_games);
  if (!elo || games <= 0) return { ...emptyStats(slug, title), playtimeMs };

  const rating = toNum(elo.elo_rating);
  const wins = toNum(elo.total_wins);
  const losses = toNum(elo.total_losses);
  const draws = toNum(elo.total_draws);
  const tier = eloTier(rating);

  return {
    slug,
    title,
    hasData: true,
    tier: { ...tier, rating },
    headline: { label: 'Elo', value: fmt(rating) },
    gamesPlayed: games,
    playtimeMs,
    metrics: [
      { label: 'Elo rating', value: fmt(rating), hint: `Peak ${fmt(toNum(elo.peak_elo))}` },
      { label: 'Tier', value: tier.name },
      { label: 'Record', value: `${fmt(wins)}W · ${fmt(losses)}L · ${fmt(draws)}D` },
      { label: 'Win rate', value: winRate(wins, wins + losses + draws) },
      { label: 'Games', value: fmt(games) },
    ],
  };
}

// ─── High-score games ────────────────────────────────────────────────────────

/** Simple single-column best-score table (snake/breakout/stack/…). */
async function simpleHighScore(
  userId: string,
  slug: string,
  title: string,
  table: string,
  scoreLabel: string,
  gameType: string,
): Promise<GameProfileStats> {
  const [row, playtimeMs] = await Promise.all([
    safeRow<{ score: number | string }>(
      `SELECT score FROM ${table} WHERE od_user_id = $1 ORDER BY score DESC LIMIT 1`,
      [userId],
    ),
    readPlaytimeMs(userId, gameType),
  ]);
  if (!row) return { ...emptyStats(slug, title), playtimeMs };
  const score = toNum(row.score);
  const metrics: ProfileStatMetric[] = [{ label: scoreLabel, value: fmt(score) }];
  if (playtimeMs) metrics.push({ label: 'Time played', value: formatDuration(playtimeMs) });
  return {
    slug,
    title,
    hasData: true,
    tier: null,
    headline: { label: scoreLabel, value: fmt(score) },
    gamesPlayed: null,
    playtimeMs,
    metrics,
  };
}

async function snakeStats(userId: string, slug: string, title: string) {
  return simpleHighScore(userId, slug, title, 'snake_scores', 'Best score', 'snake');
}
async function flappyStats(userId: string, slug: string, title: string) {
  return simpleHighScore(userId, slug, title, 'flappy_bird_scores', 'Best score', 'flappy-bird');
}
async function breakoutStats(userId: string, slug: string, title: string) {
  return simpleHighScore(userId, slug, title, 'breakout_scores', 'Best score', 'breakout');
}
async function stackStats(userId: string, slug: string, title: string) {
  // Current rules only: last season's best was on easier rules.
  return simpleHighScore(userId, slug, title, '(SELECT * FROM stack_scores WHERE rules = 2) sk', 'Best height', 'stack');
}
async function sequenceStats(userId: string, slug: string, title: string) {
  return simpleHighScore(userId, slug, title, 'sequence_scores', 'Best level', 'sequence');
}
async function gopherStats(userId: string, slug: string, title: string) {
  return simpleHighScore(userId, slug, title, 'gopher_scores', 'Best score', 'gopher');
}
async function ricochetStats(userId: string, slug: string, title: string) {
  return simpleHighScore(userId, slug, title, 'ricochet_scores', 'Best walls', 'ricochet');
}
async function swerveStats(userId: string, slug: string, title: string) {
  return simpleHighScore(userId, slug, title, 'swerve_scores', 'Best rows', 'swerve');
}
async function tumblerStats(userId: string, slug: string, title: string) {
  return simpleHighScore(userId, slug, title, 'tumbler_scores', 'Best score', 'tumbler');
}
async function mathStats(userId: string, slug: string, title: string) {
  return simpleHighScore(userId, slug, title, 'math_scores', 'Best correct', 'math');
}
async function blitzTacticsStats(userId: string, slug: string, title: string) {
  return simpleHighScore(userId, slug, title, 'blitz_tactics_scores', 'Puzzles solved', 'blitz-tactics');
}
async function boardwalkHopStats(userId: string, slug: string, title: string) {
  return simpleHighScore(userId, slug, title, 'boardwalk_hop_scores', 'Best score', 'boardwalk-hop');
}
async function highStrikerStats(userId: string, slug: string, title: string) {
  // Current rules only: last season's best is on a different scale.
  return simpleHighScore(userId, slug, title, '(SELECT * FROM high_striker_scores WHERE rules = 3) hs', 'Best score', 'high-striker');
}
async function skeeBallStats(userId: string, slug: string, title: string) {
  return simpleHighScore(userId, slug, title, 'skee_ball_scores', 'Best score', 'skee-ball');
}
async function gunrushStats(userId: string, slug: string, title: string) {
  return simpleHighScore(userId, slug, title, 'gunrush_scores', 'Best score', 'gunrush');
}
async function ringTossStats(userId: string, slug: string, title: string) {
  return simpleHighScore(userId, slug, title, 'ring_toss_scores', 'Best score', 'ring-toss');
}

async function ticketStopStats(userId: string, slug: string, title: string) {
  return simpleHighScore(userId, slug, title, 'ticket_stop_lock_scores', 'Best score', 'ticket-stop');
}
async function freecellStats(userId: string, slug: string, title: string): Promise<GameProfileStats> {
  const [row, playtimeMs] = await Promise.all([
    safeRow<{ best_ms: number | string; clears: number | string }>(
      `SELECT MIN(solve_time_ms) AS best_ms, COUNT(*) AS clears
         FROM freecell_scores WHERE od_user_id = $1`,
      [userId],
    ),
    readPlaytimeMs(userId, 'freecell'),
  ]);
  const clears = toNum(row?.clears);
  if (!row || clears <= 0) return { ...emptyStats(slug, title), playtimeMs };
  const bestSeconds = toNum(row.best_ms) / 1000;
  return {
    slug,
    title,
    hasData: true,
    tier: null,
    headline: { label: 'Best clear', value: formatSeconds(bestSeconds) },
    gamesPlayed: clears,
    playtimeMs,
    metrics: [
      { label: 'Best clear', value: formatSeconds(bestSeconds) },
      { label: 'Deals cleared', value: fmt(clears) },
      ...(playtimeMs ? [{ label: 'Time played', value: formatDuration(playtimeMs) }] : []),
    ],
  };
}
async function logSplitterStats(userId: string, slug: string, title: string) {
  return simpleHighScore(userId, slug, title, 'log_splitter_scores', 'Best chops', 'log-splitter');
}
async function knifeBoothStats(userId: string, slug: string, title: string) {
  return simpleHighScore(userId, slug, title, 'knife_booth_scores', 'Best score', 'knife-booth');
}
async function melonChopStats(userId: string, slug: string, title: string) {
  return simpleHighScore(userId, slug, title, 'melon_chop_scores', 'Best score', 'melon-chop');
}
async function tinDuckStats(userId: string, slug: string, title: string) {
  // Current rules only: last season's best is on a different scale.
  return simpleHighScore(userId, slug, title, '(SELECT * FROM tin_duck_scores WHERE rules = 2) td', 'Best score', 'tin-duck');
}

async function game2048Stats(userId: string, slug: string, title: string): Promise<GameProfileStats> {
  const [row, playtimeMs] = await Promise.all([
    safeRow<{ score: number | string; highest_tile: number | string }>(
      `SELECT score, highest_tile FROM game_2048_scores
        WHERE od_user_id = $1 ORDER BY score DESC LIMIT 1`,
      [userId],
    ),
    readPlaytimeMs(userId, '2048'),
  ]);
  if (!row) return { ...emptyStats(slug, title), playtimeMs };
  const score = toNum(row.score);
  const tile = toNum(row.highest_tile);
  const metrics: ProfileStatMetric[] = [
    { label: 'Best score', value: fmt(score) },
    { label: 'Highest tile', value: fmt(tile) },
  ];
  if (playtimeMs) metrics.push({ label: 'Time played', value: formatDuration(playtimeMs) });
  return {
    slug,
    title,
    hasData: true,
    tier: null,
    headline: { label: 'Best score', value: fmt(score) },
    gamesPlayed: null,
    playtimeMs,
    metrics,
  };
}

async function tetrisStats(userId: string, slug: string, title: string): Promise<GameProfileStats> {
  const [row, playtimeMs] = await Promise.all([
    safeRow<{
      score: number | string;
      best_lines: number | string;
      total_games: number | string;
      total_lines: number | string;
    }>(
      `SELECT score, best_lines, total_games, total_lines FROM tetris_scores
        WHERE od_user_id = $1 ORDER BY score DESC LIMIT 1`,
      [userId],
    ),
    readPlaytimeMs(userId, 'tetris'),
  ]);
  if (!row) return { ...emptyStats(slug, title), playtimeMs };
  const score = toNum(row.score);
  const games = toNum(row.total_games);
  const metrics: ProfileStatMetric[] = [
    { label: 'Best score', value: fmt(score) },
    { label: 'Best lines', value: fmt(toNum(row.best_lines)) },
    { label: 'Total lines', value: fmt(toNum(row.total_lines)) },
  ];
  if (games > 0) metrics.push({ label: 'Games', value: fmt(games) });
  if (playtimeMs) metrics.push({ label: 'Time played', value: formatDuration(playtimeMs) });
  return {
    slug,
    title,
    hasData: true,
    tier: null,
    headline: { label: 'Best score', value: fmt(score) },
    gamesPlayed: games > 0 ? games : null,
    playtimeMs,
    metrics,
  };
}

// ─── Skill / clock games ─────────────────────────────────────────────────────

async function typingStats(userId: string, slug: string, title: string): Promise<GameProfileStats> {
  const [row, playtimeMs] = await Promise.all([
    safeRow<{ wpm: number | string; accuracy: number | string }>(
      `SELECT wpm, accuracy FROM typing_test_scores
        WHERE od_user_id = $1 ORDER BY wpm DESC, accuracy DESC LIMIT 1`,
      [userId],
    ),
    readPlaytimeMs(userId, 'typing-test'),
  ]);
  if (!row) return { ...emptyStats(slug, title), playtimeMs };
  const wpm = toNum(row.wpm);
  const accuracy = toNum(row.accuracy);
  return {
    slug,
    title,
    hasData: true,
    tier: null,
    headline: { label: 'Best WPM', value: fmt(wpm) },
    gamesPlayed: null,
    playtimeMs,
    metrics: [
      { label: 'Best WPM', value: fmt(wpm) },
      { label: 'Accuracy', value: `${accuracy.toFixed(1)}%` },
      ...(playtimeMs ? [{ label: 'Time played', value: formatDuration(playtimeMs) }] : []),
    ],
  };
}

async function reactionStats(userId: string, slug: string, title: string): Promise<GameProfileStats> {
  const [row, playtimeMs] = await Promise.all([
    safeRow<{ best_time: number | string; average_time: number | string }>(
      `SELECT best_time, average_time FROM reaction_time_scores
        WHERE od_user_id = $1 ORDER BY score DESC, average_time ASC LIMIT 1`,
      [userId],
    ),
    readPlaytimeMs(userId, 'reaction-time'),
  ]);
  if (!row) return { ...emptyStats(slug, title), playtimeMs };
  const best = toNum(row.best_time);
  const avg = toNum(row.average_time);
  return {
    slug,
    title,
    hasData: true,
    tier: null,
    headline: { label: 'Best', value: `${best.toFixed(0)}ms` },
    gamesPlayed: null,
    playtimeMs,
    metrics: [
      { label: 'Best time', value: `${best.toFixed(0)}ms` },
      { label: 'Average', value: `${avg.toFixed(0)}ms` },
    ],
  };
}

async function sudokuStats(userId: string, slug: string, title: string): Promise<GameProfileStats> {
  const [row, playtimeMs] = await Promise.all([
    safeRow<{ best_ms: number | string; solves: number | string }>(
      `SELECT MIN(solve_time_ms) AS best_ms, COUNT(*) AS solves
         FROM sudoku_scores WHERE od_user_id = $1`,
      [userId],
    ),
    readPlaytimeMs(userId, 'sudoku'),
  ]);
  const solves = toNum(row?.solves);
  if (!row || solves <= 0) return { ...emptyStats(slug, title), playtimeMs };
  const bestSeconds = toNum(row.best_ms) / 1000;
  return {
    slug,
    title,
    hasData: true,
    tier: null,
    headline: { label: 'Best solve', value: formatSeconds(bestSeconds) },
    gamesPlayed: solves,
    playtimeMs,
    metrics: [
      { label: 'Best solve', value: formatSeconds(bestSeconds) },
      { label: 'Puzzles solved', value: fmt(solves) },
      ...(playtimeMs ? [{ label: 'Time played', value: formatDuration(playtimeMs) }] : []),
    ],
  };
}

async function punchCardStats(userId: string, slug: string, title: string): Promise<GameProfileStats> {
  const [row, playtimeMs] = await Promise.all([
    safeRow<{ best_ms: number | string; solves: number | string }>(
      `SELECT MIN(solve_time_ms) AS best_ms, COUNT(*) AS solves
         FROM punch_card_scores WHERE od_user_id = $1`,
      [userId],
    ),
    readPlaytimeMs(userId, 'punch-card'),
  ]);
  const solves = toNum(row?.solves);
  if (!row || solves <= 0) return { ...emptyStats(slug, title), playtimeMs };
  const bestSeconds = toNum(row.best_ms) / 1000;
  return {
    slug,
    title,
    hasData: true,
    tier: null,
    headline: { label: 'Best solve', value: formatSeconds(bestSeconds) },
    gamesPlayed: solves,
    playtimeMs,
    metrics: [
      { label: 'Best solve', value: formatSeconds(bestSeconds) },
      { label: 'Cards cleared', value: fmt(solves) },
      ...(playtimeMs ? [{ label: 'Time played', value: formatDuration(playtimeMs) }] : []),
    ],
  };
}

async function coinFlipStats(userId: string, slug: string, title: string): Promise<GameProfileStats> {
  const row = await safeRow<{
    streak: number | string;
    total_flips: number | string;
    total_correct_flips: number | string;
  }>(
    `SELECT streak, total_flips, total_correct_flips FROM coin_flip_scores
      WHERE od_user_id = $1 ORDER BY streak DESC LIMIT 1`,
    [userId],
  );
  if (!row) return emptyStats(slug, title);
  const streak = toNum(row.streak);
  const flips = toNum(row.total_flips);
  const correct = toNum(row.total_correct_flips);
  const accuracy = flips > 0 ? `${((correct / flips) * 100).toFixed(1)}%` : '—';
  return {
    slug,
    title,
    hasData: true,
    tier: null,
    headline: { label: 'Best streak', value: fmt(streak) },
    gamesPlayed: flips > 0 ? flips : null,
    playtimeMs: null,
    metrics: [
      { label: 'Best streak', value: fmt(streak) },
      { label: 'Accuracy', value: accuracy },
      ...(flips > 0 ? [{ label: 'Total flips', value: fmt(flips) }] : []),
    ],
  };
}

// ─── Daily puzzles ───────────────────────────────────────────────────────────

async function connectionsStats(userId: string, slug: string, title: string): Promise<GameProfileStats> {
  const row = await safeRow<{ solved: number | string; played: number | string }>(
    `SELECT COALESCE(SUM(CASE WHEN solved THEN 1 ELSE 0 END), 0) AS solved,
            COUNT(*) AS played
       FROM connections_scores WHERE od_user_id = $1`,
    [userId],
  );
  const played = toNum(row?.played);
  if (!row || played <= 0) return emptyStats(slug, title);
  const solved = toNum(row.solved);
  return {
    slug,
    title,
    hasData: true,
    tier: null,
    headline: { label: 'Solved', value: fmt(solved) },
    gamesPlayed: played,
    playtimeMs: null,
    metrics: [
      { label: 'Puzzles solved', value: fmt(solved) },
      { label: 'Solve rate', value: winRate(solved, played) },
      { label: 'Played', value: fmt(played) },
    ],
  };
}

async function bumperCarsStats(userId: string, slug: string, title: string): Promise<GameProfileStats> {
  const row = await safeRow<{ played: number | string; wins: number | string; best: number | string; bumps: number | string; tickets: number | string }>(
    `SELECT COUNT(*) AS played,
            COALESCE(SUM(CASE WHEN place = 1 AND points > 0 THEN 1 ELSE 0 END), 0) AS wins,
            COALESCE(MAX(score), 0) AS best,
            COALESCE(SUM(bumps), 0) AS bumps,
            COALESCE(SUM(tickets), 0) AS tickets
       FROM bumper_car_players WHERE user_id = $1 AND result IN ('finished', 'timeout')`,
    [userId],
  );
  const played = toNum(row?.played);
  if (!row || played <= 0) return emptyStats(slug, title);
  const wins = toNum(row.wins);
  return {
    slug,
    title,
    hasData: true,
    tier: null,
    headline: { label: 'Best round', value: fmt(toNum(row.best)) },
    gamesPlayed: played,
    playtimeMs: null,
    metrics: [
      { label: 'Rounds won', value: fmt(wins) },
      { label: 'Win rate', value: winRate(wins, played) },
      { label: 'Bumps', value: fmt(toNum(row.bumps)) },
      { label: 'Tickets', value: fmt(toNum(row.tickets)) },
    ],
  };
}

async function trickShotStats(userId: string, slug: string, title: string): Promise<GameProfileStats> {
  // A day is one row holding its best try; `tries` counts them (a row from
  // before tries were counted took one). The best streak is the longest run
  // of cleared days: consecutive dates share date minus row number.
  const row = await safeRow<{ played: number | string; clears: number | string; tries: number | string; best_streak: number | string }>(
    `SELECT COUNT(*) AS played,
            COALESCE(SUM(CASE WHEN clear THEN 1 ELSE 0 END), 0) AS clears,
            COALESCE(SUM(GREATEST(COALESCE(tries, 1), 1)), 0) AS tries,
            (SELECT COALESCE(MAX(n), 0) FROM (
               SELECT COUNT(*) AS n FROM (
                 SELECT puzzle_date::date - (ROW_NUMBER() OVER (ORDER BY puzzle_date))::int AS run
                   FROM trick_shot_attempts WHERE od_user_id = $1 AND status = 'shot' AND clear
               ) days GROUP BY run
             ) runs) AS best_streak
       FROM trick_shot_attempts WHERE od_user_id = $1 AND status = 'shot'`,
    [userId],
  );
  const played = toNum(row?.played);
  if (!row || played <= 0) return emptyStats(slug, title);
  const clears = toNum(row.clears);
  return {
    slug,
    title,
    hasData: true,
    tier: null,
    headline: { label: 'Cleared', value: fmt(clears) },
    gamesPlayed: played,
    playtimeMs: null,
    metrics: [
      { label: 'Days cleared', value: fmt(clears) },
      { label: 'Clear rate', value: winRate(clears, played) },
      { label: 'Best streak', value: fmt(toNum(row.best_streak)) },
      { label: 'Tries', value: fmt(toNum(row.tries)) },
    ],
  };
}

async function derbyStats(userId: string, slug: string, title: string): Promise<GameProfileStats> {
  const row = await safeRow<{ races: number | string; wins: number | string; podiums: number | string; best: number | string | null; reds: number | string }>(
    `SELECT races, wins, podiums, best_win_ms AS best, reds FROM derby_stats WHERE od_user_id = $1`,
    [userId],
  );
  const races = toNum(row?.races);
  if (!row || races <= 0) return emptyStats(slug, title);
  const wins = toNum(row.wins);
  const best = row.best == null ? null : toNum(row.best);
  return {
    slug,
    title,
    hasData: true,
    tier: null,
    headline: { label: 'Wins', value: fmt(wins) },
    gamesPlayed: races,
    playtimeMs: null,
    metrics: [
      { label: 'Races won', value: fmt(wins) },
      { label: 'Win rate', value: winRate(wins, races) },
      { label: 'Top three', value: fmt(toNum(row.podiums)) },
      { label: 'Fastest win', value: best == null ? 'none' : `${(best / 1000).toFixed(1)}s` },
    ],
  };
}

async function miniGolfStats(userId: string, slug: string, title: string): Promise<GameProfileStats> {
  const row = await safeRow<{ played: number | string; best: number | string | null; aces: number | string; under: number | string }>(
    `SELECT COUNT(*) AS played,
            MIN(strokes - par) AS best,
            COALESCE(SUM(aces), 0) AS aces,
            COALESCE(SUM(CASE WHEN strokes < par THEN 1 ELSE 0 END), 0) AS under
       FROM mini_golf_rounds WHERE od_user_id = $1 AND finished_at IS NOT NULL`,
    [userId],
  );
  const played = toNum(row?.played);
  if (!row || played <= 0) return emptyStats(slug, title);
  const best = toNum(row.best);
  const toPar = best === 0 ? 'E' : best > 0 ? `+${best}` : `\u2212${-best}`;
  return {
    slug,
    title,
    hasData: true,
    tier: null,
    headline: { label: 'Best round', value: toPar },
    gamesPlayed: played,
    playtimeMs: null,
    metrics: [
      { label: 'Rounds', value: fmt(played) },
      { label: 'Best round', value: toPar },
      { label: 'Holes in one', value: fmt(toNum(row.aces)) },
      { label: 'Under par', value: fmt(toNum(row.under)) },
    ],
  };
}

async function wordGridStats(userId: string, slug: string, title: string): Promise<GameProfileStats> {
  const row = await safeRow<{
    solved: number | string;
    played: number | string;
    best_guesses: number | string;
  }>(
    `SELECT COALESCE(SUM(CASE WHEN solved THEN 1 ELSE 0 END), 0) AS solved,
            COUNT(*) AS played,
            MIN(CASE WHEN solved THEN guesses END) AS best_guesses
       FROM word_grid_scores WHERE od_user_id = $1`,
    [userId],
  );
  const played = toNum(row?.played);
  if (!row || played <= 0) return emptyStats(slug, title);
  const solved = toNum(row.solved);
  const bestGuesses = toNum(row.best_guesses);
  return {
    slug,
    title,
    hasData: true,
    tier: null,
    headline: { label: 'Solved', value: fmt(solved) },
    gamesPlayed: played,
    playtimeMs: null,
    metrics: [
      { label: 'Puzzles solved', value: fmt(solved) },
      { label: 'Solve rate', value: winRate(solved, played) },
      ...(bestGuesses > 0 ? [{ label: 'Best (guesses)', value: fmt(bestGuesses) }] : []),
      { label: 'Played', value: fmt(played) },
    ],
  };
}

async function pangramStats(userId: string, slug: string, title: string): Promise<GameProfileStats> {
  const row = await safeRow<{
    played: number | string;
    best_score: number | string;
    total_words: number | string;
  }>(
    `SELECT COUNT(*) AS played,
            COALESCE(MAX(score), 0) AS best_score,
            COALESCE(SUM(words_found), 0) AS total_words
       FROM pangram_scores WHERE od_user_id = $1`,
    [userId],
  );
  const played = toNum(row?.played);
  if (!row || played <= 0) return emptyStats(slug, title);
  return {
    slug,
    title,
    hasData: true,
    tier: null,
    headline: { label: 'Best score', value: fmt(toNum(row.best_score)) },
    gamesPlayed: played,
    playtimeMs: null,
    metrics: [
      { label: 'Best score', value: fmt(toNum(row.best_score)) },
      { label: 'Words found', value: fmt(toNum(row.total_words)) },
      { label: 'Days played', value: fmt(played) },
    ],
  };
}

// ─── Public entry point ──────────────────────────────────────────────────────

/**
 * Build the render-ready stat block for one game on a player's profile. Unknown
 * slugs and games with no per-user stat surface (most wager games, air hockey,
 * typing duel) resolve to a graceful no-data block.
 */
export async function getGameProfileStats(
  userId: string,
  slug: string,
  title: string,
): Promise<GameProfileStats> {
  switch (slug) {
    case '8-ball':
      return poolStats(userId, slug, title);
    case 'chess':
      return chessStats(userId, slug, title);
    case 'connect-four':
      return drawEloStats(userId, slug, title, 'connect_four_elo', 'connect-four');
    case 'checkers':
      return drawEloStats(userId, slug, title, 'checkers_elo', 'checkers');
    case 'snake':
      return snakeStats(userId, slug, title);
    case 'flappy-bird':
      return flappyStats(userId, slug, title);
    case '2048':
      return game2048Stats(userId, slug, title);
    case 'tetris':
      return tetrisStats(userId, slug, title);
    case 'breakout':
      return breakoutStats(userId, slug, title);
    case 'stack':
      return stackStats(userId, slug, title);
    case 'sequence':
      return sequenceStats(userId, slug, title);
    case 'gopher':
      return gopherStats(userId, slug, title);
    case 'ricochet':
      return ricochetStats(userId, slug, title);
    case 'swerve':
      return swerveStats(userId, slug, title);
    case 'tumbler':
      return tumblerStats(userId, slug, title);
    case 'log-splitter':
      return logSplitterStats(userId, slug, title);
    case 'knife-booth':
      return knifeBoothStats(userId, slug, title);
    case 'melon-chop':
      return melonChopStats(userId, slug, title);
    case 'tin-duck':
      return tinDuckStats(userId, slug, title);
    case 'math':
      return mathStats(userId, slug, title);
    case 'blitz-tactics':
      return blitzTacticsStats(userId, slug, title);
    case 'boardwalk-hop':
      return boardwalkHopStats(userId, slug, title);
    case 'high-striker':
      return highStrikerStats(userId, slug, title);
    case 'skee-ball':
      return skeeBallStats(userId, slug, title);
    case 'gunrush':
      return gunrushStats(userId, slug, title);
    case 'ticket-stop':
      return ticketStopStats(userId, slug, title);
    case 'ring-toss':
      return ringTossStats(userId, slug, title);
    case 'freecell':
      return freecellStats(userId, slug, title);
    case 'typing-test':
      return typingStats(userId, slug, title);
    case 'reaction-time':
      return reactionStats(userId, slug, title);
    case 'sudoku':
      return sudokuStats(userId, slug, title);
    case 'punch-card':
      return punchCardStats(userId, slug, title);
    case 'coin-flip':
      return coinFlipStats(userId, slug, title);
    case 'connections':
      return connectionsStats(userId, slug, title);
    case 'word-grid':
      return wordGridStats(userId, slug, title);
    case 'trick-shot':
      return trickShotStats(userId, slug, title);
    case 'derby':
      return derbyStats(userId, slug, title);
    case 'mini-golf':
      return miniGolfStats(userId, slug, title);
    case 'bumper-cars':
      return bumperCarsStats(userId, slug, title);
    case 'pangram':
      return pangramStats(userId, slug, title);
    default:
      return emptyStats(slug, title);
  }
}
