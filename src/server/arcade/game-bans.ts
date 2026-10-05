import { query, queryOne } from '@/server/db/client';

export const MAX_BAN_HOURS = 11;
export const MAX_BAN_MINUTES = 59;

type GameBanRow = {
  user_id: string;
  banned_at: string | number;
  banned_until: string | number | null;
  is_indefinite: boolean | number;
  reason: string | null;
  banned_by: string | null;
};

export type GameBanStatus = {
  isBanned: boolean;
  isIndefinite: boolean;
  bannedAt: number | null;
  bannedUntil: number | null;
  reason: string | null;
  bannedBy: string | null;
  remainingMs: number;
};

const noBan = (): GameBanStatus => ({
  isBanned: false,
  isIndefinite: false,
  bannedAt: null,
  bannedUntil: null,
  reason: null,
  bannedBy: null,
  remainingMs: 0,
});

const toNumber = (value: string | number | null) => {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export const getGameBanStatus = async (
  userId: string,
  nowMs: number = Date.now(),
): Promise<GameBanStatus> => {
  const row = await queryOne<GameBanRow>(
    `SELECT user_id, banned_at, banned_until, is_indefinite, reason, banned_by
     FROM game_bans
     WHERE user_id = $1`,
    [userId],
  );

  if (!row) {
    return noBan();
  }

  const isIndefinite = row.is_indefinite === true || row.is_indefinite === 1;
  const bannedAt = toNumber(row.banned_at);
  const bannedUntil = toNumber(row.banned_until);
  if (!isIndefinite && bannedUntil !== null && bannedUntil <= nowMs) {
    await query('DELETE FROM game_bans WHERE user_id = $1', [userId]);
    return noBan();
  }

  return {
    isBanned: true,
    isIndefinite,
    bannedAt,
    bannedUntil,
    reason: row.reason,
    bannedBy: row.banned_by,
    remainingMs:
      isIndefinite || bannedUntil === null
        ? 0
        : Math.max(0, bannedUntil - nowMs),
  };
};

export const setGameBan = async ({
  userId,
  bannedBy,
  hours,
  minutes,
  indefinite,
  reason,
}: {
  userId: string;
  bannedBy?: string | null;
  hours: number;
  minutes: number;
  indefinite: boolean;
  /** The admin's own words; without one the row says how long the ban is for. */
  reason?: string | null;
}) => {
  const parsedHours = Math.max(0, Math.min(MAX_BAN_HOURS, Math.floor(hours)));
  const parsedMinutes = Math.max(
    0,
    Math.min(MAX_BAN_MINUTES, Math.floor(minutes)),
  );
  const totalMinutes = parsedHours * 60 + parsedMinutes;
  if (!indefinite && totalMinutes <= 0) {
    throw new Error('Ban duration must be greater than 0 minutes.');
  }
  const nowMs = Date.now();
  const bannedUntil = indefinite ? null : nowMs + totalMinutes * 60 * 1000;

  await query(
    `INSERT INTO game_bans (user_id, banned_at, banned_until, is_indefinite, reason, banned_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT(user_id) DO UPDATE SET
       banned_at = excluded.banned_at,
       banned_until = excluded.banned_until,
       is_indefinite = excluded.is_indefinite,
       reason = excluded.reason,
       banned_by = excluded.banned_by`,
    [
      userId,
      nowMs,
      bannedUntil,
      indefinite,
      reason?.trim() ||
        (indefinite
          ? 'Banned by admin indefinitely'
          : `Banned by admin for ${parsedHours}h ${parsedMinutes}m`),
      bannedBy ?? null,
    ],
  );
};

export const clearGameBan = async (userId: string) => {
  await query('DELETE FROM game_bans WHERE user_id = $1', [userId]);
};

const AUTO_BAN_DURATION_MINUTES = 30;

export const applyAutomaticAntiCheatBan = async ({
  userId,
  reason,
  nowMs = Date.now(),
}: {
  userId: string;
  reason?: string;
  nowMs?: number;
}) => {
  const current = await getGameBanStatus(userId, nowMs);
  if (current.isBanned && current.isIndefinite) {
    return current;
  }

  const durationMinutes = AUTO_BAN_DURATION_MINUTES;
  const extensionMs = durationMinutes * 60 * 1000;
  const baseUntil =
    current.isBanned && current.bannedUntil !== null && current.bannedUntil > nowMs
      ? current.bannedUntil
      : nowMs;
  const bannedUntil = baseUntil + extensionMs;

  await query(
    `INSERT INTO game_bans (user_id, banned_at, banned_until, is_indefinite, reason, banned_by)
     VALUES ($1, $2, $3, false, $4, $5)
     ON CONFLICT(user_id) DO UPDATE SET
       banned_at = excluded.banned_at,
       banned_until = CASE
         WHEN game_bans.is_indefinite THEN game_bans.banned_until
         ELSE excluded.banned_until
       END,
       is_indefinite = game_bans.is_indefinite,
       reason = CASE
         WHEN game_bans.is_indefinite THEN game_bans.reason
         ELSE excluded.reason
       END,
       banned_by = CASE
         WHEN game_bans.is_indefinite THEN game_bans.banned_by
         ELSE excluded.banned_by
       END`,
    [
      userId,
      nowMs,
      bannedUntil,
      reason?.trim()
        ? `Auto anti-cheat ban (${durationMinutes}m): ${reason.trim()}`
        : `Auto anti-cheat ban (${durationMinutes}m): repeated flagged runs`,
      'system:auto-anti-cheat',
    ],
  );

  return getGameBanStatus(userId, nowMs);
};
