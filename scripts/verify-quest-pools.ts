/**
 * Verifies the floor-built quest, featured and tour pools (tixy/2-quests-floor).
 *
 *   npm run test:quest-pools
 *
 * - over 365 days from the day the floor pools start, no daily quest pick, no
 *   reroll, no featured game and no tour game is ever off the floor
 * - the same holds when the floor shrinks: with games taken off the floor
 *   (the predicate every picker takes), none of them is picked
 * - before the switch day the featured game and the tour are exactly what
 *   they were, so nothing changes under players mid-week
 * - every daily template that ever shipped still resolves its label, and old
 *   quest keys are unchanged
 * - each floor skill game has a "play 2" and a score or win quest; the 4
 *   generic quests are there with "earn 250" in place of "earn 300"
 */
import assert from 'node:assert/strict';

import { getFloorGames, isOnFloor } from '../src/features/arcade/components/arcade-game-registry';
import { getArcadeTourGames, getArcadeTourWeek } from '../src/server/arcade/arcade-tour';
import {
  DAILY_QUEST_TEMPLATES,
  LEGACY_DAILY_QUESTS,
  getDailyQuestPool,
  getQuestTemplate,
  pickQuestKeys,
  pickRerollQuest,
} from '../src/server/arcade/battlepass/daily-quests';
import { DAILY_QUEST_COUNT, DAILY_QUEST_REROLLS } from '../src/server/arcade/battlepass/season-0';
import { getFeaturedGameType } from '../src/server/arcade/featured-game';
import { FLOOR_POOLS_FROM } from '../src/server/arcade/floor-pools';

let passed = 0;
const ok = (message: string) => {
  passed += 1;
  console.log(`  ok  ${message}`);
};

const DAY_MS = 24 * 60 * 60 * 1000;
const start = Date.parse(`${FLOOR_POOLS_FROM}T00:00:00Z`);
const dateKeys = Array.from({ length: 365 }, (_, i) => new Date(start + i * DAY_MS).toISOString().slice(0, 10));
const users = Array.from({ length: 24 }, (_, i) => `user-${i}`);

const templateGame = (key: string) => getQuestTemplate(key)?.targetGame;

/* The pool a game leaving the floor must leave: run every picker against the
   real floor, then against floors with games removed. */
const floors: { name: string; onFloor: (slug: string) => boolean }[] = [
  { name: 'the real floor', onFloor: isOnFloor },
  { name: 'snake and skee-ball gone', onFloor: (slug) => isOnFloor(slug) && slug !== 'snake' && slug !== 'skee-ball' },
  { name: 'only ticket stop, tin duck and chess left', onFloor: (slug) => ['ticket-stop', 'tin-duck', 'chess'].includes(slug) },
];

for (const { name, onFloor } of floors) {
  for (const dateKey of dateKeys) {
    for (const userId of users) {
      const keys = pickQuestKeys(userId, dateKey, onFloor);
      assert.equal(keys.length, DAILY_QUEST_COUNT, `${name}: ${dateKey} picks ${DAILY_QUEST_COUNT}`);
      assert.equal(new Set(keys).size, keys.length, `${name}: ${dateKey} picks distinct quests`);
      for (const key of keys) {
        const game = templateGame(key);
        assert.ok(!game || onFloor(game), `${name}: ${dateKey} ${userId} picked ${key}, off the floor`);
      }
      // Both rerolls, one slot each, then a third try on slot 0.
      const inUse = new Set(keys);
      for (let used = 0; used < DAILY_QUEST_REROLLS; used += 1) {
        const next = pickRerollQuest(userId, dateKey, used, used, inUse, onFloor);
        assert.ok(next, `${name}: ${dateKey} a reroll finds a quest`);
        assert.ok(!inUse.has(next.key), `${name}: ${dateKey} a reroll is a new quest`);
        assert.ok(!next.targetGame || onFloor(next.targetGame), `${name}: ${dateKey} reroll ${next.key} is off the floor`);
        inUse.add(next.key);
      }
    }
    const featured = getFeaturedGameType(dateKey, onFloor);
    assert.ok(onFloor(featured), `${name}: ${dateKey} featured ${featured} is off the floor`);
  }
  ok(`${name}: 365 days x ${users.length} players pick and reroll only floor quests; the featured game is a floor game`);
}

// The tour turns over on Mondays; 52 weeks from the switch day.
for (const { name, onFloor } of floors.slice(0, 2)) {
  for (let week = 0; week < 52; week += 1) {
    const { weekKey } = getArcadeTourWeek(start + week * 7 * DAY_MS);
    const games = getArcadeTourGames(weekKey, onFloor);
    assert.equal(games.length, 3, `${name}: ${weekKey} has 3 tour games`);
    assert.equal(new Set(games.map((game) => game.slug)).size, 3, `${name}: ${weekKey} tour games are distinct`);
    for (const game of games) assert.ok(onFloor(game.slug), `${name}: ${weekKey} tour game ${game.slug} is off the floor`);
  }
}
ok('52 tour weeks have 3 distinct floor games');

// Before the switch, nothing moves: pinned to the pre-change results.
assert.equal(getArcadeTourWeek(Date.parse('2026-10-05T12:00:00Z')).weekKey, '2026-10-05');
assert.equal(getFeaturedGameType('2026-10-03'), getFeaturedGameType('2026-10-03', () => false), 'before the switch the featured pool ignores the floor');
assert.deepEqual(
  getArcadeTourGames('2026-10-05').map((game) => game.slug),
  getArcadeTourGames('2026-10-05', () => false).map((game) => game.slug),
  'before the switch the tour ignores the floor',
);
ok(`before ${FLOOR_POOLS_FROM} the featured game and the tour are the pre-floor pools`);

// Old rows keep their labels, and stored keys are unchanged.
const legacyLabels: [string, string][] = [
  ['earn-300', 'Earn 300 tickets'],
  ['swerve-2', 'Play 2 rounds of Swerve'],
  ['ricochet-2', 'Play 2 rounds of Ricochet'],
  ['flappy-2', 'Play 2 rounds of Flappy Bird'],
  ['gopher-3', 'Whack 3 rounds of Gopher'],
  ['tetris-1', 'Play a round of Tetris'],
  ['breakout-2', 'Play 2 rounds of Breakout'],
  ['gopher-score-400', 'Score 800 in Gopher'],
  ['snake-2', 'Play 2 rounds of Snake'],
  ['snake-score-150', 'Score 150 in Snake'],
  ['2048-score-2000', 'Score 2000 in 2048'],
  ['play-any-3', 'Play 3 games'],
  ['play-any-6', 'Play 6 games'],
  ['earn-150', 'Earn 150 tickets'],
];
for (const [key, label] of legacyLabels) {
  assert.equal(getQuestTemplate(key)?.label, label, `${key} keeps its label`);
}
const keys = [...DAILY_QUEST_TEMPLATES, ...LEGACY_DAILY_QUESTS].map((quest) => quest.key);
assert.equal(new Set(keys).size, keys.length, 'quest keys are unique across current and legacy');
assert.ok(getQuestTemplate('w4-swerve-6') === null, 'weekly keys are not daily keys');
ok(`${legacyLabels.length} legacy daily keys keep their labels; ${keys.length} keys are unique`);

// The pool's shape.
const floorSkill = ['snake', '2048', 'stack', 'skee-ball', 'high-striker', 'tin-duck', 'ticket-stop', 'ricochet', 'flappy-bird', '8-ball', 'chess', 'connect-four'];
// Ring toss
floorSkill.push('ring-toss');
// Derby
floorSkill.push('derby');
for (const slug of floorSkill) {
  assert.ok(isOnFloor(slug), `${slug} is on the floor`);
  const own = DAILY_QUEST_TEMPLATES.filter((quest) => quest.targetGame === slug);
  assert.ok(own.some((quest) => quest.kind === 'play_game' && quest.goal === 2), `${slug} has a play 2 quest`);
  assert.ok(own.some((quest) => quest.kind === 'score_game'), `${slug} has a score or win quest`);
}
// Mini golf counts one round a day, so its play quest is one round.
{
  assert.ok(isOnFloor('mini-golf'), 'mini golf is on the floor');
  const own = DAILY_QUEST_TEMPLATES.filter((quest) => quest.targetGame === 'mini-golf');
  assert.ok(own.some((quest) => quest.kind === 'play_game' && quest.goal === 1), 'mini golf has a play 1 quest');
  assert.ok(own.some((quest) => quest.kind === 'score_game'), 'mini golf has a score quest');
  ok("mini golf has the day's round and a score quest");
}
const generic = DAILY_QUEST_TEMPLATES.filter((quest) => !quest.targetGame).map((quest) => quest.key).sort();
assert.deepEqual(generic, ['earn-150', 'earn-250', 'play-any-3', 'play-any-6']);
assert.equal(getDailyQuestPool().length, DAILY_QUEST_TEMPLATES.length, 'every template is on the real floor today');
const floorSet = new Set(getFloorGames().map((game) => game.slug));
for (const quest of DAILY_QUEST_TEMPLATES) {
  assert.ok(!quest.targetGame || floorSet.has(quest.targetGame), `${quest.key} names a floor game`);
}
ok(`${floorSkill.length} floor skill games each have play 2 and a score or win quest; 4 generic quests`);

console.log(`\nquest pools: ${passed} checks passed`);
