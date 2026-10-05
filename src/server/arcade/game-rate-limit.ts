import { query, withTransaction } from '@/server/db/client';
import type { GameType } from './game-session';

type LimitResult = {
  ok: boolean;
  retryAfterMs?: number;
  reason?: string;
};

const SESSION_WINDOW_MS = 60_000;
const SESSION_LIMITS: Record<GameType, number> = {
  snake: 30,
  'flappy-bird': 25,
  'reaction-time': 40,
  'typing-test': 30,
  'coin-flip': 90,
  '8-ball': 20,
  tetris: 20,
  '2048': 25,
  stack: 25,
  sequence: 30,
  breakout: 25,
  tumbler: 25,
  gopher: 25,
  ricochet: 25,
  swerve: 25,
  sudoku: 30,
  math: 25,
  'bubble-shooter': 25,
  'gem-swap': 25,
  'sky-climber': 25,
  minesweeper: 30,
  'knife-booth': 25,
  'log-splitter': 25,
  'melon-chop': 25,
  'tin-duck': 25,
  'boardwalk-hop': 25,
  'punch-card': 30,
  freecell: 30,
  'blitz-tactics': 25,
  'high-striker': 25,
  'skee-ball': 25,
  gunrush: 25,
  'ticket-stop': 25,
  'stack-cabinet': 25,
  'ring-toss': 25,
  // Mini golf starts one counted round a day; the rest is practice.
  'mini-golf': 10,
};

const SCORE_COOLDOWN_MS: Record<GameType, number> = {
  snake: 1_500,
  'flappy-bird': 1_500,
  'reaction-time': 1_000,
  'typing-test': 4_000,
  'coin-flip': 750,
  '8-ball': 2_000,
  tetris: 4_000,
  '2048': 2_000,
  stack: 1_500,
  sequence: 1_500,
  breakout: 1_500,
  tumbler: 1_500,
  gopher: 1_500,
  ricochet: 1_500,
  swerve: 1_500,
  sudoku: 4_000,
  math: 1_500,
  'bubble-shooter': 1_500,
  'gem-swap': 1_500,
  'sky-climber': 1_500,
  minesweeper: 4_000,
  'knife-booth': 1_500,
  'log-splitter': 1_500,
  'melon-chop': 1_500,
  'tin-duck': 1_500,
  'boardwalk-hop': 1_500,
  'punch-card': 4_000,
  freecell: 4_000,
  'blitz-tactics': 2_000,
  'high-striker': 1_500,
  'skee-ball': 2_000,
  // Gunrush runs are multi-minute (greedy play p50 ≈ 260s), so a 2s cooldown is
  // never felt by a real player and still throttles a submit loop.
  gunrush: 2_000,
  // Ticket stop runs last 5 to 10 s, like reaction time.
  'ticket-stop': 1_000,
  // Stacker's cabinet runs last 5 to 20 s.
  'stack-cabinet': 1_000,
  // Ring toss rounds last 15 to 30 s.
  'ring-toss': 1_500,
  // Mini golf posts each putt as it is struck; a tap putt and the next can
  // come a second apart.
  'mini-golf': 300,
};

const SCORE_ROLLING_WINDOW_MS = 10 * 60_000;
const SCORE_ROLLING_WINDOW_LIMIT = 180;
const RETENTION_MS =
  Math.max(SESSION_WINDOW_MS, SCORE_ROLLING_WINDOW_MS) + 60_000;

const toCount = (value: string | number | null | undefined) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const toTs = (value: string | number | null | undefined, fallback: number) => {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const pruneOldEvents = async (now: number) => {
  await query('DELETE FROM game_rate_events WHERE ts < $1', [
    now - RETENTION_MS,
  ]);
};

export const checkSessionStartLimit = async (
  userId: string,
  gameType: GameType,
  now = Date.now(),
): Promise<LimitResult> => {
  return withTransaction(async (client) => {
    await client.query('DELETE FROM game_rate_events WHERE ts < $1', [
      now - RETENTION_MS,
    ]);

    const cutoff = now - SESSION_WINDOW_MS;
    const maxStarts = SESSION_LIMITS[gameType];
    const countResult = await client.query<{ count: string | number }>(
      `SELECT COUNT(1) AS count
       FROM game_rate_events
       WHERE user_id = $1
         AND game_type = $2
         AND event_type = 'session_start'
         AND ts >= $3`,
      [userId, gameType, cutoff],
    );
    const count = toCount(countResult.rows[0]?.count);

    if (count >= maxStarts) {
      const oldestResult = await client.query<{ ts: string | number }>(
        `SELECT ts
         FROM game_rate_events
         WHERE user_id = $1
           AND game_type = $2
           AND event_type = 'session_start'
           AND ts >= $3
         ORDER BY ts ASC
         LIMIT 1`,
        [userId, gameType, cutoff],
      );
      const oldestInWindow = toTs(oldestResult.rows[0]?.ts, now);
      return {
        ok: false,
        retryAfterMs: Math.max(
          1_000,
          oldestInWindow + SESSION_WINDOW_MS - now,
        ),
        reason: `Too many session starts for ${gameType}.`,
      };
    }

    await client.query(
      `INSERT INTO game_rate_events (user_id, game_type, event_type, ts)
       VALUES ($1, $2, 'session_start', $3)`,
      [userId, gameType, now],
    );
    return { ok: true };
  });
};

export const checkScoreSubmitLimit = async (
  userId: string,
  gameType: GameType,
  now = Date.now(),
): Promise<LimitResult> => {
  await pruneOldEvents(now);

  return withTransaction(async (client) => {
    const cooldownMs = SCORE_COOLDOWN_MS[gameType];
    const lastSubmission = await client.query<{ ts: string | number }>(
      `SELECT ts
       FROM game_rate_events
       WHERE user_id = $1
         AND game_type = $2
         AND event_type = 'score_submit'
       ORDER BY ts DESC
       LIMIT 1`,
      [userId, gameType],
    );
    const lastTs = lastSubmission.rows[0]
      ? toTs(lastSubmission.rows[0].ts, 0)
      : null;
    if (lastTs !== null && now - lastTs < cooldownMs) {
      return {
        ok: false,
        retryAfterMs: cooldownMs - (now - lastTs),
        reason: `Please wait before submitting another ${gameType} score.`,
      };
    }

    const cutoff = now - SCORE_ROLLING_WINDOW_MS;
    const countResult = await client.query<{ count: string | number }>(
      `SELECT COUNT(1) AS count
       FROM game_rate_events
       WHERE user_id = $1
         AND game_type = $2
         AND event_type = 'score_submit'
         AND ts >= $3`,
      [userId, gameType, cutoff],
    );
    const count = toCount(countResult.rows[0]?.count);

    if (count >= SCORE_ROLLING_WINDOW_LIMIT) {
      const oldestResult = await client.query<{ ts: string | number }>(
        `SELECT ts
         FROM game_rate_events
         WHERE user_id = $1
           AND game_type = $2
           AND event_type = 'score_submit'
           AND ts >= $3
         ORDER BY ts ASC
         LIMIT 1`,
        [userId, gameType, cutoff],
      );
      const oldestInWindow = toTs(oldestResult.rows[0]?.ts, now);
      return {
        ok: false,
        retryAfterMs: Math.max(
          1_000,
          oldestInWindow + SCORE_ROLLING_WINDOW_MS - now,
        ),
        reason: 'Score submission limit reached. Please try again shortly.',
      };
    }

    await client.query(
      `INSERT INTO game_rate_events (user_id, game_type, event_type, ts)
       VALUES ($1, $2, 'score_submit', $3)`,
      [userId, gameType, now],
    );
    return { ok: true };
  });
};
