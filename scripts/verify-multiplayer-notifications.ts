import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  buildFriendWaitingNotification,
  buildMatchFoundNotification,
  multiplayerWaitDedupePrefix,
} from '../src/server/arcade/multiplayer-waiting-notifications';

const waiting = buildFriendWaitingNotification({
  recipientUserId: 'friend-1',
  ownerName: 'Morgan',
  gameType: 'chess',
  matchId: 'private-match-id',
});
assert.equal(waiting.href, '/chess');
assert.equal(waiting.preferenceKey, 'game_notifications');
assert.equal(waiting.type, 'friend_waiting_for_match');
assert.ok(!waiting.title.includes('private-match-id'));
assert.ok(!waiting.body.includes('private-match-id'));
assert.ok(!waiting.href.includes('private-match-id'));
assert.equal(
  waiting.dedupeKey,
  `${multiplayerWaitDedupePrefix({ gameType: 'chess', matchId: 'private-match-id' })}friend-1`,
);

const otherRecipient = buildFriendWaitingNotification({
  recipientUserId: 'friend-2',
  ownerName: 'Morgan',
  gameType: 'chess',
  matchId: 'private-match-id',
});
assert.notEqual(waiting.dedupeKey, otherRecipient.dedupeKey);

const emailFallback = buildFriendWaitingNotification({
  recipientUserId: 'friend-1',
  ownerName: 'private@example.com',
  gameType: 'reversi',
  matchId: 'match-2',
});
assert.match(emailFallback.title, /^A friend /);
assert.ok(!emailFallback.body.includes('private@example.com'));

const found = buildMatchFoundNotification({
  ownerUserId: 'owner-1',
  opponentName: 'Riley',
  gameType: 'typing-test',
  matchId: 'session-1',
});
assert.equal(found.type, 'multiplayer_match_found');
assert.equal(found.href, '/typing-test/duel?join=session-1');
assert.equal(found.userId, 'owner-1');
assert.match(found.dedupeKey ?? '', /session-1:owner-1$/);

const source = (relativePath: string) =>
  readFileSync(join(process.cwd(), relativePath), 'utf8');

const matchQueueSource = source('src/server/arcade/match-queue.ts');
assert.match(matchQueueSource, /announceWaitingQueueToOnlineFriends/);
assert.match(matchQueueSource, /announceMatchTableOpponentJoined/);
assert.match(
  matchQueueSource,
  /const outcome = await serializePerKey[\s\S]+?\n  \}\);\n\n  \/\/ The DB transaction has committed/,
  'notification work must run after the transaction and serialization gate',
);
assert.match(source('src/server/arcade/session-quick-join.ts'), /announceMultiplayerMatchFound/);
assert.match(source('src/server/arcade/session-quick-join.ts'), /resolveMultiplayerWaitingNotifications/);
assert.match(source('src/server/realtime/presence.ts'), /resolveWaitingNotificationsForOfflineOwner/);
const notificationServiceSource = source('src/server/services/notifications.ts');
assert.match(notificationServiceSource, /ON CONFLICT \(user_id, dedupe_key\)/);
assert.match(
  notificationServiceSource,
  /Failed to persist notification:[\s\S]+?return null;/,
  'failed persistence must not return a phantom delivered notification',
);

for (const game of ['8-ball', 'chess', 'connect-four', 'checkers', 'reversi', 'battleship']) {
  assert.match(
    source(`src/app/api/games/${game}/match/join/route.ts`),
    /announceMatchTableOpponentJoined/,
    `${game} explicit joins must resolve waiting alerts and notify the owner`,
  );
  assert.match(
    source(`src/app/api/games/${game}/match/[id]/cancel/route.ts`),
    /resolveMultiplayerWaitingNotifications/,
    `${game} cancellation must resolve waiting alerts`,
  );
}

console.log('multiplayer waiting notification invariants passed');
