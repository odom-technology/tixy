import assert from 'node:assert/strict';
import {
  PANGRAM_MIN_WORDS,
  PANGRAM_RANK_TIERS,
  PANGRAM_SETS,
  finalizeScore,
  getDayNumber,
  gradeGuess,
  scorePangramWord,
  solutionsFor,
  validatePangramSet,
} from '../src/server/arcade/pangram';
import {
  gradeWordGrid,
  isWinningGrade,
} from '../src/server/arcade/word-grid';

const rejectedDictionaryArtifacts = [
  'blore',
  'clava',
  'embry',
  'lavid',
  'liley',
  'lored',
  'tonue',
  'zooabate',
];

for (const [index, set] of PANGRAM_SETS.entries()) {
  const validation = validatePangramSet(set);
  assert.equal(validation.ok, true, `default Pangram set ${index} must be playable`);
  if (!validation.ok) continue;

  const { words, pangrams, maxScore } = validation.solutions;
  assert.ok(words.length >= PANGRAM_MIN_WORDS);
  assert.ok(pangrams.length >= 1);
  assert.equal(maxScore, words.reduce((sum, word) => sum + scorePangramWord(word), 0));

  const allowed = new Set(set.letters);
  for (const word of words) {
    assert.ok(word.length >= 4);
    assert.ok(word.includes(set.center));
    assert.ok([...word].every((letter) => allowed.has(letter)));
  }
  for (const word of pangrams) {
    assert.equal(new Set(word).size, 7);
  }
}

const sampleSet = PANGRAM_SETS[8]!;
const sampleSolutions = solutionsFor(sampleSet);
assert.ok(sampleSolutions.words.includes('apple'));
assert.ok(sampleSolutions.pangrams.includes('spectacle'));
assert.deepEqual(gradeGuess('test-day', 'app'), {
  accepted: false,
  isPangram: false,
  points: 0,
  reason: 'too-short',
});

// Grade against an explicit override-independent set through the pure solution
// builder, and verify score finalization de-duplicates accepted submissions.
const finalizedDate = '2026-07-30';
const finalized = finalizeScore(finalizedDate, ['apple', 'APPLE', 'spectacle', 'notaword']);
assert.deepEqual(finalized.validWords, ['apple', 'spectacle']);
assert.equal(finalized.score, 21);
assert.equal(finalized.pangrams, 1);

for (const artifact of rejectedDictionaryArtifacts) {
  assert.ok(
    !PANGRAM_SETS.some((set) => solutionsFor(set).words.includes(artifact)),
    `${artifact} must not appear in a default hive`,
  );
}

assert.deepEqual(
  PANGRAM_RANK_TIERS.map((tier) => [tier.name, tier.pct]),
  [
    ['Beginner', 0],
    ['Good Start', 0.02],
    ['Moving Up', 0.05],
    ['Good', 0.08],
    ['Great', 0.15],
    ['Amazing', 0.25],
    ['Genius', 0.7],
    ['Queen Bee', 1],
  ],
);
assert.equal(getDayNumber('2025-01-01'), 1);
assert.equal(getDayNumber('2026-07-30'), 576);

assert.deepEqual(
  gradeWordGrid('llama', 'alley'),
  ['present', 'correct', 'present', 'absent', 'absent'],
);
assert.deepEqual(
  gradeWordGrid('sassy', 'asset'),
  ['present', 'present', 'correct', 'absent', 'absent'],
);
assert.equal(isWinningGrade(gradeWordGrid('crane', 'crane')), true);
assert.equal(isWinningGrade(gradeWordGrid('crane', 'caper')), false);

console.log(`Verified ${PANGRAM_SETS.length} Pangram hives and Word Grid grading.`);
