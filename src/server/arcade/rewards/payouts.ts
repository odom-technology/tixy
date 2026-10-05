import crypto from 'node:crypto';

import { query, queryOne, withTransaction } from '@/server/db/client';

import { buildMonthlyAwards, monthlyBoardsRetired } from './monthly-boards';
import type { MonthlyRewardsResult } from './types';
import {
  getServerMonthKey,
  parseMonthKeyLocal,
  startOfPreviousMonth,
} from './helpers';
import { mutateWalletAndLedgerForTransaction } from './wallet';

/**
 * Runs monthly leaderboard reward distribution for the previous month.
 * Skips if already completed; awards Tickets based on rank tiers. Months
 * before October 2026 run on the season 0 list. From October 2026 the award
 * is retired (the weekly boards pay instead): it returns 'retired' and writes
 * nothing, no run row included.
 */
export const runMonthlyLeaderboardRewards = async (
  requestedMonthKey?: string,
  options?: { resetLeaderboards?: boolean },
): Promise<MonthlyRewardsResult> => {
  const monthKey = requestedMonthKey ?? getServerMonthKey(startOfPreviousMonth());
  const parsed = parseMonthKeyLocal(monthKey);
  if (!parsed) {
    throw new Error('Invalid month key. Expected YYYY-MM.');
  }

  if (monthlyBoardsRetired(monthKey)) {
    return { monthKey, status: 'retired', awardedUsers: 0, totalCreditsAwarded: 0, awards: [] };
  }

  const already = await queryOne<{
    month_key: string;
    status: string;
    ran_at: string | number;
    summary_json: string | null;
  }>(
    'SELECT month_key, status, ran_at, summary_json FROM monthly_reward_runs WHERE month_key = $1 LIMIT 1',
    [monthKey],
  );
  if (already?.status === 'completed') {
    const parsedSummary = already.summary_json
      ? (JSON.parse(already.summary_json) as {
          awardedUsers?: number;
          totalCreditsAwarded?: number;
          awards?: MonthlyRewardsResult['awards'];
        })
      : null;
    const summary = {
      awardedUsers: parsedSummary?.awardedUsers ?? 0,
      totalCreditsAwarded: parsedSummary?.totalCreditsAwarded ?? 0,
      awards: parsedSummary?.awards ?? ([] as MonthlyRewardsResult['awards']),
    };

    return {
      monthKey,
      status: 'already-ran',
      awardedUsers: summary.awardedUsers,
      totalCreditsAwarded: summary.totalCreditsAwarded,
      awards: summary.awards,
    };
  }

  // Which boards pay depends on the month the award is for (monthly-boards.ts).
  const finalAwards = await buildMonthlyAwards(monthKey);

  const awardedUserSet = new Set<string>();
  let totalCreditsAwarded = 0;

  await withTransaction(async (client) => {
    for (const award of finalAwards) {
      const sourcePrefix = `${monthKey}:${award.leaderboardKey}:${award.userId}`;
      const creditsSourceId = `monthly-credits:${sourcePrefix}`;

      if (award.credits > 0) {
        const granted = await mutateWalletAndLedgerForTransaction(client, {
          userId: award.userId,
          currencyType: 'credits',
          amount: award.credits,
          sourceType: 'monthly_reward',
          sourceId: creditsSourceId,
          meta: {
            monthKey,
            leaderboardKey: award.leaderboardKey,
            rank: award.rank,
          },
        });
        // A ledger row for this month, board and user means it was paid already.
        if (!granted.deduped) totalCreditsAwarded += award.credits;
      }

      await client.query(
        `
          INSERT INTO monthly_reward_awards (
            id,
            month_key,
            leaderboard_key,
            user_id,
            rank,
            credits_awarded,
            wupiupi_awarded,
            awarded_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          ON CONFLICT DO NOTHING
        `,
        [
          crypto.randomUUID(),
          monthKey,
          award.leaderboardKey,
          award.userId,
          award.rank,
          award.credits,
          0,
          Date.now(),
        ],
      );

      awardedUserSet.add(award.userId);
    }

    await client.query(
      `
        INSERT INTO monthly_reward_runs (month_key, status, ran_at, summary_json)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT(month_key) DO UPDATE SET
          status = excluded.status,
          ran_at = excluded.ran_at,
          summary_json = excluded.summary_json
      `,
      [
        monthKey,
        'completed',
        Date.now(),
        JSON.stringify({
          awardedUsers: awardedUserSet.size,
          totalCreditsAwarded,
          awards: finalAwards,
        }),
      ],
    );
  });

  // Leaderboard resets are DISABLED for now (product decision 2026-06-25).
  // We are moving to rolling 7d / 30d / all-time windows instead of wiping
  // scores monthly, and Elo ladders must never be reset. The monthly reward
  // job still runs (it pays the top players), but it no longer DELETEs any
  // score table. This kill-switch overrides the caller's `resetLeaderboards`
  // option AND the cron's default, so the external monthly crontab (which
  // would otherwise fire a reset on the 1st) is neutralized without needing
  // crontab access. Set ENABLE_LEADERBOARD_RESETS='true' to ever re-enable.
  const resetsEnabled = process.env.ENABLE_LEADERBOARD_RESETS === 'true';
  if (resetsEnabled && options?.resetLeaderboards !== false) {
    // Note: connections_scores is NOT reset — daily puzzle history persists.
    // Note: *_elo tables are NEVER reset — ranked ladders persist permanently.
    for (const table of [
      'snake_scores',
      'flappy_bird_scores',
      'reaction_time_scores',
      'typing_test_scores',
      'coin_flip_scores',
      'pool_bot_records',
    ]) {
      await query(`DELETE FROM ${table}`);
    }
  } else if (options?.resetLeaderboards !== false) {
    console.log(
      '[monthly-leaderboards] reset requested but DISABLED (ENABLE_LEADERBOARD_RESETS!=true) — skipping score wipe.',
    );
  }

  return {
    monthKey,
    status: 'completed',
    awardedUsers: awardedUserSet.size,
    totalCreditsAwarded,
    awards: finalAwards.map((award) => ({
      leaderboardKey: award.leaderboardKey,
      userId: award.userId,
      rank: award.rank,
      credits: award.credits,
    })),
  };
};
