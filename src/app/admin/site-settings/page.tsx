import { redirect } from 'next/navigation';

import { requireIdentity } from '@/server/auth';
import { checkRole } from '@/server/auth/check-role';
import {
  getMaintenanceModeSettings,
  getMaintenanceModeStatusForRoles,
  getSiteAvailabilitySettings,
  getWarningBannerSettings,
} from '@/server/site-settings';

import { AdminSiteSettingsClient } from './_site-settings-client';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Site settings | tixy',
};

export default async function AdminSiteSettingsPage() {
  let identity;
  try {
    identity = await requireIdentity();
  } catch {
    redirect('/signin?next=/admin/site-settings');
  }

  if (!(await checkRole('admin', identity))) {
    redirect('/');
  }

  const [warningBanner, maintenanceMode, siteAvailability] = await Promise.all([
    getWarningBannerSettings(),
    getMaintenanceModeSettings(),
    getSiteAvailabilitySettings(),
  ]);

  return (
    <AdminSiteSettingsClient
      initialWarningBanner={warningBanner}
      initialMaintenanceMode={maintenanceMode}
      initialSiteAvailability={siteAvailability}
      initialMaintenanceStatus={getMaintenanceModeStatusForRoles({
        config: maintenanceMode.config,
        roles: identity.roles,
      })}
    />
  );
}
