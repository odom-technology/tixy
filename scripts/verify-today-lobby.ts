import assert from 'node:assert/strict';

import {
  getQuestProgress,
  rankTodayRecommendations,
  selectTodayQuest,
  type TodayRankingInput,
  type TodayQuest,
} from '../src/features/arcade/components/today-lobby-model';

const quest = (overrides: Partial<TodayQuest>): TodayQuest => ({
  slotIndex: 0,
  key: 'quest',
  label: 'Play games',
  targetGame: null,
  goal: 10,
  progress: 0,
  rewardXp: 100,
  rewardTickets: 50,
  claimed: false,
  complete: false,
  ...overrides,
});

const claimable = quest({ key: 'claimable', progress: 10, complete: true });
const nearlyDone = quest({ key: 'near', progress: 9 });
const halfway = quest({ key: 'half', goal: 4, progress: 2 });

assert.equal(
  selectTodayQuest([nearlyDone, claimable, halfway])?.key,
  'claimable',
  'a claimable quest should be the first daily action',
);

assert.equal(
  selectTodayQuest([halfway, nearlyDone])?.key,
  'near',
  'the closest proportional quest should win when none are complete',
);

assert.equal(
  selectTodayQuest([quest({ claimed: true, complete: true })]),
  null,
  'claimed quests should not appear as the next action',
);

assert.deepEqual(
  getQuestProgress(quest({ goal: 10, progress: 14 })),
  { current: 10, max: 10 },
  'display progress should be clamped to the API goal',
);

assert.deepEqual(
  getQuestProgress(quest({ goal: 0, progress: -4 })),
  { current: 0, max: 1 },
  'malformed progress should still produce a safe progress bar',
);

const rankingInput = (overrides: Partial<TodayRankingInput> = {}): TodayRankingInput => ({
  recentGames: [],
  featured: null,
  quest: null,
  questTarget: null,
  claim: null,
  multiplayer: null,
  dailyPuzzle: { id: 'word-grid', href: '/word-grid' },
  ...overrides,
});

const urgent = rankTodayRecommendations(rankingInput({
  claim: { available: true, claimed: false, streak: 7 },
  quest: claimable,
  multiplayer: {
    id: 'chess',
    href: '/chess',
    openLobbies: 1,
    playersInGame: 4,
    liveMatches: 2,
    friendsOnline: 1,
  },
}));
assert.deepEqual(
  urgent.slice(0, 3).map((entry) => entry.kind),
  ['daily-claim', 'claim-quest', 'multiplayer'],
  'same-day streak risk, claimable work, and a waiting opponent should rank by urgency',
);

const aligned = rankTodayRecommendations(rankingInput({
  recentGames: [{ id: 'snake', href: '/snake' }],
  featured: { id: 'snake', href: '/snake', multiplier: 2 },
  quest: nearlyDone,
  questTarget: { id: 'snake', href: '/snake' },
}));
assert.equal(aligned[0]?.id, 'game:/snake');
assert.deepEqual(
  aligned[0]?.reasons,
  ['quest-progress', 'featured-reward', 'recent-play'],
  'signals that point to the same game should combine into one explainable recommendation',
);
assert.equal(
  aligned.filter((entry) => entry.href === '/snake').length,
  1,
  'aligned signals should never create duplicate game cards',
);

const noDemand = rankTodayRecommendations(rankingInput({
  multiplayer: {
    id: 'chess',
    href: '/chess',
    openLobbies: 0,
    playersInGame: 0,
    liveMatches: 0,
    friendsOnline: 0,
  },
}));
assert.equal(
  noDemand.some((entry) => entry.kind === 'multiplayer'),
  false,
  'an empty multiplayer rotation is not evidence of demand',
);

const unavailableClaim = rankTodayRecommendations(rankingInput({
  claim: { available: false, claimed: false, streak: 12 },
}));
assert.equal(
  unavailableClaim.some((entry) => entry.kind === 'daily-claim'),
  false,
  'weekends and blackout days should not be presented as streak risk',
);

console.log('Today lobby selection checks passed.');
