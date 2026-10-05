import { getAntiCheatLogRetentionDays } from '@/server/arcade/anti-cheat-logs';
import { getRateLimitHits } from '@/server/auth/auth-rate-limit';
import { query } from '@/server/db/client';

import { cached } from './cache';
import { canonicalGameKey, gameRef } from './games';
import { ensureRollups } from './rollup';
import type { TrustMetrics } from './types';
import { buildWindow, dayBoundsMs, hasBaseline, kpi, num, parseWindow, windowDays } from './window';

/**
 * Trust definitions.
 *
 * flags, rejects, passes: rows in admin_trust_days by result, window against the
 *   window before. Pass rows are logged only when ANTI_CHEAT_LOG_PASSES is on, so
 *   passes is 0 on a server that leaves it off; read flags and rejects, not the
 *   pass rate.
 * byGame: the same per game, merged through the registry. players is the sum of
 *   each day's distinct players on flag and reject rows (player-days), as the rollup
 *   keeps them per day.
 * daily: flags and rejects per day, dense.
 * recent: the latest 50 flag and reject rows in anti_cheat_logs, which the app
 *   prunes, so it reaches back at most logRetentionDays (ANTI_CHEAT_LOG_RETENTION_DAYS,
 *   14 by default). The rollup tables keep the counts after the log rows go.
 * bans: activeGameBans are game_bans rows that are indefinite or end after now;
 *   issuedInWindow are rows with banned_at in the window; suspendedAccounts are
 *   arcade_accounts with status 'suspended'; recent is the 20 latest bans with
 *   the account's username.
 * rateLimits: in-memory counts of limited results by rule family since the server
 *   process started (signin:id, signin:ip, register:ip, recover:id, read:admin and
 *   so on). They reset when the process restarts.
 */
async function load(daysInput: number): Promise<TrustMetrics> {
  await ensureRollups();
  const days = parseWindow(daysInput);
  const window = await buildWindow(days);
  const baseline = await hasBaseline(window);
  const list = windowDays(window);
  const cur = dayBoundsMs(window.from, window.to);
  const now = Date.now();

  const [totals, byGameRows, dailyRows, recent, activeBans, issued, suspended, recentBans] = await Promise.all([
    query<{ result: string; cur: string; prev: string }>(
      `SELECT result,
              COALESCE(SUM(n) FILTER (WHERE day >= $2::date), 0) AS cur,
              COALESCE(SUM(n) FILTER (WHERE day < $2::date), 0) AS prev
       FROM admin_trust_days WHERE day >= $1::date AND day <= $3::date GROUP BY result`,
      [window.previousFrom, window.from, window.to],
    ),
    query<{ game_key: string; result: string; n: string; players: string }>(
      `SELECT game_key, result, SUM(n) AS n, SUM(players) AS players FROM admin_trust_days
       WHERE day >= $1::date AND day <= $2::date GROUP BY game_key, result`,
      [window.from, window.to],
    ),
    query<{ day: string; result: string; n: string }>(
      `SELECT day::text AS day, result, SUM(n) AS n FROM admin_trust_days
       WHERE day >= $1::date AND day <= $2::date AND result IN ('flag', 'reject') GROUP BY day, result`,
      [window.from, window.to],
    ),
    query<{
      id: string;
      game_type: string;
      user_id: string | null;
      user_name: string | null;
      result: string;
      reason: string | null;
      score: number;
      ts: string;
    }>(
      `SELECT id, game_type, user_id, user_name, result, reason, score, ts
       FROM anti_cheat_logs WHERE result IN ('flag', 'reject') ORDER BY ts DESC LIMIT 50`,
    ),
    query<{ n: string }>(
      `SELECT COUNT(*) AS n FROM game_bans WHERE is_indefinite OR banned_until > $1`,
      [now],
    ),
    query<{ n: string }>(`SELECT COUNT(*) AS n FROM game_bans WHERE banned_at >= $1 AND banned_at < $2`, [
      cur.startMs,
      cur.endMs,
    ]),
    query<{ n: string }>(`SELECT COUNT(*) AS n FROM arcade_accounts WHERE status = 'suspended'`),
    query<{
      user_id: string;
      username: string | null;
      banned_at: string;
      banned_until: string | null;
      is_indefinite: boolean;
      reason: string | null;
    }>(
      `SELECT b.user_id, a.username, b.banned_at, b.banned_until, b.is_indefinite, b.reason
       FROM game_bans b LEFT JOIN arcade_accounts a ON a.id = b.user_id
       ORDER BY b.banned_at DESC LIMIT 20`,
    ),
  ]);

  const result = (name: string) => totals.rows.find((row) => row.result === name);
  const pair = (name: string) => kpi(num(result(name)?.cur), num(result(name)?.prev), baseline);

  const games = new Map<string, { pass: number; flag: number; reject: number; players: number }>();
  for (const row of byGameRows.rows) {
    const key = canonicalGameKey(row.game_key);
    const entry = games.get(key) ?? { pass: 0, flag: 0, reject: 0, players: 0 };
    if (row.result === 'pass' || row.result === 'flag' || row.result === 'reject') {
      entry[row.result] += num(row.n);
    }
    if (row.result !== 'pass') entry.players += num(row.players);
    games.set(key, entry);
  }

  const dailyMap = new Map<string, { flag: number; reject: number }>();
  for (const row of dailyRows.rows) {
    const entry = dailyMap.get(row.day) ?? { flag: 0, reject: 0 };
    if (row.result === 'flag') entry.flag = num(row.n);
    if (row.result === 'reject') entry.reject = num(row.n);
    dailyMap.set(row.day, entry);
  }

  return {
    window,
    flags: pair('flag'),
    rejects: pair('reject'),
    passes: pair('pass'),
    byGame: [...games.entries()]
      .map(([key, entry]) => ({ game: gameRef(key), ...entry }))
      .sort(
        (a, b) =>
          b.flag + b.reject - (a.flag + a.reject) || b.pass - a.pass || a.game.key.localeCompare(b.game.key),
      ),
    daily: list.map((day) => ({ day, flag: dailyMap.get(day)?.flag ?? 0, reject: dailyMap.get(day)?.reject ?? 0 })),
    recent: recent.rows.map((row) => ({
      id: row.id,
      game: gameRef(canonicalGameKey(row.game_type)),
      userId: row.user_id,
      username: row.user_name,
      result: row.result === 'reject' ? ('reject' as const) : ('flag' as const),
      reason: row.reason,
      score: row.score,
      at: num(row.ts),
    })),
    bans: {
      activeGameBans: num(activeBans.rows[0]?.n),
      issuedInWindow: num(issued.rows[0]?.n),
      suspendedAccounts: num(suspended.rows[0]?.n),
      recent: recentBans.rows.map((row) => ({
        userId: row.user_id,
        username: row.username,
        bannedAt: num(row.banned_at),
        until: row.banned_until == null ? null : num(row.banned_until),
        indefinite: row.is_indefinite,
        reason: row.reason,
      })),
    },
    rateLimits: getRateLimitHits(),
    logRetentionDays: getAntiCheatLogRetentionDays(),
  };
}

export function getTrustMetrics(days: number): Promise<TrustMetrics> {
  const window = parseWindow(days);
  // The rate-limit counters live in memory and move on every request, so they
  // are read fresh on top of the cached rest.
  return cached('trust', window, () => load(window)).then((metrics) => ({
    ...metrics,
    rateLimits: getRateLimitHits(),
  }));
}
