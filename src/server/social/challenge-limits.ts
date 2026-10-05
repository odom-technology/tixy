// ---------------------------------------------------------------------------
// Generic challenge rate-limit + denial soft-block. One implementation for all
// PvP games (was duplicated as chess-/pool-challenge-limits). Storage is the
// unified arcade_challenge_denials table (keyed by game_type) + game_rate_events.
// The per-game modules are now thin bindings over this.
// ---------------------------------------------------------------------------
import { query, queryOne, withTransaction } from '@/server/db/client';

const SEND_PER_MINUTE_LIMIT = 5;
const SEND_PER_HOUR_LIMIT = 20;
const SEND_MINUTE_WINDOW_MS = 60_000;
const SEND_HOUR_WINDOW_MS = 60 * 60 * 1000;

const MAX_PENDING_OUTGOING = 5;
const MAX_PENDING_PER_PAIR = 1;

const DENIAL_THRESHOLD = 3;
const DENIAL_BLOCK_MS = 30 * 60 * 1000;

// Fixed per-game match tables (constants, never user input → safe to interpolate).
const MATCH_TABLE: Record<string, string> = {
  chess: 'chess_matches',
  '8-ball': 'pool_matches',
};

function matchTableFor(gameType: string): string {
  const table = MATCH_TABLE[gameType];
  if (!table) throw new Error(`Unknown challenge game type: ${gameType}`);
  return table;
}

export type ChallengeSendBlockReason =
  | 'minute_limit'
  | 'hour_limit'
  | 'outgoing_pending_limit'
  | 'pair_pending_limit'
  | 'target_blocked';

export type ChallengeSendAllowed = {
  ok: boolean;
  status?: 409 | 429;
  reason?: ChallengeSendBlockReason;
  message?: string;
  retryAfterMs?: number;
  matchId?: string;
};

type DenialRow = {
  denial_count: string | number;
  blocked_until: string | number | null;
};

const toNum = (value: unknown): number => (value == null ? 0 : Number(value));
const toNumOrNull = (value: unknown): number | null => (value == null ? null : Number(value));

const countSendsSince = async (gameType: string, userId: string, cutoff: number): Promise<number> => {
  const row = await queryOne<{ cnt: unknown }>(
    `SELECT COUNT(1) AS cnt FROM game_rate_events
     WHERE user_id = $1 AND game_type = $2 AND event_type = 'challenge_send' AND ts >= $3`,
    [userId, gameType, cutoff],
  );
  return toNum(row?.cnt);
};

const computeRateRetryAfterMs = async ({
  gameType,
  userId,
  now,
  windowMs,
}: {
  gameType: string;
  userId: string;
  now: number;
  windowMs: number;
}) => {
  const cutoff = now - windowMs;
  const oldest = await queryOne<{ ts: string | number }>(
    `SELECT ts FROM game_rate_events
     WHERE user_id = $1 AND game_type = $2 AND event_type = 'challenge_send' AND ts >= $3
     ORDER BY ts ASC LIMIT 1`,
    [userId, gameType, cutoff],
  );
  if (!oldest) return 1_000;
  return Math.max(1_000, toNum(oldest.ts) + windowMs - now);
};

export const checkChallengeSendAllowed = async ({
  gameType,
  senderUserId,
  targetUserId,
  now = Date.now(),
}: {
  gameType: string;
  senderUserId: string;
  targetUserId: string;
  now?: number;
}): Promise<ChallengeSendAllowed> => {
  const matchTable = matchTableFor(gameType);

  const denialRow = await queryOne<DenialRow>(
    `SELECT denial_count, blocked_until FROM arcade_challenge_denials
     WHERE game_type = $1 AND sender_user_id = $2 AND target_user_id = $3 LIMIT 1`,
    [gameType, senderUserId, targetUserId],
  );
  const blockedUntil = toNumOrNull(denialRow?.blocked_until ?? null);
  if (blockedUntil && blockedUntil > now) {
    return {
      ok: false,
      status: 429,
      reason: 'target_blocked',
      message: 'This user has declined your recent challenges. Wait before asking again.',
      retryAfterMs: blockedUntil - now,
    };
  }

  const minuteCount = await countSendsSince(gameType, senderUserId, now - SEND_MINUTE_WINDOW_MS);
  if (minuteCount >= SEND_PER_MINUTE_LIMIT) {
    return {
      ok: false,
      status: 429,
      reason: 'minute_limit',
      message: `Challenge send limit reached (${SEND_PER_MINUTE_LIMIT}/minute).`,
      retryAfterMs: await computeRateRetryAfterMs({ gameType, userId: senderUserId, now, windowMs: SEND_MINUTE_WINDOW_MS }),
    };
  }

  const hourCount = await countSendsSince(gameType, senderUserId, now - SEND_HOUR_WINDOW_MS);
  if (hourCount >= SEND_PER_HOUR_LIMIT) {
    return {
      ok: false,
      status: 429,
      reason: 'hour_limit',
      message: `Challenge send limit reached (${SEND_PER_HOUR_LIMIT}/hour).`,
      retryAfterMs: await computeRateRetryAfterMs({ gameType, userId: senderUserId, now, windowMs: SEND_HOUR_WINDOW_MS }),
    };
  }

  const outgoingPendingRow = await queryOne<{ cnt: unknown }>(
    `SELECT COUNT(1) AS cnt FROM ${matchTable}
     WHERE player1_id = $1 AND status = 'waiting' AND player2_id IS NULL AND invited_user_id IS NOT NULL`,
    [senderUserId],
  );
  if (toNum(outgoingPendingRow?.cnt) >= MAX_PENDING_OUTGOING) {
    return {
      ok: false,
      status: 409,
      reason: 'outgoing_pending_limit',
      message: `You can only keep ${MAX_PENDING_OUTGOING} outgoing challenges at once.`,
    };
  }

  const pendingPair = await queryOne<{ id: string }>(
    `SELECT id FROM ${matchTable}
     WHERE player1_id = $1 AND invited_user_id = $2 AND status = 'waiting' AND player2_id IS NULL
     LIMIT 1`,
    [senderUserId, targetUserId],
  );
  if (pendingPair && MAX_PENDING_PER_PAIR <= 1) {
    return {
      ok: false,
      status: 409,
      reason: 'pair_pending_limit',
      message: 'You already have a pending challenge for this user.',
      matchId: pendingPair.id,
    };
  }

  return { ok: true };
};

export const recordChallengeSend = async ({
  gameType,
  senderUserId,
  now = Date.now(),
}: {
  gameType: string;
  senderUserId: string;
  now?: number;
}) => {
  await query(
    `INSERT INTO game_rate_events (user_id, game_type, event_type, ts)
     VALUES ($1, $2, 'challenge_send', $3)`,
    [senderUserId, gameType, now],
  );
};

export const recordChallengeDenied = async ({
  gameType,
  senderUserId,
  targetUserId,
  now = Date.now(),
}: {
  gameType: string;
  senderUserId: string;
  targetUserId: string;
  now?: number;
}): Promise<{ blockedUntil: number | null; denialCount: number }> => {
  return withTransaction(async (client) => {
    const existingResult = await client.query<DenialRow>(
      `SELECT denial_count, blocked_until FROM arcade_challenge_denials
       WHERE game_type = $1 AND sender_user_id = $2 AND target_user_id = $3 LIMIT 1`,
      [gameType, senderUserId, targetUserId],
    );
    const existing = existingResult.rows[0];
    const existingBlockedUntil = toNumOrNull(existing?.blocked_until ?? null);

    const currentlyBlocked = Boolean(existingBlockedUntil && existingBlockedUntil > now);
    const baseCount = existingBlockedUntil && existingBlockedUntil <= now ? 0 : toNum(existing?.denial_count ?? 0);
    let denialCount = baseCount + 1;
    let blockedUntil: number | null = currentlyBlocked ? existingBlockedUntil : null;

    if (denialCount >= DENIAL_THRESHOLD) {
      blockedUntil = now + DENIAL_BLOCK_MS;
      denialCount = 0;
    }

    await client.query(
      `INSERT INTO arcade_challenge_denials (
         game_type, sender_user_id, target_user_id, denial_count, last_denied_at, blocked_until
       ) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (game_type, sender_user_id, target_user_id) DO UPDATE SET
         denial_count = EXCLUDED.denial_count,
         last_denied_at = EXCLUDED.last_denied_at,
         blocked_until = EXCLUDED.blocked_until`,
      [gameType, senderUserId, targetUserId, denialCount, now, blockedUntil],
    );
    await client.query(
      `INSERT INTO game_rate_events (user_id, game_type, event_type, ts)
       VALUES ($1, $2, 'challenge_deny', $3)`,
      [targetUserId, gameType, now],
    );
    return { blockedUntil, denialCount };
  });
};

export const clearChallengeDenials = async ({
  gameType,
  senderUserId,
  targetUserId,
}: {
  gameType: string;
  senderUserId: string;
  targetUserId: string;
}) => {
  await query(
    `DELETE FROM arcade_challenge_denials
     WHERE game_type = $1 AND sender_user_id = $2 AND target_user_id = $3`,
    [gameType, senderUserId, targetUserId],
  );
};
