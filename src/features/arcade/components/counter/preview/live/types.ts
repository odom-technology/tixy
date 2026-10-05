import type { SkinSet } from '@/features/arcade/lib/skins/skin-set';

/** A live preview gets the skin to draw, or null for the game's own look. */
export type LiveProps = { skin: SkinSet | null };
