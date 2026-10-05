import type { MetadataRoute } from 'next';

import {
  getMaintenanceModeSettings,
  getMaintenanceModeStatusForRoles,
} from '@/server/site-settings';

export default async function robots(): Promise<MetadataRoute.Robots> {
  const maintenanceSetting = await getMaintenanceModeSettings();
  const maintenanceStatus = getMaintenanceModeStatusForRoles({
    config: maintenanceSetting.config,
    roles: null,
  });

  return {
    rules: {
      userAgent: '*',
      allow: maintenanceStatus.isActive ? undefined : '/',
      disallow: maintenanceStatus.isActive ? '/' : '/admin',
    },
  };
}
