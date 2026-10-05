// Namespaced keys for the generic user_stats counter store.
//
// Convention: "<scope>.<metric>" where scope is a game slug, "global", "mp"
// (cross-game multiplayer), "daily" (puzzle games), "secret" (easter-egg
// trigger counters), or "played" (per-game first-play flags). Keep these in one
// place so the achievement registry and the profile display reference the same
// strings.

export type StatMode = 'add' | 'max' | 'min' | 'set';

export type StatDelta = {
  key: string;
  value: number;
  mode: StatMode;
};

/** Per-game metric, e.g. gameStat('snake', 'best') -> "snake.best". */
export const gameStat = (slug: string, metric: string) => `${slug}.${metric}`;

/** First-play flag, set to 1 the first time a game is played. */
export const playedFlag = (slug: string) => `played.${slug}`;

/** Never stored: stands in for "played every floor game in this group". */
export const groupPlayedStat = (groupId: string) => `floor_group.${groupId}.played`;

/** Secret / easter-egg trigger counter. */
export const secretStat = (key: string) => `secret.${key}`;

// Cross-cutting global keys.
export const GLOBAL = {
  games: 'global.games',
  playtimeMs: 'global.playtime_ms',
  ticketsEarned: 'global.tickets_earned',
  distinctGames: 'global.distinct_games',
  level: 'global.level',
  cosmeticsOwned: 'global.cosmetics_owned',
  leaderboardTops: 'global.leaderboard_tops',
  achievementsUnlocked: 'global.achievements_unlocked',
  secretsFound: 'global.secrets_found',
  lastPlayDate: 'global.last_play_date', // YYYYMMDD
  gamesToday: 'global.games_today',
  gamesTodayDate: 'global.games_today_date', // YYYYMMDD
  playStreak: 'global.play_streak',
  playStreakBest: 'global.play_streak_best',
  wagerWon: 'global.wager_won',
  biggestWin: 'global.biggest_win',
} as const;

// Cross-game multiplayer roll-ups (mirrored from per-game *_stats on settle).
export const MP = {
  wins: 'mp.wins',
  losses: 'mp.losses',
  games: 'mp.games',
  winStreak: 'mp.win_streak',
  winStreakBest: 'mp.win_streak_best',
  botHardWins: 'mp.bot_hard_wins',
} as const;

// Daily-puzzle roll-ups (connections / word-grid / pangram).
export const DAILY = {
  solved: 'daily.solved',
  perfect: 'daily.perfect',
  streak: 'daily.streak',
  streakBest: 'daily.streak_best',
  lastSolveDate: 'daily.last_solve_date', // YYYYMMDD
} as const;

export const add = (key: string, value: number): StatDelta => ({ key, value, mode: 'add' });
export const max = (key: string, value: number): StatDelta => ({ key, value, mode: 'max' });
/** Lower-is-better best (solve times, reaction ms). Only ever stores positive values. */
export const min = (key: string, value: number): StatDelta => ({ key, value, mode: 'min' });
export const set = (key: string, value: number): StatDelta => ({ key, value, mode: 'set' });
