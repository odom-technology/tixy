import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { readAccountSettings } from '@/features/account/account-settings';
import {
  ACCOUNT_SESSION_COOKIE,
  getAccountById,
  getAccountData,
  listAccountSessions,
} from '@/server/accounts';
import { getRecoveryCodeSummary } from '@/server/account-recovery';
import { requireIdentity } from '@/server/auth';
import { listFeedbackForUser } from '@/server/feedback';
import { getUnreadNotificationCount } from '@/server/services/notifications';
import type { ProfileEditFormProps } from '@/app/profile/_profile-edit-form';
import { getArcadeGameBySlug } from '@/features/arcade/components/arcade-game-registry';
import { getGameDisplayName } from '@/features/arcade/lib/game-renames';
import { ADMIN_AVATARS, DEFAULT_AVATARS, isAvatarAssetPath } from '@/features/users/avatars';
import { profileCosmeticOptions } from '@/features/users/profile-cosmetic-options';
import { getAchievementsForUser } from '@/server/arcade/achievements';
import { loadProfileView, rarestFirst } from '@/server/arcade/player-profile-view';
import { getUserInventoryAndEquipped } from '@/server/arcade/rewards/store';

import { SettingsClient, type SettingsTab } from './_settings-client';

export const metadata = {
  title: 'Settings | tixy.lol',
};

type SettingsPageProps = {
  searchParams?: Promise<{
    tab?: string | string[];
  }>;
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function parseSettingsTab(value: string | undefined): SettingsTab {
  if (
    value === 'preferences' ||
    value === 'security' ||
    value === 'activity' ||
    value === 'profile'
  ) {
    return value;
  }
  return 'overview';
}

export default async function SettingsPage({ searchParams }: SettingsPageProps) {
  let identity;
  try {
    identity = await requireIdentity({ allowExternal: true });
  } catch {
    redirect('/signin?next=/settings');
  }

  const params = searchParams ? await searchParams : {};
  const activeTab = parseSettingsTab(firstParam(params.tab));
  const cookieStore = await cookies();
  const currentToken = cookieStore.get(ACCOUNT_SESSION_COOKIE)?.value ?? null;
  const [
    account,
    settingsData,
    sessions,
    recoveryCodeSummary,
    unreadCount,
    feedbackEntries,
  ] = await Promise.all([
    getAccountById(identity.userId),
    getAccountData(identity.userId, 'settings'),
    listAccountSessions({
      userId: identity.userId,
      currentToken,
    }),
    getRecoveryCodeSummary(identity.userId),
    getUnreadNotificationCount(identity.userId),
    listFeedbackForUser(identity.userId, 10),
  ]);

  if (!account) redirect('/signin?next=/settings');

  // Profile inventory is only needed when the editor is open. Keep regular
  // settings navigation light while deriving avatar choices from owned items.
  let profileEditor: ProfileEditFormProps | null = null;
  if (activeTab === 'profile') {
    const [view, inventory, achievementState] = await Promise.all([
      loadProfileView(account),
      getUserInventoryAndEquipped(identity.userId),
      getAchievementsForUser(identity.userId),
    ]);
    const numberGames = view.data.numbers.map((game) => ({
      slug: game.slug,
      name: game.name,
      value: game.value,
      label: game.label,
      playtimeMs: game.playtimeMs,
    }));
    const playedGames = view.data.playedSlugs
      .map((slug) => {
        const game = getArcadeGameBySlug(slug);
        if (!game) return null;
        const best = view.data.numbers.find((entry) => entry.slug === slug);
        return {
          slug,
          name: getGameDisplayName(game.slug, game.title).toLowerCase(),
          value: best?.value ?? null,
          label: best?.label ?? null,
          playtimeMs: view.data.recent.find((entry) => entry.slug === slug)?.totalMs ?? best?.playtimeMs ?? 0,
        };
      })
      .filter((game): game is NonNullable<typeof game> => Boolean(game));
    profileEditor = {
      account: {
        email: account.email,
        username: account.username,
        imageUrl: account.imageUrl,
      },
      initialProfileDetails: view.details,
      initialShowcases: view.showcases,
      autoShowcase: view.autoShowcase,
      numberGames,
      playedGames,
      achievements: [...achievementState.achievements, ...achievementState.retired]
        .filter((achievement) => achievement.unlocked)
        .sort((a, b) => a.globalRate - b.globalRate)
        .map((achievement) => ({
          id: achievement.id,
          name: achievement.name,
          icon: achievement.icon,
          globalRate: achievement.globalRate,
        })),
      ownedItems: rarestFirst(view.ownedItems).map((item) => ({
        id: item.id,
        name: item.name,
        gameType: item.gameType,
        rarity: item.rarity,
        slots: item.slots,
        assetRef: item.assetRef,
      })),
      profilePath: view.href,
      avatarOptions: {
        admin: account.roles.includes('admin') ? ADMIN_AVATARS : [],
        defaults: DEFAULT_AVATARS,
        owned: inventory.ownedItems
          .filter((owned) => owned.item.gameType === 'profile' && owned.item.slots.includes('avatar'))
          .map((owned) => ({
            id: owned.item.id,
            name: owned.item.name,
            rarity: owned.item.rarity as 'common' | 'rare' | 'epic' | 'legendary',
            src: typeof owned.item.assetRef?.imageUrl === 'string' ? owned.item.assetRef.imageUrl : '',
          }))
          .filter((avatar) => isAvatarAssetPath(avatar.src)),
      },
      cosmeticOptions: profileCosmeticOptions(inventory),
      showcaseSlots: view.slots,
      accountLevel: view.level.level,
    };
  }

  return (
    <SettingsClient
      account={{
        email: account.email,
        username: account.username,
        status: account.status,
        roles: account.roles,
        lastLoginAt: account.lastLoginAt,
      }}
      activeTab={activeTab}
      initialSettings={readAccountSettings(settingsData?.value)}
      initialSessions={sessions}
      initialRecoveryCodeSummary={recoveryCodeSummary}
      initialUnreadCount={unreadCount}
      initialFeedbackEntries={feedbackEntries}
      profileEditor={profileEditor}
    />
  );
}
