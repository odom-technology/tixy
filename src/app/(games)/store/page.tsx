import { PrizeCounter } from '@/features/arcade/components/counter/prize-counter';
import { getRewardedAdConfig } from '@/server/monetization/rewarded-ads';

export const metadata = {
  title: 'Prize counter | tixy.lol',
};

export default function ArcadeStorePage() {
  const rewardedAds = getRewardedAdConfig();
  return (
    <PrizeCounter
      rewardedAds={{
        enabled: Boolean(rewardedAds.adUnitPath),
        ticketsAmount: rewardedAds.storeTicketsAmount,
        dailyAttemptLimit: rewardedAds.dailyAttemptLimit,
        cooldownSeconds: Math.ceil(rewardedAds.cooldownMs / 1000),
      }}
    />
  );
}
