export type TodayQuest = {
  slotIndex: number;
  key: string;
  label: string;
  targetGame: string | null;
  goal: number;
  progress: number;
  rewardXp: number;
  rewardTickets: number;
  claimed: boolean;
  complete: boolean;
};

export type TodayBattlepassState = {
  seasonName: string;
  tier: number;
  maxTier: number;
  bar: {
    into: number;
    need: number;
    atMax: boolean;
  };
  quests: TodayQuest[];
};

export type TodayGameTarget = {
  id: string;
  href: string;
};

export type TodayFeaturedSignal = TodayGameTarget & {
  multiplier: number;
};

export type TodayClaimSignal = {
  available: boolean;
  claimed: boolean;
  streak: number;
};

export type TodayMultiplayerSignal = TodayGameTarget & {
  openLobbies: number;
  playersInGame: number;
  liveMatches: number;
  friendsOnline: number | null;
};

export type TodayRecommendationKind =
  | 'daily-claim'
  | 'claim-quest'
  | 'quest-game'
  | 'multiplayer'
  | 'featured'
  | 'recent'
  | 'daily-puzzle';

export type TodayRecommendationReason =
  | 'streak-risk'
  | 'daily-reward'
  | 'quest-claimable'
  | 'quest-progress'
  | 'opponent-waiting'
  | 'friends-online'
  | 'players-active'
  | 'matches-live'
  | 'featured-reward'
  | 'recent-play'
  | 'daily-puzzle';

export type TodayRecommendation = {
  id: string;
  kind: TodayRecommendationKind;
  href: string | null;
  gameId: string | null;
  score: number;
  reasons: TodayRecommendationReason[];
};

export type TodayRankingInput = {
  recentGames: readonly TodayGameTarget[];
  featured: TodayFeaturedSignal | null;
  quest: TodayQuest | null;
  questTarget: TodayGameTarget | null;
  claim: TodayClaimSignal | null;
  multiplayer: TodayMultiplayerSignal | null;
  dailyPuzzle: TodayGameTarget;
};

type Contribution = {
  kind: TodayRecommendationKind;
  points: number;
  reason: TodayRecommendationReason;
};

type MutableRecommendation = Omit<TodayRecommendation, 'score' | 'reasons' | 'kind'> & {
  contributions: Contribution[];
};

const KIND_ORDER: Record<TodayRecommendationKind, number> = {
  'daily-claim': 0,
  'claim-quest': 1,
  'quest-game': 2,
  multiplayer: 3,
  featured: 4,
  recent: 5,
  'daily-puzzle': 6,
};

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function addGameContribution(
  recommendations: Map<string, MutableRecommendation>,
  target: TodayGameTarget,
  contribution: Contribution,
) {
  const key = `game:${target.href}`;
  const current = recommendations.get(key) ?? {
    id: key,
    href: target.href,
    gameId: target.id,
    contributions: [],
  };
  current.contributions.push(contribution);
  recommendations.set(key, current);
}

function finalize(recommendation: MutableRecommendation): TodayRecommendation {
  const ordered = [...recommendation.contributions].sort((left, right) =>
    right.points - left.points || KIND_ORDER[left.kind] - KIND_ORDER[right.kind],
  );
  const primary = ordered[0]!;
  const score = primary.points + Math.min(24, Math.max(0, ordered.length - 1) * 12);
  return {
    id: recommendation.id,
    kind: primary.kind,
    href: recommendation.href,
    gameId: recommendation.gameId,
    score,
    reasons: ordered.map((entry) => entry.reason),
  };
}

/**
 * Ranks real, explainable dashboard actions. Fixed weights encode urgency:
 * protect a streak, claim completed work, help a waiting opponent, finish an
 * almost-complete quest, then use featured/recent play for discovery. When
 * several signals point to one game, a small bounded alignment bonus breaks
 * ties without allowing weak signals to swamp an urgent action.
 */
export function rankTodayRecommendations(input: TodayRankingInput): TodayRecommendation[] {
  const recommendations = new Map<string, MutableRecommendation>();

  if (input.claim?.available && !input.claim.claimed) {
    const streak = finiteNonNegative(input.claim.streak);
    recommendations.set('action:daily-claim', {
      id: 'action:daily-claim',
      href: null,
      gameId: null,
      contributions: [{
        kind: 'daily-claim',
        points: streak > 0 ? 200 + Math.min(20, streak) : 120,
        reason: streak > 0 ? 'streak-risk' : 'daily-reward',
      }],
    });
  }

  if (input.quest && !input.quest.claimed) {
    if (input.quest.complete) {
      recommendations.set(`action:quest:${input.quest.slotIndex}`, {
        id: `action:quest:${input.quest.slotIndex}`,
        href: '/battlepass',
        gameId: null,
        contributions: [{
          kind: 'claim-quest',
          points: 180,
          reason: 'quest-claimable',
        }],
      });
    } else {
      const progress = input.quest.goal > 0 ? input.quest.progress / input.quest.goal : 0;
      const target = input.questTarget
        ?? input.featured
        ?? input.recentGames[0]
        ?? input.dailyPuzzle;
      addGameContribution(recommendations, target, {
        kind: 'quest-game',
        points: 100 + Math.round(Math.max(0, Math.min(1, progress)) * 50),
        reason: 'quest-progress',
      });
    }
  }

  const multiplayer = input.multiplayer;
  if (multiplayer) {
    const openLobbies = finiteNonNegative(multiplayer.openLobbies);
    const friendsOnline = finiteNonNegative(multiplayer.friendsOnline ?? 0);
    const playersInGame = finiteNonNegative(multiplayer.playersInGame);
    const liveMatches = finiteNonNegative(multiplayer.liveMatches);
    let contribution: Contribution | null = null;
    if (openLobbies > 0) {
      contribution = {
        kind: 'multiplayer',
        points: 160 + Math.min(15, openLobbies * 5),
        reason: 'opponent-waiting',
      };
    } else if (friendsOnline > 0) {
      contribution = {
        kind: 'multiplayer',
        points: 120 + Math.min(15, friendsOnline * 3),
        reason: 'friends-online',
      };
    } else if (playersInGame > 0) {
      contribution = {
        kind: 'multiplayer',
        points: 90 + Math.min(15, playersInGame * 3),
        reason: 'players-active',
      };
    } else if (liveMatches > 0) {
      contribution = {
        kind: 'multiplayer',
        points: 75 + Math.min(15, liveMatches * 3),
        reason: 'matches-live',
      };
    }
    if (contribution) addGameContribution(recommendations, multiplayer, contribution);
  }

  if (input.featured) {
    addGameContribution(recommendations, input.featured, {
      kind: 'featured',
      points: 70 + Math.min(20, finiteNonNegative(input.featured.multiplier) * 4),
      reason: 'featured-reward',
    });
  }

  input.recentGames.slice(0, 3).forEach((game, index) => {
    addGameContribution(recommendations, game, {
      kind: 'recent',
      points: Math.max(30, 60 - index * 15),
      reason: 'recent-play',
    });
  });

  addGameContribution(recommendations, input.dailyPuzzle, {
    kind: 'daily-puzzle',
    points: 20,
    reason: 'daily-puzzle',
  });

  return [...recommendations.values()]
    .map(finalize)
    .sort((left, right) =>
      right.score - left.score
      || KIND_ORDER[left.kind] - KIND_ORDER[right.kind]
      || left.id.localeCompare(right.id),
    );
}

/** The closest useful quest; completion remains server-authoritative. */
export function selectTodayQuest(quests: readonly TodayQuest[]): TodayQuest | null {
  return (
    quests
      .filter((quest) => !quest.claimed)
      .sort((left, right) => {
        if (left.complete !== right.complete) return left.complete ? -1 : 1;
        const leftRatio = left.goal > 0 ? left.progress / left.goal : 0;
        const rightRatio = right.goal > 0 ? right.progress / right.goal : 0;
        if (leftRatio !== rightRatio) return rightRatio - leftRatio;
        return Math.max(0, left.goal - left.progress)
          - Math.max(0, right.goal - right.progress);
      })[0] ?? null
  );
}

export function getQuestProgress(quest: TodayQuest): { current: number; max: number } {
  const max = Math.max(1, quest.goal);
  return {
    current: Math.min(max, Math.max(0, quest.progress)),
    max,
  };
}
