import type { MetadataRoute } from 'next';

import { getAppBaseUrl } from '@/server/arcade/shared-utils';
import {
  getMaintenanceModeSettings,
  getMaintenanceModeStatusForRoles,
} from '@/server/site-settings';

export const dynamic = 'force-dynamic';

export default async function robots(): Promise<MetadataRoute.Robots> {
  const maintenanceSetting = await getMaintenanceModeSettings();
  const maintenanceStatus = getMaintenanceModeStatusForRoles({
    config: maintenanceSetting.config,
    roles: null,
  });

  return {
    sitemap: new URL('/sitemap.xml', getAppBaseUrl()).toString(),
    rules: {
      userAgent: '*',
      allow: maintenanceStatus.isActive ? undefined : '/',
      disallow: maintenanceStatus.isActive ? '/' : '/admin',
    },
  };
}
