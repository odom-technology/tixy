import assert from 'node:assert/strict';

import {
  getArcadeTourGames,
  getArcadeTourWeek,
  scoreArcadeTourRows,
} from '../src/server/arcade/arcade-tour';

const friday = getArcadeTourWeek(Date.UTC(2026, 7, 7, 18));
assert.deepEqual(friday, {
  weekKey: '2026-08-03',
  startsAt: Date.UTC(2026, 7, 3),
  endsAt: Date.UTC(2026, 7, 10),
});
assert.equal(getArcadeTourWeek(Date.UTC(2026, 7, 9, 23)).weekKey, '2026-08-03');
assert.equal(getArcadeTourWeek(Date.UTC(2026, 7, 10)).weekKey, '2026-08-10');

const games = getArcadeTourGames(friday.weekKey);
assert.equal(games.length, 3);
assert.equal(new Set(games.map((game) => game.slug)).size, 3);
assert.deepEqual(games, getArcadeTourGames(friday.weekKey));
assert.notDeepEqual(games, getArcadeTourGames('2026-08-10'));

const [first, second, third] = games;
const standings = scoreArcadeTourRows(games, [
  { gameSlug: first.slug, userId: 'a', userName: 'Alice', score: 100 },
  { gameSlug: first.slug, userId: 'b', userName: 'Bob', score: 90 },
  { gameSlug: first.slug, userId: 'c', userName: 'Carol', score: 90 },
  { gameSlug: second.slug, userId: 'a', userName: 'Alice', score: 50 },
  { gameSlug: second.slug, userId: 'b', userName: 'Bob', score: 100 },
  { gameSlug: third.slug, userId: 'a', userName: 'Alice', score: 10 },
]);

assert.deepEqual(
  standings.map(({ userId, rank, points, gamesCompleted, badge }) => ({
    userId,
    rank,
    points,
    gamesCompleted,
    badge,
  })),
  [
    { userId: 'a', rank: 1, points: 299, gamesCompleted: 3, badge: 'Tour leader' },
    { userId: 'b', rank: 2, points: 199, gamesCompleted: 2, badge: 'Top 10' },
    { userId: 'c', rank: 3, points: 99, gamesCompleted: 1, badge: 'Top 10' },
  ],
);
assert.equal(standings[1].games[0].rank, 2);
assert.equal(standings[2].games[0].rank, 2, 'ties share the same per-game rank');

console.log('tixy Tour rotation, week boundaries, tie ranks, and combined scoring passed.');
