import { getListedGames } from '@/features/arcade/components/arcade-game-registry';
import { query } from '@/server/db/client';

export const GAME_POPULARITY_WINDOW_DAYS = 30;

type PopularityRow = {
  game_slug: string;
  play_count: string | number;
};

/**
 * Rolling popularity comes from the existing privacy-safe game_started funnel
 * event. It includes guests and accounts, stores no raw account identifier,
 * and records one event per game-route entry/client navigation.
 */
export async function getPopularGameSlugs(
  days = GAME_POPULARITY_WINDOW_DAYS,
): Promise<string[]> {
  const safeDays = Math.max(1, Math.min(90, Math.floor(days) || GAME_POPULARITY_WINDOW_DAYS));
  const cutoff = Date.now() - safeDays * 24 * 60 * 60 * 1000;
  // Only games players can find in a list are ranked; hidden games' events stay in the table.
  const registrySlugs = getListedGames().map((game) => game.slug);

  try {
    const result = await query<PopularityRow>(
      `SELECT game_slug, COUNT(*)::text AS play_count
         FROM product_analytics_events
        WHERE event_name = 'game_started'
          AND created_at >= $1
          AND game_slug = ANY($2::text[])
        GROUP BY game_slug
        ORDER BY COUNT(*) DESC, MAX(created_at) DESC, game_slug ASC`,
      [cutoff, registrySlugs],
    );
    return result.rows.map((row) => row.game_slug);
  } catch (error) {
    // A partially migrated/local database should retain deterministic registry
    // ordering instead of taking down the homepage.
    if ((error as { code?: string }).code === '42P01') return [];
    throw error;
  }
}
