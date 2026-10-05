// Catalog items that players earn rather than buy. Code grants them by id
// (achievements, battle pass tiers, profile milestones), so deleting one would
// make every future unlock grant nothing. The admin catalog never deletes them.
import { ACHIEVEMENTS } from '@/server/arcade/achievements/registry';
import { SEASON_0_ITEMS, SEASON_0_TIERS } from '@/server/arcade/battlepass/season-0';
import { SEASON_CARD_ITEMS } from '@/server/arcade/battlepass/season-card';
import { WEEKLY_BOARD_MEDAL } from '@/features/arcade/lib/weekly-boards';

/** Profile flair granted by src/server/services/profile-milestones.ts. */
export const MILESTONE_FLAIR_ITEM_IDS = {
  friends: 'profile-badge-connector',
  rankedWins: 'profile-title-strategist',
} as const;

let rewardOnlyIds: Set<string> | null = null;

const getRewardOnlyItemIds = () => {
  if (!rewardOnlyIds) {
    rewardOnlyIds = new Set<string>([
      ...ACHIEVEMENTS.flatMap((def) => (def.cosmeticId ? [def.cosmeticId] : [])),
      ...SEASON_0_ITEMS.map((item) => item.id),
      ...SEASON_CARD_ITEMS.map((item) => item.id),
      ...SEASON_0_TIERS.flatMap((tier) =>
        [tier.free, tier.premium].flatMap((reward) => (reward.kind === 'item' ? [reward.itemId] : [])),
      ),
      ...Object.values(MILESTONE_FLAIR_ITEM_IDS),
      // First place on a weekly board (rewards/weekly-boards.ts).
      WEEKLY_BOARD_MEDAL.itemId,
    ]);
  }
  return rewardOnlyIds;
};

/**
 * True for an item a player earns: any item with a season tag (battle pass,
 * achievement and admin-only items all carry one), or any id the reward code
 * grants directly.
 */
export const isRewardOnlyItem = (item: { id: string; seasonTag: string | null }) =>
  Boolean(item.seasonTag) || getRewardOnlyItemIds().has(item.id);
