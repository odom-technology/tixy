import {
  DEFAULT_ARCADE_THEME,
  type ArcadeThemeId,
  normalizeArcadeThemeId,
} from '@/features/arcade/lib/arcade-themes';

/* Dropped 2026-06: emailGameInvites/emailProductUpdates (no mailer ever
   shipped) and reduceMotion (the CSS honors the OS-level
   prefers-reduced-motion query instead). readAccountSettings ignores
   unknown keys, so blobs that still carry them stay readable. */
export type AccountSettings = {
  profileVisibility: 'public' | 'players' | 'private';
  gameNotifications: boolean;
  feedbackNotifications: boolean;
  arcadeTheme: ArcadeThemeId;
  defaultDashboardSection: 'all' | 'casual' | 'competitive' | 'daily' | 'wager';
};

export const DEFAULT_ACCOUNT_SETTINGS: AccountSettings = {
  profileVisibility: 'public',
  gameNotifications: true,
  feedbackNotifications: true,
  arcadeTheme: DEFAULT_ARCADE_THEME,
  defaultDashboardSection: 'all',
};

export function readAccountSettings(value: unknown): AccountSettings {
  if (!value || typeof value !== 'object') return DEFAULT_ACCOUNT_SETTINGS;
  const record = value as Partial<AccountSettings>;
  return {
    profileVisibility:
      record.profileVisibility === 'players' ||
      record.profileVisibility === 'private'
        ? record.profileVisibility
        : DEFAULT_ACCOUNT_SETTINGS.profileVisibility,
    gameNotifications:
      typeof record.gameNotifications === 'boolean'
        ? record.gameNotifications
        : DEFAULT_ACCOUNT_SETTINGS.gameNotifications,
    feedbackNotifications:
      typeof record.feedbackNotifications === 'boolean'
        ? record.feedbackNotifications
        : DEFAULT_ACCOUNT_SETTINGS.feedbackNotifications,
    arcadeTheme:
      normalizeArcadeThemeId(record.arcadeTheme) ??
      DEFAULT_ACCOUNT_SETTINGS.arcadeTheme,
    defaultDashboardSection:
      record.defaultDashboardSection === 'casual' ||
      record.defaultDashboardSection === 'competitive' ||
      record.defaultDashboardSection === 'daily' ||
      record.defaultDashboardSection === 'wager'
        ? record.defaultDashboardSection
        : DEFAULT_ACCOUNT_SETTINGS.defaultDashboardSection,
  };
}
