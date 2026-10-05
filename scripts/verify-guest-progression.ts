import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const readSource = (path: string) => readFileSync(join(root, path), 'utf8');

const sessionSource = readSource('src/app/api/games/session/route.ts');
const sessionPost = sessionSource.slice(
  sessionSource.indexOf('export async function POST'),
  sessionSource.indexOf('export async function PATCH'),
);
assert.match(sessionPost, /requireIdentity\(\{ allowExternal: true \}\)/);
assert.doesNotMatch(sessionPost, /allowGuest|getOrCreateRouteIdentity/);

const scoreHelperSource = readSource('src/app/api/games/_shared/score-helpers.ts');
assert.match(scoreHelperSource, /requireIdentity\(\{ allowExternal: true \}\)/);
assert.doesNotMatch(scoreHelperSource, /allowGuest: true/);

const gamesApiRoot = join(root, 'src/app/api/games');
const scoreRoutes = (readdirSync(gamesApiRoot, {
  recursive: true,
  encoding: 'utf8',
}) as string[]).filter((file) => file.endsWith('/score/route.ts'));

for (const route of scoreRoutes) {
  const source = readFileSync(join(gamesApiRoot, route), 'utf8');
  const postStart = source.indexOf('export async function POST');
  assert.notEqual(postStart, -1, `${route} must expose a score POST`);
  const nextExport = source.indexOf('\nexport async function ', postStart + 1);
  const postSource = source.slice(postStart, nextExport === -1 ? undefined : nextExport);
  assert.doesNotMatch(
    postSource,
    /allowGuest: true/,
    `${route} must not authenticate guests for score submission`,
  );
}

const rewardSource = readSource('src/server/arcade/rewards/wallet.ts');
const guestRewardGuard = rewardSource.indexOf('if (isGuestUserId(userId))');
const rewardTransaction = rewardSource.indexOf('withTransaction<AwardOutcome>');
assert.ok(guestRewardGuard > -1 && guestRewardGuard < rewardTransaction);

const scoreEventSource = readSource('src/server/arcade/score-events.ts');
assert.match(scoreEventSource, /if \(isGuestUserId\(input\.userId\)\) return;/);

console.log('guest runs remain local-only and cannot persist progression');
