import assert from 'node:assert/strict';
import { createPattern, readChoices, replayPattern, ROUNDS, RULES_VERSION } from '../src/features/arcade/lib/starter-match/engine';

assert.equal(RULES_VERSION, 1);
assert.deepEqual(createPattern(0), [0, 1, 3, 2, 1, 2, 1, 2], 'Versioned replay fixture stays stable.');
assert.deepEqual(createPattern(12345), [0, 0, 2, 2, 3, 0, 1, 2]);
for (const seed of [0, 1, 12345, 2 ** 31 - 1]) {
  const pattern = createPattern(seed);
  assert.equal(pattern.length, ROUNDS);
  assert.equal(replayPattern(seed, pattern).score, 800);
  assert.equal(replayPattern(seed, pattern.map((choice) => (choice + 1) % 4)).score, 0);
  const halfWrong = pattern.map((choice, round) => round % 2 ? choice : (choice + 1) % 4);
  assert.equal(replayPattern(seed, halfWrong).score, 400);
  assert.deepEqual(createPattern(seed), pattern, 'Replay has no ambient randomness.');
}
for (const invalid of [null, {}, [], [0], Array(8), Array(9).fill(0), Array(8).fill('0'), Array(8).fill(4), Array(8).fill(-1), Array(8).fill(0.5), Array(8).fill(NaN)]) {
  assert.throws(() => readChoices(invalid));
}
for (const invalid of [-1, 2 ** 31, NaN, Infinity, 1.5]) assert.throws(() => createPattern(invalid));
console.log('Starter game: deterministic fixtures, exact replay scoring, and malformed transcripts passed.');
