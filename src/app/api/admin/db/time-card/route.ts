import { NextResponse } from 'next/server';

import { withAdmin } from '@/server/admin/guard';
import { query } from '@/server/db/client';
import { listAccounts } from '@/server/accounts';
import {
  addGameTimeDurationToBucket,
  createEmptyGameTimeBucket,
  finalizeGameTimeBucket,
} from '@/features/arcade/lib/game-time';

type DailyMetricRow = {
  user_id: string;
  game_type: string;
  date_key: string;
  duration_ms: string | number;
};

type TotalMetricRow = {
  user_id: string;
  game_type: string;
  total_duration_ms: string | number;
};

const dateKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`;

export const dynamic = 'force-dynamic';

export const GET = withAdmin(async () => {
  try {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const previousMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const previousMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);

    const monthStartKey = dateKey(monthStart);
    const monthEndExclusiveKey = dateKey(nextMonthStart);
    const previousMonthStartKey = dateKey(previousMonthStart);
    const previousMonthEndKey = dateKey(previousMonthEnd);
    const todayKey = dateKey(now);

    const [dailyResult, totalResult] = await Promise.all([
      query<DailyMetricRow>(
        `
          SELECT user_id, game_type, date_key, duration_ms
          FROM game_time_metrics_daily
          WHERE date_key >= $1
            AND date_key < $2
        `,
        [previousMonthStartKey, monthEndExclusiveKey],
      ),
      query<TotalMetricRow>(
        `
          SELECT user_id, game_type, total_duration_ms
          FROM game_time_metrics_totals
        `,
      ),
    ]);
    const dailyRows = dailyResult.rows;
    const totalRows = totalResult.rows;

    const bucketsByUserId = new Map<
      string,
      {
        today: ReturnType<typeof createEmptyGameTimeBucket>;
        allTime: ReturnType<typeof createEmptyGameTimeBucket>;
        monthToDate: ReturnType<typeof createEmptyGameTimeBucket>;
        lastMonth: ReturnType<typeof createEmptyGameTimeBucket>;
      }
    >();

    const getBuckets = (userId: string) => {
      let existing = bucketsByUserId.get(userId);
      if (existing) return existing;
      existing = {
        today: createEmptyGameTimeBucket(),
        allTime: createEmptyGameTimeBucket(),
        monthToDate: createEmptyGameTimeBucket(),
        lastMonth: createEmptyGameTimeBucket(),
      };
      bucketsByUserId.set(userId, existing);
      return existing;
    };

    for (const row of totalRows) {
      const buckets = getBuckets(row.user_id);
      addGameTimeDurationToBucket(
        buckets.allTime,
        row.game_type,
        Number(row.total_duration_ms ?? 0),
      );
    }

    for (const row of dailyRows) {
      const durationMs = Number(row.duration_ms ?? 0);
      if (durationMs <= 0) continue;
      const buckets = getBuckets(row.user_id);
      if (row.date_key === todayKey) {
        addGameTimeDurationToBucket(buckets.today, row.game_type, durationMs);
      }
      if (row.date_key >= monthStartKey && row.date_key < monthEndExclusiveKey) {
        addGameTimeDurationToBucket(
          buckets.monthToDate,
          row.game_type,
          durationMs,
        );
      }
      if (
        row.date_key >= previousMonthStartKey &&
        row.date_key <= previousMonthEndKey
      ) {
        addGameTimeDurationToBucket(
          buckets.lastMonth,
          row.game_type,
          durationMs,
        );
      }
    }

    const users = await listAccounts({ status: 'all', limit: 200 });
    const rows = users
      .map((user) => {
        const userId = user.id;
        const buckets = bucketsByUserId.get(userId) ?? {
          today: createEmptyGameTimeBucket(),
          allTime: createEmptyGameTimeBucket(),
          monthToDate: createEmptyGameTimeBucket(),
          lastMonth: createEmptyGameTimeBucket(),
        };
        return {
          userId,
          username: user.username || user.email || userId,
          today: finalizeGameTimeBucket(buckets.today),
          allTime: finalizeGameTimeBucket(buckets.allTime),
          monthToDate: finalizeGameTimeBucket(buckets.monthToDate),
          lastMonth: finalizeGameTimeBucket(buckets.lastMonth),
        };
      })
      .sort((a, b) =>
        `${a.username}|${a.userId}`
          .toLowerCase()
          .localeCompare(`${b.username}|${b.userId}`.toLowerCase()),
      );

    return NextResponse.json({
      generatedAt: Date.now(),
      rows,
    });
  } catch (error) {
    console.error('Failed to build time card:', error);
    return NextResponse.json(
      { error: 'Failed to load time card metrics.' },
      { status: 500 },
    );
  }
});
