import { query } from '@/server/db/client';

export type NamedLeaderboardEntry = {
  userId?: string;
  odUserId?: string;
  userName: string | null;
};

/** Historical scores keep their original names; public boards use the account's
 * current username. Resolve by stable ID in one query without changing ranks,
 * scores, or guest/external names that have no local account. */
export async function withCurrentLeaderboardNames<T extends NamedLeaderboardEntry>(
  entries: T[],
): Promise<T[]> {
  const ids = [...new Set(entries.map((entry) => entry.userId ?? entry.odUserId).filter(Boolean))];
  if (ids.length === 0) return entries;
  const accounts = await query<{ id: string; username: string | null }>(
    'SELECT id, username FROM arcade_accounts WHERE id = ANY($1::text[])',
    [ids],
  );
  const names = new Map(accounts.rows.map((account) => [account.id, account.username || 'Player']));
  return entries.map((entry) => {
    const id = entry.userId ?? entry.odUserId;
    const name = id ? names.get(id) : undefined;
    return name === undefined ? entry : { ...entry, userName: name };
  });
}
