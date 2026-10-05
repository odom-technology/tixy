import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  SCORE_CHALLENGE_GAMES,
  formatScoreChallengeTarget,
  getScoreChallengeGameFromPath,
} from '../src/features/arcade/lib/score-challenge';
import { SCORE_LEADERBOARD_GAMES } from '../src/server/arcade/score-events';
import {
  signScoreChallenge,
  verifyScoreChallenge,
} from '../src/server/arcade/score-challenges';

process.env.GAME_SESSION_SECRET = 'result-sharing-verification-secret-at-least-32-characters';

const now = 1_800_000_000_000;
const token = signScoreChallenge({
  gameSlug: 'snake',
  score: 12_345,
  now,
});
const verified = verifyScoreChallenge(token, now + 1_000);
assert.ok(verified);
assert.equal(verified.gameSlug, 'snake');
assert.equal(verified.gameHref, '/snake');
assert.equal(verified.score, 12_345);
assert.equal(verified.formattedScore, '12,345');

const [payload, signature] = token.split('.');
assert.ok(payload && signature);
const tamperedPayload = Buffer.from(
  JSON.stringify({ v: 1, g: 'snake', s: 999_999_999, m: null, iat: now, exp: now + 604_800_000 }),
).toString('base64url');
assert.equal(verifyScoreChallenge(`${tamperedPayload}.${signature}`, now), null);
assert.equal(verifyScoreChallenge(`${payload}.${signature.slice(0, -1)}x`, now), null);
assert.equal(verifyScoreChallenge(token, now + 604_800_001), null);

assert.equal(formatScoreChallengeTarget('reaction-time', 187.6), '188 ms');
assert.equal(formatScoreChallengeTarget('sudoku', 125_000), '2:05');
assert.equal(getScoreChallengeGameFromPath('/typing-test/duel')?.slug, 'typing-test');
assert.equal(getScoreChallengeGameFromPath('/snake/not-a-real-run')?.href, '/snake');
assert.equal(getScoreChallengeGameFromPath('/chess'), null);

assert.deepEqual(
  SCORE_CHALLENGE_GAMES.map((game) => game.slug).sort(),
  Object.keys(SCORE_LEADERBOARD_GAMES).sort(),
  'shareable score games must stay aligned with the accepted-score event registry',
);

const challengeServerSource = readFileSync(
  join(process.cwd(), 'src/server/arcade/score-challenges.ts'),
  'utf8',
);
assert.match(challengeServerSource, /SELECT score, mode, created_at/);
assert.doesNotMatch(
  challengeServerSource,
  /\b(?:INSERT|UPDATE|DELETE)\b/,
  'display-only challenges must not write scores, rewards, or leaderboards',
);

const challengeRouteSource = readFileSync(
  join(process.cwd(), 'src/app/api/games/score-challenges/route.ts'),
  'utf8',
);
assert.doesNotMatch(challengeRouteSource, /body\.score/);
assert.match(challengeRouteSource, /gameSlug: identity\.userId|userId: identity\.userId/);

const resultSource = readFileSync(
  join(process.cwd(), 'src/features/arcade/components/results/arcade-run-result.tsx'),
  'utf8',
);
assert.match(resultSource, /ArcadeResultShare/);

const shareSource = readFileSync(
  join(process.cwd(), 'src/features/arcade/components/results/arcade-result-share.tsx'),
  'utf8',
);
assert.match(shareSource, /navigator\.share/);
assert.match(shareSource, /navigator\.clipboard/);
assert.match(shareSource, /result_shared/);

const landingSource = readFileSync(
  join(process.cwd(), 'src/features/arcade/components/results/score-challenge-landing.tsx'),
  'utf8',
);
assert.match(landingSource, /challenge_opened/);
assert.match(landingSource, /cannot grant rewards by itself/);

console.log('result sharing and signed score challenge invariants passed');
