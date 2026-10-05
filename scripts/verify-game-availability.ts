import assert from 'node:assert/strict';
import type { Pool } from 'pg';
import { DEFAULT_SITE_AVAILABILITY, type SiteAvailabilityConfig } from '../src/lib/site-availability';

// The strict database double rejects gameplay SQL: a disabled start must never
// insert a session or reach a wallet/transaction. No environment files are read.
process.env.DATABASE_URL = 'postgres://isolated:isolated@invalid/availability_regression';
let config: SiteAvailabilityConfig = structuredClone(DEFAULT_SITE_AVAILABILITY);
let updatedAt: number | null = 1000;
let settingReads = 0;
let transactionScenario: 'blocked' | 'new-seat' | 'existing-seat' | 'ready' = 'blocked';
const sessionRow = {
  id: 'qa-table', gameType: 'typing-test', mode: 'versus', status: 'waiting',
  ownerUserId: 'owner', ownerUserName: 'Owner', minPlayers: 2, maxPlayers: 2,
  currentPlayerCount: 1, visibility: 'public', metadataJson: '{}',
  createdAt: 1, updatedAt: 1, startedAt: null, completedAt: null,
};
const existingPlayer = {
  sessionId: 'qa-table', userId: 'qa', userName: 'QA', seatIndex: 0,
  role: 'player', status: 'seated', joinedAt: 1, updatedAt: 1, leftAt: null,
};
const pool = {
  async query(sql: string, params?: unknown[]) {
    if (/CREATE TABLE IF NOT EXISTS site_settings/.test(sql)) return { rows: [], rowCount: 0 };
    if (/SELECT id, config_json, updated_at, updated_by/.test(sql) && params?.[0] === 'site-availability') {
      settingReads += 1;
      return { rows: [{ id: 'site-availability', config_json: JSON.stringify(config), updated_at: updatedAt, updated_by: null }], rowCount: 1 };
    }
    throw new Error(`Unexpected gameplay SQL during disabled start: ${sql.slice(0, 80)}`);
  },
  async connect() {
    if (transactionScenario === 'blocked') {
      throw new Error('Disabled gameplay must not begin a wallet/session transaction.');
    }
    return {
      async query(sql: string) {
        if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql)) return { rows: [], rowCount: 0 };
        if (/FROM arcade_multiplayer_sessions/.test(sql)) return { rows: [sessionRow], rowCount: 1 };
        if (/FROM arcade_multiplayer_session_players/.test(sql)) {
          return { rows: transactionScenario === 'existing-seat' ? [existingPlayer] : [], rowCount: 0 };
        }
        throw new Error(`Paused multiplayer must not mutate seats/readiness: ${sql.slice(0, 80)}`);
      },
      release() {},
    };
  },
};
globalThis.__arcadePgPool = pool as unknown as Pool;

async function main() {
  const { assertGameAvailable, checkNewGameAvailability, checkGameSessionResume, GameUnavailableError } = await import('../src/server/arcade/game-availability');
  const { createGameSession } = await import('../src/server/arcade/game-session');
  const { createArcadeSession } = await import('../src/server/arcade/arcade-session');
  const { createMultiplayerSession, joinMultiplayerSession, setMultiplayerSessionPlayerReady } = await import('../src/server/arcade/multiplayer');
  const { quickJoinSession } = await import('../src/server/arcade/session-quick-join');
  const { placeDerbyBet } = await import('../src/server/arcade/derby/bets');

  config.disabledGames = ['snake', '21', 'derby', 'typing-test'];
  await assert.rejects(() => createGameSession('qa', 'snake'), GameUnavailableError);
  await assert.rejects(() => createArcadeSession('qa', 'arcade-blackjack', 10), GameUnavailableError);
  await assert.rejects(() => createMultiplayerSession({ gameType: 'typing-test', ownerUserId: 'qa', ownerUserName: 'QA' }), GameUnavailableError);
  await assert.rejects(() => quickJoinSession({ gameType: 'typing-test', modeSec: 30, user: { userId: 'qa', userName: 'QA' } }), GameUnavailableError);
  await assert.rejects(() => placeDerbyBet({ userId: 'qa', userName: 'QA', roundId: 'qa', horseIdx: 0, amount: 10 }), GameUnavailableError);
  transactionScenario = 'new-seat';
  await assert.rejects(() => joinMultiplayerSession({ sessionId: 'qa-table', userId: 'qa', userName: 'QA' }), GameUnavailableError);
  transactionScenario = 'ready';
  await assert.rejects(() => setMultiplayerSessionPlayerReady({ sessionId: 'qa-table', userId: 'qa', ready: true }), GameUnavailableError);
  transactionScenario = 'existing-seat';
  const reconnect = await joinMultiplayerSession({ sessionId: 'qa-table', userId: 'qa', userName: 'QA' });
  assert.equal(reconnect.players[0]?.userId, 'qa', 'An existing seat must still be resumable.');
  transactionScenario = 'blocked';
  await assert.rejects(() => assertGameAvailable('arcade-derby'), GameUnavailableError);
  await assertGameAvailable('chess');

  const response = await checkNewGameAvailability('snake');
  assert.equal(response?.status, 503);
  assert.equal(response?.headers.get('Cache-Control'), 'no-store');
  assert.equal(response?.headers.get('Retry-After'), '300');
  assert.deepEqual(await response?.json(), { error: config.message });
  assert.equal(await checkNewGameAvailability('chess'), null);

  // A paused game's previously issued token may reconnect and finish. A new
  // post-pause token cannot establish a skill-game socket, even if obtained via
  // another process before it observes the availability write.
  await checkGameSessionResume('snake', 999);
  await checkGameSessionResume('snake', 1000);
  await assert.rejects(() => checkGameSessionResume('snake', 1001), GameUnavailableError);
  await checkGameSessionResume('chess', 1001);
  updatedAt = null;
  await assert.rejects(() => checkGameSessionResume('snake', 999), GameUnavailableError);

  config = structuredClone(DEFAULT_SITE_AVAILABILITY);
  config.sections.games = false;
  await assert.rejects(() => createGameSession('qa', 'coin-flip'), GameUnavailableError);
  await assert.rejects(() => createArcadeSession('qa', 'arcade-slots', 10), GameUnavailableError);
  await assert.rejects(() => createMultiplayerSession({ gameType: 'blackjack', ownerUserId: 'qa', ownerUserName: 'QA' }), GameUnavailableError);
  await assert.rejects(() => placeDerbyBet({ userId: 'qa', userName: null, roundId: 'qa', horseIdx: 0, amount: 10 }), GameUnavailableError);
  assert.equal(settingReads, 20, 'Each operation must observe current settings.');
  // Friend challenges are separate new-match entry points and must not reach
  // account lookup, notifications, or wager holds while games are paused.
  const poolChallenge = await import('../src/app/api/games/8-ball/challenge/route');
  const chessChallenge = await import('../src/app/api/games/chess/challenge/route');
  const request = new Request('http://invalid/api/games/chess/challenge', { method: 'POST' });
  assert.equal((await poolChallenge.POST(request)).status, 503);
  assert.equal((await chessChallenge.POST(request)).status, 503);
  console.log('Gameplay availability regressions passed: start gates, aliases, HTTP 503, and existing-round reconnects.');
}

// game-session owns a periodic cleanup timer. Explicitly exit the isolated test
// process after assertions; it never connects to a real database.
main().then(() => process.exit(0), (error: unknown) => {
  console.error(error);
  process.exit(1);
});
