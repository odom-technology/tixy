// ───────────────────────────────────────────────────────────────────────────
// The season card + daily quests — server logic. The live season is the card,
// shown as "Season 0" under the key `season-0-r2` (seasons.ts).
//
// XP is one number (see levels/index.ts, grantXp): a skill run's ticket value
// before the daily cap, participation, quests and achievements. Every grant
// also lands on the current season's row here. Tier rewards and quest rewards
// are claimed explicitly; claiming grants tickets (via the currency ledger) or
// item ownership.
// ───────────────────────────────────────────────────────────────────────────

import { renameGameNamesInText } from '@/features/arcade/lib/game-renames';
import { playerItemName } from '@/features/arcade/lib/item-names';

import { query, queryOne, withTransaction } from '@/server/db/client';
import { getServerDateKey } from '@/server/arcade/rewards/helpers';
import {
  applyXp,
  finishXpGrant,
  grantXp,
  type AddAccountXpResult,
  type AppliedXp,
} from '@/server/arcade/levels';
import { mutateWalletAndLedgerForTransaction } from '@/server/arcade/rewards/wallet';
import {
  DAILY_QUEST_COUNT,
  DAILY_QUEST_REROLLS,
  SEASON_0_SEASON_QUESTS,
  SEASON_0_TOTAL_WEEKS,
  SEASON_0_WEEKLY_QUESTS,
  SEASON_KEY,
  getSeasonItem,
  getSeasonQuestTemplate,
  getWeeklyQuestTemplate,
  participationXpForGame,
  seasonWeekForDate,
  weekUnlockMs,
  type QuestTemplate,
  type SeasonReward,
} from './season-0';
import { getQuestTemplate, pickQuestKeys, pickRerollQuest } from './daily-quests';
import { currentSeason, seasonByKey, seasonTierFromXp, seasonTierProgress } from './seasons';
import { SEASON_CARD_ITEMS } from './season-card';
import { completeOffFloorQuestsForUser } from './complete-on-redirect';
import { isOnFloor } from '@/features/arcade/components/arcade-game-registry';
import {
  WEEK_MS,
  getWeeklyCardTemplate,
  weeklyCardQuests,
  weeklyCardWeek,
} from './weekly-card';

export type QuestView = {
  slotIndex: number;
  key: string;
  kind: string;
  label: string;
  targetGame: string | null;
  goal: number;
  progress: number;
  rewardXp: number;
  rewardTickets: number;
  claimed: boolean;
  complete: boolean;
  /** The game is off the floor: the quest was set complete and pays as normal. */
  offFloor: boolean;
};

export type WeeklyQuestView = QuestView & { week: number };

/** This week's card, and earlier cards' finished quests that are still unclaimed. */
export type WeeklyCardView = {
  week: number;
  totalWeeks: number;
  /** When this week's card closes to new progress. */
  endsAtMs: number;
  quests: WeeklyQuestView[];
  carryover: WeeklyQuestView[];
};

// Season quests: a fixed set, all unlocked at season start, keyed by slot_index.
// The UI contract is EXACT — this shape (no `complete` field; the UI derives it
// from progress >= goal) is what the season-pass widget builds against.
export type SeasonQuestView = {
  slotIndex: number;
  key: string;
  kind: string;
  targetGame: string | null;
  label: string;
  goal: number;
  progress: number;
  rewardXp: number;
  rewardTickets: number;
  claimed: boolean;
  offFloor: boolean;
};

/** Per-week unlock summary so the UI can render locked/future weeks + dates. */
export type WeekSummaryView = {
  week: number;
  unlocksAtMs: number;
  unlocked: boolean;
};

export type RewardView = {
  kind: 'tickets' | 'item';
  amount?: number;
  itemId?: string;
  name?: string;
  preview?: {
    id: string;
    name: string;
    gameType: string;
    slots: string[];
    assetRef: Record<string, unknown> | null;
  };
  /** An art kit file for the prize, drawn at 32 px. Absent for a game skin. */
  art?: string | null;
};

export type TierView = {
  tier: number;
  free: RewardView;
  /** A second reward on the same tier (tier 30's prize), or null. */
  premium: RewardView | null;
  unlocked: boolean;
  freeClaimed: boolean;
  premiumClaimed: boolean;
};

export type BattlepassState = {
  seasonKey: string;
  seasonName: string;
  xp: number;
  tier: number;
  maxTier: number;
  xpPerTier: number;
  bar: { into: number; need: number; atMax: boolean };
  tiers: TierView[];
  quests: QuestView[];
  rerollsLeft: number;
  weeklyQuests: WeeklyQuestView[];
  currentWeek: number;
  totalWeeks: number;
  weeks: WeekSummaryView[];
  seasonQuests: SeasonQuestView[];
  /** The week's card. Null for a legacy season, which has the fixed ladder above; the live season always has one. */
  weeklyCard: WeeklyCardView | null;
  startsAtMs: number;
  /** Null for a season with no end here. */
  endsAtMs: number | null;
};

const now = () => Date.now();

const rewardLabel = (r: SeasonReward): RewardView => {
  if (r.kind === 'item') {
    const it = getSeasonItem(r.itemId) ?? SEASON_CARD_ITEMS.find((item) => item.id === r.itemId) ?? null;
    const art = it && 'art' in it ? (it as { art: string | null }).art : null;
    return {
      kind: 'item',
      itemId: r.itemId,
      name: it ? playerItemName(it.name) : r.itemId,
      art,
      preview: it
        ? {
            id: it.id,
            name: playerItemName(it.name),
            gameType: it.gameType,
            slots: [it.slot],
            assetRef: it.assetRef,
          }
        : undefined,
    };
  }
  return { kind: 'tickets', amount: r.amount };
};

// ─── Progress row ────────────────────────────────────────────────────────────
// The `premium` column stays in the table and is unused: there is one track.
const ensureProgress = async (userId: string) => {
  const season = currentSeason();
  const row = await queryOne<{ xp: number }>(
    `SELECT xp FROM user_season_progress WHERE user_id = $1 AND season_key = $2`,
    [userId, season.key],
  );
  if (row) return { xp: Number(row.xp ?? 0) };
  await query(
    `INSERT INTO user_season_progress (user_id, season_key, xp, premium, updated_at)
     VALUES ($1, $2, 0, FALSE, $3)
     ON CONFLICT (user_id, season_key) DO NOTHING`,
    [userId, season.key, now()],
  );
  return { xp: 0 };
};

// ─── Daily quests ────────────────────────────────────────────────────────────
const insertQuest = async (
  userId: string,
  dateKey: string,
  slotIndex: number,
  template: QuestTemplate,
) => {
  await query(
    `INSERT INTO user_daily_quests
       (user_id, date_key, slot_index, quest_key, kind, target_game, goal, progress, reward_xp, reward_tickets, claimed, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 0, $8, $9, FALSE, $10)
     ON CONFLICT (user_id, date_key, slot_index) DO NOTHING`,
    [
      userId,
      dateKey,
      slotIndex,
      template.key,
      template.kind,
      template.targetGame ?? null,
      template.goal,
      template.rewardXp,
      template.rewardTickets,
      now(),
    ],
  );
};

const ensureDailyQuests = async (userId: string, dateKey: string) => {
  const existing = await query<{ slot_index: number }>(
    `SELECT slot_index FROM user_daily_quests WHERE user_id = $1 AND date_key = $2`,
    [userId, dateKey],
  );
  if (existing.rows.length >= DAILY_QUEST_COUNT) return;
  const keys = pickQuestKeys(userId, dateKey);
  for (let slot = 0; slot < keys.length; slot += 1) {
    const template = getQuestTemplate(keys[slot]!);
    if (template) await insertQuest(userId, dateKey, slot, template);
  }
  await query(
    `INSERT INTO user_quest_day (user_id, date_key, rerolls_used)
     VALUES ($1, $2, 0) ON CONFLICT (user_id, date_key) DO NOTHING`,
    [userId, dateKey],
  );
};

type QuestRow = {
  slot_index: number;
  quest_key: string;
  kind: string;
  target_game: string | null;
  goal: number;
  progress: number;
  reward_xp: number;
  reward_tickets: number;
  claimed: boolean;
};

/** An unclaimed quest on a game that is not on the floor. The read path has
 *  already set it complete, so it is claimable; the UI says why. */
const leftFloor = (r: QuestRow): boolean =>
  !r.claimed && r.target_game != null && !isOnFloor(r.target_game);

const toQuestView = (r: QuestRow): QuestView => {
  const template = getQuestTemplate(r.quest_key);
  return {
    slotIndex: r.slot_index,
    key: r.quest_key,
    kind: r.kind,
    label: renameGameNamesInText(template?.label ?? r.quest_key),
    targetGame: r.target_game,
    goal: Number(r.goal),
    progress: Number(r.progress),
    rewardXp: Number(r.reward_xp),
    rewardTickets: Number(r.reward_tickets ?? 0),
    claimed: Boolean(r.claimed),
    complete: Number(r.progress) >= Number(r.goal),
    offFloor: leftFloor(r),
  };
};

// ─── Weekly quests ───────────────────────────────────────────────────────────
// Fixed ladder (same for everyone, no rerolls). Rows are seeded lazily for every
// week 1..currentWeek — including any weeks the player missed — so newly unlocked
// AND back-dated weeks both appear and stay completable for the whole season.
type WeeklyQuestRow = QuestRow & { week: number };

const toWeeklyQuestView = (r: WeeklyQuestRow): WeeklyQuestView => {
  const template = getWeeklyQuestTemplate(r.quest_key);
  return {
    week: Number(r.week),
    slotIndex: r.slot_index,
    key: r.quest_key,
    kind: r.kind,
    label: renameGameNamesInText(template?.label ?? r.quest_key),
    targetGame: r.target_game,
    goal: Number(r.goal),
    progress: Number(r.progress),
    rewardXp: Number(r.reward_xp),
    rewardTickets: Number(r.reward_tickets ?? 0),
    claimed: Boolean(r.claimed),
    complete: Number(r.progress) >= Number(r.goal),
    offFloor: leftFloor(r),
  };
};

/**
 * Seed weekly quest rows for every unlocked week (1..currentWeek) in a single
 * idempotent INSERT. Cheap to call repeatedly — ON CONFLICT DO NOTHING leaves
 * existing progress untouched — so both the state fetch and the gameplay hook
 * call it, ensuring players accrue weekly progress even if they never open the
 * battlepass page.
 */
const ensureWeeklyQuests = async (userId: string, currentWeek: number) => {
  const maxWeek = Math.max(1, Math.min(SEASON_0_TOTAL_WEEKS, currentWeek));
  const values: string[] = [];
  const params: unknown[] = [];
  const ts = now();
  for (const { week, quests } of SEASON_0_WEEKLY_QUESTS) {
    if (week > maxWeek) continue;
    quests.forEach((q, slot) => {
      const b = params.length;
      values.push(
        `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7}, 0, $${b + 8}, $${b + 9}, FALSE, $${b + 10})`,
      );
      params.push(
        userId,
        week,
        slot,
        q.key,
        q.kind,
        q.targetGame ?? null,
        q.goal,
        q.rewardXp,
        q.rewardTickets,
        ts,
      );
    });
  }
  if (values.length === 0) return;
  await query(
    `INSERT INTO user_weekly_quests
       (user_id, week, slot_index, quest_key, kind, target_game, goal, progress, reward_xp, reward_tickets, claimed, created_at)
     VALUES ${values.join(', ')}
     ON CONFLICT (user_id, week, slot_index) DO NOTHING`,
    params,
  );
};

// ─── The weekly card (the live season) ────────────────────────────────────────────
// Five quests a week on user_weekly_cards, keyed by season and week. Rows are
// written once, the first time a player's week is touched (the state fetch and
// the gameplay hook both call this), so the three games on a card never change
// under a player. Only the current week's card takes progress. A finished
// quest from an earlier week stays claimable.
const toWeeklyCardView = (r: WeeklyQuestRow): WeeklyQuestView => {
  const template = getWeeklyCardTemplate(r.quest_key);
  return {
    ...toWeeklyQuestView(r),
    label: renameGameNamesInText(template?.label ?? r.quest_key),
  };
};

const ensureWeeklyCard = async (userId: string, seasonKey: string, week: number) => {
  const quests = weeklyCardQuests(seasonKey, week);
  if (quests.length === 0) return;
  const values: string[] = [];
  const params: unknown[] = [];
  const ts = now();
  quests.forEach((q, slot) => {
    const b = params.length;
    values.push(
      `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7}, $${b + 8}, 0, $${b + 9}, $${b + 10}, FALSE, $${b + 11})`,
    );
    params.push(userId, seasonKey, week, slot, q.key, q.kind, q.targetGame ?? null, q.goal, q.rewardXp, q.rewardTickets, ts);
  });
  await query(
    `INSERT INTO user_weekly_cards
       (user_id, season_key, week, slot_index, quest_key, kind, target_game, goal, progress, reward_xp, reward_tickets, claimed, created_at)
     VALUES ${values.join(', ')}
     ON CONFLICT (user_id, season_key, week, slot_index) DO NOTHING`,
    params,
  );
};

// ─── Season quests ───────────────────────────────────────────────────────────
// Fixed ladder (same for everyone, no rerolls), ALL unlocked at season start and
// never expiring within the season. Rows are keyed by (user_id, season_key,
// slot_index) — season_key scopes them so a future season gets a fresh ladder —
// and seeded lazily/idempotently — both the state fetch and the gameplay hook
// call ensureSeasonQuests so players accrue progress even without opening the
// page.
const toSeasonQuestView = (r: QuestRow): SeasonQuestView => {
  const template = getSeasonQuestTemplate(r.quest_key);
  return {
    slotIndex: r.slot_index,
    key: r.quest_key,
    kind: r.kind,
    targetGame: r.target_game,
    label: renameGameNamesInText(template?.label ?? r.quest_key),
    goal: Number(r.goal),
    progress: Number(r.progress),
    rewardXp: Number(r.reward_xp),
    rewardTickets: Number(r.reward_tickets ?? 0),
    claimed: Boolean(r.claimed),
    offFloor: leftFloor(r),
  };
};

/**
 * Seed all season-quest rows for a user in a single idempotent INSERT. Cheap to
 * call repeatedly — ON CONFLICT DO NOTHING leaves existing progress untouched.
 * Mirrors ensureWeeklyQuests but keyed by (user_id, season_key, slot_index).
 */
const ensureSeasonQuests = async (userId: string) => {
  const values: string[] = [];
  const params: unknown[] = [];
  const ts = now();
  SEASON_0_SEASON_QUESTS.forEach((q, slot) => {
    const b = params.length;
    values.push(
      `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7}, 0, $${b + 8}, $${b + 9}, FALSE, $${b + 10})`,
    );
    params.push(
      userId,
      SEASON_KEY,
      slot,
      q.key,
      q.kind,
      q.targetGame ?? null,
      q.goal,
      q.rewardXp,
      q.rewardTickets,
      ts,
    );
  });
  if (values.length === 0) return;
  await query(
    `INSERT INTO user_season_quests
       (user_id, season_key, slot_index, quest_key, kind, target_game, goal, progress, reward_xp, reward_tickets, claimed, created_at)
     VALUES ${values.join(', ')}
     ON CONFLICT (user_id, season_key, slot_index) DO NOTHING`,
    params,
  );
};

/**
 * Advance quest + season XP from a single game run. Called from
 * awardGameRunCredits AFTER the wallet commit; wrapped by the caller in
 * try/catch so battlepass never blocks a reward.
 */
export const recordGameRunForSeason = async (
  userId: string,
  input: { gameType: string; creditsEarned: number; score?: number },
): Promise<AddAccountXpResult | null> => {
  const dateKey = getServerDateKey(new Date());
  let participationResult: AddAccountXpResult | null = null;

  // Participation XP: every game grants a little XP even after the ticket cap
  // zeroes out creditsEarned, tapering with each play and capped per day.
  // Atomically bump today's game counter, then grant the tapered XP. The run's
  // own XP (its ticket value before the cap) is granted by the reward path.
  try {
    const counter = await queryOne<{ games: number; participation_xp: number }>(
      `INSERT INTO user_season_xp_day (user_id, date_key, games, participation_xp, updated_at)
         VALUES ($1, $2, 1, 0, $3)
       ON CONFLICT (user_id, date_key) DO UPDATE
         SET games = user_season_xp_day.games + 1, updated_at = $3
       RETURNING games, participation_xp`,
      [userId, dateKey, now()],
    );
    if (counter) {
      const participationXp = participationXpForGame(
        Number(counter.games),
        Number(counter.participation_xp),
      );
      if (participationXp > 0) {
        participationResult = await grantXp(userId, participationXp, 'participation', dateKey);
        await query(
          `UPDATE user_season_xp_day
              SET participation_xp = participation_xp + $3, updated_at = $4
            WHERE user_id = $1 AND date_key = $2`,
          [userId, dateKey, participationXp, now()],
        );
      }
    }
  } catch (error) {
    console.error('[battlepass] participation XP failed:', error);
  }

  await ensureDailyQuests(userId, dateKey);
  const rows = (
    await query<QuestRow>(
      `SELECT slot_index, quest_key, kind, target_game, goal, progress, reward_xp, reward_tickets, claimed
         FROM user_daily_quests WHERE user_id = $1 AND date_key = $2`,
      [userId, dateKey],
    )
  ).rows;
  for (const r of rows) {
    if (r.claimed) continue;
    if (Number(r.progress) >= Number(r.goal)) continue;
    let inc = 0;
    if (r.kind === 'play_any') inc = 1;
    else if (r.kind === 'play_game' && r.target_game === input.gameType) inc = 1;
    else if (r.kind === 'earn_tickets') inc = Math.max(0, Math.floor(input.creditsEarned));
    else if (r.kind === 'score_game' && r.target_game === input.gameType) {
      // Score quests track the best single-run score, not a sum. GREATEST makes
      // the write atomic — this hook runs post-commit OUTSIDE the per-user award
      // lock, so a concurrent lower-scoring run must not clobber a higher
      // progress. The quest_key/claimed guards stop a delayed write from
      // mutating a slot that a concurrent reroll or claim swapped/settled.
      const score = Math.floor(input.score ?? 0);
      if (score > Number(r.progress)) {
        await query(
          `UPDATE user_daily_quests
              SET progress = LEAST(GREATEST(progress, $4), goal)
            WHERE user_id = $1 AND date_key = $2 AND slot_index = $3
              AND quest_key = $5 AND claimed = FALSE`,
          [userId, dateKey, r.slot_index, score, r.quest_key],
        );
      }
      continue;
    }
    if (inc > 0) {
      await query(
        `UPDATE user_daily_quests
            SET progress = LEAST(progress + $4, goal)
          WHERE user_id = $1 AND date_key = $2 AND slot_index = $3
            AND quest_key = $5 AND claimed = FALSE`,
        [userId, dateKey, r.slot_index, inc, r.quest_key],
      );
    }
  }

  // The live season: the week's card. Same kind semantics and clamping as the
  // dailies, applied to the current week's unclaimed rows only. Own try/catch
  // so a card hiccup never blocks the daily or participation progress above.
  const season = currentSeason();
  if (season.weeklyCard) {
    try {
      const week = weeklyCardWeek(season);
      if (week != null) {
        await ensureWeeklyCard(userId, season.key, week);
        const cardRows = (
          await query<QuestRow>(
            `SELECT slot_index, quest_key, kind, target_game, goal, progress, reward_xp, reward_tickets, claimed
               FROM user_weekly_cards WHERE user_id = $1 AND season_key = $2 AND week = $3`,
            [userId, season.key, week],
          )
        ).rows;
        for (const r of cardRows) {
          if (r.claimed || Number(r.progress) >= Number(r.goal)) continue;
          let inc = 0;
          if (r.kind === 'play_any') inc = 1;
          else if (r.kind === 'play_game' && r.target_game === input.gameType) inc = 1;
          else if (r.kind === 'earn_tickets') inc = Math.max(0, Math.floor(input.creditsEarned));
          if (inc > 0) {
            await query(
              `UPDATE user_weekly_cards
                  SET progress = LEAST(progress + $5, goal)
                WHERE user_id = $1 AND season_key = $2 AND week = $3 AND slot_index = $4
                  AND quest_key = $6 AND claimed = FALSE`,
              [userId, season.key, week, r.slot_index, inc, r.quest_key],
            );
          }
        }
      }
    } catch (error) {
      console.error('[battlepass] weekly card progress failed:', error);
    }
    return participationResult;
  }

  // Weekly quests — same kind semantics/clamping as dailies, applied to EVERY
  // unclaimed weekly row across ALL of the player's unlocked weeks (that's what
  // lets a run retro-complete a still-open past week). Wrapped in its own
  // try/catch so a weekly hiccup (e.g. table missing pre-migration) never blocks
  // the daily/participation progress above or the payout downstream.
  try {
    const currentWeek = seasonWeekForDate(new Date());
    await ensureWeeklyQuests(userId, currentWeek);
    const weeklyRows = (
      await query<WeeklyQuestRow>(
        `SELECT week, slot_index, quest_key, kind, target_game, goal, progress, reward_xp, reward_tickets, claimed
           FROM user_weekly_quests WHERE user_id = $1`,
        [userId],
      )
    ).rows;
    for (const r of weeklyRows) {
      if (r.claimed) continue;
      if (Number(r.progress) >= Number(r.goal)) continue;
      let inc = 0;
      if (r.kind === 'play_any') inc = 1;
      else if (r.kind === 'play_game' && r.target_game === input.gameType) inc = 1;
      else if (r.kind === 'earn_tickets') inc = Math.max(0, Math.floor(input.creditsEarned));
      else if (r.kind === 'score_game' && r.target_game === input.gameType) {
        // Atomic best-score write + claimed guard — same rationale as dailies.
        const score = Math.floor(input.score ?? 0);
        if (score > Number(r.progress)) {
          await query(
            `UPDATE user_weekly_quests
                SET progress = LEAST(GREATEST(progress, $4), goal)
              WHERE user_id = $1 AND week = $2 AND slot_index = $3
                AND quest_key = $5 AND claimed = FALSE`,
            [userId, Number(r.week), r.slot_index, score, r.quest_key],
          );
        }
        continue;
      }
      if (inc > 0) {
        await query(
          `UPDATE user_weekly_quests
              SET progress = LEAST(progress + $4, goal)
            WHERE user_id = $1 AND week = $2 AND slot_index = $3
              AND quest_key = $5 AND claimed = FALSE`,
          [userId, Number(r.week), r.slot_index, inc, r.quest_key],
        );
      }
    }
  } catch (error) {
    console.error('[battlepass] weekly quest progress failed:', error);
  }

  // Season quests — a fixed, always-unlocked ladder using the SAME kind
  // semantics/clamping as dailies/weeklies, applied to every unclaimed season
  // row. Own try/catch so a season hiccup (e.g. table missing pre-migration)
  // never blocks the daily/weekly/participation progress above or the payout
  // downstream.
  try {
    await ensureSeasonQuests(userId);
    const seasonRows = (
      await query<QuestRow>(
        `SELECT slot_index, quest_key, kind, target_game, goal, progress, reward_xp, reward_tickets, claimed
           FROM user_season_quests WHERE user_id = $1 AND season_key = $2`,
        [userId, SEASON_KEY],
      )
    ).rows;
    for (const r of seasonRows) {
      if (r.claimed) continue;
      if (Number(r.progress) >= Number(r.goal)) continue;
      let inc = 0;
      if (r.kind === 'play_any') inc = 1;
      else if (r.kind === 'play_game' && r.target_game === input.gameType) inc = 1;
      else if (r.kind === 'earn_tickets') inc = Math.max(0, Math.floor(input.creditsEarned));
      else if (r.kind === 'score_game' && r.target_game === input.gameType) {
        // Atomic best-score write + claimed guard — same rationale as dailies.
        const score = Math.floor(input.score ?? 0);
        if (score > Number(r.progress)) {
          await query(
            `UPDATE user_season_quests
                SET progress = LEAST(GREATEST(progress, $4), goal)
              WHERE user_id = $1 AND season_key = $2 AND slot_index = $3
                AND quest_key = $5 AND claimed = FALSE`,
            [userId, SEASON_KEY, r.slot_index, score, r.quest_key],
          );
        }
        continue;
      }
      if (inc > 0) {
        await query(
          `UPDATE user_season_quests
              SET progress = LEAST(progress + $4, goal)
            WHERE user_id = $1 AND season_key = $2 AND slot_index = $3
              AND quest_key = $5 AND claimed = FALSE`,
          [userId, SEASON_KEY, r.slot_index, inc, r.quest_key],
        );
      }
    }
  } catch (error) {
    console.error('[battlepass] season quest progress failed:', error);
  }
  return participationResult;
};

// `dateKey` defaults to today and `seasonKey` to the current season. The retired
// season 0 close job passed the final day and `season-0`.
export const claimQuest = async (
  userId: string,
  slotIndex: number,
  dateKey: string = getServerDateKey(new Date()),
  seasonKey?: string,
) => {
  let applied: AppliedXp | undefined;
  const result = await withTransaction(async (client) => {
    const row = (
      await client.query(
        `SELECT goal, progress, reward_xp, reward_tickets, claimed FROM user_daily_quests
          WHERE user_id = $1 AND date_key = $2 AND slot_index = $3 FOR UPDATE`,
        [userId, dateKey, slotIndex],
      )
    ).rows[0] as
      | { goal: number; progress: number; reward_xp: number; reward_tickets: number; claimed: boolean }
      | undefined;
    if (!row) throw new Error('Quest not found.');
    if (row.claimed) throw new Error('Already claimed.');
    if (Number(row.progress) < Number(row.goal)) throw new Error('Quest not complete.');
    await client.query(
      `UPDATE user_daily_quests SET claimed = TRUE
        WHERE user_id = $1 AND date_key = $2 AND slot_index = $3`,
      [userId, dateKey, slotIndex],
    );
    applied = await applyXp(client, userId, Number(row.reward_xp), 'quest', dateKey, seasonKey);
    // Quests pay Tickets too — gives players something to grind past the cap.
    const rewardTickets = Number(row.reward_tickets ?? 0);
    if (rewardTickets > 0) {
      await mutateWalletAndLedgerForTransaction(client, {
        userId,
        currencyType: 'credits',
        amount: rewardTickets,
        sourceType: 'battlepass',
        sourceId: `quest:${dateKey}:${slotIndex}`,
        meta: { kind: 'daily_quest', dateKey, slotIndex },
      });
    }
    return { rewardXp: Number(row.reward_xp), rewardTickets };
  });
  if (applied) await finishXpGrant(userId, applied);
  return result;
};

// Mirrors claimQuest exactly, keyed by (week, slotIndex) instead of a date_key.
export const claimWeeklyQuest = async (
  userId: string,
  week: number,
  slotIndex: number,
  seasonKey?: string,
) => {
  const dateKey = getServerDateKey(new Date());
  let applied: AppliedXp | undefined;
  const result = await withTransaction(async (client) => {
    const row = (
      await client.query(
        `SELECT goal, progress, reward_xp, reward_tickets, claimed FROM user_weekly_quests
          WHERE user_id = $1 AND week = $2 AND slot_index = $3 FOR UPDATE`,
        [userId, week, slotIndex],
      )
    ).rows[0] as
      | { goal: number; progress: number; reward_xp: number; reward_tickets: number; claimed: boolean }
      | undefined;
    if (!row) throw new Error('Quest not found.');
    if (row.claimed) throw new Error('Already claimed.');
    if (Number(row.progress) < Number(row.goal)) throw new Error('Quest not complete.');
    await client.query(
      `UPDATE user_weekly_quests SET claimed = TRUE
        WHERE user_id = $1 AND week = $2 AND slot_index = $3`,
      [userId, week, slotIndex],
    );
    applied = await applyXp(client, userId, Number(row.reward_xp), 'quest', dateKey, seasonKey);
    const rewardTickets = Number(row.reward_tickets ?? 0);
    if (rewardTickets > 0) {
      await mutateWalletAndLedgerForTransaction(client, {
        userId,
        currencyType: 'credits',
        amount: rewardTickets,
        sourceType: 'battlepass',
        sourceId: `weekly-quest:${week}:${slotIndex}`,
        meta: { kind: 'weekly_quest', week, slotIndex },
      });
    }
    return { rewardXp: Number(row.reward_xp), rewardTickets };
  });
  if (applied) await finishXpGrant(userId, applied);
  return result;
};

// Mirrors claimWeeklyQuest exactly, keyed by the season's slotIndex — the
// sourceId `season-quest:${SEASON_KEY}:${slotIndex}` is unique per
// user+season+slot (the ledger dedups on it, so a duplicate claim never
// double-pays even under a concurrent claim race, while a future season's
// same-slot claim still pays out).
export const claimSeasonQuest = async (
  userId: string,
  slotIndex: number,
  seasonKey: string = SEASON_KEY,
) => {
  const dateKey = getServerDateKey(new Date());
  let applied: AppliedXp | undefined;
  const result = await withTransaction(async (client) => {
    const row = (
      await client.query(
        `SELECT goal, progress, reward_xp, reward_tickets, claimed FROM user_season_quests
          WHERE user_id = $1 AND season_key = $2 AND slot_index = $3 FOR UPDATE`,
        [userId, seasonKey, slotIndex],
      )
    ).rows[0] as
      | { goal: number; progress: number; reward_xp: number; reward_tickets: number; claimed: boolean }
      | undefined;
    if (!row) throw new Error('Quest not found.');
    if (row.claimed) throw new Error('Already claimed.');
    if (Number(row.progress) < Number(row.goal)) throw new Error('Quest not complete.');
    await client.query(
      `UPDATE user_season_quests SET claimed = TRUE
        WHERE user_id = $1 AND season_key = $2 AND slot_index = $3`,
      [userId, seasonKey, slotIndex],
    );
    applied = await applyXp(client, userId, Number(row.reward_xp), 'quest', dateKey, seasonKey);
    const rewardTickets = Number(row.reward_tickets ?? 0);
    if (rewardTickets > 0) {
      await mutateWalletAndLedgerForTransaction(client, {
        userId,
        currencyType: 'credits',
        amount: rewardTickets,
        sourceType: 'battlepass',
        sourceId: `season-quest:${seasonKey}:${slotIndex}`,
        meta: { kind: 'season_quest', seasonKey, slotIndex },
      });
    }
    return { rewardXp: Number(row.reward_xp), rewardTickets };
  });
  if (applied) await finishXpGrant(userId, applied);
  return result;
};

// The weekly card's claim. Same shape as claimWeeklyQuest, keyed by season,
// week and slot. The ledger source id is unique per user, season, week and
// slot, so a second claim never pays twice.
export const claimWeeklyCard = async (
  userId: string,
  seasonKey: string,
  week: number,
  slotIndex: number,
) => {
  const dateKey = getServerDateKey(new Date());
  let applied: AppliedXp | undefined;
  const result = await withTransaction(async (client) => {
    const row = (
      await client.query(
        `SELECT goal, progress, reward_xp, reward_tickets, claimed FROM user_weekly_cards
          WHERE user_id = $1 AND season_key = $2 AND week = $3 AND slot_index = $4 FOR UPDATE`,
        [userId, seasonKey, week, slotIndex],
      )
    ).rows[0] as
      | { goal: number; progress: number; reward_xp: number; reward_tickets: number; claimed: boolean }
      | undefined;
    if (!row) throw new Error('Quest not found.');
    if (row.claimed) throw new Error('Already claimed.');
    if (Number(row.progress) < Number(row.goal)) throw new Error('Quest not complete.');
    await client.query(
      `UPDATE user_weekly_cards SET claimed = TRUE
        WHERE user_id = $1 AND season_key = $2 AND week = $3 AND slot_index = $4`,
      [userId, seasonKey, week, slotIndex],
    );
    applied = await applyXp(client, userId, Number(row.reward_xp), 'quest', dateKey, seasonKey);
    const rewardTickets = Number(row.reward_tickets ?? 0);
    if (rewardTickets > 0) {
      await mutateWalletAndLedgerForTransaction(client, {
        userId,
        currencyType: 'credits',
        amount: rewardTickets,
        sourceType: 'battlepass',
        sourceId: `weekly-card:${seasonKey}:${week}:${slotIndex}`,
        meta: { kind: 'weekly_card', seasonKey, week, slotIndex },
      });
    }
    return { rewardXp: Number(row.reward_xp), rewardTickets };
  });
  if (applied) await finishXpGrant(userId, applied);
  return result;
};

export const rerollQuest = async (userId: string, slotIndex: number) => {
  const dateKey = getServerDateKey(new Date());
  return withTransaction(async (client) => {
    const dayRow = (
      await client.query(
        `SELECT rerolls_used FROM user_quest_day WHERE user_id = $1 AND date_key = $2 FOR UPDATE`,
        [userId, dateKey],
      )
    ).rows[0] as { rerolls_used: number } | undefined;
    const used = Number(dayRow?.rerolls_used ?? 0);
    if (used >= DAILY_QUEST_REROLLS) throw new Error('No rerolls left today.');
    const current = (
      await client.query(
        `SELECT quest_key, claimed FROM user_daily_quests
          WHERE user_id = $1 AND date_key = $2 AND slot_index = $3 FOR UPDATE`,
        [userId, dateKey, slotIndex],
      )
    ).rows[0] as { quest_key: string; claimed: boolean } | undefined;
    if (!current) throw new Error('Quest not found.');
    if (current.claimed) throw new Error('Cannot reroll a claimed quest.');
    // Pick a template not currently in any of the day's slots.
    const inUse = new Set(
      (
        await client.query<{ quest_key: string }>(
          `SELECT quest_key FROM user_daily_quests WHERE user_id = $1 AND date_key = $2`,
          [userId, dateKey],
        )
      ).rows.map((r) => r.quest_key),
    );
    const next = pickRerollQuest(userId, dateKey, slotIndex, used, inUse);
    if (!next) throw new Error('No alternative quests available.');
    await client.query(
      `UPDATE user_daily_quests
          SET quest_key = $4, kind = $5, target_game = $6, goal = $7, progress = 0,
              reward_xp = $8, reward_tickets = $9, claimed = FALSE
        WHERE user_id = $1 AND date_key = $2 AND slot_index = $3`,
      [userId, dateKey, slotIndex, next.key, next.kind, next.targetGame ?? null, next.goal, next.rewardXp, next.rewardTickets],
    );
    await client.query(
      `UPDATE user_quest_day SET rerolls_used = rerolls_used + 1
        WHERE user_id = $1 AND date_key = $2`,
      [userId, dateKey],
    );
    return { rerollsLeft: DAILY_QUEST_REROLLS - (used + 1) };
  });
};

// ─── Claim a tier reward ─────────────────────────────────────────────────────
export const claimTierReward = async (
  userId: string,
  tier: number,
  track: 'free' | 'premium',
  seasonKey?: string,
) => {
  const season = seasonKey ? seasonByKey(seasonKey) : currentSeason();
  const tierDef = season.tiers.find((t) => t.tier === tier);
  if (!tierDef) throw new Error('Unknown tier.');
  const reward = track === 'free' ? tierDef.free : tierDef.premium;
  if (!reward) throw new Error('Nothing to claim on this track.');

  return withTransaction(async (client) => {
    const progressRow = (
      await client.query(
        `SELECT xp FROM user_season_progress
          WHERE user_id = $1 AND season_key = $2 FOR UPDATE`,
        [userId, season.key],
      )
    ).rows[0] as { xp: number } | undefined;
    const xp = Number(progressRow?.xp ?? 0);
    if (seasonTierFromXp(season, xp) < tier) throw new Error('Tier not unlocked yet.');

    const dup = await client.query(
      `SELECT 1 FROM user_season_claims
        WHERE user_id = $1 AND season_key = $2 AND tier = $3 AND track = $4`,
      [userId, season.key, tier, track],
    );
    if (dup.rows[0]) throw new Error('Reward already claimed.');

    await client.query(
      `INSERT INTO user_season_claims (user_id, season_key, tier, track, claimed_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, season.key, tier, track, now()],
    );

    if (reward.kind === 'tickets') {
      await mutateWalletAndLedgerForTransaction(client, {
        userId,
        currencyType: 'credits',
        amount: reward.amount,
        sourceType: 'battlepass',
        sourceId: `${season.key}:${track}:t${tier}`,
        meta: { tier, track },
      });
    } else {
      await client.query(
        `INSERT INTO user_owned_items (user_id, item_id, acquired_at, acquired_source)
         VALUES ($1, $2, $3, 'battlepass')
         ON CONFLICT (user_id, item_id) DO NOTHING`,
        [userId, reward.itemId, now()],
      );
    }
    return rewardLabel(reward);
  });
};

// ─── State for the UI ────────────────────────────────────────────────────────
// NOTE (2026-07): a former "premium perk" auto-completed every daily quest on
// each state fetch (UPDATE ... SET progress = goal). Because Season 0 gifts
// premium to everyone (SEASON_0_PREMIUM_FOR_ALL), that made all quests
// claimable with zero play just by opening the battlepass page or focusing the
// dashboard widget. Removed: quest progress now only moves through real
// gameplay via recordGameRunForSeason.

export const getBattlepassState = async (
  userId: string,
): Promise<BattlepassState> => {
  const season = currentSeason();
  const { xp } = await ensureProgress(userId);
  // Only today's dailies, under the same date key the picker uses. They are
  // created here if they do not exist yet; earlier days are never read.
  const dateKey = getServerDateKey(new Date());
  await ensureDailyQuests(userId, dateKey);
  const currentWeek = season.weeklyCard
    ? (weeklyCardWeek(season) ?? 0)
    : seasonWeekForDate(new Date());
  // Seed every list this season shows, then set the quests on games that left
  // the floor complete (PROGRESSION.md, "Quests on retired games"), before any
  // of them is read. Idempotent, so a floor change later is handled the same way.
  if (season.weeklyCard) {
    if (currentWeek > 0) await ensureWeeklyCard(userId, season.key, currentWeek);
  } else {
    await ensureWeeklyQuests(userId, currentWeek);
    await ensureSeasonQuests(userId);
  }
  await completeOffFloorQuestsForUser(userId, { dateKey, seasonKey: season.key });

  const claimRows = (
    await query<{ tier: number; track: string }>(
      `SELECT tier, track FROM user_season_claims WHERE user_id = $1 AND season_key = $2`,
      [userId, season.key],
    )
  ).rows;
  const claimed = new Set(claimRows.map((r) => `${r.tier}:${r.track}`));

  const tier = seasonTierFromXp(season, xp);
  const bar = seasonTierProgress(season, xp);
  const tiers: TierView[] = season.tiers.map((t) => ({
    tier: t.tier,
    free: rewardLabel(t.free),
    premium: t.premium ? rewardLabel(t.premium) : null,
    unlocked: tier >= t.tier,
    freeClaimed: claimed.has(`${t.tier}:free`),
    premiumClaimed: t.premium ? claimed.has(`${t.tier}:premium`) : true,
  }));

  const questRows = (
    await query<QuestRow>(
      `SELECT slot_index, quest_key, kind, target_game, goal, progress, reward_xp, reward_tickets, claimed
         FROM user_daily_quests WHERE user_id = $1 AND date_key = $2
        ORDER BY slot_index ASC`,
      [userId, dateKey],
    )
  ).rows;
  const dayRow = await queryOne<{ rerolls_used: number }>(
    `SELECT rerolls_used FROM user_quest_day WHERE user_id = $1 AND date_key = $2`,
    [userId, dateKey],
  );

  // A legacy season has the fixed weekly ladder and the season quests. The live
  // season has the week's card, and nothing of the old lists.
  let weeklyRows: WeeklyQuestRow[] = [];
  let weeks: WeekSummaryView[] = [];
  let seasonQuestRows: QuestRow[] = [];
  let weeklyCard: WeeklyCardView | null = null;

  if (season.weeklyCard) {
    if (currentWeek > 0) {
      const cardRows = (
        await query<WeeklyQuestRow>(
          `SELECT week, slot_index, quest_key, kind, target_game, goal, progress, reward_xp, reward_tickets, claimed
             FROM user_weekly_cards
            WHERE user_id = $1 AND season_key = $2
              AND (week = $3 OR (week < $3 AND claimed = FALSE AND progress >= goal))
            ORDER BY week ASC, slot_index ASC`,
          [userId, season.key, currentWeek],
        )
      ).rows;
      weeklyCard = {
        week: currentWeek,
        totalWeeks: season.totalWeeks,
        endsAtMs: season.startMs + currentWeek * WEEK_MS,
        quests: cardRows.filter((r) => Number(r.week) === currentWeek).map(toWeeklyCardView),
        carryover: cardRows.filter((r) => Number(r.week) < currentWeek).map(toWeeklyCardView),
      };
    }
  } else {
    // Seed all unlocked weeks (past + current), then return only the seeded
    // (unlocked) rows. Future weeks are intentionally NOT returned: the UI
    // derives locked placeholders + unlock dates from `weeks`/currentWeek.
    weeklyRows = (
      await query<WeeklyQuestRow>(
        `SELECT week, slot_index, quest_key, kind, target_game, goal, progress, reward_xp, reward_tickets, claimed
           FROM user_weekly_quests WHERE user_id = $1
          ORDER BY week ASC, slot_index ASC`,
        [userId],
      )
    ).rows;
    weeks = SEASON_0_WEEKLY_QUESTS.map(({ week }) => ({
      week,
      unlocksAtMs: weekUnlockMs(week),
      unlocked: week <= currentWeek,
    }));
    // Season quests: seed the fixed all-unlocked ladder, then return every row
    // ordered by slot_index. Always present (ensured first).
    seasonQuestRows = (
      await query<QuestRow>(
        `SELECT slot_index, quest_key, kind, target_game, goal, progress, reward_xp, reward_tickets, claimed
           FROM user_season_quests WHERE user_id = $1 AND season_key = $2
          ORDER BY slot_index ASC`,
        [userId, SEASON_KEY],
      )
    ).rows;
  }

  return {
    seasonKey: season.key,
    seasonName: season.name,
    xp,
    tier,
    maxTier: season.maxTier,
    xpPerTier: season.xpPerTier,
    bar: { into: bar.into, need: bar.need, atMax: bar.atMax },
    tiers,
    quests: questRows.map(toQuestView),
    rerollsLeft: Math.max(0, DAILY_QUEST_REROLLS - Number(dayRow?.rerolls_used ?? 0)),
    weeklyQuests: weeklyRows.map(toWeeklyQuestView),
    currentWeek,
    totalWeeks: season.totalWeeks,
    weeks,
    seasonQuests: seasonQuestRows.map(toSeasonQuestView),
    weeklyCard,
    startsAtMs: season.startMs,
    endsAtMs: season.endMs,
  };
};

