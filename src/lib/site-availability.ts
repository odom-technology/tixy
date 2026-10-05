import { rebrandSiteText } from '@/lib/site-branding';
import { ARCADE_GAMES } from '@/features/arcade/components/arcade-game-registry';
import { canonicalGamePath } from '@/features/arcade/lib/game-renames';

export const SITE_SECTIONS = [
  { id: 'games', label: 'Games', description: 'All game pages and new gameplay.' },
  { id: 'store', label: 'Store', description: 'Store browsing and new purchases. Owned items remain available.' },
  { id: 'social', label: 'Social', description: 'Chat, friends, player directory, and social activity.' },
  { id: 'leaderboards', label: 'Leaderboards', description: 'Public scores and rankings.' },
  { id: 'tour', label: 'tixy Tour', description: 'Weekly tour pages and progress views.' },
  { id: 'seasonPass', label: 'Season Pass', description: 'Season pass, quests, and reward claims.' },
] as const;

export type SiteSectionId = (typeof SITE_SECTIONS)[number]['id'];
export type SiteAvailabilityConfig = {
  sections: Record<SiteSectionId, boolean>;
  registrationEnabled: boolean;
  ticketBundlesEnabled: boolean;
  disabledGames: string[];
  disabledGameDisplay: 'visible' | 'hidden';
  message: string;
};

export const DEFAULT_SITE_AVAILABILITY: SiteAvailabilityConfig = {
  sections: { games: true, store: true, social: true, leaderboards: true, tour: true, seasonPass: true },
  registrationEnabled: true,
  ticketBundlesEnabled: true,
  disabledGames: [],
  disabledGameDisplay: 'visible',
  message: 'This part of tixy is temporarily unavailable. Please check back soon.',
};

const GAME_SLUGS = new Set(ARCADE_GAMES.map((game) => game.slug));

export function normalizeSiteAvailabilityConfig(value: unknown): SiteAvailabilityConfig {
  const record = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
  const sections = record.sections && typeof record.sections === 'object' && !Array.isArray(record.sections)
    ? record.sections as Record<string, unknown> : {};
  return {
    sections: Object.fromEntries(SITE_SECTIONS.map(({ id }) => [id, sections[id] !== false])) as Record<SiteSectionId, boolean>,
    registrationEnabled: record.registrationEnabled !== false,
    ticketBundlesEnabled: record.ticketBundlesEnabled !== false,
    disabledGames: Array.isArray(record.disabledGames)
      ? [...new Set(record.disabledGames.filter((slug): slug is string => typeof slug === 'string' && GAME_SLUGS.has(slug)))] : [],
    disabledGameDisplay: record.disabledGameDisplay === 'hidden' ? 'hidden' : 'visible',
    message: typeof record.message === 'string' && record.message.trim()
      ? rebrandSiteText(record.message.trim()).slice(0, 1200) : DEFAULT_SITE_AVAILABILITY.message,
  };
}

export type AvailabilityRestriction = { id: string; label: string; message: string };

export function gameSlugFromType(gameType: string): string {
  const slug = gameType.replace(/^arcade-/, '');
  return slug === 'blackjack' ? '21' : slug;
}

export function getGameRestriction(config: SiteAvailabilityConfig, gameType: string): AvailabilityRestriction | null {
  const slug = gameSlugFromType(gameType);
  if (!config.sections.games || config.disabledGames.includes(slug)) {
    return { id: slug, label: ARCADE_GAMES.find((game) => game.slug === slug)?.title ?? 'Games', message: config.message };
  }
  return null;
}

const within = (path: string, prefix: string) => path === prefix || path.startsWith(`${prefix}/`);

export function getPathRestriction(config: SiteAvailabilityConfig, requestedPathname: string): AvailabilityRestriction | null {
  // A renamed game is served at its new route; its rules are keyed by the old slug.
  const pathname = canonicalGamePath(requestedPathname);
  // Administrative controls, account recovery, and payment reconciliation always remain reachable.
  if (within(pathname, '/admin') || within(pathname, '/api/admin') || within(pathname, '/api/account/admin') || within(pathname, '/api/cron') || pathname === '/api/stripe/webhook') return null;
  if (!config.registrationEnabled && pathname === '/api/account/register') {
    return { id: 'registration', label: 'New accounts', message: config.message };
  }
  if (!config.ticketBundlesEnabled && within(pathname, '/api/store/ticket-packs')) {
    return { id: 'ticketBundles', label: 'Ticket bundles', message: config.message };
  }
  const paths: Record<SiteSectionId, string[]> = {
    // Gameplay start functions enforce this section. Existing rounds must still finish and settle.
    games: [],
    store: ['/store', '/api/store'],
    social: ['/social', '/messages', '/players', '/api/social', '/api/messages', '/api/friends', '/api/players'],
    leaderboards: ['/leaderboard', '/api/leaderboard', '/api/wagers/leaderboard'],
    tour: ['/tour', '/api/games/arcade-tour'],
    seasonPass: ['/battlepass', '/api/battlepass'],
  };
  for (const section of SITE_SECTIONS) {
    if (config.sections[section.id]) continue;
    if (section.id === 'store' && ['/api/store/inventory', '/api/store/equip', '/api/store/unequip'].some((path) => within(pathname, path))) continue;
    if (paths[section.id].some((path) => within(pathname, path)) ||
      (section.id === 'leaderboards' && pathname.startsWith('/api/games/') && /\/(?:leaderboard|elo-leaderboard)$/.test(pathname))) {
      return { id: section.id, label: section.label, message: config.message };
    }
  }
  const slug = pathname.split('/')[1];
  if (GAME_SLUGS.has(slug)) return getGameRestriction(config, slug);
  const apiParts = pathname.split('/');
  const apiSlug = pathname.startsWith('/api/games/') ? apiParts[3] : null;
  if (apiSlug && GAME_SLUGS.has(apiSlug)) {
    const isNewPuzzle = apiParts[4] === 'puzzle';
    const isDailyPuzzlePlay = ['pangram', 'word-grid', 'connections'].includes(apiSlug) && apiParts[4] !== 'leaderboard';
    if (isNewPuzzle || isDailyPuzzlePlay) return getGameRestriction(config, apiSlug);
  }
  return null;
}

export function validateSiteAvailabilityConfig(value: unknown): SiteAvailabilityConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Availability settings must be an object.');
  const record = value as Record<string, unknown>;
  const sections = record.sections as Record<string, unknown> | null;
  if (!sections || typeof sections !== 'object' || Array.isArray(sections) || SITE_SECTIONS.some(({ id }) => typeof sections[id] !== 'boolean')) {
    throw new Error('Provide an enabled or disabled value for every site section.');
  }
  if (typeof record.registrationEnabled !== 'boolean' || typeof record.ticketBundlesEnabled !== 'boolean') throw new Error('Signup and ticket bundle controls must be enabled or disabled.');
  if (record.disabledGameDisplay !== 'visible' && record.disabledGameDisplay !== 'hidden') throw new Error('Choose how unavailable games should appear.');
  if (!Array.isArray(record.disabledGames) || record.disabledGames.some((slug) => typeof slug !== 'string' || !GAME_SLUGS.has(slug))) throw new Error('Choose games from the tixy game list.');
  if (typeof record.message !== 'string' || record.message.length > 1200) throw new Error('The visitor message must be at most 1200 characters.');
  return normalizeSiteAvailabilityConfig(record);
}
