import 'server-only';

/* What a profile shows (docs/design/tixy-rebrand/PROFILES.md): the player's
   floor games with one real number each, what they played lately, their
   season tier, and their recent results. Every read is an indexed lookup for
   one player: the per-game best tables are unique on od_user_id, the rating
   tables on user_id, game_time_metrics_daily on (user_id, date_key),
   game_time_metrics_totals on (user_id, game_type), the score event log on
   (game_slug, od_user_id), and the match tables on player1_id and
   player2_id. Each part fails on its own and comes back empty. */

import {
  getArcadeGameBySlug,
  getFloorGames,
} from '@/features/arcade/components/arcade-game-registry';
import { getGameDisplayName, getGameDisplayRoute } from '@/features/arcade/lib/game-renames';
import { SEASON_CARD_ITEMS, SEASON_CARD_TIERS } from '@/server/arcade/battlepass/season-card';
import { currentSeason, seasonTierProgress } from '@/server/arcade/battlepass/seasons';
import { query, queryOne } from '@/server/db/client';

export type ProfileGameNumber = {
  slug: string;
  name: string;
  href: string;
  value: number;
  /** What the number is: "rating", "best", "solved". */
  label: string;
  playtimeMs: number;
};

export type ProfileResult = {
  id: string;
  slug: string;
  name: string;
  href: string;
  at: number;
} & (
  | { kind: 'score'; score: number }
  | { kind: 'match'; outcome: 'won' | 'lost' | 'drew'; opponent: string | null }
);

export type ProfileSeason = {
  /** "season 0" */
  name: string;
  tier: number;
  maxTier: number;
  into: number;
  need: number;
  atMax: boolean;
  /** The season's medal: its art, the tier that pays it, and whether the
   *  player has it. Null when the season has no medal. */
  medal: { art: string; tier: number; owned: boolean } | null;
};

/** A game played in the last two weeks (Steam's "recent activity"). */
export type ProfileRecentGame = {
  slug: string;
  name: string;
  href: string;
  lastPlayedAt: number;
  /** Runs and matches in the last seven days. */
  weekPlays: number;
  twoWeeksMs: number;
  totalMs: number;
  best: { value: number; label: string } | null;
};

export type ProfilePlaySummary = {
  /** Time on every game, all time. */
  totalMs: number;
  /** Time in the last two weeks. */
  twoWeeksMs: number;
  /** Games with any time on them. */
  gamesPlayed: number;
};

/* Ratings: one row per player, and only once they have played. */
const RATING_TABLES: Record<string, string> = {
  '8-ball': 'pool_elo',
  chess: 'chess_elo',
  'connect-four': 'connect_four_elo',
};

/* Bests: one row per player (unique on od_user_id). The floor's skill games. */
const BEST_TABLES: Record<string, string> = {
  'skee-ball': 'skee_ball_scores',
  'high-striker': 'high_striker_scores',
  'tin-duck': 'tin_duck_scores',
  snake: 'snake_scores',
  '2048': 'game_2048_scores',
  stack: 'stack_scores',
  'ticket-stop': 'ticket_stop_scores',
  'ring-toss': 'ring_toss_scores',
};

/* Matches for recent results, newest first by updated_at (indexed). */
const MATCH_TABLES: Record<string, string> = {
  '8-ball': 'pool_matches',
  chess: 'chess_matches',
  'connect-four': 'connect_four_matches',
};

const MAX_GAMES = 6;
const MAX_RESULTS = 8;
const MAX_RECENT = 5;
const DAY_MS = 86_400_000;

const num = (value: unknown) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

async function settle<T>(promise: Promise<T>, fallback: T, label: string): Promise<T> {
  try {
    return await promise;
  } catch (error) {
    console.error(`[player-profile] ${label} failed:`, error);
    return fallback;
  }
}

function gameLink(slug: string) {
  const game = getArcadeGameBySlug(slug);
  if (!game) return null;
  return {
    name: getGameDisplayName(game.slug, game.title).toLowerCase(),
    href: getGameDisplayRoute(game.slug, game.href),
  };
}

/* game_time_metrics records some games under their own key ('stack-cabinet'
   for the stack machine, 'arcade-blackjack' for 21) and the newer machines
   under one shared 'arcade' key, which belongs to no game. */
const TIME_KEY_SLUGS: Record<string, string> = {
  'stack-cabinet': 'stack',
  'arcade-blackjack': '21',
  'arcade-legacy': '',
  arcade: '',
};

export function timeKeyToSlug(gameType: string): string | null {
  const mapped = TIME_KEY_SLUGS[gameType];
  if (mapped !== undefined) return mapped || null;
  if (getArcadeGameBySlug(gameType)) return gameType;
  if (gameType.startsWith('arcade-')) {
    const slug = gameType.slice('arcade-'.length);
    if (getArcadeGameBySlug(slug)) return slug;
  }
  return null;
}

/** Local date key, the way game_time_metrics_daily writes it. */
function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/* Time on every game, all time, as slug -> ms. */
async function readPlaytime(userId: string): Promise<Map<string, number>> {
  const rows = await query<{ game_type: string; total_duration_ms: string | number }>(
    `SELECT game_type, total_duration_ms FROM game_time_metrics_totals WHERE user_id = $1`,
    [userId],
  );
  const bySlug = new Map<string, number>();
  for (const row of rows.rows) {
    const slug = timeKeyToSlug(row.game_type);
    if (!slug) continue;
    bySlug.set(slug, (bySlug.get(slug) ?? 0) + num(row.total_duration_ms));
  }
  return bySlug;
}

/* The player's floor games that have a number, most played first. Machines
   have no number of their own (ROADMAP.md, "Decided"), so they don't show. */
async function readFloorNumbers(userId: string, playtime: Map<string, number>): Promise<ProfileGameNumber[]> {
  const floor = new Set(getFloorGames().map((game) => game.slug));
  const parts: string[] = [];
  for (const [slug, table] of Object.entries(RATING_TABLES)) {
    if (!floor.has(slug)) continue;
    parts.push(
      `SELECT '${slug}' AS slug, 'rating' AS label, (SELECT elo_rating FROM ${table} WHERE user_id = $1 AND total_games > 0)::bigint AS value`,
    );
  }
  for (const [slug, table] of Object.entries(BEST_TABLES)) {
    if (!floor.has(slug)) continue;
    parts.push(
      `SELECT '${slug}' AS slug, 'best' AS label, (SELECT MAX(score) FROM ${table} WHERE od_user_id = $1)::bigint AS value`,
    );
  }
  if (floor.has('word-grid')) {
    parts.push(
      `SELECT 'word-grid' AS slug, 'solved' AS label, (SELECT NULLIF(COUNT(*), 0) FROM word_grid_scores WHERE od_user_id = $1 AND solved)::bigint AS value`,
    );
  }
  if (floor.has('mini-golf')) {
    parts.push(
      `SELECT 'mini-golf' AS slug, 'rounds' AS label, (SELECT NULLIF(COUNT(*), 0) FROM mini_golf_rounds WHERE od_user_id = $1 AND finished_at IS NOT NULL)::bigint AS value`,
    );
  }
  if (floor.has('bumper-cars')) {
    parts.push(
      `SELECT 'bumper-cars' AS slug, 'best' AS label, (SELECT MAX(score) FROM bumper_car_players WHERE user_id = $1 AND result IN ('finished', 'timeout'))::bigint AS value`,
    );
  }
  if (floor.has('derby')) {
    parts.push(
      `SELECT 'derby' AS slug, 'wins' AS label, (SELECT NULLIF(wins, 0) FROM derby_stats WHERE od_user_id = $1)::bigint AS value`,
    );
  }
  if (floor.has('trick-shot')) {
    parts.push(
      `SELECT 'trick-shot' AS slug, 'cleared' AS label, (SELECT NULLIF(COUNT(*), 0) FROM trick_shot_attempts WHERE od_user_id = $1 AND status = 'shot' AND clear)::bigint AS value`,
    );
  }
  const numbers = await query<{ slug: string; label: string; value: string | number | null }>(
    parts.join(' UNION ALL '),
    [userId],
  );
  const games: ProfileGameNumber[] = [];
  for (const row of numbers.rows) {
    // A best of 0 is a game tried, not a number to show.
    if (row.value == null || num(row.value) <= 0) continue;
    const link = gameLink(row.slug);
    if (!link) continue;
    games.push({
      slug: row.slug,
      ...link,
      value: num(row.value),
      label: row.label,
      playtimeMs: playtime.get(row.slug) ?? 0,
    });
  }
  return games.sort((a, b) => b.playtimeMs - a.playtimeMs || b.value - a.value);
}

/* Steam's recent activity: every game with time in the last two weeks, the
   newest first, with plays in the last seven days. */
async function readRecentlyPlayed(
  userId: string,
  playtime: Map<string, number>,
  numbers: ProfileGameNumber[],
  now = new Date(),
): Promise<{ recent: ProfileRecentGame[]; twoWeeksMs: number }> {
  const twoWeeks = dateKey(new Date(now.getTime() - 13 * DAY_MS));
  const week = dateKey(new Date(now.getTime() - 6 * DAY_MS));
  const rows = await query<{
    game_type: string;
    two_weeks_ms: string | number;
    week_runs: string | number;
    last_at: string | number | null;
  }>(
    `SELECT game_type,
            SUM(duration_ms) AS two_weeks_ms,
            SUM(CASE WHEN date_key >= $3 THEN run_count ELSE 0 END) AS week_runs,
            MAX(last_played_at) AS last_at
       FROM game_time_metrics_daily
      WHERE user_id = $1 AND date_key >= $2
      GROUP BY game_type`,
    [userId, twoWeeks, week],
  );
  const bests = new Map(numbers.map((game) => [game.slug, game]));
  const bySlug = new Map<string, ProfileRecentGame>();
  let twoWeeksMs = 0;
  for (const row of rows.rows) {
    const ms = num(row.two_weeks_ms);
    const slug = timeKeyToSlug(row.game_type);
    const link = slug ? gameLink(slug) : null;
    if (!slug || !link) continue;
    twoWeeksMs += ms;
    const entry = bySlug.get(slug);
    const best = bests.get(slug);
    if (entry) {
      entry.twoWeeksMs += ms;
      entry.weekPlays += num(row.week_runs);
      entry.lastPlayedAt = Math.max(entry.lastPlayedAt, num(row.last_at));
      continue;
    }
    bySlug.set(slug, {
      slug,
      ...link,
      lastPlayedAt: num(row.last_at),
      weekPlays: num(row.week_runs),
      twoWeeksMs: ms,
      totalMs: playtime.get(slug) ?? ms,
      best: best ? { value: best.value, label: best.label } : null,
    });
  }
  const recent = [...bySlug.values()]
    .sort((a, b) => b.lastPlayedAt - a.lastPlayedAt)
    .slice(0, MAX_RECENT);
  return { recent, twoWeeksMs };
}

type ScoreRow = { id: string; slug: string; score: string | number; at: string | number };
type MatchRow = {
  id: string;
  slug: string;
  winner: string | null;
  opponent: string | null;
  at: string | number;
};

/* Runs on the floor's skill games, and finished matches, newest first. */
async function readRecentResults(userId: string): Promise<ProfileResult[]> {
  const floor = new Set(getFloorGames().map((game) => game.slug));
  const scoreSlugs = Object.keys(BEST_TABLES).filter((slug) => floor.has(slug));
  const matchSql = Object.entries(MATCH_TABLES)
    .filter(([slug]) => floor.has(slug))
    .flatMap(([slug, table]) =>
      ['player1_id', 'player2_id'].map(
        (column) => `(
          SELECT id, '${slug}' AS slug, winner_id AS winner,
                 CASE WHEN player1_id = $1 THEN player2_name ELSE player1_name END AS opponent,
                 COALESCE(completed_at, updated_at) AS at
          FROM ${table}
          WHERE ${column} = $1 AND status IN ('completed', 'forfeited')
          ORDER BY updated_at DESC
          LIMIT ${MAX_RESULTS})`,
      ),
    )
    .join(' UNION ALL ');

  const [scores, matches] = await Promise.all([
    scoreSlugs.length
      ? query<ScoreRow>(
          `SELECT id, game_slug AS slug, score, created_at AS at
           FROM game_score_events
           WHERE game_slug = ANY($2::text[]) AND od_user_id = $1
           ORDER BY created_at DESC
           LIMIT ${MAX_RESULTS}`,
          [userId, scoreSlugs],
        )
      : Promise.resolve({ rows: [] as ScoreRow[] }),
    matchSql ? query<MatchRow>(matchSql, [userId]) : Promise.resolve({ rows: [] as MatchRow[] }),
  ]);

  const results: ProfileResult[] = [];
  const seenMatches = new Set<string>();
  for (const row of scores.rows) {
    const link = gameLink(row.slug);
    if (!link) continue;
    results.push({ id: `score:${row.id}`, slug: row.slug, ...link, at: num(row.at), kind: 'score', score: num(row.score) });
  }
  for (const row of matches.rows) {
    const key = `${row.slug}:${row.id}`;
    if (seenMatches.has(key)) continue;
    seenMatches.add(key);
    const link = gameLink(row.slug);
    if (!link) continue;
    results.push({
      id: `match:${key}`,
      slug: row.slug,
      ...link,
      at: num(row.at),
      kind: 'match',
      outcome: row.winner == null ? 'drew' : row.winner === userId ? 'won' : 'lost',
      opponent: row.opponent,
    });
  }
  return results.sort((a, b) => b.at - a.at).slice(0, MAX_RESULTS);
}

/* The season card's medal prize and the tier that pays it. */
const SEASON_MEDAL = (() => {
  const prize = SEASON_CARD_ITEMS.find((item) => item.art?.includes('/medals/'));
  if (!prize?.art) return null;
  const tier = SEASON_CARD_TIERS.find(
    (entry) =>
      (entry.free.kind === 'item' && entry.free.itemId === prize.id) ||
      (entry.premium?.kind === 'item' && entry.premium.itemId === prize.id),
  )?.tier;
  return tier ? { itemId: prize.id, art: prize.art, tier } : null;
})();

async function readSeason(userId: string): Promise<ProfileSeason> {
  const season = currentSeason();
  const [row, medalRow] = await Promise.all([
    queryOne<{ xp: string | number }>(
      `SELECT xp FROM user_season_progress WHERE user_id = $1 AND season_key = $2`,
      [userId, season.key],
    ),
    SEASON_MEDAL
      ? queryOne<{ item_id: string }>(
          `SELECT item_id FROM user_owned_items WHERE user_id = $1 AND item_id = $2`,
          [userId, SEASON_MEDAL.itemId],
        )
      : Promise.resolve(null),
  ]);
  const progress = seasonTierProgress(season, num(row?.xp));
  return {
    name: (season.name.split(' · ')[0] ?? season.name).toLowerCase(),
    tier: progress.tier,
    maxTier: season.maxTier,
    into: progress.into,
    need: progress.need,
    atMax: progress.atMax,
    medal: SEASON_MEDAL
      ? { art: SEASON_MEDAL.art, tier: SEASON_MEDAL.tier, owned: Boolean(medalRow) }
      : null,
  };
}

/** Where a number sits on its all-time board: "3rd of 41". Only bests and
 *  ratings have a board; anything else has no rank. */
export async function getBoardRank(
  slug: string,
  label: string,
  value: number,
): Promise<{ rank: number; of: number } | null> {
  let sql: string | null = null;
  if (label === 'best' && BEST_TABLES[slug]) {
    sql = `SELECT COUNT(DISTINCT od_user_id) FILTER (WHERE score > $1) AS above,
                  COUNT(DISTINCT od_user_id) AS players
             FROM ${BEST_TABLES[slug]}`;
  } else if (label === 'rating' && RATING_TABLES[slug]) {
    sql = `SELECT COUNT(*) FILTER (WHERE elo_rating > $1) AS above, COUNT(*) AS players
             FROM ${RATING_TABLES[slug]} WHERE total_games > 0`;
  }
  if (!sql) return null;
  try {
    const row = await queryOne<{ above: string | number; players: string | number }>(sql, [value]);
    const players = num(row?.players);
    return players > 0 ? { rank: num(row?.above) + 1, of: players } : null;
  } catch (error) {
    console.error('[player-profile] board rank failed:', error);
    return null;
  }
}

export type PlayerProfileData = {
  /** The best games strip: up to six, most played first. */
  games: ProfileGameNumber[];
  /** Every game with a number, most played first (for pickers and slots). */
  numbers: ProfileGameNumber[];
  results: ProfileResult[];
  season: ProfileSeason | null;
  recent: ProfileRecentGame[];
  summary: ProfilePlaySummary;
  /** Every game with time on it, most played first. */
  playedSlugs: string[];
};

export async function getPlayerProfileData(userId: string): Promise<PlayerProfileData> {
  const playtime = await settle(readPlaytime(userId), new Map<string, number>(), 'playtime');
  const numbers = await settle(readFloorNumbers(userId, playtime), [], 'floor games');
  const [results, season, recentPart] = await Promise.all([
    settle(readRecentResults(userId), [], 'recent results'),
    settle(readSeason(userId), null, 'season'),
    settle(readRecentlyPlayed(userId, playtime, numbers), { recent: [], twoWeeksMs: 0 }, 'recently played'),
  ]);
  const played = [...playtime.entries()].filter(([, ms]) => ms > 0).sort((a, b) => b[1] - a[1]);
  return {
    games: numbers.slice(0, MAX_GAMES),
    numbers,
    results,
    season,
    recent: recentPart.recent,
    summary: {
      totalMs: played.reduce((sum, [, ms]) => sum + ms, 0),
      twoWeeksMs: recentPart.twoWeeksMs,
      gamesPlayed: played.length,
    },
    playedSlugs: played.map(([slug]) => slug),
  };
}
