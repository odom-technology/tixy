// ───────────────────────────────────────────────────────────────────────────
// Profile stat depth — the aggregate "stat strip" (games played + time played +
// most-played) and the per-game stat blocks for a player's most-played games.
// Powers both /profile (own) and /u/[identifier] (public), so a player with no
// configured showcases still gets a rich, data-driven card.
//
// READ-ONLY. Playtime is read straight from game_time_metrics_totals (indexed by
// PK (user_id, game_type)); per-game blocks reuse getGameProfileStats. Both the
// stat handlers and the game registry key on the same slug strings, and tracked
// game_type values match those slugs for the real (non-arcade-legacy) games.
// ───────────────────────────────────────────────────────────────────────────

import { query } from '@/server/db/client';
import { ARCADE_GAMES, getArcadeGameBySlug } from '@/features/arcade/components/arcade-game-registry';
import {
  getGameProfileStats,
  type GameProfileStats,
} from '@/server/arcade/game-profile-stats';

export type ProfileStatOverview = {
  /** Distinct registry games with recorded playtime. */
  gamesPlayed: number;
  /** Lifetime playtime (ms) across those games. */
  totalPlaytimeMs: number;
  /** Most-played registry game, if any. */
  mostPlayed: { slug: string; title: string; href: string } | null;
};

export type PlayerStatDepth = {
  overview: ProfileStatOverview;
  /** Per-game stat blocks for the most-played games, richest first. */
  gameBlocks: GameProfileStats[];
};

type TotalsRow = { game_type: string; total_duration_ms: string | number };

const toNum = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

/**
 * One query on game_time_metrics_totals → the aggregate overview + the ordered
 * list of registry-resolvable most-played slugs (richest first). Everything the
 * depth builder needs comes from this single read.
 */
async function readPlaytimeTotals(userId: string): Promise<{
  overview: ProfileStatOverview;
  orderedSlugs: string[];
}> {
  let rows: TotalsRow[] = [];
  try {
    const result = await query<TotalsRow>(
      `SELECT game_type, total_duration_ms
         FROM game_time_metrics_totals
        WHERE user_id = $1
        ORDER BY total_duration_ms DESC`,
      [userId],
    );
    rows = result.rows;
  } catch (error) {
    // Missing table on a partially-migrated DB → graceful empty overview.
    const code = (error as { code?: string }).code;
    if (code !== '42P01') throw error;
  }

  let totalPlaytimeMs = 0;
  let gamesPlayed = 0;
  const orderedSlugs: string[] = [];
  for (const row of rows) {
    const ms = toNum(row.total_duration_ms);
    if (ms <= 0) continue;
    const game = getArcadeGameBySlug(row.game_type);
    if (!game) continue; // skip legacy/untracked-in-registry buckets ('arcade', …)
    totalPlaytimeMs += ms;
    gamesPlayed += 1;
    orderedSlugs.push(game.slug);
  }

  const top = orderedSlugs[0] ? getArcadeGameBySlug(orderedSlugs[0]) : null;
  return {
    overview: {
      gamesPlayed,
      totalPlaytimeMs,
      mostPlayed: top ? { slug: top.slug, title: top.title, href: top.href } : null,
    },
    orderedSlugs,
  };
}

/**
 * Aggregate stat overview only (stat strip). One query.
 */
export async function getProfileStatOverview(userId: string): Promise<ProfileStatOverview> {
  const { overview } = await readPlaytimeTotals(userId);
  return overview;
}

/**
 * Full stat depth: aggregate overview + per-game stat blocks for the most-played
 * games. `excludeSlugs` drops games already shown elsewhere so blocks don't
 * duplicate. A zero limit returns only the overview, which profiles use when
 * favorites replace automatic blocks. Game-block reads run in one Promise.all.
 */
export async function getPlayerStatDepth(
  userId: string,
  options: { limit?: number; excludeSlugs?: string[] } = {},
): Promise<PlayerStatDepth> {
  const limit = Math.max(0, Math.min(6, options.limit ?? 4));
  const exclude = new Set(options.excludeSlugs ?? []);
  const { overview, orderedSlugs } = await readPlaytimeTotals(userId);
  if (limit === 0) return { overview, gameBlocks: [] };

  // Evaluate a few extra candidates so games with no per-user stat surface can
  // drop out and still leave a full row of real blocks.
  const candidates = orderedSlugs
    .filter((slug) => !exclude.has(slug))
    .slice(0, limit + 2);

  const resolved = await Promise.all(
    candidates.map((slug) => {
      const game = getArcadeGameBySlug(slug)!;
      return getGameProfileStats(userId, game.slug, game.title);
    }),
  );

  const gameBlocks = resolved.filter((block) => block.hasData).slice(0, limit);
  return { overview, gameBlocks };
}

export type MostPlayedGame = { slug: string; title: string; href: string };

/**
 * Batched most-played game per user for the player directory. ONE query using
 * DISTINCT ON to pick each user's top game_type by playtime — no N+1. Returns a
 * map keyed by userId; users with no tracked, registry-resolvable playtime are
 * absent.
 */
export async function getMostPlayedGamesForUsers(
  userIds: string[],
): Promise<Map<string, MostPlayedGame>> {
  const ids = [...new Set(userIds.filter((id) => typeof id === 'string' && id.trim()))];
  const result = new Map<string, MostPlayedGame>();
  if (ids.length === 0) return result;

  let rows: Array<{ user_id: string; game_type: string }> = [];
  try {
    // Filter to registry-resolvable game_types BEFORE DISTINCT ON so a user whose
    // single highest-playtime bucket is a legacy/unregistered game_type falls
    // through to their next VALID game rather than being dropped entirely.
    const registrySlugs = ARCADE_GAMES.map((g) => g.slug);
    const res = await query<{ user_id: string; game_type: string }>(
      `SELECT DISTINCT ON (user_id) user_id, game_type
         FROM game_time_metrics_totals
        WHERE user_id = ANY($1::text[]) AND total_duration_ms > 0
          AND game_type = ANY($2::text[])
        ORDER BY user_id, total_duration_ms DESC`,
      [ids, registrySlugs],
    );
    rows = res.rows;
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code !== '42P01') throw error;
  }

  for (const row of rows) {
    const game = getArcadeGameBySlug(row.game_type);
    if (!game) continue; // top bucket is legacy/untracked — leave user unset
    result.set(row.user_id, { slug: game.slug, title: game.title, href: game.href });
  }
  return result;
}
