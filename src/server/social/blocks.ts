// ---------------------------------------------------------------------------
// User-initiated blocks. A block is a symmetric gate: if either party blocks
// the other, DMs, friend requests, and challenges between them are refused.
// ---------------------------------------------------------------------------
import { query, queryOne } from '@/server/db/client';

export async function blockUser(blockerUserId: string, blockedUserId: string): Promise<void> {
  if (blockerUserId === blockedUserId) return;
  await query(
    `INSERT INTO arcade_user_blocks (blocker_user_id, blocked_user_id, created_at)
     VALUES ($1, $2, $3)
     ON CONFLICT (blocker_user_id, blocked_user_id) DO NOTHING`,
    [blockerUserId, blockedUserId, Date.now()],
  );
}

export async function unblockUser(blockerUserId: string, blockedUserId: string): Promise<void> {
  await query(
    `DELETE FROM arcade_user_blocks WHERE blocker_user_id = $1 AND blocked_user_id = $2`,
    [blockerUserId, blockedUserId],
  );
}

/** True if EITHER user has blocked the other (the gate is symmetric). */
export async function isBlocked(userA: string, userB: string): Promise<boolean> {
  if (userA === userB) return false;
  const row = await queryOne(
    `SELECT 1 FROM arcade_user_blocks
     WHERE (blocker_user_id = $1 AND blocked_user_id = $2)
        OR (blocker_user_id = $2 AND blocked_user_id = $1)
     LIMIT 1`,
    [userA, userB],
  );
  return row !== null;
}

/** Ids this user has blocked (one direction). */
export async function listBlockedUsers(userId: string): Promise<string[]> {
  const result = await query<{ blocked_user_id: string }>(
    `SELECT blocked_user_id FROM arcade_user_blocks WHERE blocker_user_id = $1`,
    [userId],
  );
  return result.rows.map((row) => row.blocked_user_id);
}
