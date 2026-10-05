// Shared bridge from a finished score route to the stats + achievement engine.
// Call AFTER awardGameRunCredits inside the persist callback; thread the result
// into the route response as `achievements` so the client can toast unlocks.
// Best-effort — recordGameRunStats swallows its own errors and returns [].
import { recordGameRunStats, type RunExtra } from '@/server/arcade/stats';
import type { GameRewardContext, GameRewardResult } from '@/server/arcade/rewards/types';
import type { UnlockResult } from '@/server/arcade/achievements/types';
import { isGuestUserId } from '@/server/auth/guest';

export function recordRunAchievements(
  userId: string,
  context: GameRewardContext,
  reward: GameRewardResult | null | undefined,
  extra: RunExtra & { durationMs?: number } = {},
): Promise<UnlockResult[]> {
  if (isGuestUserId(userId)) return Promise.resolve([]);
  return recordGameRunStats(userId, context, {
    ...extra,
    ticketsEarned: reward?.awardedCredits ?? 0,
  });
}
