// "Play every game in <group>": which stats say a game was played, and how far
// a player is through a group on today's floor.
import {
  ARCADE_GAMES,
  getFloorGroups,
  type ArcadeFloorGroupId,
} from '@/features/arcade/components/arcade-game-registry';
import { playedFlag } from '@/server/arcade/stats/stat-keys';

/** Stat keys that mark a game as played. Skill games and matches write
 *  played.<slug>; ticket machines settle under their arcade history type
 *  (arcade-blackjack for 21), so either key counts. */
export function playedKeysForGame(slug: string): string[] {
  const game = ARCADE_GAMES.find((g) => g.slug === slug);
  const keys = [playedFlag(slug)];
  if (game?.arcadeHistoryType) keys.push(playedFlag(game.arcadeHistoryType));
  return keys;
}

/** Every played key for every game that has ever had a placement. A game can
 *  move onto the floor, so the index covers all of them. */
export function allPlayedKeys(): string[] {
  return ARCADE_GAMES.flatMap((g) => playedKeysForGame(g.slug));
}

/** The slugs on the floor in a group today. */
export function floorSlugsInGroup(groupId: ArcadeFloorGroupId): string[] {
  return getFloorGroups()
    .filter(({ group }) => group.id === groupId)
    .flatMap(({ games }) => games.map((g) => g.slug));
}

export function groupProgress(
  groupId: ArcadeFloorGroupId,
  stats: Map<string, number>,
): { played: number; total: number } {
  const slugs = floorSlugsInGroup(groupId);
  const played = slugs.filter((slug) =>
    playedKeysForGame(slug).some((key) => (stats.get(key) ?? 0) >= 1),
  ).length;
  return { played, total: slugs.length };
}

export function groupComplete(
  groupId: ArcadeFloorGroupId,
  stats: Map<string, number>,
): boolean {
  const { played, total } = groupProgress(groupId, stats);
  return total > 0 && played >= total;
}
