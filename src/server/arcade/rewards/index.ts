// Types
export type {
  LedgerSourceType,
  WalletRow,
  StoreItem,
  RotationEntry,
  StoreVisibilityConfig,
  OwnedStoreItem,
  EquippedStoreItem,
  LedgerEntry,
  SkinGroup,
  GameRewardContext,
  GameRewardResult,
  DailyGameCreditsProgress,
  MonthlyRewardsResult,
  DailyClaimStatus,
  DailyClaimResult,
  DailyClaimReward,
  DailyClaimUnavailableReason,
} from './types';

// Re-export library types for convenience
export {
  type StoreRarity,
  type CurrencyType,
  type GameSlot,
  type RewardGameType,
} from './types';

// Helpers (date utilities)
export { getServerDateKey } from './helpers';

// Wallet + currency + game rewards
export {
  awardStoreCredits,
  getCombinedWalletForTransaction,
  mutateStoreCreditsForTransaction,
  type CombinedWalletBalance,
  type StoreCreditSourceType,
} from './store-credits';

export {
  consumeEntitlement,
  grantEntitlement,
  mutateEntitlementForTransaction,
  type EntitlementSourceType,
  type EntitlementType,
} from './entitlements';

export {
  getWalletForUser,
  adjustCurrencyByAdmin,
  adjustCurrencyByAdminForUsers,
  awardWalletCurrency,
  mutateWalletAndLedgerForTransaction,
  getDailyGameCreditsProgress,
  awardGameRunCredits,
  getArcadeEconomyStats,
  queryCurrencyLedger,
} from './wallet';

// Store rotation, catalog, user store operations
export {
  getStoreVisibilityConfig,
  setStoreVisibilityConfig,
  generateStoreDailyRotation,
  clearDeprecatedCurrencyRotation,
  getStoreCatalog,
  clearStoreCatalog,
  deleteStoreCatalogItems,
  retireStoreCatalogItems,
  StoreCatalogDeleteRefusedError,
  getUserInventoryAndEquipped,
  getStoreStateForUser,
  purchaseStoreItemForUser,
  grantStoreItem,
  removeStoreItemOwnership,
  equipStoreItemForUser,
  unequipStoreItemForUser,
} from './store';

// Payouts
export { runMonthlyLeaderboardRewards } from './payouts';
export { runDueWeeklyBoardAwards, runWeeklyBoardAwards } from './weekly-boards';

// Daily claim
export {} from './daily-claim';

// Skin studio admin CRUD + skin groups
export {
  listStoreItemsForSkinStudio,
  upsertStoreItemForSkinStudio,
  setStoreItemActiveForSkinStudio,
  setStoreItemsActiveForSkinStudio,
  listSkinGroups,
  upsertSkinGroup,
  deleteSkinGroup,
} from './skin-studio';
