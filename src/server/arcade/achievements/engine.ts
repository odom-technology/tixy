// Achievement evaluation engine. Event-driven: a reverse index (stat key ->
// achievement ids) lets a stat change re-check only the handful of achievements
// that key feeds. Unlocking grants flat account XP, an optional cosmetic, an
// activity-feed event, and bumps the global rarity counter — all best-effort so
// one failed grant never blocks the others.
import { renameGameNamesInText } from '@/features/arcade/lib/game-renames';
import { query, queryOne } from '@/server/db/client';
import { grantXp } from '@/server/arcade/levels';
import { getServerDateKey } from '@/server/arcade/rewards/helpers';
import { grantStoreItem } from '@/server/arcade/rewards/store';
import { recordActivityEvent } from '@/server/services/activity-events';
import { applyStatDeltas, getUserStats } from '@/server/arcade/stats/record';
import { add, max, GLOBAL } from '@/server/arcade/stats/stat-keys';
import {
  ACHIEVEMENTS,
  ACHIEVEMENTS_BY_ID,
  getAchievement,
  isRetiredAchievement,
} from './registry';
import { SECRET_ICON } from './badges';
import { allPlayedKeys, groupComplete, groupProgress } from './floor-groups';
import type {
  AchievementCondition,
  AchievementDef,
  AchievementView,
  StatComparator,
  UnlockResult,
} from './types';

const COMPLETIONIST_ID = 'secret-completionist';

const NON_SECRET_IDS = ACHIEVEMENTS.filter((a) => a.category !== 'secret').map((a) => a.id);

// stat key -> achievement ids that reference it.
let REVERSE_INDEX: Map<string, Set<string>> | null = null;
function reverseIndex(): Map<string, Set<string>> {
  if (REVERSE_INDEX) return REVERSE_INDEX;
  const index = new Map<string, Set<string>>();
  for (const def of ACHIEVEMENTS) {
    const keys = def.floorGroup ? allPlayedKeys() : conditionStats(def.condition);
    for (const stat of keys) {
      let set = index.get(stat);
      if (!set) index.set(stat, (set = new Set()));
      set.add(def.id);
    }
  }
  REVERSE_INDEX = index;
  return index;
}

function conditionStats(cond: AchievementCondition): string[] {
  return 'all' in cond ? cond.all.map((c) => c.stat) : [cond.stat];
}

function comparatorOk(cmp: StatComparator, stats: Map<string, number>): boolean {
  const has = stats.has(cmp.stat);
  const value = stats.get(cmp.stat) ?? 0;
  if (cmp.gte !== undefined) return value >= cmp.gte;
  if (cmp.lte !== undefined) return has && value <= cmp.lte;
  if (cmp.eq !== undefined) return has && value === cmp.eq;
  return false;
}

function conditionOk(cond: AchievementCondition, stats: Map<string, number>): boolean {
  return 'all' in cond ? cond.all.every((c) => comparatorOk(c, stats)) : comparatorOk(cond, stats);
}

function collectCandidates(keys: Iterable<string>): Set<string> {
  const index = reverseIndex();
  const out = new Set<string>();
  for (const key of keys) {
    const ids = index.get(key);
    if (ids) ids.forEach((id) => out.add(id));
  }
  return out;
}

/**
 * Evaluate achievements for a user. With `changedKeys`, only achievements those
 * keys feed are re-checked; without, the whole catalog is scanned (backfill /
 * page-load safety net). Cascades a few passes so meta achievements ("unlock 10
 * achievements") can fire off the same call.
 */
export async function evaluateAchievements(
  userId: string,
  changedKeys?: Set<string> | Iterable<string>,
): Promise<UnlockResult[]> {
  if (!userId) return [];
  const results: UnlockResult[] = [];
  let candidates = changedKeys
    ? collectCandidates(changedKeys)
    : new Set(ACHIEVEMENTS.map((a) => a.id));
  // The completionist check is not stat-driven; reconsider it whenever anything
  // changed.
  candidates.add(COMPLETIONIST_ID);

  for (let pass = 0; pass < 8 && candidates.size > 0; pass++) {
    const newly = await tryUnlock(userId, candidates);
    if (newly.length === 0) break;
    results.push(...newly);

    const deltas = [add(GLOBAL.achievementsUnlocked, newly.length)];
    const secretCount = newly.filter((n) => n.category === 'secret').length;
    if (secretCount > 0) deltas.push(add(GLOBAL.secretsFound, secretCount));
    const changed = await applyStatDeltas(userId, deltas);
    candidates = collectCandidates(changed);
    candidates.add(COMPLETIONIST_ID);
  }
  return results;
}

async function tryUnlock(userId: string, candidateIds: Set<string>): Promise<UnlockResult[]> {
  const ids = [...candidateIds].filter((id) => ACHIEVEMENTS_BY_ID.has(id));
  if (ids.length === 0) return [];

  const existing = await query<{ achievement_id: string }>(
    `SELECT achievement_id FROM user_achievements WHERE user_id = $1 AND achievement_id = ANY($2)`,
    [userId, ids],
  );
  const have = new Set(existing.rows.map((r) => r.achievement_id));
  const pending = ids.filter((id) => !have.has(id));
  if (pending.length === 0) return [];

  // Read every stat the pending conditions need, in one query.
  const statKeys = new Set<string>();
  for (const id of pending) {
    if (id === COMPLETIONIST_ID) continue;
    const def = getAchievement(id)!;
    if (def.floorGroup) allPlayedKeys().forEach((s) => statKeys.add(s));
    else conditionStats(def.condition).forEach((s) => statKeys.add(s));
  }
  const stats = statKeys.size > 0 ? await getUserStats(userId, [...statKeys]) : new Map<string, number>();

  const toUnlock: AchievementDef[] = [];
  for (const id of pending) {
    const def = getAchievement(id)!;
    if (id === COMPLETIONIST_ID) {
      if (await isCompletionistComplete(userId)) toUnlock.push(def);
    } else if (def.floorGroup) {
      if (groupComplete(def.floorGroup, stats)) toUnlock.push(def);
    } else if (conditionOk(def.condition, stats)) {
      toUnlock.push(def);
    }
  }

  const results: UnlockResult[] = [];
  for (const def of toUnlock) {
    const result = await unlockOne(userId, def);
    if (result) results.push(result);
  }
  return results;
}

async function isCompletionistComplete(userId: string): Promise<boolean> {
  const row = await queryOne<{ c: string }>(
    `SELECT COUNT(*)::int AS c FROM user_achievements WHERE user_id = $1 AND achievement_id = ANY($2)`,
    [userId, NON_SECRET_IDS],
  );
  return Number(row?.c ?? 0) >= NON_SECRET_IDS.length;
}

async function unlockOne(userId: string, def: AchievementDef): Promise<UnlockResult | null> {
  // Idempotent insert — a concurrent evaluation may have just unlocked it.
  const inserted = await queryOne<{ achievement_id: string }>(
    `INSERT INTO user_achievements (user_id, achievement_id, tier, unlocked_at, xp_awarded, seen)
     VALUES ($1, $2, $3, $4, $5, FALSE)
     ON CONFLICT (user_id, achievement_id) DO NOTHING
     RETURNING achievement_id`,
    [userId, def.id, def.tier, Date.now(), def.xp],
  );
  if (!inserted) return null;

  await query(
    `INSERT INTO achievement_unlock_counts (achievement_id, count)
     VALUES ($1, 1)
     ON CONFLICT (achievement_id) DO UPDATE SET count = achievement_unlock_counts.count + 1`,
    [def.id],
  ).catch(() => {});

  if (def.xp > 0) {
    try {
      const xpResult = await grantXp(userId, def.xp, 'achievement', getServerDateKey());
      // Keep the level stat fresh so level-gated achievements (Centurion) can
      // fire off achievement XP too.
      await applyStatDeltas(userId, [max(GLOBAL.level, xpResult.after.level)]);
    } catch (error) {
      console.error('[achievements] grantXp failed:', error);
    }
  }

  if (def.cosmeticId) {
    try {
      await grantStoreItem({
        itemId: def.cosmeticId,
        userId,
        grantToAll: false,
        actorUserId: userId,
        acquiredSource: 'achievement',
      });
      await applyStatDeltas(userId, [add(GLOBAL.cosmeticsOwned, 1)]);
    } catch (error) {
      console.error(`[achievements] grantStoreItem(${def.cosmeticId}) failed:`, error);
    }
  }

  try {
    await recordActivityEvent({
      userId,
      type: 'achievement',
      payload: { achievementId: def.id, title: def.name, rarity: def.rarity },
    });
  } catch {
    /* recordActivityEvent never throws, but guard anyway */
  }

  return {
    id: def.id,
    name: renameGameNamesInText(def.name),
    description: renameGameNamesInText(def.description),
    icon: def.icon,
    rarity: def.rarity,
    category: def.category,
    tier: def.tier,
    tierLabel: def.tierLabel,
    xp: def.xp,
    cosmeticId: def.cosmeticId,
  };
}

// ── Read model for the achievements page + profile ──────────────────────────

function primaryComparator(cond: AchievementCondition): StatComparator {
  return 'all' in cond ? cond.all[0] : cond;
}

function progressFor(cmp: StatComparator, value: number): { progress: number; current: number; target: number } {
  if (cmp.gte !== undefined) {
    const target = cmp.gte;
    return { progress: Math.max(0, Math.min(1, target > 0 ? value / target : 1)), current: value, target };
  }
  if (cmp.lte !== undefined) {
    const target = cmp.lte;
    // Lower is better: 0 (never set) => no progress; once set, closer as it shrinks.
    const progress = value > 0 ? Math.max(0, Math.min(1, target / value)) : 0;
    return { progress, current: value, target };
  }
  if (cmp.eq !== undefined) return { progress: 0, current: value, target: cmp.eq };
  return { progress: 0, current: value, target: 0 };
}

export type AchievementsSummary = {
  /** Listed achievements. Retired ones are not counted. */
  total: number;
  /** Listed achievements the player has. */
  unlocked: number;
  /** Account XP from every unlock, retired ones included. */
  xpEarned: number;
  byRarity: Record<string, { total: number; unlocked: number }>;
};

export type AchievementsForUser = {
  summary: AchievementsSummary;
  /** The listed catalog: everything that is on the floor, locked or not. */
  achievements: AchievementView[];
  /** Retired achievements this player earned, newest first. Never listed to anyone else. */
  retired: AchievementView[];
};

/**
 * The listed catalog merged with the user's unlocks + live progress + global
 * rarity, and the retired achievements the user earned. A retired achievement
 * is never listed to a player who doesn't have it; holders keep it, its XP and
 * its item. Hidden (secret) achievements that are still locked are redacted to
 * "???".
 */
export async function getAchievementsForUser(userId: string): Promise<AchievementsForUser> {
  const [unlockedRows, stats, countRows, totalRow] = await Promise.all([
    query<{ achievement_id: string; unlocked_at: string }>(
      `SELECT achievement_id, unlocked_at FROM user_achievements WHERE user_id = $1`,
      [userId],
    ),
    getUserStats(userId),
    query<{ achievement_id: string; count: string }>(`SELECT achievement_id, count FROM achievement_unlock_counts`),
    queryOne<{ c: string }>(`SELECT COUNT(*)::int AS c FROM user_account_xp`),
  ]);

  const unlockedAt = new Map(unlockedRows.rows.map((r) => [r.achievement_id, Number(r.unlocked_at)]));
  const counts = new Map(countRows.rows.map((r) => [r.achievement_id, Number(r.count)]));
  const totalPlayers = Math.max(1, Number(totalRow?.c ?? 1));

  const byRarity: AchievementsSummary['byRarity'] = {};
  let unlockedCount = 0;
  let xpEarned = 0;

  const views: AchievementView[] = ACHIEVEMENTS.map((def) => {
    const unlocked = unlockedAt.has(def.id);
    const retired = isRetiredAchievement(def);
    const cmp = primaryComparator(def.condition);
    let { progress, current, target } = progressFor(cmp, stats.get(cmp.stat) ?? 0);
    if (def.floorGroup) {
      const group = groupProgress(def.floorGroup, stats);
      current = group.played;
      target = group.total;
      progress = group.total > 0 ? group.played / group.total : 0;
    }

    if (unlocked) xpEarned += def.xp;
    if (!retired) {
      byRarity[def.rarity] ??= { total: 0, unlocked: 0 };
      byRarity[def.rarity].total += 1;
      if (unlocked) {
        byRarity[def.rarity].unlocked += 1;
        unlockedCount += 1;
      }
    }

    const redacted = def.hidden && !unlocked;
    return {
      id: def.id,
      seriesId: def.seriesId,
      seriesName: def.seriesId ? renameGameNamesInText(def.name.replace(/ \d+$/, '')) : undefined,
      game: def.game,
      tier: def.tier,
      tierLabel: def.tierLabel,
      name: redacted ? '???' : renameGameNamesInText(def.name),
      description: redacted ? def.hint ?? 'A secret achievement. Keep playing to discover it.' : renameGameNamesInText(def.description),
      hint: def.hint,
      category: def.category,
      hidden: def.hidden,
      rarity: def.rarity,
      xp: def.xp,
      cosmeticId: redacted ? undefined : def.cosmeticId,
      icon: redacted ? SECRET_ICON : def.icon,
      unlocked,
      unlockedAt: unlockedAt.get(def.id) ?? null,
      retired,
      progress: unlocked ? 1 : redacted ? 0 : progress,
      current: redacted ? 0 : current,
      target: redacted ? 0 : target,
      globalRate: (counts.get(def.id) ?? 0) / totalPlayers,
    };
  });

  const listed = views.filter((v) => !v.retired);
  const retiredHeld = views
    .filter((v) => v.retired && v.unlocked)
    .sort((a, b) => (b.unlockedAt ?? 0) - (a.unlockedAt ?? 0));

  return {
    summary: {
      total: listed.length,
      unlocked: unlockedCount,
      xpEarned,
      byRarity,
    },
    achievements: listed,
    retired: retiredHeld,
  };
}

export type ProfileAchievements = {
  unlocked: number;
  total: number;
  pct: number;
  /** Player-pinned achievements, in their chosen order (unlocked only). */
  featured: AchievementView[];
  /** Most recently unlocked (for a "recent" strip). */
  recent: AchievementView[];
  /** Retired achievements the player earned, newest first, each with its date. */
  retired: AchievementView[];
};

/**
 * Compact achievement view for a profile: completion %, the player's featured
 * picks (or, if none, their rarest unlocked), and recent unlocks. `featuredIds`
 * comes from the profile details JSON.
 */
export async function getProfileAchievements(
  userId: string,
  featuredIds: string[],
): Promise<ProfileAchievements> {
  const { summary, achievements, retired } = await getAchievementsForUser(userId);
  // Featured picks and the recent strip draw from everything earned, so a
  // retired achievement can stay pinned.
  const unlockedViews = [...achievements, ...retired].filter((a) => a.unlocked);
  const byId = new Map(unlockedViews.map((a) => [a.id, a]));

  let featured = featuredIds.map((id) => byId.get(id)).filter((a): a is AchievementView => Boolean(a));
  if (featured.length === 0) {
    // Fall back to the rarest unlocked (lowest global rate, then highest XP).
    featured = [...unlockedViews]
      .sort((a, b) => a.globalRate - b.globalRate || b.xp - a.xp)
      .slice(0, 3);
  }

  const recent = [...unlockedViews]
    .sort((a, b) => (b.unlockedAt ?? 0) - (a.unlockedAt ?? 0))
    .slice(0, 4);

  return {
    unlocked: summary.unlocked,
    total: summary.total,
    pct: summary.total > 0 ? Math.round((summary.unlocked / summary.total) * 100) : 0,
    featured,
    recent,
    retired,
  };
}

/** Mark a user's unlocked achievements as seen (clears the "new" badge). */
export async function markAchievementsSeen(userId: string): Promise<void> {
  await query(`UPDATE user_achievements SET seen = TRUE WHERE user_id = $1 AND seen = FALSE`, [userId]);
}

/** Count of unlocked-but-unseen achievements (for a nav badge). */
export async function countUnseenAchievements(userId: string): Promise<number> {
  const row = await queryOne<{ c: string }>(
    `SELECT COUNT(*)::int AS c FROM user_achievements WHERE user_id = $1 AND seen = FALSE`,
    [userId],
  );
  return Number(row?.c ?? 0);
}
