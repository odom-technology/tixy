import crypto from 'node:crypto';
import { query, queryOne } from '@/server/db/client';

const formatUserDisplay = (userId: string, userName: string | null): string => {
  return userName ? `${userName} (${userId})` : userId;
};

const normalizeUserName = (value?: string | null) => {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
};

const formatReactionScore = (avgMs: number) =>
  Math.max(0, Math.round((500 - avgMs) * 100) / 100);

export type AntiCheatLogEntry = {
  id: string;
  ts: number;
  dateKey: string;
  gameType: string;
  userId?: string;
  userName?: string | null;
  score: number;
  modeSec?: number;
  result: 'pass' | 'flag' | 'reject';
  severity?: 'reject' | 'flag';
  reason?: string;
  stage?: string;
  checks?: string[];
};

const DEFAULT_RETENTION_DAYS = 14;
const MAX_RETENTION_DAYS = 90;
const parsedRetentionDays = Number.parseInt(
  process.env.ANTI_CHEAT_LOG_RETENTION_DAYS ?? `${DEFAULT_RETENTION_DAYS}`,
  10,
);
const ANTI_CHEAT_LOG_RETENTION_DAYS = Number.isFinite(parsedRetentionDays)
  ? Math.min(MAX_RETENTION_DAYS, Math.max(1, parsedRetentionDays))
  : DEFAULT_RETENTION_DAYS;

const getDateKey = (ts: number = Date.now()) =>
  new Date(ts).toISOString().slice(0, 10);

let lastPurgeTs = 0;
const PURGE_INTERVAL_MS = 60 * 60 * 1000;

const toNumber = (value: string | number | null | undefined) => {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const purgeOldLogs = async (nowTs: number = Date.now()) => {
  if (nowTs - lastPurgeTs < PURGE_INTERVAL_MS) return;
  lastPurgeTs = nowTs;
  const cutoff = nowTs - ANTI_CHEAT_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  await query('DELETE FROM anti_cheat_logs WHERE ts < $1', [cutoff]);
};

export const addAntiCheatLog = async (
  entry: Omit<AntiCheatLogEntry, 'id' | 'dateKey'>,
) => {
  const dateKey = getDateKey(entry.ts);
  await purgeOldLogs(entry.ts);

  const userName = normalizeUserName(entry.userName);

  await query(
    `INSERT INTO anti_cheat_logs
      (id, date_key, ts, game_type, user_id, user_name, score, mode_sec, result, severity, reason, stage, checks_json)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [
      crypto.randomUUID(),
      dateKey,
      entry.ts,
      entry.gameType,
      entry.userId ?? null,
      userName,
      entry.score,
      entry.modeSec ?? null,
      entry.result,
      entry.severity ?? null,
      entry.reason ?? null,
      entry.stage ?? null,
      entry.checks ? JSON.stringify(entry.checks) : null,
    ],
  );
};

const isDateKey = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);

export const getAntiCheatLogs = async (requestedDateKey?: string) => {
  const now = Date.now();
  await purgeOldLogs(now);
  const latestDateRow = await queryOne<{ date_key: string }>(
    `SELECT date_key
     FROM anti_cheat_logs
     ORDER BY date_key DESC
     LIMIT 1`,
  );
  const dateKey = isDateKey(requestedDateKey ?? '')
    ? (requestedDateKey as string)
    : (latestDateRow?.date_key ?? getDateKey(now));

  const result = await query<{
    id: string;
    date_key: string;
    ts: string | number;
    game_type: string;
    user_id: string | null;
    user_name: string | null;
    score: string | number;
    mode_sec: string | number | null;
    result: 'pass' | 'flag' | 'reject';
    severity: 'reject' | 'flag' | null;
    reason: string | null;
    stage: string | null;
    checks_json: string | null;
  }>(
    `SELECT id, date_key, ts, game_type, user_id, user_name, score, mode_sec, result, severity, reason, stage, checks_json
     FROM anti_cheat_logs
     WHERE date_key = $1
     ORDER BY ts DESC`,
    [dateKey],
  );

  const entries = result.rows.map((row) => ({
    id: row.id,
    dateKey: row.date_key,
    ts: toNumber(row.ts) ?? 0,
    gameType: row.game_type,
    userId: row.user_id ?? undefined,
    userName: row.user_name ?? undefined,
    score: toNumber(row.score) ?? 0,
    modeSec: toNumber(row.mode_sec) ?? undefined,
    result: row.result,
    severity: row.severity ?? undefined,
    reason: row.reason ?? undefined,
    stage: row.stage ?? undefined,
    checks: row.checks_json ? (JSON.parse(row.checks_json) as string[]) : [],
  }));

  const availableDateRows = await query<{ date_key: string }>(
    `SELECT DISTINCT date_key
     FROM anti_cheat_logs
     ORDER BY date_key DESC
     LIMIT $1`,
    [ANTI_CHEAT_LOG_RETENTION_DAYS],
  );

  return {
    dateKey,
    entries,
    availableDates: availableDateRows.rows.map((row) => row.date_key),
    retentionDays: ANTI_CHEAT_LOG_RETENTION_DAYS,
  };
};

export const serializeAntiCheatLogs = async (requestedDateKey?: string) => {
  const { dateKey, entries } = await getAntiCheatLogs(requestedDateKey);
  const header = `Anti-cheat logs for ${dateKey}\n`;
  if (entries.length === 0) return `${header}No entries.\n`;
  const lines = entries.map((entry) => {
    const time = new Date(entry.ts).toISOString();
    const userDisplay = entry.userId
      ? formatUserDisplay(entry.userId, entry.userName || null)
      : 'unknown';
    const base = [
      time,
      entry.gameType,
      entry.gameType === 'typing-test' && entry.modeSec
        ? `${entry.modeSec}s`
        : undefined,
      userDisplay,
      entry.gameType === 'reaction-time'
        ? `avg_ms=${Number(entry.score).toFixed(2)} score=${formatReactionScore(Number(entry.score)).toFixed(2)}`
        : `score=${entry.score}`,
      entry.result.toUpperCase(),
    ].filter(Boolean);
    if (entry.stage) base.push(`stage=${entry.stage}`);
    if (entry.reason) base.push(`reason=${entry.reason}`);
    if (entry.checks && entry.checks.length > 0) {
      base.push(`checks=${entry.checks.join('; ')}`);
    }
    return base.join(' | ');
  });
  return `${header}${lines.join('\n')}\n`;
};

export const countRecentFlags = async (userId: string, sinceMs: number) => {
  const row = await queryOne<{ count: string | number }>(
    `SELECT COUNT(1) AS count
     FROM anti_cheat_logs
     WHERE user_id = $1
       AND result = 'flag'
       AND ts >= $2`,
    [userId, sinceMs],
  );
  return toNumber(row?.count) ?? 0;
};

export const FLAG_ESCALATION_WINDOW_MS = 30 * 60 * 1000;
export const FLAG_ESCALATION_THRESHOLD = 5;

export type AntiCheatPlayRestriction = {
  blocked: boolean;
  recentFlags: number;
  threshold: number;
  windowMs: number;
  retryAfterMs: number;
};

export const getAntiCheatPlayRestriction = async (
  userId: string,
  nowMs: number = Date.now(),
): Promise<AntiCheatPlayRestriction> => {
  const sinceMs = nowMs - FLAG_ESCALATION_WINDOW_MS;
  const result = await query<{ ts: string | number }>(
    `SELECT ts
     FROM anti_cheat_logs
     WHERE user_id = $1
       AND result = 'flag'
       AND ts >= $2
     ORDER BY ts ASC`,
    [userId, sinceMs],
  );

  const rows = result.rows.map((row) => ({ ts: toNumber(row.ts) ?? 0 }));
  const recentFlags = rows.length;
  if (recentFlags < FLAG_ESCALATION_THRESHOLD) {
    return {
      blocked: false,
      recentFlags,
      threshold: FLAG_ESCALATION_THRESHOLD,
      windowMs: FLAG_ESCALATION_WINDOW_MS,
      retryAfterMs: 0,
    };
  }

  const unblockIndex = recentFlags - FLAG_ESCALATION_THRESHOLD;
  const unblockAt = rows[unblockIndex].ts + FLAG_ESCALATION_WINDOW_MS;
  return {
    blocked: true,
    recentFlags,
    threshold: FLAG_ESCALATION_THRESHOLD,
    windowMs: FLAG_ESCALATION_WINDOW_MS,
    retryAfterMs: Math.max(0, unblockAt - nowMs),
  };
};

export const clearRecentFlagRestriction = async (
  userId: string,
  nowMs: number = Date.now(),
) => {
  const sinceMs = nowMs - FLAG_ESCALATION_WINDOW_MS;
  const result = await query(
    `DELETE FROM anti_cheat_logs
     WHERE user_id = $1
       AND result = 'flag'
       AND ts >= $2`,
    [userId, sinceMs],
  );
  return result.rowCount ?? 0;
};

/** Days of anti-cheat log the server keeps (ANTI_CHEAT_LOG_RETENTION_DAYS). */
export const getAntiCheatLogRetentionDays = () => ANTI_CHEAT_LOG_RETENTION_DAYS;
