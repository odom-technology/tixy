import type { MetadataRoute } from 'next';

import { ARCADE_GAMES, isGameListed } from '@/features/arcade/components/arcade-game-registry';
import { getGameDisplayRoute } from '@/features/arcade/lib/game-renames';
import { getGameRestriction, getPathRestriction } from '@/lib/site-availability';
import { getAppBaseUrl } from '@/server/arcade/shared-utils';
import {
  getMaintenanceModeSettings,
  getMaintenanceModeStatusForRoles,
  getSiteAvailabilitySettings,
} from '@/server/site-settings';

export const dynamic = 'force-dynamic';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [maintenance, availability] = await Promise.all([
    getMaintenanceModeSettings(),
    getSiteAvailabilitySettings(),
  ]);
  if (getMaintenanceModeStatusForRoles({ config: maintenance.config, roles: null }).isActive) {
    return [];
  }

  const gamePaths = ARCADE_GAMES
    .filter((game) => isGameListed(game.slug) && !getGameRestriction(availability.config, game.slug))
    .map((game) => getGameDisplayRoute(game.slug, game.href));
  const paths = [...new Set(['/', '/developers', '/privacy', '/terms', '/feedback', ...gamePaths])]
    .filter((pathname) => !getPathRestriction(availability.config, pathname));
  const baseUrl = getAppBaseUrl();
  return paths.map((pathname) => ({ url: new URL(pathname, baseUrl).toString() }));
}
