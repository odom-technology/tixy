import { recordGameRunStats } from '@/server/arcade/stats';
import type { UnlockResult } from '@/server/arcade/achievements/types';
import type { GameRewardContext, GameRewardResult } from '@/server/arcade/rewards/types';

export type MatchRunResult = {
  reward: GameRewardResult;
  achievements: UnlockResult[];
};

const resultByMatchUser = new Map<string, MatchRunResult>();
const MAX_PENDING_RESULTS = 1000;

const resultKey = (matchId: string, userId: string) => `${matchId}:${userId}`;

/**
 * Record verified multiplayer stats after its ticket reward is known, then
 * retain the viewer-specific result until the match polling route delivers it.
 */
export async function recordMatchRunResult({
  matchId,
  userId,
  context,
  reward,
  durationMs,
}: {
  matchId: string;
  userId: string;
  context: GameRewardContext;
  reward: GameRewardResult;
  durationMs?: number;
}): Promise<MatchRunResult> {
  const achievements = await recordGameRunStats(userId, context, {
    durationMs,
    ticketsEarned: reward.awardedTickets ?? reward.awardedCredits,
  });
  const result = { reward, achievements };
  resultByMatchUser.set(resultKey(matchId, userId), result);

  if (resultByMatchUser.size > MAX_PENDING_RESULTS) {
    const oldest = resultByMatchUser.keys().next().value;
    if (oldest) resultByMatchUser.delete(oldest);
  }
  return result;
}

/** One-shot delivery; pages retain the payload after the polling response. */
export function takeMatchRunResult(matchId: string, userId: string): MatchRunResult | null {
  const key = resultKey(matchId, userId);
  const result = resultByMatchUser.get(key) ?? null;
  if (result) resultByMatchUser.delete(key);
  return result;
}
