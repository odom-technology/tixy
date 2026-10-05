import { ArcadeDashboardContent } from '@/features/arcade/components/arcade-dashboard-content';
import type { ArcadeDashboardSectionId } from '@/features/arcade/components/arcade-game-registry';
import { FLOOR_STILLS } from '@/features/arcade/components/game-previews/stills';
import { TixyHome } from '@/features/arcade/components/home/tixy-home';
import { GamesShell } from '@/features/arcade/components/shell/games-shell';
import { getGamesWalletSnapshot } from '@/features/arcade/components/shell/get-games-wallet-snapshot';
import { readAccountSettings } from '@/features/account/account-settings';
import { DEFAULT_ARCADE_THEME, arcadeThemeSystem } from '@/features/arcade/lib/arcade-themes';
import {
  ACCOUNT_PROFILE_DETAILS_KEY,
  readAccountProfileDetails,
} from '@/features/users/account-profile-details';
import { getAccountData } from '@/server/accounts';
import { getPopularGameSlugs } from '@/server/arcade/game-popularity';
import { getTixyHomeData } from '@/server/arcade/tixy-home';
import { requireIdentity } from '@/server/auth';
import { isGuestIdentity } from '@/server/auth/guest';
import { DEFAULT_SITE_AVAILABILITY } from '@/lib/site-availability';
import { getSiteAvailabilitySettings } from '@/server/site-settings';

export const metadata = {
  title: 'Dashboard | tixy',
};

export const dynamic = 'force-dynamic';

async function getSignedInUserId(): Promise<string | null> {
  try {
    const identity = await requireIdentity({ allowExternal: true, allowGuest: true });
    return isGuestIdentity(identity) ? null : identity.userId;
  } catch {
    return null;
  }
}

function quiet<T>(promise: Promise<T>, fallback: T): Promise<T> {
  return promise.catch(() => fallback);
}

/* The old home sorts aisles by a 30-day popularity count. The same for every
   player, so it is kept for a minute: an old-theme player can read it beside
   the settings without waiting on the aggregate. */
const POPULAR_TTL_MS = 60_000;
let popularCache: { at: number; slugs: Promise<string[]> } | null = null;
function getPopularCached(): Promise<string[]> {
  if (!popularCache || Date.now() - popularCache.at > POPULAR_TTL_MS) {
    const slugs = quiet(getPopularGameSlugs(), [] as string[]);
    popularCache = { at: Date.now(), slugs };
  }
  return popularCache.slugs;
}

export default async function HomePage() {
  const availabilityPromise = quiet(
    getSiteAvailabilitySettings().then((setting) => setting.config),
    DEFAULT_SITE_AVAILABILITY,
  );
  const walletPromise = getGamesWalletSnapshot();
  // At most one popularity query a minute for the whole site, so starting it
  // here for everyone costs nothing and the old home never waits on it.
  const popularPromise = getPopularCached();
  const userId = await getSignedInUserId();

  // The settings row (the theme) is read beside the wallet, the profile and
  // the availability. Then the page branches: the tixy home's data only runs
  // for tixy players.
  const [settingsData, profileData, initialSnapshot, availability] = await Promise.all([
    userId ? quiet(getAccountData(userId, 'settings'), null) : Promise.resolve(null),
    userId ? quiet(getAccountData(userId, ACCOUNT_PROFILE_DETAILS_KEY), null) : Promise.resolve(null),
    walletPromise,
    availabilityPromise,
  ]);
  const settings = readAccountSettings(settingsData?.value);
  const theme = userId ? settings.arcadeTheme : DEFAULT_ARCADE_THEME;
  const favoriteGameSlugs = userId
    ? readAccountProfileDetails(profileData?.value).favoriteGameSlugs
    : [];

  if (arcadeThemeSystem(theme) === 'tixy') {
    const data = await quiet(getTixyHomeData({ userId }), null);
    return (
      <GamesShell
        initialSnapshot={initialSnapshot}
        shellClassName='page-shell max-w-[86rem]'
        showDesktopHeader={false}
        showMobileWallet={false}
        showRouteSwitcher={false}
        headerProps={{ title: 'tixy.lol' }}
      >
        <TixyHome
          data={data}
          signedIn={userId != null}
          userId={userId}
          initialSection={settings.defaultDashboardSection}
          initialFavoriteGameSlugs={favoriteGameSlugs}
          availability={availability}
          stills={FLOOR_STILLS}
        />
      </GamesShell>
    );
  }

  const popularGameSlugs = await popularPromise;
  const initialSection: ArcadeDashboardSectionId = userId ? settings.defaultDashboardSection : 'all';

  return (
    <GamesShell
      initialSnapshot={initialSnapshot}
      shellClassName='page-shell max-w-[116rem] space-y-6'
      showDesktopHeader={false}
      showMobileWallet={false}
      showRouteSwitcher={false}
      headerProps={{
        eyebrow: 'tixy',
        title: 'tixy Dashboard',
      }}
    >
      <ArcadeDashboardContent
        initialSection={initialSection}
        initialFavoriteGameSlugs={favoriteGameSlugs}
        canFavorite={userId != null}
        popularGameSlugs={popularGameSlugs}
        availability={availability}
      />
    </GamesShell>
  );
}
