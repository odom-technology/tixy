import { query, withTransaction } from '@/server/db/client';
import {
  addGameTimeDurationToBucket,
  createEmptyGameTimeBucket,
  finalizeGameTimeBucket,
  type RawGameTimeGameType,
  type UserGameTimeMetrics,
} from '@/features/arcade/lib/game-time';

const MAX_SESSION_MS = 1000 * 60 * 60 * 12;
const PRUNE_INTERVAL_MS = 1000 * 60 * 30;

const dateKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`;

const clampSessionDurationMs = (durationMs: number) => {
  if (!Number.isFinite(durationMs)) return 0;
  const normalized = Math.floor(durationMs);
  if (normalized <= 0) return 0;
  return Math.min(normalized, MAX_SESSION_MS);
};

const clampAggregateDurationMs = (durationMs: number) => {
  if (!Number.isFinite(durationMs)) return 0;
  const normalized = Math.floor(durationMs);
  if (normalized <= 0) return 0;
  return normalized;
};

const monthRangeKeys = (date: Date) => {
  const monthStart = new Date(date.getFullYear(), date.getMonth(), 1);
  const nextMonthStart = new Date(date.getFullYear(), date.getMonth() + 1, 1);
  const previousMonthStart = new Date(date.getFullYear(), date.getMonth() - 1, 1);
  const previousMonthEnd = new Date(date.getFullYear(), date.getMonth(), 0);
  return {
    monthStartKey: dateKey(monthStart),
    monthEndExclusiveKey: dateKey(nextMonthStart),
    previousMonthStartKey: dateKey(previousMonthStart),
    previousMonthEndKey: dateKey(previousMonthEnd),
  };
};

let lastPruneAt = 0;

const ensureBackfillAndPrune = async (now: Date) => {
  await query(`
    INSERT INTO game_time_metrics_totals (user_id, game_type, total_duration_ms)
    SELECT d.user_id, d.game_type, SUM(d.duration_ms)
    FROM game_time_metrics_daily d
    LEFT JOIN game_time_metrics_totals t
      ON t.user_id = d.user_id AND t.game_type = d.game_type
    WHERE t.user_id IS NULL
    GROUP BY d.user_id, d.game_type
  `);

  const nowMs = now.getTime();
  if (nowMs - lastPruneAt < PRUNE_INTERVAL_MS) return;
  const previousMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  await query('DELETE FROM game_time_metrics_daily WHERE date_key < $1', [
    dateKey(previousMonthStart),
  ]);
  lastPruneAt = nowMs;
};

export const recordGameTimeMetric = async ({
  userId,
  gameType,
  durationMs,
  playedAtMs = Date.now(),
}: {
  userId: string;
  gameType: RawGameTimeGameType;
  durationMs: number;
  playedAtMs?: number;
}) => {
  const clamped = clampSessionDurationMs(durationMs);
  if (clamped <= 0) return;

  const playedAt = new Date(playedAtMs);
  const dailyKey = dateKey(playedAt);
  await ensureBackfillAndPrune(playedAt);

  await withTransaction(async (client) => {
    await client.query(
      `
        INSERT INTO game_time_metrics_daily (
          user_id,
          game_type,
          date_key,
          duration_ms,
          run_count,
          first_played_at,
          last_played_at
        ) VALUES ($1, $2, $3, $4, 1, $5, $5)
        ON CONFLICT(user_id, game_type, date_key) DO UPDATE SET
          duration_ms = game_time_metrics_daily.duration_ms + excluded.duration_ms,
          run_count = game_time_metrics_daily.run_count + 1,
          first_played_at = COALESCE(game_time_metrics_daily.first_played_at, excluded.first_played_at),
          last_played_at = GREATEST(
            COALESCE(game_time_metrics_daily.last_played_at, 0),
            excluded.last_played_at
          )
      `,
      [userId, gameType, dailyKey, clamped, playedAtMs],
    );

    await client.query(
      `
        INSERT INTO game_time_metrics_totals (
          user_id,
          game_type,
          total_duration_ms
        ) VALUES ($1, $2, $3)
        ON CONFLICT(user_id, game_type) DO UPDATE SET
          total_duration_ms =
            game_time_metrics_totals.total_duration_ms + excluded.total_duration_ms
      `,
      [userId, gameType, clamped],
    );
  });
};

export const getUserGameTimeMetrics = async (
  userId: string,
  now: Date = new Date(),
): Promise<UserGameTimeMetrics> => {
  await ensureBackfillAndPrune(now);
  const [dailyResult, totalResult] = await Promise.all([
    query<{
      game_type: string;
      date_key: string;
      duration_ms: string | number;
    }>(
      `
        SELECT game_type, date_key, duration_ms
        FROM game_time_metrics_daily
        WHERE user_id = $1
        LIMIT 400
      `,
      [userId],
    ),
    query<{
      game_type: string;
      total_duration_ms: string | number;
    }>(
      `
        SELECT game_type, total_duration_ms
        FROM game_time_metrics_totals
        WHERE user_id = $1
      `,
      [userId],
    ),
  ]);

  const today = createEmptyGameTimeBucket();
  const allTime = createEmptyGameTimeBucket();
  const monthToDate = createEmptyGameTimeBucket();
  const lastMonth = createEmptyGameTimeBucket();
  const ranges = monthRangeKeys(now);
  const todayKey = dateKey(now);

  for (const row of totalResult.rows) {
    const totalDurationMs = clampAggregateDurationMs(
      Number(row.total_duration_ms ?? 0),
    );
    if (totalDurationMs <= 0) continue;
    addGameTimeDurationToBucket(allTime, row.game_type, totalDurationMs);
  }

  for (const row of dailyResult.rows) {
    const totalDurationMs = clampAggregateDurationMs(Number(row.duration_ms ?? 0));
    if (totalDurationMs <= 0) continue;
    if (row.date_key === todayKey) {
      addGameTimeDurationToBucket(today, row.game_type, totalDurationMs);
    }
    if (
      row.date_key >= ranges.monthStartKey &&
      row.date_key < ranges.monthEndExclusiveKey
    ) {
      addGameTimeDurationToBucket(monthToDate, row.game_type, totalDurationMs);
    }
    if (
      row.date_key >= ranges.previousMonthStartKey &&
      row.date_key <= ranges.previousMonthEndKey
    ) {
      addGameTimeDurationToBucket(lastMonth, row.game_type, totalDurationMs);
    }
  }

  return {
    today: finalizeGameTimeBucket(today),
    allTime: finalizeGameTimeBucket(allTime),
    monthToDate: finalizeGameTimeBucket(monthToDate),
    lastMonth: finalizeGameTimeBucket(lastMonth),
  };
};
