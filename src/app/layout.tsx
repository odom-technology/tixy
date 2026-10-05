import type { Metadata, Viewport } from 'next';
import { Bungee, Rubik, Spline_Sans_Mono } from 'next/font/google';
import { cookies } from 'next/headers';
import type { ReactNode } from 'react';

import { readAccountSettings } from '@/features/account/account-settings';
import { AppShell } from '@/features/arcade/components/shell/app-shell';
import { SiteAvailabilityProvider } from '@/features/arcade/components/shell/site-availability-context';
import { SiteWarningBanner } from '@/features/arcade/components/site-warning-banner';
import {
  DEFAULT_ARCADE_THEME,
  arcadeThemeScheme,
  arcadeThemeSystem,
} from '@/features/arcade/lib/arcade-themes';
import { DEFAULT_SITE_AVAILABILITY } from '@/lib/site-availability';
import { getAppBaseUrl } from '@/server/arcade/shared-utils';
import {
  ACCOUNT_SESSION_COOKIE,
  getAccountData,
  getIdentityForSessionToken,
} from '@/server/accounts';
import {
  getWarningBannerSettings,
  getSiteAvailabilitySettings,
  isWarningBannerActiveForRoles,
} from '@/server/site-settings';

import { bigShoulders, gabarito } from './fonts/tixy-fonts';
import './globals.css';
// Shared in-game feedback, XP and feedback pieces (tixy/r-kit). Imported here
// rather than by the components, which scripts also load under tsx.
import '@/features/arcade/components/gameplay/gameplay-feedback.css';
import '@/features/arcade/components/xp-gain-burst.css';
import '@/features/arcade/components/feedback/feedback.css';

const DEFAULT_ADSENSE_CLIENT_ID = 'ca-pub-9188105841935377';

const bungee = Bungee({
  weight: '400',
  subsets: ['latin'],
  variable: '--font-bungee',
  display: 'swap',
});

const rubik = Rubik({
  subsets: ['latin'],
  variable: '--font-rubik',
  display: 'swap',
});

const splineSansMono = Spline_Sans_Mono({
  subsets: ['latin'],
  variable: '--font-spline-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  // Icons, the manifest and the share image are files in src/app, built by
  // scripts/brand/build-brand-assets.tsx. metadataBase makes their URLs absolute.
  metadataBase: readMetadataBase(),
  title: 'tixy',
  description: 'Browser games by ODOM Tech.',
  other: {
    'google-adsense-account': DEFAULT_ADSENSE_CLIENT_ID,
  },
};

// A bad APP_URL (no scheme, say) must not take every page down.
function readMetadataBase() {
  try {
    return new URL(getAppBaseUrl());
  } catch {
    return undefined;
  }
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export const dynamic = 'force-dynamic';

async function getLayoutIdentity() {
  try {
    const cookieStore = await cookies();
    const sessionToken = cookieStore.get(ACCOUNT_SESSION_COOKIE)?.value;
    return sessionToken ? getIdentityForSessionToken(sessionToken) : null;
  } catch {
    return null;
  }
}

type LayoutIdentity = Awaited<ReturnType<typeof getLayoutIdentity>>;

async function getActiveWarningBanner(identity: LayoutIdentity) {
  try {
    const setting = await getWarningBannerSettings();
    if (
      !isWarningBannerActiveForRoles({
        config: setting.config,
        roles: identity?.roles,
      })
    ) {
      return null;
    }
    return {
      config: setting.config,
      userId: identity?.userId ?? 'guest',
      versionToken: setting.updatedAt,
    };
  } catch {
    return null;
  }
}

async function getLayoutArcadeTheme(identity: LayoutIdentity) {
  if (!identity) return DEFAULT_ARCADE_THEME;
  try {
    const settingsData = await getAccountData(identity.userId, 'settings');
    return readAccountSettings(settingsData?.value).arcadeTheme;
  } catch {
    return DEFAULT_ARCADE_THEME;
  }
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const identity = await getLayoutIdentity();
  const [activeWarningBanner, arcadeTheme, availability] = await Promise.all([
    getActiveWarningBanner(identity),
    getLayoutArcadeTheme(identity),
    getSiteAvailabilitySettings()
      .then((setting) => setting.config)
      .catch(() => DEFAULT_SITE_AVAILABILITY),
  ]);

  return (
    <html
      lang='en'
      data-arcade-theme={arcadeThemeSystem(arcadeTheme)}
      data-tixy-scheme={arcadeThemeScheme(arcadeTheme)}
      className={`${bungee.variable} ${rubik.variable} ${splineSansMono.variable} ${gabarito.variable} ${bigShoulders.variable}`}
    >
      <head>
        <script
          async
          src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${DEFAULT_ADSENSE_CLIENT_ID}`}
          crossOrigin='anonymous'
        />
      </head>
      <body>
        {activeWarningBanner ? (
          <SiteWarningBanner
            config={activeWarningBanner.config}
            userId={activeWarningBanner.userId}
            versionToken={activeWarningBanner.versionToken}
          />
        ) : null}
        <SiteAvailabilityProvider value={availability}>
          <AppShell hasIdentity={Boolean(identity)}>{children}</AppShell>
        </SiteAvailabilityProvider>
      </body>
    </html>
  );
}
