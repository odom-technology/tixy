// ---------------------------------------------------------------------------
// Friend activity feed. recordActivityEvent is ALWAYS fail-soft — it is called
// from gameplay/settle/score paths and must never throw into them.
// ---------------------------------------------------------------------------
import { randomUUID } from 'node:crypto';

import { readAccountSettings } from '@/features/account/account-settings';
import { getAccountData } from '@/server/accounts';
import { getArcadeFriendUserSummaries } from '@/server/arcade/friend-users';
import { listAcceptedFriendIds } from '@/server/arcade/multiplayer';
import { query, queryOne } from '@/server/db/client';
import { broadcast } from '@/server/events';

export type ActivityEventType =
  | 'high_score'
  | 'match_win'
  | 'achievement'
  | 'purchase'
  | 'friend_added';

export type ActivityFeedItem = {
  id: string;
  userId: string;
  name: string;
  imageUrl: string | null;
  type: ActivityEventType;
  payload: Record<string, unknown>;
  createdAt: number;
};

/** Record a feed event. Snapshots the actor's profileVisibility. Never throws. */
export async function recordActivityEvent(input: {
  userId: string;
  type: ActivityEventType;
  payload?: Record<string, unknown>;
}): Promise<void> {
  try {
    const settingsRecord = await getAccountData(input.userId, 'settings');
    const visibility = readAccountSettings(settingsRecord?.value).profileVisibility;
    await query(
      `INSERT INTO arcade_activity_events (id, user_id, type, payload_json, visibility, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [randomUUID(), input.userId, input.type, JSON.stringify(input.payload ?? {}), visibility, Date.now()],
    );

    // Live-refresh each friend's feed (notice-only; they re-fetch). Private
    // events still persist but aren't pushed.
    if (visibility !== 'private') {
      const friendIds = await listAcceptedFriendIds(input.userId);
      if (friendIds.length > 0) {
        broadcast(friendIds.map((id) => `user:${id}`), { type: 'activity' });
      }
    }
  } catch (error) {
    console.error('recordActivityEvent failed:', error);
  }
}

/** Recent public/players-visible activity from the viewer's accepted friends. */
export async function listFriendActivityForUser(userId: string, limit = 40): Promise<ActivityFeedItem[]> {
  const friends = await getArcadeFriendUserSummaries(userId);
  if (friends.length === 0) return [];

  const friendIds = friends.map((friend) => friend.userId);
  const byId = new Map(friends.map((friend) => [friend.userId, friend]));

  const result = await query<{
    id: string;
    user_id: string;
    type: string;
    payload_json: string;
    created_at: string | number;
  }>(
    `SELECT id, user_id, type, payload_json, created_at
     FROM arcade_activity_events
     WHERE user_id = ANY($1::text[]) AND visibility IN ('public', 'players')
     ORDER BY created_at DESC
     LIMIT $2`,
    [friendIds, Math.min(Math.max(limit, 1), 100)],
  );

  return result.rows.map((row) => {
    let payload: Record<string, unknown> = {};
    try {
      payload = JSON.parse(row.payload_json || '{}');
    } catch {
      payload = {};
    }
    const friend = byId.get(row.user_id);
    return {
      id: row.id,
      userId: row.user_id,
      name: friend?.name ?? 'Player',
      imageUrl: friend?.imageUrl ?? null,
      type: row.type as ActivityEventType,
      payload,
      createdAt: Number(row.created_at),
    };
  });
}

export type ProfileActivityItem = {
  id: string;
  type: ActivityEventType;
  payload: Record<string, unknown>;
  createdAt: number;
};

/**
 * A single player's own recent activity, for their profile card. Uses the
 * (user_id, created_at DESC) index. By default only public/players-visible
 * events are returned (public profile view); `includePrivate` surfaces every
 * event for the owner's own profile. Read-only, fail-soft to an empty list.
 */
export async function getRecentActivityForUser(
  userId: string,
  options: { limit?: number; includePrivate?: boolean } = {},
): Promise<ProfileActivityItem[]> {
  const limit = Math.min(Math.max(options.limit ?? 8, 1), 50);
  try {
    const rows = await query<{
      id: string;
      type: string;
      payload_json: string;
      created_at: string | number;
    }>(
      options.includePrivate
        ? `SELECT id, type, payload_json, created_at
             FROM arcade_activity_events
            WHERE user_id = $1
            ORDER BY created_at DESC
            LIMIT $2`
        : `SELECT id, type, payload_json, created_at
             FROM arcade_activity_events
            WHERE user_id = $1 AND visibility IN ('public', 'players')
            ORDER BY created_at DESC
            LIMIT $2`,
      [userId, limit],
    );
    return rows.rows.map((row) => {
      let payload: Record<string, unknown> = {};
      try {
        payload = JSON.parse(row.payload_json || '{}');
      } catch {
        payload = {};
      }
      return {
        id: row.id,
        type: row.type as ActivityEventType,
        payload,
        createdAt: Number(row.created_at),
      };
    });
  } catch (error) {
    console.error('getRecentActivityForUser failed:', error);
    return [];
  }
}

/**
 * Fire a `high_score` feed event if `newScore` beats the user's prior best.
 * Fail-soft. Call this BEFORE the score upsert so it reads the OLD best.
 * table/userColumn/scoreColumn are fixed constants (never user input).
 */
export async function recordHighScoreIfBeaten(input: {
  userId: string;
  gameSlug: string;
  table: string;
  userColumn: string;
  scoreColumn: string;
  newScore: number;
}): Promise<void> {
  try {
    const row = await queryOne<{ best: string | number }>(
      `SELECT ${input.scoreColumn} AS best FROM ${input.table} WHERE ${input.userColumn} = $1`,
      [input.userId],
    );
    const oldBest = Number(row?.best ?? 0);
    // Only announce an improvement over an existing best (not the very first score).
    if (oldBest > 0 && input.newScore > oldBest) {
      void recordActivityEvent({
        userId: input.userId,
        type: 'high_score',
        payload: { game: input.gameSlug, score: input.newScore },
      });
    }
  } catch (error) {
    console.error('recordHighScoreIfBeaten failed:', error);
  }
}
