'use client';

import { useCallback, useState } from 'react';

import { trackGameCompletion } from '@/features/analytics/product-events';
import type { UnlockResult } from '@/server/arcade/achievements/types';
import type { AccountXpReward, GameRewardResult } from '@/server/arcade/rewards/types';

export type ArcadeRunAchievement = UnlockResult;

export type ArcadeRunReward = Partial<GameRewardResult> & {
  account?: AccountXpReward;
};

export type ArcadeRunResultSnapshot = {
  reward: ArcadeRunReward | null;
  achievements: ArcadeRunAchievement[];
};

const EMPTY_RESULT: ArcadeRunResultSnapshot = {
  reward: null,
  achievements: [],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAchievement(value: unknown): value is ArcadeRunAchievement {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.description === 'string' &&
    typeof value.icon === 'string' &&
    typeof value.rarity === 'string' &&
    typeof value.xp === 'number'
  );
}

/**
 * Normalizes the reward envelope shared by score routes. Older routes still
 * expose Credits aliases while newer ones expose Tickets, so consumers should
 * read this once instead of repeating alias and validation logic per game.
 */
export function parseArcadeRunResult(payload: unknown): ArcadeRunResultSnapshot {
  if (!isRecord(payload)) return EMPTY_RESULT;
  const reward = isRecord(payload.reward)
    ? (payload.reward as ArcadeRunReward)
    : null;
  const achievements = Array.isArray(payload.achievements)
    ? payload.achievements.filter(isAchievement)
    : [];
  return { reward, achievements };
}

export function awardedRunTickets(reward: ArcadeRunReward | null | undefined): number {
  const raw = reward?.awardedTickets ?? reward?.awardedCredits ?? 0;
  return Number.isFinite(Number(raw)) ? Math.max(0, Math.floor(Number(raw))) : 0;
}

export function wantedRunTickets(reward: ArcadeRunReward | null | undefined): number {
  const raw = reward?.wantedTickets ?? reward?.wantedCredits ?? awardedRunTickets(reward);
  return Number.isFinite(Number(raw)) ? Math.max(0, Math.floor(Number(raw))) : 0;
}

/** Run-local reward state. Capture the successful JSON response; reset on play again. */
export function useArcadeRunResult() {
  const [result, setResult] = useState<ArcadeRunResultSnapshot>(EMPTY_RESULT);

  const capture = useCallback((payload: unknown) => {
    const parsed = parseArcadeRunResult(payload);
    setResult(parsed);
    trackGameCompletion();
    return parsed;
  }, []);

  const reset = useCallback(() => setResult(EMPTY_RESULT), []);

  return {
    result,
    reward: result.reward,
    achievements: result.achievements,
    capture,
    reset,
  } as const;
}
