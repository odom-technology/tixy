import type { ArcadeFloorGroupId } from '@/features/arcade/components/arcade-game-registry';
import type { StoreRarity } from '@/features/arcade/lib/rewards';

export type AchievementCategory =
  | 'meta'
  | 'global'
  | 'arcade'
  | 'multiplayer'
  | 'daily'
  | 'economy'
  | 'dedication'
  | 'mastery'
  | 'secret';

/** Single stat comparison. Missing stat reads as absent (see engine guard). */
export type StatComparator = {
  stat: string;
  gte?: number;
  lte?: number;
  eq?: number;
};

/** A condition is one comparator, or an AND of several (compound feats). */
export type AchievementCondition = StatComparator | { all: StatComparator[] };

export const TIER_LABELS = ['Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond'] as const;
export type TierLabel = (typeof TIER_LABELS)[number];

export type AchievementDef = {
  id: string;
  /** Groups tiers of one track; absent for standalones. */
  seriesId?: string;
  /** 0 = standalone, 1..N = tier within a series. */
  tier: number;
  tierLabel?: TierLabel;
  name: string;
  /** Revealed description (also the "how you got it" line for secrets). */
  description: string;
  /** Optional teaser shown while a secret is still locked. */
  hint?: string;
  category: AchievementCategory;
  /** Hidden (secret) achievements render as "???" until unlocked. */
  hidden: boolean;
  rarity: StoreRarity;
  /** Flat account XP granted on unlock. */
  xp: number;
  /** Achievement-exclusive store item granted on unlock (top tiers / feats). */
  cosmeticId?: string;
  /** Badge reference, "badge:<glyph>:<tier>" (badges.ts); AchievementIcon draws it. */
  icon: string;
  condition: AchievementCondition;
  /** For easter eggs gated on a secret.<key> trigger counter. */
  secretTriggerKey?: string;
  /** Game slug a series belongs to. A series whose game is off the floor is retired. */
  game?: string;
  /** "Play every game in <group>": judged against the floor when it is evaluated. */
  floorGroup?: ArcadeFloorGroupId;
  /** Retired by name (a standalone with no single game). Holders keep it. */
  retired?: boolean;
};

/** Returned to the client for the unlock toast. */
export type UnlockResult = {
  id: string;
  name: string;
  description: string;
  icon: string;
  rarity: StoreRarity;
  category: AchievementCategory;
  tier: number;
  tierLabel?: TierLabel;
  xp: number;
  cosmeticId?: string;
};

/** One achievement merged with a user's progress, for the page + profile. */
export type AchievementView = {
  id: string;
  seriesId?: string;
  /** The series' name without the tier number, for a series card's heading. */
  seriesName?: string;
  /** Slug of the game a series belongs to; absent for cross-game series and feats. */
  game?: string;
  tier: number;
  tierLabel?: TierLabel;
  name: string;
  description: string;
  hint?: string;
  category: AchievementCategory;
  hidden: boolean;
  rarity: StoreRarity;
  xp: number;
  cosmeticId?: string;
  icon: string;
  unlocked: boolean;
  unlockedAt: number | null;
  /** Off the floor: listed only to players who earned it, on the retired shelf. */
  retired: boolean;
  /** 0..1 toward the next threshold (1 when unlocked). */
  progress: number;
  /** Raw current value of the primary stat (for "420 / 500"). */
  current: number;
  /** Target value of the primary stat. */
  target: number;
  /** Fraction of players who have this (0..1), for rarity display. */
  globalRate: number;
};
