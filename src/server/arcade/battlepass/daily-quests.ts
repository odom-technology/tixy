// ───────────────────────────────────────────────────────────────────────────
// Daily quests (tixy rev. 2): the pool, the picker and the reroll, all pure.
//
// The pool is built from the floor. A game's quests are in the pool only while
// isOnFloor() says the game is on the floor, checked each time a quest is
// picked, so a game that leaves the floor is never picked again and a reroll
// never lands on one. A daily lasts one day, so nothing already open outlives
// the floor change by more than that day.
//
// Machines never count: only skill runs and friends-game results reach the
// quest hook. Stored quest keys never change. Every template that ever shipped
// stays in LEGACY_DAILY_QUESTS so old rows keep their labels.
// ───────────────────────────────────────────────────────────────────────────

import crypto from 'node:crypto';

import { isOnFloor } from '@/features/arcade/components/arcade-game-registry';

import { DAILY_QUEST_COUNT, type QuestTemplate } from './season-0';

/** Quests that need no game. "earn 250" replaces "earn 300" (key earn-300 is legacy). */
const GENERIC_QUESTS: QuestTemplate[] = [
  { key: 'play-any-3', kind: 'play_any', label: 'Play 3 games', goal: 3, rewardXp: 150, rewardTickets: 40 },
  { key: 'play-any-6', kind: 'play_any', label: 'Play 6 games', goal: 6, rewardXp: 250, rewardTickets: 75 },
  { key: 'earn-150', kind: 'earn_tickets', label: 'Earn 150 tickets', goal: 150, rewardXp: 150, rewardTickets: 40 },
  { key: 'earn-250', kind: 'earn_tickets', label: 'Earn 250 tickets', goal: 250, rewardXp: 300, rewardTickets: 75 },
];

const play2 = (key: string, label: string, game: string): QuestTemplate => ({
  key,
  kind: 'play_game',
  label,
  goal: 2,
  rewardXp: 150,
  rewardTickets: 50,
  targetGame: game,
});

const score = (key: string, label: string, goal: number, game: string): QuestTemplate => ({
  key,
  kind: 'score_game',
  label,
  goal,
  rewardXp: 200,
  rewardTickets: 60,
  targetGame: game,
});

/* Friends games have no score. A win reports as a score of 1 (see
   recordSeasonRun in rewards/wallet.ts), so a win quest has goal 1. */
const win = (key: string, label: string, game: string) => score(key, label, 1, game);

/** Each floor skill game: "play 2" and a score near a good run. Goals come
 *  from the reward curves in rewards/wallet.ts (good run: snake 100+, 2048
 *  3,000, stack 40, skee-ball 200 to 300, high striker 80 in an endless run, tin duck
 *  about 124 in thirty seconds, ticket stop 0 to 300, ricochet 20 walls,
 *  flappy bird 75). */
const GAME_QUESTS: QuestTemplate[] = [
  play2('snake-2', 'Play 2 rounds of Snake', 'snake'),
  score('snake-score-150', 'Score 150 in Snake', 150, 'snake'),
  play2('2048-2', 'Play 2 rounds of 2048', '2048'),
  score('2048-score-2000', 'Score 2000 in 2048', 2000, '2048'),
  play2('stack-2', 'Play 2 rounds of Stack', 'stack'),
  score('stack-score-20', 'Score 20 in Stack', 20, 'stack'),
  play2('skee-ball-2', 'Play 2 rounds of Skee-Ball', 'skee-ball'),
  score('skee-ball-score-250', 'Score 250 in Skee-Ball', 250, 'skee-ball'),
  play2('high-striker-2', 'Play 2 rounds of High Striker', 'high-striker'),
  // High striker is endless since October 2026 (rules 3). 80 is about a good
  // player's median run (scripts/verify-high-striker-replay.ts).
  score('high-striker-score-80', 'Score 80 in High Striker', 80, 'high-striker'),
  play2('tin-duck-2', 'Play 2 rounds of Tin Duck Gallery', 'tin-duck'),
  score('tin-duck-score-124', 'Score 124 in Tin Duck Gallery', 124, 'tin-duck'),
  play2('ticket-stop-2', 'Play 2 rounds of Ticket Stop', 'ticket-stop'),
  // Ticket stop scores hits since #63; 60 is about a good run.
  score('ticket-stop-score-60', 'Score 60 in Ticket Stop', 60, 'ticket-stop'),
  // Flappy bird came back to the floor in October 2026. Its "play 2" keeps
  // the key it had before it left; 30 pipes is a good player's median run
  // and a casual player's best of ten (scripts/sim-flappy-tiers.ts).
  play2('flappy-2', 'Play 2 rounds of Flappy Bird', 'flappy-bird'),
  score('flappy-score-30', 'Score 30 in Flappy Bird', 30, 'flappy-bird'),
  // Ricochet is back on the floor (3 October). The 2026-07 key `ricochet-2` is
  // legacy, so these are new keys. A walls run of 20 is a good player's
  // second or third run (scripts/sim-ricochet.ts: good p50 15, strong p50 26).
  play2('ricochet-play-2', 'Play 2 rounds of Ricochet', 'ricochet'),
  score('ricochet-score-20', 'Score 20 in Ricochet', 20, 'ricochet'),
  // Trick shot has unlimited tries a day, and a try reaches the quests only
  // when it sets the day's best (the first try always does), so its play
  // quest is one try. 47 is two balls of three, or a clear on a two-ball
  // day: a casual player's best within a few tries (scripts/verify-trick-shot.ts).
  { key: 'trick-shot-1', kind: 'play_game', label: "Play the day's trick shot", goal: 1, rewardXp: 120, rewardTickets: 40, targetGame: 'trick-shot' },
  score('trick-shot-score-47', 'Score 47 in Trick Shot', 47, 'trick-shot'),
  // Mini golf counts the day's first full round, so its play quest is one
  // round. A round's points are 7 less each hole's strokes: a casual player
  // averages 41 and a good one 44 (scripts/verify-mini-golf-replay.ts --full).
  { key: 'mini-golf-1', kind: 'play_game', label: "Play the day's mini golf round", goal: 1, rewardXp: 120, rewardTickets: 40, targetGame: 'mini-golf' },
  score('mini-golf-score-44', 'Score 44 in Mini Golf', 44, 'mini-golf'),
  // Derby (October 2026). A race reports the lanes you beat as its score
  // (rewards/wallet.ts), so 5 is third or better: a good player's median
  // place against a bot field is 3.3 (scripts/sim-derby.ts).
  play2('derby-2', 'Race 2 times in Derby', 'derby'),
  score('derby-top-3', 'Finish third or better in Derby', 5, 'derby'),
  play2('8-ball-2', 'Play 2 games of 8-Ball', '8-ball'),
  win('8-ball-win', 'Win a game of 8-Ball', '8-ball'),
  play2('chess-2', 'Play 2 games of Chess', 'chess'),
  win('chess-win', 'Win a game of Chess', 'chess'),
  play2('connect-four-2', 'Play 2 games of Connect Four', 'connect-four'),
  win('connect-four-win', 'Win a game of Connect Four', 'connect-four'),
  // Ring toss (October 2026). 400 is a good player's median round and a
  // casual one's best of four (scripts/verify-ring-toss-replay.ts).
  play2('ring-toss-2', 'Play 2 rounds of Ring Toss', 'ring-toss'),
  score('ring-toss-score-400', 'Score 400 in Ring Toss', 400, 'ring-toss'),
  // Bumper cars (October 2026). A round's score is its points plus the podium;
  // 40 is about a medium bot's round, a good player's typical one
  // (scripts/sim-bumper-cars.ts: easy p50 34, medium 43, hard 50).
  play2('bumper-cars-2', 'Play 2 rounds of Bumper Cars', 'bumper-cars'),
  score('bumper-cars-score-40', 'Score 40 in Bumper Cars', 40, 'bumper-cars'),
];

/** Every daily template that can be picked, before the floor filter. */
export const DAILY_QUEST_TEMPLATES: readonly QuestTemplate[] = [...GENERIC_QUESTS, ...GAME_QUESTS];

/**
 * Templates from before the floor. Never picked. Kept so rows already in
 * user_daily_quests still resolve their label (getQuestTemplate).
 */
export const LEGACY_DAILY_QUESTS: readonly QuestTemplate[] = [
  { key: 'earn-300', kind: 'earn_tickets', label: 'Earn 300 tickets', goal: 300, rewardXp: 300, rewardTickets: 75 },
  { key: 'gopher-3', kind: 'play_game', label: 'Whack 3 rounds of Gopher', goal: 3, rewardXp: 150, rewardTickets: 50, targetGame: 'gopher' },
  { key: 'tetris-1', kind: 'play_game', label: 'Play a round of Tetris', goal: 1, rewardXp: 120, rewardTickets: 40, targetGame: 'tetris' },
  { key: 'ricochet-2', kind: 'play_game', label: 'Play 2 rounds of Ricochet', goal: 2, rewardXp: 150, rewardTickets: 50, targetGame: 'ricochet' },
  { key: 'swerve-2', kind: 'play_game', label: 'Play 2 rounds of Swerve', goal: 2, rewardXp: 150, rewardTickets: 50, targetGame: 'swerve' },
  { key: 'breakout-2', kind: 'play_game', label: 'Play 2 rounds of Breakout', goal: 2, rewardXp: 150, rewardTickets: 50, targetGame: 'breakout' },
  // Ticket stop's v1 points quest (0 to 300); #63 scores hits instead.
  score('ticket-stop-score-200', 'Score 200 in Ticket Stop', 200, 'ticket-stop'),
  { key: 'gopher-score-400', kind: 'score_game', label: 'Score 800 in Gopher', goal: 800, rewardXp: 200, rewardTickets: 60, targetGame: 'gopher' },
  // High striker's five-swing rules top out at 25, so 60 can't be reached. Rows already assigned still resolve.
  { key: 'high-striker-score-60', kind: 'score_game', label: 'Score 60 in High Striker', goal: 60, rewardXp: 200, rewardTickets: 60, targetGame: 'high-striker' },
  // High striker's five-swing quest; the endless rules (3) score far past 16. Rows already assigned still resolve.
  score('high-striker-score-16', 'Score 16 in High Striker', 16, 'high-striker'),
  // Tin duck's thirty second rules top out near 290, so 800 can't be reached. Rows already assigned still resolve.
  { key: 'tin-duck-score-800', kind: 'score_game', label: 'Score 800 in Tin Duck Gallery', goal: 800, rewardXp: 200, rewardTickets: 60, targetGame: 'tin-duck' },
];

const templateByKey = new Map(
  [...DAILY_QUEST_TEMPLATES, ...LEGACY_DAILY_QUESTS].map((q) => [q.key, q] as const),
);
export const getQuestTemplate = (key: string) => templateByKey.get(key) ?? null;

/** The pool to pick from right now: generic quests and floor games' quests. */
export const getDailyQuestPool = (onFloor: (slug: string) => boolean = isOnFloor): QuestTemplate[] =>
  DAILY_QUEST_TEMPLATES.filter((q) => !q.targetGame || onFloor(q.targetGame));

/** Stable hash, picks DAILY_QUEST_COUNT distinct templates for a user and day. */
export const pickQuestKeys = (
  userId: string,
  dateKey: string,
  onFloor: (slug: string) => boolean = isOnFloor,
): string[] => {
  const seed = crypto.createHash('sha256').update(`${userId}:${dateKey}`).digest();
  const pool = getDailyQuestPool(onFloor);
  const chosen: QuestTemplate[] = [];
  let i = 0;
  while (chosen.length < Math.min(DAILY_QUEST_COUNT, pool.length) && pool.length) {
    const idx = seed[i % seed.length]! % pool.length;
    chosen.push(pool.splice(idx, 1)[0]!);
    i += 1;
  }
  return chosen.map((q) => q.key);
};

/** The reroll: a floor quest not already in one of the day's slots, or null. */
export const pickRerollQuest = (
  userId: string,
  dateKey: string,
  slotIndex: number,
  rerollsUsed: number,
  inUse: ReadonlySet<string>,
  onFloor: (slug: string) => boolean = isOnFloor,
): QuestTemplate | null => {
  const seed = crypto
    .createHash('sha256')
    .update(`${userId}:${dateKey}:reroll:${slotIndex}:${rerollsUsed}`)
    .digest();
  const candidates = getDailyQuestPool(onFloor).filter((q) => !inUse.has(q.key));
  if (candidates.length === 0) return null;
  return candidates[seed[0]! % candidates.length]!;
};
