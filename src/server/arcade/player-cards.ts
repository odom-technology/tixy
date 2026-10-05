// ---------------------------------------------------------------------------
// Player "namecard" view-model: everything needed to render a player's full
// cosmetic identity anywhere (leaderboards, match player bars, profiles):
// display name + avatar + equipped profile flair (name color, frame, badge,
// title, background). Batched so leaderboards/lists do a single round trip.
// ---------------------------------------------------------------------------
import { query } from '@/server/db/client';
import { adminAvatarBySrc } from '@/features/users/avatars';
import {
  EMPTY_PROFILE_FLAIR,
  listEquippedProfileFlairForUsers,
  type ProfileFlair,
} from '@/server/arcade/rewards/profile-flair';

export type PlayerCard = {
  userId: string;
  name: string;
  avatarUrl: string | null;
  flair: ProfileFlair;
};

type AccountRow = {
  id: string;
  username: string | null;
  email: string;
  image_url: string | null;
  has_admin_role: boolean;
};

/**
 * Batched player cards for a set of user ids. One query for accounts + one for
 * equipped flair (via listEquippedProfileFlairForUsers). Returns a map keyed by
 * userId; missing users are simply absent.
 */
export async function getPlayerCardsForUsers(
  userIds: string[],
): Promise<Map<string, PlayerCard>> {
  const ids = [...new Set(userIds.filter((id) => typeof id === 'string' && id.trim()))].slice(0, 200);
  const result = new Map<string, PlayerCard>();
  if (ids.length === 0) return result;

  const [accounts, flairByUser] = await Promise.all([
    query<AccountRow>(
      `
        SELECT a.id, a.username, a.email, a.image_url,
          EXISTS (
            SELECT 1 FROM arcade_account_roles r
            WHERE r.user_id = a.id AND r.role = 'admin'
          ) AS has_admin_role
        FROM arcade_accounts a
        WHERE a.id = ANY($1::text[])
          AND a.status = 'active'
      `,
      [ids],
    ),
    listEquippedProfileFlairForUsers(ids),
  ]);

  for (const row of accounts.rows) {
    const adminAvatar = row.image_url ? adminAvatarBySrc(row.image_url) : null;
    result.set(row.id, {
      userId: row.id,
      // Never surface email as a public display name — fall back to a neutral
      // label if a username is somehow unset (see anti-abuse work).
      name: row.username || 'Player',
      avatarUrl: adminAvatar
        ? row.has_admin_role ? adminAvatar.src : null
        : row.image_url ?? null,
      flair: flairByUser.get(row.id) ?? { ...EMPTY_PROFILE_FLAIR },
    });
  }
  return result;
}

/** Single-user convenience (profile pages). */
export async function getPlayerCard(userId: string): Promise<PlayerCard | null> {
  const map = await getPlayerCardsForUsers([userId]);
  return map.get(userId) ?? null;
}
