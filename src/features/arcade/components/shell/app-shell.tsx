'use client';

import { usePathname } from 'next/navigation';
import { Suspense, type ReactNode } from 'react';

import { useRecordRecentGame } from '@/features/arcade/components/use-recent-games';
import { PresenceController } from '@/features/social/presence/presence-controller';
import { SocialDock } from '@/features/social/social-dock';
import { SocialProvider } from '@/features/social/social-provider';

import { AchievementToaster } from '@/features/arcade/components/achievements/achievement-toaster';
import { SecretEasterEggs } from '@/features/arcade/components/achievements/secret-triggers';
import { ArcadePerformanceController } from '@/features/arcade/components/arcade-performance-overlay';

import { AppTopNav } from './app-top-nav';
import { GlobalMobileNav } from './global-mobile-nav';
import { GuestAuthNudge } from './guest-auth-nudge';
import { LegalFooter } from './legal-footer';
import { ViewTransitionProvider } from './view-transition-provider';
import { AccountIdentityContext } from './use-account-summary';
import { useSiteAvailability } from './site-availability-context';

/* Standalone flows render without app chrome. */
const BARE_ROUTE_PREFIXES = [
  '/signin',
  '/signup',
  '/signout',
  '/recover',
  '/maintenance',
  // The console draws its own shell (src/features/admin/ui/shell.tsx).
  '/admin',
];

export function AppShell({
  children,
  hasIdentity = null,
}: {
  children: ReactNode;
  hasIdentity?: boolean | null;
}) {
  const pathname = usePathname();
  const availability = useSiteAvailability();
  const socialEnabled = availability.sections.social;
  // Capture every game visit so the home "Jump back in" shelf has real data.
  useRecordRecentGame();
  const bare = BARE_ROUTE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );

  if (bare) return <>{children}</>;

  return (
    // Pad the bottom on sub-sm screens so the fixed mobile dock never covers
    // page content or the footer; from sm up the top nav strip takes over and
    // the dock is hidden.
    <AccountIdentityContext.Provider value={hasIdentity}>
      <SocialProvider enabled={socialEnabled && hasIdentity !== false}>
      <div className='pb-[calc(4rem+env(safe-area-inset-bottom))] sm:pb-0'>
        <a
          href='#main-content'
          className='arc-skiplink arcade-display rounded-key border-2 border-ink bg-primary px-3 pt-1.5 pb-1 text-xs uppercase text-primary-on shadow-chip'
        >
          Skip to content
        </a>
        <PresenceController enabled={socialEnabled && hasIdentity !== false} />
        <Suspense fallback={null}>
          <ViewTransitionProvider />
        </Suspense>
        <AppTopNav pathname={pathname} />
        {/* The shell owns the single main landmark; bare routes (auth,
            maintenance) render their own. tabIndex lets the skip link land
            focus here without adding it to the tab order. view-transition-name
            is applied by ViewTransitionProvider for soft navigations. */}
        <main id='main-content' tabIndex={-1} className='min-w-0 flex-1 outline-none'>
          {children}
        </main>
        <LegalFooter />
        <GlobalMobileNav pathname={pathname} />
        {availability.registrationEnabled ? <GuestAuthNudge /> : null}
        <AchievementToaster />
        <SecretEasterEggs />
        <ArcadePerformanceController pathname={pathname} />
        {socialEnabled ? <SocialDock /> : null}
      </div>
      </SocialProvider>
    </AccountIdentityContext.Provider>
  );
}
