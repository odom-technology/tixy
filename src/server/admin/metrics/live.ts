import { query } from '@/server/db/client';
import { getMultiplayerActivitySnapshot } from '@/server/arcade/multiplayer-activity';

import { cached } from './cache';
import { canonicalGameKey, gameRef } from './games';
import { num } from './window';
import type { GameRef, LiveMetrics } from './types';

/* Live: what is happening now. Cached for at most 5 seconds. */

const PRESENCE_FRESH_MS = 120_000;
const SESSION_FRESH_MS = 5 * 60_000;
const LAST_WINDOW_MS = 15 * 60_000;
const LIVE_TTL_MS = 5_000;

/** Accounts online: presence seen in the last 2 minutes, status not offline.
    A small table (one row per account), read by a status index. */
export async function countOnline(now: number = Date.now()): Promise<number> {
  const result = await query<{ n: string }>(
    `SELECT COUNT(*) AS n FROM arcade_user_presence WHERE status <> 'offline' AND last_seen_at >= $1`,
    [now - PRESENCE_FRESH_MS],
  );
  return num(result.rows[0]?.n);
}

/**
 * online / inGame: arcade_user_presence rows with last_seen_at in the last 120
 * seconds and status not 'offline'; inGame is status 'in_game'.
 * activeSessions: game_sessions with last_action_at in the last 5 minutes,
 * guests included (the table keeps 6 hours, so it is small). byGame merges
 * presence (players, by game_slug) with sessions (by game_type).
 * players: up to 50 accounts by last_seen_at, with usernames.
 * openTables: the home's multiplayer activity snapshot (waiting lobbies whose
 * owner is present, live human matches), reused as is.
 * last15m: runs are game_score_events, rounds are arcade_round_history, tickets
 * minted are positive faucet rows in currency_ledger, all in the last 15 minutes.
 */
async function loadLive(): Promise<LiveMetrics> {
  const now = Date.now();
  const presenceCutoff = now - PRESENCE_FRESH_MS;
  const sessionCutoff = now - SESSION_FRESH_MS;
  const lastCutoff = now - LAST_WINDOW_MS;

  const [counts, presenceByGame, sessionsByGame, players, snapshot, last] = await Promise.all([
    query<{ online: string; in_game: string }>(
      `SELECT COUNT(*) AS online, COUNT(*) FILTER (WHERE status = 'in_game') AS in_game
       FROM arcade_user_presence WHERE status <> 'offline' AND last_seen_at >= $1`,
      [presenceCutoff],
    ),
    query<{ game_slug: string; n: string }>(
      `SELECT game_slug, COUNT(*) AS n FROM arcade_user_presence
       WHERE status = 'in_game' AND game_slug IS NOT NULL AND last_seen_at >= $1
       GROUP BY game_slug`,
      [presenceCutoff],
    ),
    query<{ game_type: string; n: string; sessions: string }>(
      `SELECT game_type, COUNT(DISTINCT od_user_id) AS n, COUNT(*) AS sessions
       FROM game_sessions WHERE last_action_at >= $1 GROUP BY game_type`,
      [sessionCutoff],
    ),
    query<{ user_id: string; username: string | null; status: string; game_slug: string | null; last_seen_at: string }>(
      `SELECT p.user_id, a.username, p.status, p.game_slug, p.last_seen_at
       FROM arcade_user_presence p
       JOIN arcade_accounts a ON a.id = p.user_id
       WHERE p.status <> 'offline' AND p.last_seen_at >= $1
       ORDER BY p.last_seen_at DESC
       LIMIT 50`,
      [presenceCutoff],
    ),
    getMultiplayerActivitySnapshot({ now }).catch((error: unknown) => {
      console.error('[admin-metrics] open tables failed', error instanceof Error ? error.message : 'unknown');
      return null;
    }),
    query<{ runs: string; rounds: string; minted: string }>(
      `SELECT
         (SELECT COUNT(*) FROM game_score_events WHERE created_at >= $1) AS runs,
         (SELECT COUNT(*) FROM arcade_round_history WHERE created_at >= $1) AS rounds,
         (SELECT COALESCE(SUM(amount), 0) FROM currency_ledger
           WHERE created_at >= $1 AND currency_type = 'credits' AND amount > 0
             AND source_type IN ('game_reward', 'daily_claim', 'battlepass', 'level_reward', 'achievement',
                                 'monthly_reward', 'weekly_board', 'wager_payout', 'admin_adjust', 'admin_grant', 'refund')) AS minted`,
      [lastCutoff],
    ),
  ]);

  const byGame = new Map<string, { game: GameRef; players: number; sessions: number }>();
  const slot = (key: string) => {
    const canonical = canonicalGameKey(key);
    let row = byGame.get(canonical);
    if (!row) {
      row = { game: gameRef(canonical), players: 0, sessions: 0 };
      byGame.set(canonical, row);
    }
    return row;
  };
  for (const row of presenceByGame.rows) slot(row.game_slug).players += num(row.n);
  for (const row of sessionsByGame.rows) {
    const entry = slot(row.game_type);
    entry.sessions += num(row.sessions);
    entry.players = Math.max(entry.players, num(row.n));
  }

  const sessionTotal = sessionsByGame.rows.reduce((sum, row) => sum + num(row.sessions), 0);

  return {
    at: now,
    online: num(counts.rows[0]?.online),
    inGame: num(counts.rows[0]?.in_game),
    activeSessions: sessionTotal,
    byGame: [...byGame.values()].sort(
      (a, b) => b.players + b.sessions - (a.players + a.sessions) || a.game.key.localeCompare(b.game.key),
    ),
    players: players.rows.map((row) => ({
      userId: row.user_id,
      username: row.username ?? 'player',
      status: row.status,
      game: row.game_slug ? gameRef(row.game_slug) : null,
      lastSeenAt: num(row.last_seen_at),
    })),
    openTables: (snapshot?.games ?? []).map((game) => ({
      game: gameRef(game.gameType),
      waiting: game.openLobbies,
      playing: game.liveMatches,
    })),
    last15m: {
      runs: num(last.rows[0]?.runs),
      rounds: num(last.rows[0]?.rounds),
      ticketsMinted: num(last.rows[0]?.minted),
    },
  };
}

export function getLiveMetrics(): Promise<LiveMetrics> {
  return cached('live', 0, loadLive, LIVE_TTL_MS);
}
