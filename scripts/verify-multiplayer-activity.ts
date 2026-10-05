import assert from 'node:assert/strict';

import {
  pickFeaturedMultiplayerGame,
  type MultiplayerGameActivity,
} from '../src/server/arcade/multiplayer-activity';

function game(
  gameType: MultiplayerGameActivity['gameType'],
  counts: Partial<Pick<MultiplayerGameActivity, 'playersInGame' | 'openLobbies' | 'liveMatches'>> = {},
): MultiplayerGameActivity {
  return {
    gameType,
    label: gameType,
    lobbyPath: `/${gameType}`,
    playersInGame: counts.playersInGame ?? 0,
    openLobbies: counts.openLobbies ?? 0,
    liveMatches: counts.liveMatches ?? 0,
  };
}

const waitingPlayerWins = pickFeaturedMultiplayerGame(
  [game('chess', { liveMatches: 3 }), game('checkers', { openLobbies: 1 })],
  '2026-08-03',
);
assert.equal(waitingPlayerWins.gameType, 'checkers');
assert.equal(waitingPlayerWins.reason, 'open-lobbies');

const presenceWins = pickFeaturedMultiplayerGame(
  [game('chess', { playersInGame: 2 }), game('reversi', { liveMatches: 2 })],
  '2026-08-03',
);
assert.equal(presenceWins.gameType, 'chess');
assert.equal(presenceWins.reason, 'players-online');

const zeroActivityA = pickFeaturedMultiplayerGame(
  [game('chess'), game('reversi'), game('battleship')],
  '2026-08-03',
);
const zeroActivityB = pickFeaturedMultiplayerGame(
  [game('chess'), game('reversi'), game('battleship')],
  '2026-08-03',
);
assert.equal(zeroActivityA.gameType, zeroActivityB.gameType);
assert.equal(zeroActivityA.reason, 'daily-rotation');

assert.throws(() => pickFeaturedMultiplayerGame([], '2026-08-03'));

console.log('multiplayer activity ranking invariants passed');
