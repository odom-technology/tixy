// ---------------------------------------------------------------------------
// Shared quick-match ("PLAY") backend for the unified multiplayer lobby.
//
// One transactional join-else-create routine that every versus game plugs into
// via a small per-game adapter. The design contract (.playtest/lobby-contract.md
// §PLAY) calls for:
//
//   SELECT ... FROM <game>_matches WHERE status='waiting' AND <compatible>
//     AND player1 <> me ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1
//   → atomically join it; else INSERT a waiting row.
//
// `runQuickMatch` owns the control flow (join → dedupe → create) and each game
// supplies the SQL specifics + its existing join/create logic through the
// `QuickMatchAdapter`. The join step runs in its own transaction using
// `FOR UPDATE SKIP LOCKED` so concurrent PLAY clicks never grab the same
// waiting row; the create/dedupe steps reuse each game's pooled helpers
// (e.g. chess `createMatch`) so wager/broadcast/bookkeeping stay in one place.
//
// NO rating/ELO logic lives here — quick-match only pairs casual (non-wager)
// waiting rows. Rating is settled by each game's existing match-completion path.
// ---------------------------------------------------------------------------

import type { PoolClient } from 'pg';
import { withTransaction } from '@/server/db/client';
import {
  announceMatchTableOpponentJoined,
  announceWaitingQueueToOnlineFriends,
  type WaitingNotificationGameType,
} from '@/server/arcade/multiplayer-waiting-notifications';

/** The caller requesting a quick match. */
export type QuickMatchUser = {
  userId: string;
  userName: string;
};

/** Result returned to the client. `matched` = paired with a live opponent and
 *  the match is now active; `queued` = waiting for someone to join. */
export type QuickMatchResult = {
  status: 'matched' | 'queued';
  matchId: string;
};

/**
 * Per-game glue. Bind the caller's requested params (time format, color pref,
 * etc.) into the closures when you construct the adapter — `runQuickMatch`
 * itself is param-agnostic.
 */
export type QuickMatchAdapter = {
  /** Game identifier, for logging only. */
  gameType: Exclude<WaitingNotificationGameType, 'typing-test'>;

  /**
   * Inside the given transaction, find ONE compatible waiting match (another
   * player's open row with matching params) using
   * `SELECT ... FOR UPDATE SKIP LOCKED LIMIT 1`, then atomically claim it for
   * `user` (the row is already locked, so a plain `UPDATE` is safe). Return the
   * joined match id, or `null` when no compatible waiting match exists.
   *
   * Must NOT commit/rollback — `runQuickMatch` owns the transaction lifecycle.
   */
  tryJoinWaiting: (client: PoolClient, user: QuickMatchUser) => Promise<string | null>;

  /**
   * Return the id of a compatible waiting match the caller ALREADY owns (same
   * params, still open), or `null`. Prevents a second PLAY click from spawning
   * a duplicate waiting row. Runs on a pooled connection (no active tx).
   */
  findOwnWaiting: (user: QuickMatchUser) => Promise<string | null>;

  /**
   * Create a fresh waiting match for `user` and return its id. Reuse the game's
   * existing `createMatch` so wager holds, broadcasts, and defaults stay in one
   * place. Runs on a pooled connection (no active tx).
   */
  createWaiting: (user: QuickMatchUser) => Promise<string>;

  /**
   * Fired AFTER the join transaction commits. Use it to emit the realtime
   * broadcasts the game normally sends on join (lobby `match_joined`, the
   * `<game>:{id}` `opponent_joined` notice, etc.) so both players' pages
   * transition. Optional.
   */
  onJoined?: (matchId: string, user: QuickMatchUser) => void | Promise<void>;
};

// ---------------------------------------------------------------------------
// Per-(gameType,user) serialization of the own-check→join→create critical
// section.
//
// `findOwnWaiting` / `tryJoinWaiting` / `createWaiting` do NOT share one atomic
// DB step. Two PLAY requests from the SAME user that arrive together must not
// (a) both INSERT — duplicate waiting rows (contract §PLAY: "no duplicates"),
// nor (b) have one join a *third* player's row while the caller's own waiting
// row is left open — one user with two live obligations. Serializing the whole
// own-check→join→create flow per user makes PLAY idempotent and closes both.
// The UI already blocks concurrent PLAY clicks, so this only bites API-level
// hammering (or a second tab), but the server must hold the invariant regardless.
//
// We serialize just that critical section in-process, keyed by gameType+user.
// The server is a single long-lived Node process (see server.ts), so an
// in-memory async gate is sufficient and — unlike a DB advisory lock held
// across a second pooled `createWaiting` connection — carries ZERO pool-
// exhaustion / deadlock risk. Different users never contend — distinct keys
// run fully in parallel — so cross-user pairing keeps its throughput.
// ---------------------------------------------------------------------------
declare global {
  var __arcadeQuickMatchDedupeChains: Map<string, Promise<void>> | undefined;
}
const dedupeChains: Map<string, Promise<void>> = (globalThis.__arcadeQuickMatchDedupeChains ??=
  new Map<string, Promise<void>>());

export async function serializePerKey<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = dedupeChains.get(key) ?? Promise.resolve();
  let settle!: () => void;
  const done = new Promise<void>((resolve) => {
    settle = resolve;
  });
  dedupeChains.set(key, done);
  // Wait our turn behind any in-flight critical section for this key.
  await prev.catch(() => {});
  try {
    return await fn();
  } finally {
    settle();
    // Drop the map entry once we're the tail so the map can't grow unbounded.
    if (dedupeChains.get(key) === done) dedupeChains.delete(key);
  }
}

/**
 * Transactional join-else-create quick match, idempotent per PLAY.
 *
 * The ENTIRE own-check → join → create flow is serialized per (gameType, user)
 * so a user who fires PLAY twice (e.g. a second tab) can never end up with two
 * live obligations:
 *
 * 1. If the caller ALREADY owns an equivalent waiting match → `queued` (return
 *    that row; PLAY is idempotent). Checked FIRST so a double-fire can never
 *    join a *third* player's row while leaving its own row orphaned.
 * 2. Else, in a transaction, try to atomically join a compatible waiting match
 *    from another player (`FOR UPDATE SKIP LOCKED`). If joined → `matched`.
 * 3. Else create a new waiting match → `queued`.
 *
 * The gate is per-user, so cross-user pairing (step 2) and different users
 * never contend — distinct keys run fully in parallel with zero throughput cost.
 */
export async function runQuickMatch(
  adapter: QuickMatchAdapter,
  user: QuickMatchUser,
): Promise<QuickMatchResult> {
  const outcome = await serializePerKey(`${adapter.gameType}:${user.userId}`, async () => {
    // 1) Already queued? Return the existing waiting match — PLAY is idempotent.
    //    Checked BEFORE any join so a second PLAY click can never abandon the
    //    caller's own open row by seating them into someone else's.
    const ownWaitingId = await adapter.findOwnWaiting(user);
    if (ownWaitingId) {
      return { status: 'queued', matchId: ownWaitingId, created: false } as const;
    }

    // 2) Join an existing compatible waiting match (another player's), atomically.
    const joinedId = await withTransaction((client) =>
      adapter.tryJoinWaiting(client, user),
    );
    if (joinedId) {
      return { status: 'matched', matchId: joinedId, created: false } as const;
    }

    // 3) Nobody to pair with — open a fresh waiting match and wait.
    const createdId = await adapter.createWaiting(user);
    return { status: 'queued', matchId: createdId, created: true } as const;
  });

  // The DB transaction has committed and the per-user serialization gate has
  // been released before any best-effort broadcast/notification I/O begins.
  if (outcome.status === 'matched') {
    await adapter.onJoined?.(outcome.matchId, user);
    await announceMatchTableOpponentJoined({
      gameType: adapter.gameType,
      matchId: outcome.matchId,
      opponentName: user.userName,
    });
  } else if (outcome.created) {
    await announceWaitingQueueToOnlineFriends({
      ownerUserId: user.userId,
      ownerName: user.userName,
      gameType: adapter.gameType,
      matchId: outcome.matchId,
    });
  }

  return { status: outcome.status, matchId: outcome.matchId };
}
