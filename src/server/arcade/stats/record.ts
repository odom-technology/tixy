// Low-level read/write for the user_stats counter store. No achievement logic
// here — see ./pipeline.ts for the orchestration that applies deltas and then
// evaluates achievements.
import { query } from '@/server/db/client';
import type { StatDelta } from './stat-keys';

const now = () => Date.now();

/**
 * Apply a batch of stat deltas for one user. Each delta UPSERTs by mode:
 *   add -> value = value + n
 *   max -> value = GREATEST(value, n)   (no-op if n isn't a new high)
 *   set -> value = n
 *
 * Returns the set of keys whose stored value actually CHANGED, so the caller
 * can evaluate only the achievements those keys feed (max/set are often no-ops).
 */
export async function applyStatDeltas(
  userId: string,
  deltas: StatDelta[],
): Promise<Set<string>> {
  const changed = new Set<string>();
  if (!userId || deltas.length === 0) return changed;

  const ts = now();
  for (const delta of deltas) {
    const value = Math.round(Number(delta.value) || 0);
    if (delta.mode === 'add' && value === 0) continue;

    const setExpr =
      delta.mode === 'add'
        ? 'user_stats.value + EXCLUDED.value'
        : delta.mode === 'max'
          ? 'GREATEST(user_stats.value, EXCLUDED.value)'
          : delta.mode === 'min'
            ? 'LEAST(user_stats.value, EXCLUDED.value)'
            : 'EXCLUDED.value';

    // Capture the prior value (if any) before the UPSERT so we know whether the
    // stored value actually moved — `max` is frequently a no-op.
    const row = await query<{ new_value: string; old_value: string | null }>(
      `WITH prev AS (
         SELECT value AS old_value FROM user_stats WHERE user_id = $1 AND stat_key = $2
       )
       INSERT INTO user_stats (user_id, stat_key, value, updated_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, stat_key) DO UPDATE SET
         value = ${setExpr},
         updated_at = EXCLUDED.updated_at
       RETURNING value AS new_value, (SELECT old_value FROM prev) AS old_value`,
      [userId, delta.key, value, ts],
    );
    const result = row.rows[0];
    if (!result) continue;
    const movedFromInsert = result.old_value === null;
    const movedFromUpdate =
      result.old_value !== null && Number(result.new_value) !== Number(result.old_value);
    if (movedFromInsert || movedFromUpdate) changed.add(delta.key);
  }
  return changed;
}

/** Read selected stats (or all) for a user as a key->number map. */
export async function getUserStats(
  userId: string,
  keys?: string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!userId) return out;
  const rows = keys && keys.length > 0
    ? await query<{ stat_key: string; value: string }>(
        `SELECT stat_key, value FROM user_stats WHERE user_id = $1 AND stat_key = ANY($2)`,
        [userId, keys],
      )
    : await query<{ stat_key: string; value: string }>(
        `SELECT stat_key, value FROM user_stats WHERE user_id = $1`,
        [userId],
      );
  for (const row of rows.rows) out.set(row.stat_key, Number(row.value));
  return out;
}

/** Bulk read a fixed key set for many users (profile rows, leaderboards). */
export async function getStatsForUsers(
  userIds: string[],
  keys: string[],
): Promise<Map<string, Map<string, number>>> {
  const out = new Map<string, Map<string, number>>();
  if (userIds.length === 0 || keys.length === 0) return out;
  const rows = await query<{ user_id: string; stat_key: string; value: string }>(
    `SELECT user_id, stat_key, value
       FROM user_stats
      WHERE user_id = ANY($1) AND stat_key = ANY($2)`,
    [userIds, keys],
  );
  for (const row of rows.rows) {
    let inner = out.get(row.user_id);
    if (!inner) {
      inner = new Map();
      out.set(row.user_id, inner);
    }
    inner.set(row.stat_key, Number(row.value));
  }
  return out;
}
