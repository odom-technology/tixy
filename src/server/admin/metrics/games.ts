import {
  ARCADE_GAMES,
  getFloorGames,
  getGamePlacement,
  isOnFloor,
  type ArcadeGameEntry,
} from '@/features/arcade/components/arcade-game-registry';

import type { GameRef } from './types';

/* Game identity for the metrics. Stored keys are not uniform: score tables
   use the registry slug ('snake', '2048'), wager machines use their history
   type ('arcade-blackjack' for the slug '21'), the cabinet stack run is
   'stack-cabinet' for the slug 'stack', and product analytics uses the slug
   from the URL. One game can arrive under more than one key, so the metrics
   merge them under the canonical key from `canonicalGameKey`. */

const BY_HISTORY_TYPE = new Map<string, ArcadeGameEntry>();
const BY_SLUG = new Map<string, ArcadeGameEntry>();
for (const game of ARCADE_GAMES) {
  BY_SLUG.set(game.slug, game);
  if (game.arcadeHistoryType) BY_HISTORY_TYPE.set(game.arcadeHistoryType, game);
}

/** Keys that are the same game as another stored key. */
export const GAME_KEY_ALIASES: Readonly<Record<string, string>> = {
  'stack-cabinet': 'stack',
};

function entryForKey(key: string): ArcadeGameEntry | null {
  const history = BY_HISTORY_TYPE.get(key);
  if (history) return history;
  const alias = GAME_KEY_ALIASES[key];
  if (alias && BY_SLUG.has(alias)) return BY_SLUG.get(alias) ?? null;
  return BY_SLUG.get(key) ?? null;
}

/** The key one game is reported under: its history type for a machine, its
    slug otherwise, and the stored key itself when the registry does not know it. */
export function canonicalGameKey(key: string): string {
  const entry = entryForKey(key);
  if (!entry) return key;
  return entry.arcadeHistoryType ?? entry.slug;
}

export function gameRef(key: string): GameRef {
  const entry = entryForKey(key);
  if (!entry) {
    return { key, slug: null, title: key, onFloor: false, group: null };
  }
  const placement = getGamePlacement(entry.slug);
  return {
    key,
    slug: entry.slug,
    title: entry.title,
    onFloor: isOnFloor(entry.slug),
    group:
      placement && placement.status === 'floor' ? placement.group : null,
  };
}

/** The canonical key of every game on the floor, in floor order. */
export function floorGameKeys(): string[] {
  return getFloorGames().map((game) => game.arcadeHistoryType ?? game.slug);
}

/** The canonical keys of floor games that are wager machines. */
export function floorMachineKeys(): string[] {
  return getFloorGames()
    .filter((game) => game.arcadeHistoryType)
    .map((game) => game.arcadeHistoryType as string);
}

/** Every machine key the registry knows. */
export function machineKeys(): string[] {
  return [...BY_HISTORY_TYPE.keys()];
}

/** SQL that maps a key column through GAME_KEY_ALIASES, so a distinct count
    over players does not double count a game stored under two keys. */
export function aliasKeySql(column: string): string {
  const cases = Object.entries(GAME_KEY_ALIASES)
    .map(([from, to]) => `WHEN '${from.replace(/'/g, "''")}' THEN '${to.replace(/'/g, "''")}'`)
    .join(' ');
  return `(CASE ${column} ${cases} ELSE ${column} END)`;
}

/** Floor rows first, in floor order; the rest after, by `weight` descending
    (then key, so the order is stable). */
export function splitFloor<T>(
  rows: readonly T[],
  keyOf: (row: T) => string,
  weight: (row: T) => number,
): { floor: T[]; offFloor: T[] } {
  const order = new Map(floorGameKeys().map((key, index) => [key, index]));
  const floor: T[] = [];
  const offFloor: T[] = [];
  for (const row of rows) {
    if (order.has(canonicalGameKey(keyOf(row)))) floor.push(row);
    else offFloor.push(row);
  }
  floor.sort(
    (a, b) =>
      (order.get(canonicalGameKey(keyOf(a))) ?? 0) - (order.get(canonicalGameKey(keyOf(b))) ?? 0),
  );
  offFloor.sort((a, b) => weight(b) - weight(a) || keyOf(a).localeCompare(keyOf(b)));
  return { floor, offFloor };
}
