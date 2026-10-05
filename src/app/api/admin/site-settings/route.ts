import { NextResponse } from 'next/server';

import { withAdmin } from '@/server/admin/guard';
import type { ArcadeIdentity } from '@/server/auth';
import {
  getMaintenanceModeSettings,
  getMaintenanceModeStatusForRoles,
  getWarningBannerSettings,
  saveMaintenanceModeConfig,
  saveWarningBannerConfig,
  getSiteAvailabilitySettings,
  saveSiteAvailabilityConfig,
  type MaintenanceModeConfig,
  type WarningBannerConfig,
} from '@/server/site-settings';
import { validateSiteAvailabilityConfig, type SiteAvailabilityConfig } from '@/lib/site-availability';

export const dynamic = 'force-dynamic';

function getActorLabel(identity: ArcadeIdentity) {
  return identity.name || identity.userId;
}

export const GET = withAdmin(async (_request, { identity }) => {
  const [warningBanner, maintenanceMode, siteAvailability] = await Promise.all([
    getWarningBannerSettings(),
    getMaintenanceModeSettings(),
    getSiteAvailabilitySettings(),
  ]);

  return NextResponse.json({
    warningBanner,
    maintenanceMode,
    siteAvailability,
    maintenanceStatus: getMaintenanceModeStatusForRoles({
      config: maintenanceMode.config,
      roles: identity.roles,
    }),
  });
});

export const PATCH = withAdmin(async (request, { identity }) => {
  let body: {
    warningBanner?: WarningBannerConfig;
    maintenanceMode?: MaintenanceModeConfig;
    siteAvailability?: SiteAvailabilityConfig;
    siteAvailabilityUpdatedAt?: number | null;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });
  }

  if (!body || typeof body !== 'object' || (!body.warningBanner && !body.maintenanceMode && !body.siteAvailability)) {
    return NextResponse.json(
      { error: 'No settings were provided.' },
      { status: 400 },
    );
  }

  try {
    if (body.siteAvailability) {
      validateSiteAvailabilityConfig(body.siteAvailability);
      if (!Object.hasOwn(body, 'siteAvailabilityUpdatedAt') || (body.siteAvailabilityUpdatedAt !== null && (!Number.isSafeInteger(body.siteAvailabilityUpdatedAt) || (body.siteAvailabilityUpdatedAt ?? 0) < 0))) {
        return NextResponse.json({ error: 'Load the current availability settings before saving.' }, { status: 400 });
      }
      const current = await getSiteAvailabilitySettings();
      if (current.updatedAt !== body.siteAvailabilityUpdatedAt) {
        throw new Error('Availability changed since you loaded it. Refresh and review the current settings.');
      }
    }
    const updatedBy = getActorLabel(identity);
    const [warningBanner, maintenanceMode, siteAvailability] = await Promise.all([
      body.warningBanner
        ? saveWarningBannerConfig({
            config: body.warningBanner,
            updatedBy,
          })
        : getWarningBannerSettings(),
      body.maintenanceMode
        ? saveMaintenanceModeConfig({
            config: body.maintenanceMode,
            updatedBy,
          })
        : getMaintenanceModeSettings(),
      body.siteAvailability
        ? saveSiteAvailabilityConfig({ config: body.siteAvailability, updatedBy, expectedUpdatedAt: body.siteAvailabilityUpdatedAt ?? null })
        : getSiteAvailabilitySettings(),
    ]);

    return NextResponse.json({
      warningBanner,
      maintenanceMode,
      siteAvailability,
      maintenanceStatus: getMaintenanceModeStatusForRoles({
        config: maintenanceMode.config,
        roles: identity.roles,
      }),
    });
  } catch (error) {
    const message = (error as Error).message || 'Unable to update site settings.';
    return NextResponse.json(
      { error: message },
      { status: message.startsWith('Availability changed') ? 409 : 400 },
    );
  }
}, {
  audit: ({ body }) => {
    const input = (body ?? {}) as {
      warningBanner?: { enabled?: unknown };
      maintenanceMode?: { enabled?: unknown };
      siteAvailability?: unknown;
    };
    const sections = [
      input.warningBanner ? 'warningBanner' : null,
      input.maintenanceMode ? 'maintenanceMode' : null,
      input.siteAvailability ? 'siteAvailability' : null,
    ].filter((section): section is string => section !== null);
    const single = sections.length === 1
      ? (input.warningBanner ?? input.maintenanceMode) as { enabled?: unknown } | undefined
      : undefined;
    return {
      action: 'site.settings',
      targetType: 'site',
      targetId: sections.join(',') || 'settings',
      details: {
        section: sections,
        ...(typeof single?.enabled === 'boolean' ? { active: single.enabled } : {}),
      },
    };
  },
});
