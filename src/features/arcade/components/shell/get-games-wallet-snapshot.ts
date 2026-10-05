import 'server-only';

import { requireIdentity } from '@/server/auth';
import {
  getDailyGameCreditsProgress,
  getWalletForUser,
} from '@/server/arcade/rewards';

import type { GamesWalletSnapshot } from './games-wallet-types';

export async function getGamesWalletSnapshot(): Promise<GamesWalletSnapshot | null> {
  try {
    const identity = await requireIdentity({ allowExternal: true, allowGuest: true });
    const [wallet, progress] = await Promise.all([
      getWalletForUser(identity.userId),
      getDailyGameCreditsProgress(identity.userId),
    ]);
    return {
      credits: wallet.credits,
      dailyCredits: {
        earned: progress.earned,
        cap: progress.cap,
      },
    };
  } catch {
    return null;
  }
}
