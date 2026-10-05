import 'server-only';

/* Everything one profile needs, read once and shared by the profile pages,
   the player card image and the embed (docs/design/tixy-rebrand/PROFILES.md).
   Who may see it is decided here too, so the card and the embed can never
   show more than the page does. */

import { readAccountSettings, type AccountSettings } from '@/features/account/account-settings';
import {
  ACCOUNT_PROFILE_DETAILS_KEY,
  readAccountProfileDetails,
  type AccountProfileDetails,
} from '@/features/users/account-profile-details';
import {
  maxShowcaseSlots,
  visibleShowcases,
  type ProfileShowcase,
} from '@/features/users/profile-showcase';
import {
  getAccountById,
  getAccountByUsername,
  getAccountData,
  type AccountPublicProfile,
} from '@/server/accounts';
import { getAchievementsForUser, type AchievementView } from '@/server/arcade/achievements';
import { getAccountLevelState, type AccountLevelState } from '@/server/arcade/levels';
import {
  getBoardRank,
  getPlayerProfileData,
  type PlayerProfileData,
  type ProfileGameNumber,
} from '@/server/arcade/player-profile';
import { getEquippedProfileFlair, type ProfileFlair } from '@/server/arcade/rewards/profile-flair';
import { getUserOwnedStoreItems } from '@/server/arcade/rewards/store';
import type { StoreItem } from '@/server/arcade/rewards/types';

export type ProfileVisibility = AccountSettings['profileVisibility'];

export type FeaturedScore = ProfileGameNumber & { rank: { rank: number; of: number } | null };

export type ProfileView = {
  account: Pick<AccountPublicProfile, 'id' | 'username' | 'imageUrl' | 'createdAt'>;
  name: string;
  href: string;
  visibility: ProfileVisibility;
  details: AccountProfileDetails;
  flair: ProfileFlair;
  level: AccountLevelState;
  achievements: ProfileAchievementSet;
  data: PlayerProfileData;
  /** Slots the level unlocks. */
  slots: number;
  /** The player's own list, or the auto layout, cut to `slots`. */
  showcases: ProfileShowcase[];
  /** True while the player has not arranged a showcase. */
  autoShowcase: boolean;
  /** Prizes the player got themselves (not the ones every player has),
   *  newest first. */
  ownedItems: StoreItem[];
  /** The number the card leads with: the first featured score slot, else the
   *  most played game with a number. */
  featured: FeaturedScore | null;
};

export async function getAccountByIdentifier(identifier: string) {
  let trimmed = '';
  try {
    trimmed = decodeURIComponent(identifier).trim();
  } catch {
    return null;
  }
  if (!trimmed || trimmed.includes('/')) return null;
  return (await getAccountByUsername(trimmed)) ?? (await getAccountById(trimmed));
}

export function profileHref(account: Pick<AccountPublicProfile, 'id' | 'username'>) {
  return `/u/${encodeURIComponent(account.username ?? account.id)}`;
}

export async function readProfileVisibility(userId: string): Promise<ProfileVisibility> {
  const settings = await getAccountData(userId, 'settings');
  return readAccountSettings(settings?.value).profileVisibility;
}

export function canViewProfile(input: {
  account: Pick<AccountPublicProfile, 'id' | 'status'>;
  viewer: { userId: string; roles?: readonly string[] } | null;
  visibility: ProfileVisibility;
}) {
  const isOwner = input.viewer?.userId === input.account.id;
  const isAdmin = input.viewer?.roles?.includes('admin') ?? false;
  if (isOwner || isAdmin) return true;
  if (input.account.status !== 'active') return false;
  if (input.visibility === 'public') return true;
  if (input.visibility === 'players') return Boolean(input.viewer);
  return false;
}

export type ProfileAchievementSet = {
  unlocked: number;
  total: number;
  /** Pinned (in the player's order), else the rarest they have; up to six. */
  featured: AchievementView[];
  /** Nothing earned yet: the three closest to unlocking, for the showcase. */
  next: AchievementView[];
};

/* Like getProfileAchievements, from one read, plus the closest locked ones
   for a player who has none yet. */
function profileAchievements(
  state: Awaited<ReturnType<typeof getAchievementsForUser>>,
  pinnedIds: string[],
): ProfileAchievementSet {
  const earned = [...state.achievements, ...state.retired].filter((a) => a.unlocked);
  const byId = new Map(earned.map((a) => [a.id, a]));
  let featured = pinnedIds.map((id) => byId.get(id)).filter((a): a is AchievementView => Boolean(a));
  if (featured.length === 0) {
    featured = [...earned].sort((a, b) => a.globalRate - b.globalRate || b.xp - a.xp).slice(0, 3);
  }
  const next =
    earned.length === 0
      ? state.achievements
          .filter((a) => !a.unlocked && !a.hidden && !a.retired)
          .sort((a, b) => b.progress - a.progress || b.globalRate - a.globalRate)
          .slice(0, 3)
      : [];
  return { unlocked: state.summary.unlocked, total: state.summary.total, featured: featured.slice(0, 6), next };
}

const RARITY_RANK: Record<string, number> = { common: 0, uncommon: 1, rare: 2, epic: 3, legendary: 4 };

/** Rarest first, then newest (the list arrives newest first). */
export function rarestFirst(items: StoreItem[]) {
  return [...items].sort((a, b) => (RARITY_RANK[b.rarity] ?? 0) - (RARITY_RANK[a.rarity] ?? 0));
}

export async function loadProfileView(
  account: Pick<AccountPublicProfile, 'id' | 'username' | 'imageUrl' | 'createdAt'>,
): Promise<ProfileView> {
  const [detailsData, settingsData, flair, level, data, owned] = await Promise.all([
    getAccountData(account.id, ACCOUNT_PROFILE_DETAILS_KEY),
    getAccountData(account.id, 'settings'),
    getEquippedProfileFlair(account.id),
    getAccountLevelState(account.id),
    getPlayerProfileData(account.id),
    getUserOwnedStoreItems(account.id).catch((error) => {
      console.error('[profile] owned items failed:', error);
      return [];
    }),
  ]);
  const details = readAccountProfileDetails(detailsData?.value);
  const achievements = profileAchievements(await getAchievementsForUser(account.id), details.featuredAchievementIds);
  const ownedItems = owned.filter((entry) => !entry.grantedToAll).map((entry) => entry.item);

  const slots = maxShowcaseSlots(level.level);
  const showcases = visibleShowcases({
    stored: details.showcases,
    level: level.level,
    facts: {
      bestSlugs: data.numbers.map((game) => game.slug),
      playedSlugs: data.playedSlugs,
      hasAchievements: achievements.featured.length > 0 || achievements.next.length > 0,
      hasItems: ownedItems.length > 0,
    },
  });

  const pinned = showcases.find((slot) => slot.type === 'featured-score');
  const featuredGame =
    (pinned && data.numbers.find((game) => game.slug === pinned.ref)) ?? data.numbers[0] ?? null;
  const featured = featuredGame
    ? { ...featuredGame, rank: await getBoardRank(featuredGame.slug, featuredGame.label, featuredGame.value) }
    : null;

  return {
    account: {
      id: account.id,
      username: account.username,
      imageUrl: account.imageUrl,
      createdAt: account.createdAt,
    },
    name: account.username ?? 'player',
    href: profileHref(account),
    visibility: readAccountSettings(settingsData?.value).profileVisibility,
    details,
    flair,
    level,
    achievements,
    data,
    slots,
    showcases,
    autoShowcase: details.showcases === null,
    ownedItems,
    featured,
  };
}
