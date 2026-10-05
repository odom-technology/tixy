/* In-game shots of every counter skin (scripts/capture-skin-shots.mjs).

   A shot is the game's own stage, captured from the game with that skin on:
   the real 3D scene for the 3D games, and the game's own renderer for the
   rest. The counter shows them on a card when you point at it, and in the
   preview for the games that are too heavy to start up there. `house` is
   each game's look with no skin on.

   The capture script writes public/art/skin-shots/<id>.webp and the manifest
   beside this file. */

import type { SkinGame } from '@/features/arcade/lib/skins/skin-set';

import manifest from './skin-shots.json';

type ShotManifest = {
  /* Width over height of every shot of a game. */
  aspect: Partial<Record<SkinGame, number>>;
  /* Item ids with a shot, plus `house-<game>`. */
  ids: string[];
};

const SHOTS = manifest as ShotManifest;
const IDS = new Set(SHOTS.ids);

export const SKIN_SHOT_DIR = '/art/skin-shots';

export const houseShotId = (game: SkinGame) => `house-${game}`;

/** The shot for an item id (or a house id), or null when there isn't one. */
export function skinShotSrc(id: string | null | undefined): string | null {
  return id && IDS.has(id) ? `${SKIN_SHOT_DIR}/${id}.webp` : null;
}

export function skinShotAspect(game: SkinGame): number | null {
  return SHOTS.aspect[game] ?? null;
}
