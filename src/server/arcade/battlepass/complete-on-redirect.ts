// ───────────────────────────────────────────────────────────────────────────
// Complete-on-redirect (PROGRESSION.md, "Quests on retired games").
//
// A game's route only redirects once no open quest names it. When one has to
// redirect sooner, every unclaimed quest on that game is set to complete first
// (progress = goal), and players claim it as normal: the claim paths check
// progress >= goal and pay the stored reward, so nothing else changes.
//
// Covers the daily rows and the weekly card. The old season 0's weekly and
// season quest tables are not touched: season 0 was restarted on the card, those
// rows are closed and kept as they were. Idempotent: it only touches rows
// that are unclaimed and below goal, so a second run changes nothing. Rows that
// are seeded later (a player's weeks are seeded lazily) are not covered; run it
// again after the redirect goes live if a quest on the game can still be seeded.
//
// Run it with scripts/complete-quests-for-game.ts. It refuses a floor game.
// ───────────────────────────────────────────────────────────────────────────

import { getGamePlacement, isOnFloor } from '@/features/arcade/components/arcade-game-registry';
import { query, withTransaction } from '@/server/db/client';

const QUEST_TABLES = ['user_daily_quests', 'user_weekly_cards'] as const;

export type CompleteOnRedirectResult = {
  gameSlug: string;
  dryRun: boolean;
  /** Rows set complete (or that would be, on a dry run), per table. */
  completed: Record<(typeof QUEST_TABLES)[number], number>;
  total: number;
};

export const completeQuestsForGame = async (
  gameSlug: string,
  options: { dryRun?: boolean } = {},
): Promise<CompleteOnRedirectResult> => {
  const placement = getGamePlacement(gameSlug);
  if (!placement) throw new Error(`Unknown game "${gameSlug}".`);
  if (placement.status === 'floor') {
    throw new Error(`"${gameSlug}" is on the floor; its quests are live. Take it off the floor first.`);
  }
  const dryRun = Boolean(options.dryRun);
  const completed = { user_daily_quests: 0, user_weekly_cards: 0 };
  await withTransaction(async (client) => {
    for (const table of QUEST_TABLES) {
      const where = `target_game = $1 AND claimed = FALSE AND progress < goal`;
      const result = dryRun
        ? await client.query(`SELECT 1 FROM ${table} WHERE ${where}`, [gameSlug])
        : await client.query(`UPDATE ${table} SET progress = goal WHERE ${where}`, [gameSlug]);
      completed[table] = result.rowCount ?? 0;
    }
  });
  return {
    gameSlug,
    dryRun,
    completed,
    total: completed.user_daily_quests + completed.user_weekly_cards,
  };
};

/**
 * The same rule, applied to one player when their quests are read: every
 * unclaimed quest whose target game is not on the floor right now is set
 * complete, so the player claims it as normal and it pays once. The floor is
 * read at call time, so a game that returns to the floor (flappy bird,
 * ricochet) stops being completed and its quests play normally again. Only
 * today's dailies are touched, because only today's are shown. Idempotent: it
 * only changes unclaimed rows below their goal. Returns how many rows changed.
 */
export const completeOffFloorQuestsForUser = async (
  userId: string,
  options: { dateKey: string; seasonKey: string; onFloor?: (slug: string) => boolean },
): Promise<number> => {
  const onFloor = options.onFloor ?? isOnFloor;
  const scope: Record<(typeof QUEST_TABLES)[number], { column: string; value: string } | null> = {
    user_daily_quests: { column: 'date_key', value: options.dateKey },
    user_weekly_cards: { column: 'season_key', value: options.seasonKey },
  };
  let changed = 0;
  for (const table of QUEST_TABLES) {
    const narrow = scope[table];
    const params: unknown[] = narrow ? [userId, narrow.value] : [userId];
    const where =
      `user_id = $1 AND claimed = FALSE AND progress < goal AND target_game IS NOT NULL` +
      (narrow ? ` AND ${narrow.column} = $2` : '');
    const games = await query<{ target_game: string }>(
      `SELECT DISTINCT target_game FROM ${table} WHERE ${where}`,
      params,
    );
    const off = games.rows.map((row) => row.target_game).filter((slug) => !onFloor(slug));
    if (off.length === 0) continue;
    const result = await query(
      `UPDATE ${table} SET progress = goal WHERE ${where} AND target_game = ANY($${params.length + 1}::text[])`,
      [...params, off],
    );
    changed += result.rowCount ?? 0;
  }
  return changed;
};
