// ───────────────────────────────────────────────────────────────────────────
// RETIRED. Season 0 was restarted on the new card (key `season-0-r2`) instead of
// closing, so this job is not run and nothing imports it. The old season 0's
// unclaimed tiers and quests are not paid. The file stays as the record of how
// a close worked; scripts/close-season-0.ts refuses to run it by default.
//
// Closing season 0 (PROGRESSION.md, "Closing season 0").
//
// At 00:00 UTC on SEASON_0_END, for every player with a season 0 row, the job
// grants only what the player could still claim in the app at the close:
//   1. season quests and weekly quests at their goal (unlocked weeks stay open
//      all season), and the final day's dailies at their goal;
//   2. every reached tier on both tracks with no claim row, after the quests,
//      because a quest's XP can reach another tier;
//   3. every other quest is closed with no payout: the unfinished ones, and the
//      earlier days' dailies that expired unclaimed (the app only ever lets a
//      player claim today's daily, so paying them would be a windfall).
//
// Season 1 starts the day season 0 closes, so every claim passes `season-0`
// explicitly and the job gives the same result before or after the cutover.
//
// Every grant goes through the existing claim paths (claimQuest,
// claimWeeklyQuest, claimSeasonQuest, claimTierReward). Their claim rows and
// the ledger's unique (user, currency, source type, source id) make each grant
// happen once, so a second run finds nothing to grant. Rows are never deleted:
// a closed quest keeps its row and gets `closed_at` (migration 0053) and
// `claimed = TRUE`, which stops every claim and progress path from touching it.
//
// Dailies are season-less rows keyed by day. The final day is the day that
// holds the last millisecond of season 0; dailies on later days belong to the
// next season and are left alone.
//
// planSeason0Close reads and writes nothing. runSeason0Close grants.
// scripts/close-season-0.ts is the command line.
// ───────────────────────────────────────────────────────────────────────────

import { query } from '@/server/db/client';
import { levelFromXp, levelMilestoneReward } from '@/server/arcade/levels';
import { getServerDateKey } from '@/server/arcade/rewards/helpers';

import {
  claimQuest,
  claimSeasonQuest,
  claimTierReward,
  claimWeeklyQuest,
} from './index';
import {
  MAX_TIER,
  SEASON_0_END,
  SEASON_0_ITEMS,
  SEASON_0_TIERS,
  SEASON_KEY,
  getTierFromXp,
} from './season-0';

export type QuestKind = 'daily' | 'weekly' | 'season';
export type Track = 'free' | 'premium';

export type PlannedQuest = {
  kind: QuestKind;
  /** The date key for a daily, the week number for a weekly, absent for a season quest. */
  ref: string | null;
  slotIndex: number;
  questKey: string;
  tickets: number;
  xp: number;
};

export type PlannedTier = {
  tier: number;
  track: Track;
  tickets: number;
  itemId: string | null;
};

export type PlayerClose = {
  userId: string;
  username: string | null;
  seasonXpBefore: number;
  seasonXpAfter: number;
  tierBefore: number;
  tierAfter: number;
  /** All tickets the close pays this player: tiers, quests and level milestones. */
  tickets: number;
  /** Part of `tickets`: level milestones the quest XP reaches (a quest claim also adds account XP). */
  levelTickets: number;
  xp: number;
  /** Items the player does not own yet. */
  items: string[];
  quests: PlannedQuest[];
  tiers: PlannedTier[];
  /** Quests closed with no payout, by kind: unfinished ones and expired dailies. */
  closed: Record<QuestKind, number>;
  /** Finished dailies from before the final day, closed unpaid. Part of `closed.daily`. */
  expiredDailies: number;
};

export type CloseTotals = {
  /** Players with a season 0 row. */
  players: number;
  /** Players who get something or have a quest closed. */
  playersAffected: number;
  playersGranted: number;
  tickets: number;
  ticketsFromTiers: number;
  ticketsFromQuests: number;
  /** Level milestone tickets paid because claiming quests adds account XP. */
  ticketsFromLevels: number;
  /** Season XP from the quests claimed. */
  xp: number;
  tiers: number;
  items: number;
  itemsById: Record<string, number>;
  questsClaimed: Record<QuestKind, number>;
  questsClosed: Record<QuestKind, number>;
  /** Finished dailies from before the final day, closed unpaid. Part of `questsClosed.daily`. */
  expiredDailies: number;
};

export type CloseReport = {
  mode: 'dry-run' | 'run';
  seasonKey: string;
  endsAt: string;
  /** The last day of season 0. Only its dailies are claimed; earlier days' are closed. */
  finalDayKey: string;
  generatedAt: string;
  totals: CloseTotals;
  /** Only players with a grant or a closed quest. */
  players: PlayerClose[];
  /** Real run only: claims that failed for a reason other than "already claimed". */
  failures: { userId: string; step: string; error: string }[];
};

const zeroKinds = (): Record<QuestKind, number> => ({ daily: 0, weekly: 0, season: 0 });

/** The last day of season 0 as a date key: the day that holds its last millisecond. */
export const seasonFinalDayKey = (): string => getServerDateKey(new Date(SEASON_0_END.getTime() - 1));

const TIER_BY_NUMBER = new Map(SEASON_0_TIERS.map((t) => [t.tier, t]));
const SEASON_ITEM_IDS = SEASON_0_ITEMS.map((i) => i.id);
/** Season 0 gives everyone both tracks. */
const TRACKS: Track[] = ['free', 'premium'];

const tierReward = (tier: number, track: Track): PlannedTier => {
  const def = TIER_BY_NUMBER.get(tier)!;
  const reward = track === 'free' ? def.free : def.premium;
  return reward.kind === 'tickets'
    ? { tier, track, tickets: reward.amount, itemId: null }
    : { tier, track, tickets: 0, itemId: reward.itemId };
};

type FinishedRow = {
  user_id: string;
  ref: string | null;
  slot_index: number;
  quest_key: string;
  reward_xp: number;
  reward_tickets: number;
};

const loadPlayers = async (finalDay: string) =>
  (
    await query<{ user_id: string; username: string | null }>(
      `SELECT p.user_id, a.username
         FROM (
           SELECT user_id FROM user_season_progress WHERE season_key = $1
           UNION SELECT user_id FROM user_season_quests WHERE season_key = $1
           UNION SELECT user_id FROM user_weekly_quests
           UNION SELECT user_id FROM user_daily_quests WHERE date_key <= $2
         ) p
         LEFT JOIN arcade_accounts a ON a.id = p.user_id
        ORDER BY p.user_id`,
      [SEASON_KEY, finalDay],
    )
  ).rows;

const loadFinished = async (finalDay: string, userId?: string): Promise<(FinishedRow & { kind: QuestKind })[]> => {
  const cols = 'user_id, slot_index, quest_key, reward_xp, reward_tickets';
  const daily = await query<FinishedRow>(
    `SELECT ${cols}, date_key AS ref FROM user_daily_quests
      WHERE claimed = FALSE AND progress >= goal AND date_key = $1${userId ? ' AND user_id = $2' : ''}`,
    userId ? [finalDay, userId] : [finalDay],
  );
  const weekly = await query<FinishedRow>(
    `SELECT ${cols}, week::text AS ref FROM user_weekly_quests
      WHERE claimed = FALSE AND progress >= goal${userId ? ' AND user_id = $1' : ''}`,
    userId ? [userId] : [],
  );
  const season = await query<FinishedRow>(
    `SELECT ${cols}, NULL::text AS ref FROM user_season_quests
      WHERE claimed = FALSE AND progress >= goal AND season_key = $1${userId ? ' AND user_id = $2' : ''}`,
    userId ? [SEASON_KEY, userId] : [SEASON_KEY],
  );
  return [
    ...daily.rows.map((r) => ({ ...r, kind: 'daily' as const })),
    ...weekly.rows.map((r) => ({ ...r, kind: 'weekly' as const })),
    ...season.rows.map((r) => ({ ...r, kind: 'season' as const })),
  ];
};

const loadUnfinishedCounts = async (finalDay: string) => {
  const out = new Map<string, Record<QuestKind, number>>();
  const add = (userId: string, kind: QuestKind, n: number) => {
    const row = out.get(userId) ?? zeroKinds();
    row[kind] += n;
    out.set(userId, row);
  };
  const run = async (kind: QuestKind, sql: string, params: unknown[]) => {
    for (const r of (await query<{ user_id: string; n: string }>(sql, params)).rows) {
      add(r.user_id, kind, Number(r.n));
    }
  };
  await run(
    'daily',
    `SELECT user_id, count(*) AS n FROM user_daily_quests
      WHERE claimed = FALSE AND (date_key < $1 OR (date_key = $1 AND progress < goal)) GROUP BY user_id`,
    [finalDay],
  );
  await run(
    'weekly',
    `SELECT user_id, count(*) AS n FROM user_weekly_quests
      WHERE claimed = FALSE AND progress < goal GROUP BY user_id`,
    [],
  );
  await run(
    'season',
    `SELECT user_id, count(*) AS n FROM user_season_quests
      WHERE claimed = FALSE AND progress < goal AND season_key = $1 GROUP BY user_id`,
    [SEASON_KEY],
  );
  return out;
};

/** Finished dailies from before the final day that nobody claimed: closed unpaid. */
const loadExpiredDailies = async (finalDay: string, userId?: string) =>
  new Map(
    (
      await query<{ user_id: string; n: string }>(
        `SELECT user_id, count(*) AS n FROM user_daily_quests
          WHERE claimed = FALSE AND progress >= goal AND date_key < $1${userId ? ' AND user_id = $2' : ''}
          GROUP BY user_id`,
        userId ? [finalDay, userId] : [finalDay],
      )
    ).rows.map((r) => [r.user_id, Number(r.n)]),
  );

const loadSeasonXp = async (userId?: string) =>
  new Map(
    (
      await query<{ user_id: string; xp: number }>(
        `SELECT user_id, xp FROM user_season_progress WHERE season_key = $1${userId ? ' AND user_id = $2' : ''}`,
        userId ? [SEASON_KEY, userId] : [SEASON_KEY],
      )
    ).rows.map((r) => [r.user_id, Number(r.xp)]),
  );

const loadTierClaims = async (userId?: string) => {
  const out = new Map<string, Set<string>>();
  for (const r of (
    await query<{ user_id: string; tier: number; track: string }>(
      `SELECT user_id, tier, track FROM user_season_claims WHERE season_key = $1${userId ? ' AND user_id = $2' : ''}`,
      userId ? [SEASON_KEY, userId] : [SEASON_KEY],
    )
  ).rows) {
    const set = out.get(r.user_id) ?? new Set<string>();
    set.add(`${r.tier}:${r.track}`);
    out.set(r.user_id, set);
  }
  return out;
};

const loadAccountXp = async (userId?: string) =>
  new Map(
    (
      await query<{ user_id: string; xp: string | number; level_floor: number }>(
        `SELECT user_id, xp, level_floor FROM user_account_xp${userId ? ' WHERE user_id = $1' : ''}`,
        userId ? [userId] : [],
      )
    ).rows.map((r) => [r.user_id, { xp: Number(r.xp), floor: Number(r.level_floor) }]),
  );

const loadLevelClaims = async () => {
  const out = new Map<string, Set<number>>();
  for (const r of (await query<{ user_id: string; level: number }>(`SELECT user_id, level FROM user_level_reward_claims`)).rows) {
    const set = out.get(r.user_id) ?? new Set<number>();
    set.add(Number(r.level));
    out.set(r.user_id, set);
  }
  return out;
};

/**
 * Claiming a quest adds its XP to the account, and a level-up pays milestone
 * tickets (the same as a claim by hand). The last quest claim that adds XP
 * settles every unpaid milestone up to the final level.
 */
const levelTicketsFor = (
  account: { xp: number; floor: number } | undefined,
  questXp: number,
  paidLevels: Set<number> | undefined,
): number => {
  if (questXp <= 0) return 0;
  const xp = account?.xp ?? 0;
  const afterLevel = levelFromXp(xp + questXp, Math.max(account?.floor ?? 1, levelFromXp(xp, account?.floor ?? 1)));
  let tickets = 0;
  for (let level = 5; level <= afterLevel; level += 5) {
    if (!paidLevels?.has(level)) tickets += levelMilestoneReward(level);
  }
  return tickets;
};

const levelLedgerSum = async (userId: string) =>
  Number(
    (
      await query<{ sum: string }>(
        `SELECT COALESCE(SUM(amount), 0) AS sum FROM currency_ledger WHERE user_id = $1 AND source_type = 'level_reward'`,
        [userId],
      )
    ).rows[0]!.sum,
  );

const loadOwnedSeasonItems = async (userId?: string) => {
  const out = new Map<string, Set<string>>();
  for (const r of (
    await query<{ user_id: string; item_id: string }>(
      `SELECT user_id, item_id FROM user_owned_items WHERE item_id = ANY($1::text[])${userId ? ' AND user_id = $2' : ''}`,
      userId ? [SEASON_ITEM_IDS, userId] : [SEASON_ITEM_IDS],
    )
  ).rows) {
    const set = out.get(r.user_id) ?? new Set<string>();
    set.add(r.item_id);
    out.set(r.user_id, set);
  }
  return out;
};

const tiersToClaim = (xp: number, claimed: Set<string> | undefined): PlannedTier[] => {
  const reached = Math.min(MAX_TIER, getTierFromXp(xp));
  const out: PlannedTier[] = [];
  for (let tier = 1; tier <= reached; tier += 1) {
    for (const track of TRACKS) {
      if (!claimed?.has(`${tier}:${track}`)) out.push(tierReward(tier, track));
    }
  }
  return out;
};

const emptyTotals = (): CloseTotals => ({
  players: 0,
  playersAffected: 0,
  playersGranted: 0,
  tickets: 0,
  ticketsFromTiers: 0,
  ticketsFromQuests: 0,
  ticketsFromLevels: 0,
  xp: 0,
  tiers: 0,
  items: 0,
  itemsById: {},
  questsClaimed: zeroKinds(),
  questsClosed: zeroKinds(),
  expiredDailies: 0,
});

const addPlayerToTotals = (totals: CloseTotals, p: PlayerClose) => {
  const closedAny = p.closed.daily + p.closed.weekly + p.closed.season > 0;
  const granted = p.quests.length > 0 || p.tiers.length > 0;
  if (granted || closedAny) totals.playersAffected += 1;
  if (granted) totals.playersGranted += 1;
  totals.tickets += p.tickets;
  totals.xp += p.xp;
  totals.tiers += p.tiers.length;
  totals.items += p.items.length;
  for (const id of p.items) totals.itemsById[id] = (totals.itemsById[id] ?? 0) + 1;
  for (const q of p.quests) {
    totals.questsClaimed[q.kind] += 1;
    totals.ticketsFromQuests += q.tickets;
  }
  for (const t of p.tiers) totals.ticketsFromTiers += t.tickets;
  totals.ticketsFromLevels += p.levelTickets;
  for (const kind of ['daily', 'weekly', 'season'] as const) totals.questsClosed[kind] += p.closed[kind];
  totals.expiredDailies += p.expiredDailies;
};

const finish = (
  mode: CloseReport['mode'],
  finalDay: string,
  players: PlayerClose[],
  playerCount: number,
  failures: CloseReport['failures'],
): CloseReport => {
  const totals = emptyTotals();
  totals.players = playerCount;
  for (const p of players) addPlayerToTotals(totals, p);
  return {
    mode,
    seasonKey: SEASON_KEY,
    endsAt: SEASON_0_END.toISOString(),
    finalDayKey: finalDay,
    generatedAt: new Date().toISOString(),
    totals,
    players: players.filter((p) => p.quests.length > 0 || p.tiers.length > 0 || p.closed.daily + p.closed.weekly + p.closed.season > 0),
    failures,
  };
};

const toPlannedQuest = (r: FinishedRow & { kind: QuestKind }): PlannedQuest => ({
  kind: r.kind,
  ref: r.ref,
  slotIndex: Number(r.slot_index),
  questKey: r.quest_key,
  tickets: Number(r.reward_tickets ?? 0),
  xp: Number(r.reward_xp ?? 0),
});

/** What the close would grant and close. Reads only. */
export const planSeason0Close = async (): Promise<CloseReport> => {
  const finalDay = seasonFinalDayKey();
  const [players, finished, unfinished, expired, xpByUser, claimsByUser, ownedByUser, accounts, levelClaims] = await Promise.all([
    loadPlayers(finalDay),
    loadFinished(finalDay),
    loadUnfinishedCounts(finalDay),
    loadExpiredDailies(finalDay),
    loadSeasonXp(),
    loadTierClaims(),
    loadOwnedSeasonItems(),
    loadAccountXp(),
    loadLevelClaims(),
  ]);
  const finishedByUser = new Map<string, PlannedQuest[]>();
  for (const r of finished) {
    const list = finishedByUser.get(r.user_id) ?? [];
    list.push(toPlannedQuest(r));
    finishedByUser.set(r.user_id, list);
  }

  const out: PlayerClose[] = players.map(({ user_id: userId, username }) => {
    const quests = finishedByUser.get(userId) ?? [];
    const before = xpByUser.get(userId) ?? 0;
    const questXp = quests.reduce((sum, q) => sum + q.xp, 0);
    const after = before + questXp;
    const tiers = tiersToClaim(after, claimsByUser.get(userId));
    const owned = ownedByUser.get(userId) ?? new Set<string>();
    const levelTickets = levelTicketsFor(accounts.get(userId), questXp, levelClaims.get(userId));
    const items = [...new Set(tiers.flatMap((t) => (t.itemId && !owned.has(t.itemId) ? [t.itemId] : [])))];
    return {
      userId,
      username,
      seasonXpBefore: before,
      seasonXpAfter: after,
      tierBefore: getTierFromXp(before),
      tierAfter: getTierFromXp(after),
      tickets: quests.reduce((s, q) => s + q.tickets, 0) + tiers.reduce((s, t) => s + t.tickets, 0) + levelTickets,
      levelTickets,
      xp: questXp,
      items,
      quests,
      tiers,
      closed: unfinished.get(userId) ?? zeroKinds(),
      expiredDailies: expired.get(userId) ?? 0,
    };
  });
  return finish('dry-run', finalDay, out, players.length, []);
};

const isAlreadyClaimed = (error: unknown) =>
  error instanceof Error && /already claimed/i.test(error.message);

const closeUnclaimedForUser = async (userId: string, finalDay: string): Promise<Record<QuestKind, number>> => {
  const at = Date.now();
  const daily = await query(
    `UPDATE user_daily_quests SET claimed = TRUE, closed_at = $3
      WHERE user_id = $1 AND claimed = FALSE AND (date_key < $2 OR (date_key = $2 AND progress < goal))`,
    [userId, finalDay, at],
  );
  const weekly = await query(
    `UPDATE user_weekly_quests SET claimed = TRUE, closed_at = $2
      WHERE user_id = $1 AND claimed = FALSE AND progress < goal`,
    [userId, at],
  );
  const season = await query(
    `UPDATE user_season_quests SET claimed = TRUE, closed_at = $3
      WHERE user_id = $1 AND season_key = $2 AND claimed = FALSE AND progress < goal`,
    [userId, SEASON_KEY, at],
  );
  return { daily: daily.rowCount ?? 0, weekly: weekly.rowCount ?? 0, season: season.rowCount ?? 0 };
};

/**
 * Grants and closes. Safe to run again, and safe while players claim by hand:
 * each claim locks its row and the ledger dedupes on its source id. A player
 * is handled in separate claims, so a crash part-way is finished by the next run.
 */
export const runSeason0Close = async (): Promise<CloseReport> => {
  const finalDay = seasonFinalDayKey();
  const players = await loadPlayers(finalDay);
  const failures: CloseReport['failures'] = [];
  const out: PlayerClose[] = [];

  for (const { user_id: userId, username } of players) {
    const ownedBefore = (await loadOwnedSeasonItems(userId)).get(userId) ?? new Set<string>();
    const xpBefore = (await loadSeasonXp(userId)).get(userId) ?? 0;
    const levelLedgerBefore = await levelLedgerSum(userId);
    const quests: PlannedQuest[] = [];
    const tiers: PlannedTier[] = [];

    for (const q of await loadFinished(finalDay, userId)) {
      try {
        const slot = Number(q.slot_index);
        const paid =
          q.kind === 'daily'
            ? await claimQuest(userId, slot, q.ref!, SEASON_KEY)
            : q.kind === 'weekly'
              ? await claimWeeklyQuest(userId, Number(q.ref), slot, SEASON_KEY)
              : await claimSeasonQuest(userId, slot, SEASON_KEY);
        quests.push({ ...toPlannedQuest(q), tickets: paid.rewardTickets, xp: paid.rewardXp });
      } catch (error) {
        if (!isAlreadyClaimed(error)) {
          failures.push({ userId, step: `${q.kind} quest ${q.ref ?? ''}#${q.slot_index}`, error: String(error) });
        }
      }
    }

    const xpNow = (await loadSeasonXp(userId)).get(userId) ?? 0;
    const claimed = (await loadTierClaims(userId)).get(userId);
    for (const t of tiersToClaim(xpNow, claimed)) {
      try {
        await claimTierReward(userId, t.tier, t.track, SEASON_KEY);
        tiers.push(t);
      } catch (error) {
        if (!/already claimed/i.test(String(error))) {
          failures.push({ userId, step: `tier ${t.tier} ${t.track}`, error: String(error) });
        }
      }
    }

    const levelTickets = (await levelLedgerSum(userId)) - levelLedgerBefore;
    const expiredDailies = (await loadExpiredDailies(finalDay, userId)).get(userId) ?? 0;
    const closed = await closeUnclaimedForUser(userId, finalDay);
    const xpAfter = (await loadSeasonXp(userId)).get(userId) ?? 0;
    const ownedAfter = (await loadOwnedSeasonItems(userId)).get(userId) ?? new Set<string>();
    out.push({
      userId,
      username,
      seasonXpBefore: xpBefore,
      seasonXpAfter: xpAfter,
      tierBefore: getTierFromXp(xpBefore),
      tierAfter: getTierFromXp(xpAfter),
      tickets: quests.reduce((s, q) => s + q.tickets, 0) + tiers.reduce((s, t) => s + t.tickets, 0) + levelTickets,
      levelTickets,
      xp: quests.reduce((s, q) => s + q.xp, 0),
      items: [...ownedAfter].filter((id) => !ownedBefore.has(id)),
      quests,
      tiers,
      closed,
      expiredDailies,
    });
  }
  return finish('run', finalDay, out, players.length, failures);
};
