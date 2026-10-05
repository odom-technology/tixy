import { GamesWalletProvider } from '@/features/arcade/components/shell/games-wallet-provider';
import { getPrizeClawShelf } from '@/server/arcade/prize-claw-shelf';
import PrizeClawClient from './_prize-claw-client';

export { metadata } from './metadata';

// The case follows today's prize counter, so it is read per request.
export const dynamic = 'force-dynamic';

export default async function PrizeClawPage() {
  const shelf = await getPrizeClawShelf();
  return (
    <GamesWalletProvider>
      <PrizeClawClient shelf={shelf} />
    </GamesWalletProvider>
  );
}
