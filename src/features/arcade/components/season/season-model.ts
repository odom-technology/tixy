import type { BattlepassState, TierView } from '@/server/arcade/battlepass';

/** The first tier you have not reached, or null when every tier is open. */
export const nextTier = (state: BattlepassState): TierView | null =>
  state.tiers.find((tier) => !tier.unlocked) ?? null;

/** XP still needed to reach a tier. */
export const xpToTier = (state: BattlepassState, tier: number): number =>
  Math.max(0, tier * state.xpPerTier - state.xp);

/** A season's name as a title, in sentence case: "Season 0". */
export const seasonTitle = (name: string): string => {
  const words = name.replace(' · ', ', ').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/** Tiers with something to claim. */
export const claimableTierCount = (state: BattlepassState): number =>
  state.tiers.filter(
    (tier) => tier.unlocked && (!tier.freeClaimed || (tier.premium != null && !tier.premiumClaimed)),
  ).length;
