import { getAchievement } from '@/server/arcade/achievements/registry';
import { currentSeason, seasonTierFromXp } from '@/server/arcade/battlepass/seasons';
import { levelFromXp } from '@/server/arcade/levels';
import { query } from '@/server/db/client';

import { cached } from './cache';
import { ensureRollups } from './rollup';
import type { ProgressionMetrics } from './types';
import {
  buildWindow,
  dayBoundsMs,
  densify,
  hasBaseline,
  kpi,
  num,
  parseWindow,
  windowDays,
} from './window';

export const LEVEL_BANDS = [
  { label: '1-4', min: 1, max: 4 },
  { label: '5-9', min: 5, max: 9 },
  { label: '10-19', min: 10, max: 19 },
  { label: '20-29', min: 20, max: 29 },
  { label: '30-49', min: 30, max: 49 },
  { label: '50+', min: 50, max: null },
] as const;

type QuestCounts = { assigned: number; completed: number; claimed: number };

const zero = (): QuestCounts => ({ assigned: 0, completed: 0, claimed: 0 });

/**
 * Progression definitions.
 *
 * levels: each account's level from user_account_xp using the levels module's
 *   levelFromXp(xp, level_floor), counted per level from 1 to the highest, dense.
 *   levelBands group them (1-4, 5-9, 10-19, 20-29, 30-49, 50+); medianLevel is
 *   the median account.
 * season: the current season from the battlepass registry (currentSeason), its
 *   tier count from the season's config (maxTier). distribution is the count of
 *   players per tier reached (seasonTierFromXp over user_season_progress xp for
 *   that season_key), tiers 0 to maxTier, dense. premium counts rows with premium
 *   set. null once the latest season has ended and no new one has started.
 * quests: daily from user_daily_quests with date_key in the window (assigned is
 *   rows, completed is progress >= goal, claimed is claimed). weekly from
 *   user_weekly_quests and user_weekly_cards rows created in the window; season
 *   from user_season_quests for the current season (not windowed). rerolls from
 *   user_quest_day in the window: playerDays rows, rerollDays rows with
 *   rerolls_used > 0, rerolls the sum. byKind is over daily quests.
 * achievements: unlocked is user_achievements rows with unlocked_at in the window
 *   (previous: the window before); daily is that per day, dense. top is the 10
 *   achievements with the most holders (achievement_unlock_counts, which the
 *   unlock path keeps), with names from the achievements catalog and how many
 *   were unlocked in the window.
 */
async function load(daysInput: number): Promise<ProgressionMetrics> {
  await ensureRollups();
  const days = parseWindow(daysInput);
  const window = await buildWindow(days);
  const baseline = await hasBaseline(window, 'live');
  const list = windowDays(window);
  const cur = dayBoundsMs(window.from, window.to);
  const prev = dayBoundsMs(window.previousFrom, window.previousTo);
  const season = currentSeason();
  const seasonOver = season.endMs !== null && Date.now() > season.endMs;

  const [xp, seasonRows, daily, byKind, weekly, cards, seasonQuests, rerolls, unlockedDaily, unlockedPrev, top] =
    await Promise.all([
      query<{ xp: string; level_floor: number; n: string }>(
        `SELECT x.xp, x.level_floor, COUNT(*) AS n
         FROM user_account_xp x JOIN arcade_accounts a ON a.id = x.user_id
         GROUP BY x.xp, x.level_floor`,
      ),
      query<{ xp: number; premium: boolean; n: string }>(
        `SELECT xp, premium, COUNT(*) AS n FROM user_season_progress WHERE season_key = $1 GROUP BY xp, premium`,
        [season.key],
      ),
      query<{ assigned: string; completed: string; claimed: string }>(
        `SELECT COUNT(*) AS assigned, COUNT(*) FILTER (WHERE progress >= goal) AS completed,
                COUNT(*) FILTER (WHERE claimed) AS claimed
         FROM user_daily_quests WHERE date_key >= $1 AND date_key <= $2`,
        [window.from, window.to],
      ),
      query<{ kind: string; assigned: string; completed: string }>(
        `SELECT kind, COUNT(*) AS assigned, COUNT(*) FILTER (WHERE progress >= goal) AS completed
         FROM user_daily_quests WHERE date_key >= $1 AND date_key <= $2 GROUP BY kind ORDER BY assigned DESC, kind`,
        [window.from, window.to],
      ),
      query<{ assigned: string; completed: string; claimed: string }>(
        `SELECT COUNT(*) AS assigned, COUNT(*) FILTER (WHERE progress >= goal) AS completed,
                COUNT(*) FILTER (WHERE claimed) AS claimed
         FROM user_weekly_quests WHERE created_at >= $1 AND created_at < $2`,
        [cur.startMs, cur.endMs],
      ),
      query<{ assigned: string; completed: string; claimed: string }>(
        `SELECT COUNT(*) AS assigned, COUNT(*) FILTER (WHERE progress >= goal) AS completed,
                COUNT(*) FILTER (WHERE claimed) AS claimed
         FROM user_weekly_cards WHERE created_at >= $1 AND created_at < $2`,
        [cur.startMs, cur.endMs],
      ),
      query<{ assigned: string; completed: string; claimed: string }>(
        `SELECT COUNT(*) AS assigned, COUNT(*) FILTER (WHERE progress >= goal) AS completed,
                COUNT(*) FILTER (WHERE claimed) AS claimed
         FROM user_season_quests WHERE season_key = $1`,
        [season.key],
      ),
      query<{ player_days: string; reroll_days: string; rerolls: string }>(
        `SELECT COUNT(*) AS player_days, COUNT(*) FILTER (WHERE rerolls_used > 0) AS reroll_days,
                COALESCE(SUM(rerolls_used), 0) AS rerolls
         FROM user_quest_day WHERE date_key >= $1 AND date_key <= $2`,
        [window.from, window.to],
      ),
      query<{ day: string; n: string }>(
        `SELECT (to_timestamp(unlocked_at / 1000.0) AT TIME ZONE 'UTC')::date::text AS day, COUNT(*) AS n
         FROM user_achievements WHERE unlocked_at >= $1 AND unlocked_at < $2 GROUP BY 1`,
        [cur.startMs, cur.endMs],
      ),
      query<{ n: string }>(
        `SELECT COUNT(*) AS n FROM user_achievements WHERE unlocked_at >= $1 AND unlocked_at < $2`,
        [prev.startMs, prev.endMs],
      ),
      query<{ achievement_id: string; holders: string }>(
        `SELECT achievement_id, count AS holders FROM achievement_unlock_counts
         WHERE count > 0 ORDER BY count DESC, achievement_id LIMIT 10`,
      ),
    ]);

  // Levels.
  const perLevel = new Map<number, number>();
  const sorted: { level: number; n: number }[] = [];
  let accounts = 0;
  for (const row of xp.rows) {
    const level = levelFromXp(num(row.xp), row.level_floor);
    const n = num(row.n);
    perLevel.set(level, (perLevel.get(level) ?? 0) + n);
    sorted.push({ level, n });
    accounts += n;
  }
  const maxLevel = Math.max(1, ...perLevel.keys());
  const levels = Array.from({ length: maxLevel }, (_, i) => ({
    level: i + 1,
    players: perLevel.get(i + 1) ?? 0,
  }));
  let medianLevel = 0;
  if (accounts > 0) {
    let seen = 0;
    const half = accounts / 2;
    for (const entry of levels) {
      seen += entry.players;
      if (seen >= half) {
        medianLevel = entry.level;
        break;
      }
    }
  }

  // Season tiers.
  const perTier = new Map<number, number>();
  let premium = 0;
  for (const row of seasonRows.rows) {
    const tier = seasonTierFromXp(season, num(row.xp));
    perTier.set(tier, (perTier.get(tier) ?? 0) + num(row.n));
    if (row.premium) premium += num(row.n);
  }

  const counts = (row?: { assigned: string; completed: string; claimed: string }): QuestCounts =>
    row ? { assigned: num(row.assigned), completed: num(row.completed), claimed: num(row.claimed) } : zero();
  const w = counts(weekly.rows[0]);
  const c = counts(cards.rows[0]);

  const unlockedMap = new Map(unlockedDaily.rows.map((row) => [row.day, num(row.n)]));
  const unlockedTotal = [...unlockedMap.values()].reduce((a, b) => a + b, 0);

  const topIds = top.rows.map((row) => row.achievement_id);
  const inWindow =
    topIds.length === 0
      ? { rows: [] as { achievement_id: string; n: string }[] }
      : await query<{ achievement_id: string; n: string }>(
          `SELECT achievement_id, COUNT(*) AS n FROM user_achievements
           WHERE unlocked_at >= $1 AND unlocked_at < $2 AND achievement_id = ANY($3::text[])
           GROUP BY achievement_id`,
          [cur.startMs, cur.endMs, topIds],
        );
  const inWindowBy = new Map(inWindow.rows.map((row) => [row.achievement_id, num(row.n)]));

  return {
    window,
    levels,
    levelBands: LEVEL_BANDS.map((band) => ({
      label: band.label,
      min: band.min,
      max: band.max,
      players: sorted
        .filter((entry) => entry.level >= band.min && (band.max === null || entry.level <= band.max))
        .reduce((sum, entry) => sum + entry.n, 0),
    })),
    medianLevel,
    season: seasonOver ? null : {
      key: season.key,
      name: season.name,
      tiers: season.maxTier,
      distribution: Array.from({ length: season.maxTier + 1 }, (_, tier) => ({
        tier,
        players: perTier.get(tier) ?? 0,
      })),
      premium,
    },
    quests: {
      daily: counts(daily.rows[0]),
      weekly: {
        assigned: w.assigned + c.assigned,
        completed: w.completed + c.completed,
        claimed: w.claimed + c.claimed,
      },
      season: counts(seasonQuests.rows[0]),
      rerolls: {
        playerDays: num(rerolls.rows[0]?.player_days),
        rerollDays: num(rerolls.rows[0]?.reroll_days),
        rerolls: num(rerolls.rows[0]?.rerolls),
      },
      byKind: byKind.rows.map((row) => ({
        kind: row.kind,
        assigned: num(row.assigned),
        completed: num(row.completed),
      })),
    },
    achievements: {
      unlocked: kpi(unlockedTotal, num(unlockedPrev.rows[0]?.n), baseline),
      daily: densify(list, unlockedMap),
      top: top.rows.map((row) => ({
        id: row.achievement_id,
        name: getAchievement(row.achievement_id)?.name ?? row.achievement_id,
        holders: num(row.holders),
        unlockedInWindow: inWindowBy.get(row.achievement_id) ?? 0,
      })),
    },
  };
}

export function getProgressionMetrics(days: number): Promise<ProgressionMetrics> {
  const window = parseWindow(days);
  return cached('progression', window, () => load(window));
}
