import { query } from '@/server/db/client';
import { adminAvatarBySrc } from '@/features/users/avatars';
import { levelFromXp, levelTier } from '@/server/arcade/levels';
import { listEquippedProfileFlairForUsers } from '@/server/arcade/rewards/profile-flair';
import {
  leaderboardServerError,
  noStoreJson,
  resolveLeaderboardLimit,
  requireLeaderboardAccess,
} from '@/app/api/games/_shared/leaderboard-helpers';

export const dynamic = 'force-dynamic';

/**
 * Overall account-level board: ranks players by lifetime account XP (the index
 * idx_user_account_xp_xp backs the ordering). Returns username + equipped flair
 * so the board can render the full Username chrome alongside the level badge.
 */
export async function GET(request: Request) {
  const unauthorized = await requireLeaderboardAccess();
  if (unauthorized) return unauthorized;

  const { searchParams } = new URL(request.url);
  const limit = resolveLeaderboardLimit(searchParams);

  try {
    const rows = await query<{
      user_id: string;
      xp: string | number;
      level_floor: number;
      username: string | null;
      image_url: string | null;
      has_admin_role: boolean;
    }>(
      `SELECT x.user_id, x.xp, x.level_floor, a.username, a.image_url,
          EXISTS (
            SELECT 1 FROM arcade_account_roles r
            WHERE r.user_id = a.id AND r.role = 'admin'
          ) AS has_admin_role
         FROM user_account_xp x
         JOIN arcade_accounts a ON a.id = x.user_id
        WHERE x.xp > 0 AND a.status = 'active'
        ORDER BY x.xp DESC
        LIMIT $1`,
      [limit],
    );

    const flairByUser = await listEquippedProfileFlairForUsers(
      rows.rows.map((row) => row.user_id),
    );

    const leaderboard = rows.rows.map((row, index) => {
      const xp = Math.max(0, Number(row.xp ?? 0));
      const level = levelFromXp(xp, Number(row.level_floor ?? 1));
      const adminAvatar = row.image_url ? adminAvatarBySrc(row.image_url) : null;
      return {
        id: row.user_id,
        rank: index + 1,
        userId: row.user_id,
        userName: row.username,
        imageUrl: adminAvatar
          ? row.has_admin_role ? adminAvatar.src : null
          : row.image_url,
        xp,
        level,
        tier: levelTier(level),
        flair: flairByUser.get(row.user_id) ?? null,
      };
    });

    return noStoreJson({ leaderboard });
  } catch (error) {
    return leaderboardServerError(error);
  }
}
