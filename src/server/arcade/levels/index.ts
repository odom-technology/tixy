// ───────────────────────────────────────────────────────────────────────────
// Account levels and XP. One XP number per account, stored in user_account_xp.
// Every grant (a skill run, participation, a quest, an achievement) goes
// through grantXp below, which also adds to the current season's row in
// user_season_progress. Ticket machines grant none.
//
// Curve: one continuous power curve, no cliff between levels. The XP from a
// level to the next is round(250 + 7.1 × (level - 1)^1.5), so level 10 is
// 2,846 XP, level 30 is 19,562 and level 100 is 298,212. The old two-part
// curve (fast ramp, then a drop at level 10) put some players on a higher
// level than this curve gives them, so each account keeps `level_floor`, the
// highest level it has shown, and the displayed level is the larger of the
// floor and the curve. No level ever goes down.
// ───────────────────────────────────────────────────────────────────────────

import type { PoolClient } from 'pg';

import { query, queryOne, withTransaction } from '@/server/db/client';
import { currentSeason, seasonByKey, seasonTierProgress } from '@/server/arcade/battlepass/seasons';

// ─── Curve constants ─────────────────────────────────────────────────────────
export const CURVE_BASE = 250;
export const CURVE_COEF = 7.1;
export const CURVE_EXP = 1.5;
/** Safety bound on the level loop (nobody realistically passes this). */
const MAX_LEVEL = 10_000;

/** XP from skill runs stops here each day (same day boundary as the ticket cap). */
export const RUN_XP_DAILY_CAP = 2500;

/** XP needed to advance FROM `level` to `level + 1` (level is 1-indexed). */
export const xpToNext = (level: number): number => {
  const lvl = Math.max(1, Math.floor(level));
  return Math.round(CURVE_BASE + CURVE_COEF * Math.pow(lvl - 1, CURVE_EXP));
};

/** Cumulative XP required to be exactly at `level` (level 1 = 0 XP). */
export const cumulativeXpForLevel = (level: number): number => {
  const target = Math.max(1, Math.floor(level));
  let total = 0;
  for (let l = 1; l < target; l += 1) total += xpToNext(l);
  return total;
};

/** The level the curve gives for a lifetime XP, ignoring any floor. */
export const curveLevelFromXp = (xp: number): number => {
  const safeXp = Math.max(0, Math.floor(xp));
  let level = 1;
  let consumed = 0;
  while (level < MAX_LEVEL) {
    const need = xpToNext(level);
    if (consumed + need > safeXp) break;
    consumed += need;
    level += 1;
  }
  return level;
};

/** Displayed account level: the curve's level, never below the stored floor. */
export const levelFromXp = (xp: number, levelFloor = 1): number =>
  Math.max(curveLevelFromXp(xp), Math.max(1, Math.floor(levelFloor) || 1));

export type LevelProgress = {
  level: number;
  /** XP earned into the current level. */
  into: number;
  /** XP required to reach the next level. */
  need: number;
};

/** Level + progress within it, for the XP bar. */
export const levelProgress = (xp: number, levelFloor = 1): LevelProgress => {
  const safeXp = Math.max(0, Math.floor(xp));
  const curve = curveLevelFromXp(safeXp);
  const level = levelFromXp(safeXp, levelFloor);
  if (level === curve) {
    return { level, into: safeXp - cumulativeXpForLevel(level), need: xpToNext(level) };
  }
  // Held at a higher level than the curve gives: the bar waits at empty until
  // the curve catches up to the next level.
  return { level, into: 0, need: Math.max(1, cumulativeXpForLevel(level + 1) - safeXp) };
};

// ─── Tier bands (every 20 levels) ────────────────────────────────────────────
export type LevelTier = {
  name: string;
  color: string;
  icon: string;
  /** Generated rank-emblem image rendered in place of the glyph. */
  image: string;
};

const TIERS: ReadonlyArray<{ min: number; tier: LevelTier }> = [
  { min: 100, tier: { name: 'Master', color: '#c084fc', icon: '♛', image: '/cosmetics/levels/master.png' } },
  { min: 80, tier: { name: 'Diamond', color: '#a5f3fc', icon: '❖', image: '/cosmetics/levels/diamond.png' } },
  { min: 60, tier: { name: 'Platinum', color: '#5eead4', icon: '✦', image: '/cosmetics/levels/platinum.png' } },
  { min: 40, tier: { name: 'Gold', color: '#fbbf24', icon: '★', image: '/cosmetics/levels/gold.png' } },
  { min: 20, tier: { name: 'Silver', color: '#cbd5e1', icon: '◆', image: '/cosmetics/levels/silver.png' } },
  { min: 1, tier: { name: 'Bronze', color: '#b07a47', icon: '▲', image: '/cosmetics/levels/bronze.png' } },
];

/** The cosmetic tier band (name + color + icon) for a level. */
export const levelTier = (level: number): LevelTier => {
  const lvl = Math.max(1, Math.floor(level));
  for (const band of TIERS) {
    if (lvl >= band.min) return band.tier;
  }
  return TIERS[TIERS.length - 1].tier;
};

// ─── Persistence ─────────────────────────────────────────────────────────────
export type AccountLevelState = {
  xp: number;
  level: number;
  into: number;
  need: number;
  tier: LevelTier;
};

const now = () => Date.now();

const stateFromRow = (xp: number, levelFloor: number): AccountLevelState => {
  const { level, into, need } = levelProgress(xp, levelFloor);
  return { xp, level, into, need, tier: levelTier(level) };
};

/** Read a user's full account-level state (xp + level + bar + tier). */
export const getAccountLevelState = async (
  userId: string,
): Promise<AccountLevelState> => {
  const row = await queryOne<{ xp: string | number; level_floor: number }>(
    `SELECT xp, level_floor FROM user_account_xp WHERE user_id = $1`,
    [userId],
  );
  return stateFromRow(Math.max(0, Number(row?.xp ?? 0)), Number(row?.level_floor ?? 1));
};

export type XpSource = 'run' | 'participation' | 'quest' | 'achievement';

/** Where a grant left the season row: tier, XP into the tier, and what a tier takes. */
export type SeasonProgressState = {
  tier: number;
  into: number;
  need: number;
  atMax: boolean;
};

export type SeasonProgressChange = {
  seasonKey: string;
  before: SeasonProgressState;
  after: SeasonProgressState;
};

export type AddAccountXpResult = {
  /** XP actually added, after the daily run cap. */
  xpGained: number;
  before: AccountLevelState;
  after: AccountLevelState;
  /** The season row before and after, for the result's second bar. */
  season?: SeasonProgressChange;
  /** The level before this grant and the level after it (same as before.level and after.level). */
  levelBefore: number;
  levelAfter: number;
  leveledUp: boolean;
  /** Bonus Tickets auto-granted by milestone level(s) on this grant. */
  grantedTickets: number;
  /** Each milestone this grant paid, lowest level first. */
  milestones: LevelMilestonePayout[];
};

export type LevelMilestonePayout = { level: number; tickets: number };

/** The grant inside a transaction, before milestones are settled. */
export type AppliedXp = {
  xpGained: number;
  before: AccountLevelState;
  after: AccountLevelState;
  /** The level before the grant and the level after it. */
  levelBefore: number;
  levelAfter: number;
  season?: SeasonProgressChange;
};

/**
 * Milestone Ticket reward for reaching `level`, or 0 for a non-milestone level.
 * Cadence: every 5 levels, larger at every 10, larger still at every 20, and a
 * big one at 100. All multiples of 5 (ledger increment rule).
 */
export const levelMilestoneReward = (level: number): number => {
  if (level <= 0) return 0;
  if (level === 100) return 5000;
  if (level % 20 === 0) return 1000;
  if (level % 10 === 0) return 400;
  if (level % 5 === 0) return 150;
  return 0;
};

/**
 * Pay every milestone up to `toLevel` that has no claim row. Idempotent via
 * user_level_reward_claims (primary key user_id + level), and the ticket grant
 * goes through the currency ledger, which dedupes on its own source id, so a
 * milestone is never paid twice. Checking from level 1 also pays a milestone
 * that a curve change jumped over. Returns the milestones it paid, lowest level first.
 */
const settleMilestoneRewards = async (
  userId: string,
  toLevel: number,
): Promise<LevelMilestonePayout[]> => {
  if (toLevel < 5) return [];
  const claimed = await query<{ level: number }>(
    `SELECT level FROM user_level_reward_claims WHERE user_id = $1 AND level <= $2`,
    [userId, toLevel],
  );
  const have = new Set(claimed.rows.map((row) => Number(row.level)));
  const pending: Array<{ level: number; tickets: number }> = [];
  for (let lvl = 5; lvl <= toLevel; lvl += 5) {
    const tickets = levelMilestoneReward(lvl);
    if (tickets > 0 && !have.has(lvl)) pending.push({ level: lvl, tickets });
  }
  if (pending.length === 0) return [];

  const { mutateWalletAndLedgerForTransaction } = await import(
    '@/server/arcade/rewards/wallet'
  );
  const granted: LevelMilestonePayout[] = [];
  await withTransaction(async (client) => {
    for (const { level, tickets } of pending) {
      const claim = await client.query(
        `INSERT INTO user_level_reward_claims (user_id, level, tickets, claimed_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id, level) DO NOTHING`,
        [userId, level, tickets, now()],
      );
      if ((claim.rowCount ?? 0) === 0) continue; // already granted
      await mutateWalletAndLedgerForTransaction(client, {
        userId,
        currencyType: 'credits',
        amount: tickets,
        sourceType: 'level_reward',
        sourceId: `level:${level}`,
        meta: { level },
      });
      granted.push({ level, tickets });
    }
  });
  return granted;
};

/**
 * The one XP grant path, inside the caller's transaction. Adds to
 * user_account_xp and to the current season's user_season_progress row, and
 * ratchets level_floor. A skill run's XP is clamped to what is left of the
 * 2,500 a day cap under a per-user lock, in the same transaction as the
 * grant, so a burst of runs can't pass it. Call finishXpGrant after COMMIT.
 */
export const applyXp = async (
  client: PoolClient,
  userId: string,
  amount: number,
  source: XpSource,
  dateKey: string,
  /** The season row to add to. Defaults to the current season; the season 0 close passes `season-0`. */
  seasonKey?: string,
): Promise<AppliedXp> => {
  const wanted = Math.max(0, Math.round(Number(amount) || 0));
  const read = await client.query<{ xp: string | number; level_floor: number }>(
    `SELECT xp, level_floor FROM user_account_xp WHERE user_id = $1`,
    [userId],
  );
  const beforeXp = Math.max(0, Number(read.rows[0]?.xp ?? 0));
  const beforeFloor = Number(read.rows[0]?.level_floor ?? 1);
  const before = stateFromRow(beforeXp, beforeFloor);
  if (wanted <= 0) return { xpGained: 0, before, after: before, levelBefore: before.level, levelAfter: before.level };

  let gained = wanted;
  if (source === 'run') {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`run-xp:${userId}`]);
    const used = await client.query<{ run_xp: number }>(
      `SELECT run_xp FROM user_season_xp_day WHERE user_id = $1 AND date_key = $2`,
      [userId, dateKey],
    );
    const left = Math.max(0, RUN_XP_DAILY_CAP - Number(used.rows[0]?.run_xp ?? 0));
    gained = Math.min(wanted, left);
    if (gained <= 0) return { xpGained: 0, before, after: before, levelBefore: before.level, levelAfter: before.level };
    await client.query(
      `INSERT INTO user_season_xp_day (user_id, date_key, games, participation_xp, run_xp, updated_at)
       VALUES ($1, $2, 0, 0, $3, $4)
       ON CONFLICT (user_id, date_key) DO UPDATE
         SET run_xp = user_season_xp_day.run_xp + EXCLUDED.run_xp, updated_at = EXCLUDED.updated_at`,
      [userId, dateKey, gained, now()],
    );
  }

  const written = await client.query<{ xp: string | number; level_floor: number }>(
    `INSERT INTO user_account_xp (user_id, xp, level_floor, updated_at)
     VALUES ($1, $2, 1, $3)
     ON CONFLICT (user_id) DO UPDATE SET
       xp = user_account_xp.xp + EXCLUDED.xp,
       updated_at = EXCLUDED.updated_at
     RETURNING xp, level_floor`,
    [userId, gained, now()],
  );
  const afterXp = Math.max(0, Number(written.rows[0]?.xp ?? beforeXp + gained));
  const afterFloor = Number(written.rows[0]?.level_floor ?? beforeFloor);
  const level = levelFromXp(afterXp, afterFloor);
  if (level > afterFloor) {
    await client.query(
      `UPDATE user_account_xp SET level_floor = GREATEST(level_floor, $2) WHERE user_id = $1`,
      [userId, level],
    );
  }

  const season = seasonKey ? seasonByKey(seasonKey) : currentSeason();
  const seasonRow = await client.query<{ xp: string | number }>(
    `INSERT INTO user_season_progress (user_id, season_key, xp, premium, updated_at)
     VALUES ($1, $2, $3, FALSE, $4)
     ON CONFLICT (user_id, season_key)
     DO UPDATE SET xp = user_season_progress.xp + EXCLUDED.xp, updated_at = EXCLUDED.updated_at
     RETURNING xp`,
    [userId, season.key, gained, now()],
  );
  const seasonAfterXp = Math.max(0, Number(seasonRow.rows[0]?.xp ?? gained));

  const afterState = stateFromRow(afterXp, Math.max(afterFloor, level));
  return {
    xpGained: gained,
    before,
    after: afterState,
    levelBefore: before.level,
    levelAfter: afterState.level,
    season: {
      seasonKey: season.key,
      before: seasonTierProgress(season, Math.max(0, seasonAfterXp - gained)),
      after: seasonTierProgress(season, seasonAfterXp),
    },
  };
};

/**
 * After the grant's transaction commits: pay any milestone tickets and refresh
 * the level stat so level achievements can fire. Best-effort, as before.
 */
export const finishXpGrant = async (
  userId: string,
  applied: AppliedXp,
): Promise<AddAccountXpResult> => {
  const { xpGained, before, after, season, levelBefore, levelAfter } = applied;
  let milestones: LevelMilestonePayout[] = [];
  if (xpGained > 0) {
    try {
      milestones = await settleMilestoneRewards(userId, after.level);
    } catch (error) {
      console.error('[levels] settleMilestoneRewards failed:', error);
    }
  }
  const leveledUp = after.level > before.level;
  if (leveledUp) {
    try {
      const { recordStats } = await import('@/server/arcade/stats/pipeline');
      const { set, GLOBAL } = await import('@/server/arcade/stats/stat-keys');
      await recordStats(userId, [set(GLOBAL.level, after.level)]);
    } catch (error) {
      console.error('[levels] level-up achievement eval failed:', error);
    }
  }
  const grantedTickets = milestones.reduce((sum, m) => sum + m.tickets, 0);
  return { xpGained, before, after, season, levelBefore, levelAfter, leveledUp, grantedTickets, milestones };
};

/**
 * Grant XP in its own transaction. `dateKey` is the same server day key the
 * ticket cap uses (getServerDateKey); only skill runs are capped by it.
 */
export const grantXp = async (
  userId: string,
  amount: number,
  source: XpSource,
  dateKey: string,
): Promise<AddAccountXpResult> => {
  const applied = await withTransaction((client) =>
    applyXp(client, userId, amount, source, dateKey),
  );
  return finishXpGrant(userId, applied);
};

/** Fold several grants from one action into one result: the XP shown once. */
export const mergeXpResults = (
  results: Array<AddAccountXpResult | null | undefined>,
): AddAccountXpResult | null => {
  const real = results.filter((r): r is AddAccountXpResult => Boolean(r) && (r as AddAccountXpResult).xpGained > 0);
  if (real.length === 0) return null;
  const first = real[0]!;
  const last = real[real.length - 1]!;
  return {
    xpGained: real.reduce((sum, r) => sum + r.xpGained, 0),
    before: first.before,
    after: last.after,
    // The season row: where the first grant started, where the last ended.
    season:
      first.season && last.season
        ? { seasonKey: last.season.seasonKey, before: first.season.before, after: last.season.after }
        : (last.season ?? first.season),
    levelBefore: first.levelBefore,
    levelAfter: last.levelAfter,
    leveledUp: last.after.level > first.before.level,
    grantedTickets: real.reduce((sum, r) => sum + r.grantedTickets, 0),
    milestones: real.flatMap((r) => r.milestones),
  };
};

export type AccountLevelSummary = { level: number; tier: LevelTier };

/**
 * Batched account level + tier for a set of users (player directory). ONE query
 * on user_account_xp (PK user_id) — no N+1. Users with no XP row are absent
 * (callers treat them as level 1).
 */
export const getAccountLevelsForUsers = async (
  userIds: string[],
): Promise<Map<string, AccountLevelSummary>> => {
  const ids = [...new Set(userIds.filter((id) => typeof id === 'string' && id.trim()))];
  const out = new Map<string, AccountLevelSummary>();
  if (ids.length === 0) return out;
  const rows = await query<{ user_id: string; xp: string | number; level_floor: number }>(
    `SELECT user_id, xp, level_floor FROM user_account_xp WHERE user_id = ANY($1::text[])`,
    [ids],
  );
  for (const row of rows.rows) {
    const level = levelFromXp(Math.max(0, Number(row.xp ?? 0)), Number(row.level_floor ?? 1));
    out.set(row.user_id, { level, tier: levelTier(level) });
  }
  return out;
};

export type AccountLevelLeaderboardEntry = {
  userId: string;
  xp: number;
  level: number;
  tier: LevelTier;
};

/** Top accounts by lifetime XP (backs the "Account level" leaderboard board). */
export const getAccountLevelLeaderboard = async (
  limit = 100,
): Promise<AccountLevelLeaderboardEntry[]> => {
  const safeLimit = Math.max(1, Math.min(500, Math.floor(limit)));
  const rows = await query<{ user_id: string; xp: string | number; level_floor: number }>(
    `SELECT user_id, xp, level_floor
     FROM user_account_xp
     WHERE xp > 0
     ORDER BY xp DESC
     LIMIT $1`,
    [safeLimit],
  );
  return rows.rows.map((row) => {
    const xp = Math.max(0, Number(row.xp ?? 0));
    const level = levelFromXp(xp, Number(row.level_floor ?? 1));
    return { userId: row.user_id, xp, level, tier: levelTier(level) };
  });
};
