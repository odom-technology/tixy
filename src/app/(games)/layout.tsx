import { Suspense, type ReactNode } from 'react';
import { cookies } from 'next/headers';

import { ScoreChallengeLanding } from '@/features/arcade/components/results/score-challenge-landing';
import { GamePageAdFrame } from '@/features/monetization/components/game-page-ads';
import {
  ACCOUNT_SESSION_COOKIE,
  getIdentityForSessionToken,
} from '@/server/accounts';

const DEFAULT_ADSENSE_CLIENT_ID = 'ca-pub-9188105841935377';
const DEFAULT_DISABLED_GAME_ROUTES = '';
const DEFAULT_TOP_GAME_AD_SLOT = '4673590795';
const DEFAULT_BOTTOM_GAME_AD_SLOT = '3406786752';

async function hasGameLayoutIdentity() {
  try {
    const cookieStore = await cookies();
    const sessionToken = cookieStore.get(ACCOUNT_SESSION_COOKIE)?.value;
    if (!sessionToken) return false;
    return Boolean(await getIdentityForSessionToken(sessionToken));
  } catch {
    return false;
  }
}

function getAdsenseConfig() {
  return {
    bottomSlot:
      process.env['NEXT_PUBLIC_ADSENSE_GAME_BOTTOM_SLOT']?.trim() ||
      DEFAULT_BOTTOM_GAME_AD_SLOT,
    clientId:
      process.env['NEXT_PUBLIC_ADSENSE_CLIENT_ID']?.trim() ||
      DEFAULT_ADSENSE_CLIENT_ID,
    disabledRoutes:
      process.env['NEXT_PUBLIC_ADSENSE_DISABLED_GAME_ROUTES'] ??
      DEFAULT_DISABLED_GAME_ROUTES,
    enabled: process.env['NEXT_PUBLIC_ADSENSE_ENABLE_GAME_ADS'] === 'true',
    topSlot:
      process.env['NEXT_PUBLIC_ADSENSE_GAME_TOP_SLOT']?.trim() ||
      DEFAULT_TOP_GAME_AD_SLOT,
  };
}

export default async function ArcadeLayout({ children }: { children: ReactNode }) {
  const hasIdentity = await hasGameLayoutIdentity();
  const adsenseConfig = getAdsenseConfig();

  return (
    <div className='min-h-full overflow-hidden bg-background font-sans text-strong antialiased'>
      <GamePageAdFrame
        canShowAds={!hasIdentity}
        clientId={adsenseConfig.clientId}
        topSlotId={adsenseConfig.topSlot}
        bottomSlotId={adsenseConfig.bottomSlot}
        adsEnabled={adsenseConfig.enabled}
        disabledRoutes={adsenseConfig.disabledRoutes}
      >
        <Suspense fallback={null}>
          <ScoreChallengeLanding />
        </Suspense>
        {children}
      </GamePageAdFrame>
    </div>
  );
}
