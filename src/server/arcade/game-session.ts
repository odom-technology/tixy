import { assertGameAvailable } from '@/server/arcade/game-availability';
import crypto from 'node:crypto';
import { query, queryOne, withTransaction } from '@/server/db/client';

// Clean up expired sessions every 5 minutes.
//
// This horizon must comfortably exceed the length of the LONGEST legitimate
// single run, because the cleanup below physically deletes the session row
// (and its game_events replay data) by `started_at` — turn-based games like
// 2048 never ping the server mid-game, so their `last_action_at` never moves.
// At 30 minutes, a marathon run (e.g. grinding a 4096 tile in 2048, a deep
// Tetris/Sudoku session) would have its session reaped out from under the
// player, so the final score submission failed validation with "Invalid game
// session" and the score + achievements were silently lost. 6 hours covers any
// realistic human play session with wide margin while still bounding table
// growth. This does not weaken anti-cheat: the duration-based checks are all
// lower bounds (score-too-high-for-time) and authoritative scoring uses replay,
// so a longer-lived session never lets a cheater claim more in less time.
const SESSION_EXPIRY_MS = 6 * 60 * 60 * 1000; // 6 hours
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

setInterval(() => {
  void (async () => {
    const now = Date.now();
    const cutoff = now - SESSION_EXPIRY_MS;
    await query(
      'DELETE FROM game_sessions WHERE started_at < $1 AND arcade_seed IS NULL',
      [cutoff],
    );
    await query('DELETE FROM game_events WHERE ts < $1', [cutoff]);

    // Auto-refund stale arcade sessions before deleting them
    void import('@/server/arcade/arcade-session')
      .then(({ cleanupStaleArcadeSessions }) => cleanupStaleArcadeSessions())
      .catch(() => {
        // tixy module may not be loaded yet on cold start.
      });

    // Auto-forfeit pool matches where a player hasn't moved in 24 hours
    void import('@/server/arcade/pool-match')
      .then(({ processStaleMatches }) => processStaleMatches())
      .catch(() => {
        // Pool module may not be loaded yet on cold start.
      });
  })().catch((error) => {
    console.error('Failed to clean up stale game sessions:', error);
  });
}, CLEANUP_INTERVAL_MS);

// Secret key for signing tokens — MUST be set in env vars
function getSecretKey(): string {
  const key = process.env.GAME_SESSION_SECRET;
  if (!key) {
    throw new Error(
      'GAME_SESSION_SECRET environment variable is required. ' +
        "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
    );
  }
  return key;
}

function generateHmac(data: string): string {
  return crypto.createHmac('sha256', getSecretKey()).update(data).digest('hex');
}

/**
 * Derive a deterministic 31-bit RNG seed from the server-assigned sessionId.
 * sessionId is a server crypto.randomUUID, so this is unpredictable and not
 * client-influenceable. Used by solo games whose content (brick layout, pad
 * sequence) is generated from a seed without a dedicated game_sessions column.
 */
export function deriveSessionSeed(sessionId: string): number {
  const hex = crypto.createHash('sha256').update(sessionId).digest('hex').slice(0, 8);
  return parseInt(hex, 16) % 2 ** 31;
}

export type GameType =
  | 'snake'
  | 'flappy-bird'
  | 'reaction-time'
  | 'typing-test'
  | 'coin-flip'
  | '8-ball'
  | 'tetris'
  | '2048'
  | 'stack'
  | 'sequence'
  | 'breakout'
  | 'tumbler'
  | 'gopher'
  | 'ricochet'
  | 'swerve'
  | 'sudoku'
  | 'math'
  | 'bubble-shooter'
  | 'gem-swap'
  | 'sky-climber'
  | 'minesweeper'
  | 'log-splitter'
  | 'knife-booth'
  | 'melon-chop'
  | 'tin-duck'
  | 'boardwalk-hop'
  | 'punch-card'
  | 'freecell'
  | 'blitz-tactics'
  | 'high-striker'
  | 'skee-ball'
  | 'gunrush'
  | 'ticket-stop'
  | 'stack-cabinet'
  // Ring toss
  | 'ring-toss'
  | 'mini-golf';

/** The game whose availability switch covers a game type. Stacker's
 *  cabinet mode is part of stack: turning stack off turns both off. */
export function availabilityGameType(gameType: GameType): string {
  return gameType === 'stack-cabinet' ? 'stack' : gameType;
}

export interface GameSession {
  sessionId: string;
  token: string;
  modeSec?: number;
  snakeSeed?: number;
  flappySeed?: number;
  typingSeed?: number;
  coinFlipSeed?: number;
  sequenceSeed?: number;
  breakoutSeed?: number;
  tumblerSeed?: number;
  gopherSeed?: number;
  ricochetSeed?: number;
  swerveSeed?: number;
  mathSeed?: number;
  blitzTacticsSeed?: number;
  bubbleSeed?: number;
  gemSeed?: number;
  skySeed?: number;
  minesweeperSeed?: number;
  logSplitterSeed?: number;
  knifeBoothSeed?: number;
  melonChopSeed?: number;
  tinDuckSeed?: number;
  boardwalkSeed?: number;
  highStrikerSeed?: number;
  skeeBallSeed?: number;
  gunrushSeed?: number;
  ticketStopSeed?: number;
  stackCabinetSeed?: number;
  game2048Seed?: number;
  ringTossSeed?: number;
}

export interface SessionValidationResult {
  valid: boolean;
  error?: string;
  session?: {
    sessionId: string;
    odUserId: string;
    gameType: GameType;
    startedAt: number;
    /** When the last action was recorded (started_at until one is). */
    lastActionAt?: number;
    durationMs: number;
    actionCount: number;
    modeSec?: number;
    actionCounts?: Record<string, number>;
    reactionTimes?: number[];
    snakeSeed?: number;
    flappySeed?: number;
    typingSeed?: number;
    coinFlipSeed?: number;
    sequenceSeed?: number;
    breakoutSeed?: number;
    tumblerSeed?: number;
    gopherSeed?: number;
    ricochetSeed?: number;
    swerveSeed?: number;
    mathSeed?: number;
    blitzTacticsSeed?: number;
    bubbleSeed?: number;
    gemSeed?: number;
    skySeed?: number;
    minesweeperSeed?: number;
    logSplitterSeed?: number;
    knifeBoothSeed?: number;
    melonChopSeed?: number;
    tinDuckSeed?: number;
    boardwalkSeed?: number;
    highStrikerSeed?: number;
    skeeBallSeed?: number;
    gunrushSeed?: number;
    ticketStopSeed?: number;
    stackCabinetSeed?: number;
    game2048Seed?: number;
    ringTossSeed?: number;
  };
}

type StoredSessionRow = {
  id: string;
  od_user_id: string;
  game_type: GameType;
  started_at: string | number;
  last_action_at: string | number;
  action_count: string | number;
  mode_sec: string | number | null;
  action_counts_json: string | null;
  reaction_times_json: string | null;
  snake_seed: string | number | null;
  flappy_seed: string | number | null;
  typing_seed: string | number | null;
  coin_flip_seed: string | number | null;
  pow_challenge_json: string | null;
};

const toNumber = (value: string | number | null | undefined) => {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const normalizeSessionRow = (row: StoredSessionRow) => ({
  ...row,
  started_at: toNumber(row.started_at) ?? 0,
  last_action_at: toNumber(row.last_action_at) ?? 0,
  action_count: toNumber(row.action_count) ?? 0,
  mode_sec: toNumber(row.mode_sec),
  snake_seed: toNumber(row.snake_seed),
  flappy_seed: toNumber(row.flappy_seed),
  typing_seed: toNumber(row.typing_seed),
  coin_flip_seed: toNumber(row.coin_flip_seed),
});

type NormalizedSessionRow = ReturnType<typeof normalizeSessionRow>;

const parseJsonArray = <T>(value: string | null): T[] | undefined => {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as T[]) : undefined;
  } catch {
    return undefined;
  }
};

const parseJsonRecord = (
  value: string | null,
): Record<string, number> | undefined => {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return undefined;
    }
    const entries = Object.entries(parsed as Record<string, unknown>)
      .filter(([, v]) => typeof v === 'number')
      .map(([k, v]) => [k, v as number]);
    return Object.fromEntries(entries);
  } catch {
    return undefined;
  }
};

const appendReactionTime = async (
  sessionId: string,
  odUserId: string,
  reactionTime: number,
) => {
  return withTransaction(async (client) => {
    const result = await client.query<StoredSessionRow>(
      `SELECT id, od_user_id, game_type, action_count, action_counts_json, reaction_times_json
       FROM game_sessions
       WHERE id = $1`,
      [sessionId],
    );
    const rawSession = result.rows[0];
    if (!rawSession) return false;
    const session = normalizeSessionRow(rawSession);
    if (session.od_user_id !== odUserId) return false;
    if (session.game_type !== 'reaction-time') return false;

    const now = Date.now();
    const reactionTimes =
      parseJsonArray<number>(session.reaction_times_json) ?? [];
    reactionTimes.push(reactionTime);
    const counts = parseJsonRecord(session.action_counts_json) ?? {};
    counts.reaction = (counts.reaction ?? 0) + 1;

    await client.query(
      `UPDATE game_sessions
       SET last_action_at = $1, action_count = $2, action_counts_json = $3, reaction_times_json = $4
       WHERE id = $5`,
      [
        now,
        session.action_count + 1,
        JSON.stringify(counts),
        JSON.stringify(reactionTimes),
        sessionId,
      ],
    );
    return true;
  });
};

const appendAction = async (
  sessionId: string,
  odUserId: string,
  action: string,
) => {
  return withTransaction(async (client) => {
    // FOR UPDATE: a session deleted or claimed in between (ticket stop
    // replaces unused sessions) can't be stamped after the fact.
    const result = await client.query<StoredSessionRow>(
      `SELECT id, od_user_id, action_count, action_counts_json
       FROM game_sessions
       WHERE id = $1
       FOR UPDATE`,
      [sessionId],
    );
    const rawSession = result.rows[0];
    if (!rawSession) return false;
    const session = normalizeSessionRow(rawSession);
    if (session.od_user_id !== odUserId) return false;

    const now = Date.now();
    const counts = parseJsonRecord(session.action_counts_json) ?? {};
    counts[action] = (counts[action] ?? 0) + 1;

    const updated = await client.query(
      `UPDATE game_sessions
       SET last_action_at = $1, action_count = $2, action_counts_json = $3
       WHERE id = $4`,
      [now, session.action_count + 1, JSON.stringify(counts), sessionId],
    );
    if ((updated.rowCount ?? 0) === 0) return false;
    return true;
  });
};

const appendActionCounts = async (
  sessionId: string,
  odUserId: string,
  actionCounts: Record<string, number>,
) => {
  return withTransaction(async (client) => {
    const result = await client.query<StoredSessionRow>(
      `SELECT id, od_user_id, action_count, action_counts_json
       FROM game_sessions
       WHERE id = $1`,
      [sessionId],
    );
    const rawSession = result.rows[0];
    if (!rawSession) return false;
    const session = normalizeSessionRow(rawSession);
    if (session.od_user_id !== odUserId) return false;

    const now = Date.now();
    const counts = parseJsonRecord(session.action_counts_json) ?? {};
    let delta = 0;
    for (const [action, count] of Object.entries(actionCounts)) {
      if (typeof count !== 'number' || !Number.isFinite(count)) continue;
      const add = Math.max(0, Math.floor(count));
      if (add === 0) continue;
      counts[action] = (counts[action] ?? 0) + add;
      delta += add;
    }
    if (delta === 0) return true;

    await client.query(
      `UPDATE game_sessions
       SET last_action_at = $1, action_count = $2, action_counts_json = $3
       WHERE id = $4`,
      [now, session.action_count + delta, JSON.stringify(counts), sessionId],
    );
    return true;
  });
};

/**
 * Creates a new game session for a user
 */
export async function createGameSession(
  odUserId: string,
  gameType: GameType,
  options: {
    modeSec?: number;
    typingSeed?: number;
  } = {},
): Promise<GameSession> {
  await assertGameAvailable(availabilityGameType(gameType));
  const sessionId = crypto.randomUUID();
  const startedAt = Date.now();

  const modeSec =
    gameType === 'typing-test' &&
    (options.modeSec === 15 || options.modeSec === 30 || options.modeSec === 60)
      ? options.modeSec
      : undefined;

  const snakeSeed = gameType === 'snake' ? crypto.randomInt(0, 2 ** 31) : undefined;
  const flappySeed =
    gameType === 'flappy-bird' ? crypto.randomInt(0, 2 ** 31) : undefined;

  // Generate typing seed for deterministic word list
  const typingSeed =
    gameType === 'typing-test'
      ? normalizeSeedOption(options.typingSeed) ?? crypto.randomInt(0, 2 ** 31)
      : undefined;
  const coinFlipSeed =
    gameType === 'coin-flip' ? crypto.randomInt(0, 2 ** 31) : undefined;
  const sequenceSeed =
    gameType === 'sequence' ? deriveSessionSeed(sessionId) : undefined;
  const breakoutSeed =
    gameType === 'breakout' ? deriveSessionSeed(sessionId) : undefined;
  const tumblerSeed =
    gameType === 'tumbler' ? deriveSessionSeed(sessionId) : undefined;
  const gopherSeed =
    gameType === 'gopher' ? deriveSessionSeed(sessionId) : undefined;
  const ricochetSeed =
    gameType === 'ricochet' ? deriveSessionSeed(sessionId) : undefined;
  const swerveSeed =
    gameType === 'swerve' ? deriveSessionSeed(sessionId) : undefined;
  const mathSeed =
    gameType === 'math' ? deriveSessionSeed(sessionId) : undefined;
  const blitzTacticsSeed =
    gameType === 'blitz-tactics' ? deriveSessionSeed(sessionId) : undefined;
  const bubbleSeed =
    gameType === 'bubble-shooter' ? deriveSessionSeed(sessionId) : undefined;
  const gemSeed =
    gameType === 'gem-swap' ? deriveSessionSeed(sessionId) : undefined;
  const skySeed =
    gameType === 'sky-climber' ? deriveSessionSeed(sessionId) : undefined;
  const minesweeperSeed =
    gameType === 'minesweeper' ? deriveSessionSeed(sessionId) : undefined;
  const logSplitterSeed =
    gameType === 'log-splitter' ? deriveSessionSeed(sessionId) : undefined;
  const knifeBoothSeed =
    gameType === 'knife-booth' ? deriveSessionSeed(sessionId) : undefined;
  const melonChopSeed =
    gameType === 'melon-chop' ? deriveSessionSeed(sessionId) : undefined;
  const tinDuckSeed =
    gameType === 'tin-duck' ? deriveSessionSeed(sessionId) : undefined;
  const boardwalkSeed =
    gameType === 'boardwalk-hop' ? deriveSessionSeed(sessionId) : undefined;
  const highStrikerSeed =
    gameType === 'high-striker' ? deriveSessionSeed(sessionId) : undefined;
  const skeeBallSeed =
    gameType === 'skee-ball' ? deriveSessionSeed(sessionId) : undefined;
  const gunrushSeed =
    gameType === 'gunrush' ? deriveSessionSeed(sessionId) : undefined;
  const ticketStopSeed =
    gameType === 'ticket-stop' ? deriveSessionSeed(sessionId) : undefined;
  const stackCabinetSeed =
    gameType === 'stack-cabinet' ? deriveSessionSeed(sessionId) : undefined;
  const game2048Seed =
    gameType === '2048' ? deriveSessionSeed(sessionId) : undefined;
  const ringTossSeed =
    gameType === 'ring-toss' ? deriveSessionSeed(sessionId) : undefined;

  // Ticket stop fetches its session when the page opens, so a press starts
  // at once. A session nobody started (no 'start' action yet) is replaced,
  // never left behind: one unused row per player at most. Stacker's cabinet
  // mode and ricochet work the same way.
  if (gameType === 'ticket-stop' || gameType === 'stack-cabinet' || gameType === 'ricochet') {
    await query(
      `DELETE FROM game_sessions
       WHERE od_user_id = $1 AND game_type = $2 AND action_count = 0
         AND arcade_seed IS NULL`,
      [odUserId, gameType],
    );
  }

  await query(
    `INSERT INTO game_sessions
      (id, od_user_id, game_type, started_at, last_action_at, action_count, mode_sec, action_counts_json, reaction_times_json, snake_seed, flappy_seed, typing_seed, coin_flip_seed, pow_challenge_json)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
    [
      sessionId,
      odUserId,
      gameType,
      startedAt,
      startedAt,
      0,
      modeSec ?? null,
      JSON.stringify({}),
      gameType === 'reaction-time' ? JSON.stringify([]) : null,
      snakeSeed ?? null,
      flappySeed ?? null,
      typingSeed ?? null,
      coinFlipSeed ?? null,
      JSON.stringify(null),
    ],
  );

  // Create signed token: sessionId:userId:gameType:startedAt:signature
  const tokenData = `${sessionId}:${odUserId}:${gameType}:${startedAt}`;
  const signature = generateHmac(tokenData);
  const token = `${tokenData}:${signature}`;

  return {
    sessionId,
    token,
    modeSec,
    snakeSeed,
    flappySeed,
    typingSeed,
    coinFlipSeed,
    sequenceSeed,
    breakoutSeed,
    tumblerSeed,
    gopherSeed,
    ricochetSeed,
    swerveSeed,
    mathSeed,
    blitzTacticsSeed,
    bubbleSeed,
    gemSeed,
    skySeed,
    minesweeperSeed,
    logSplitterSeed,
    knifeBoothSeed,
    melonChopSeed,
    tinDuckSeed,
    boardwalkSeed,
    highStrikerSeed,
    skeeBallSeed,
    gunrushSeed,
    ticketStopSeed,
    stackCabinetSeed,
    game2048Seed,
    ringTossSeed,
  };
}

/**
 * Increments the action count for a game session
 */
async function _incrementActionCount(
  sessionId: string,
  odUserId: string,
): Promise<boolean> {
  try {
    const result = await query(`
      UPDATE game_sessions 
      SET action_count = action_count + 1, last_action_at = $1
      WHERE id = $2 AND od_user_id = $3
    `, [Date.now(), sessionId, odUserId]);
    return (result.rowCount ?? 0) > 0;
  } catch (error) {
    console.error('Failed to increment action count:', error);
    return false;
  }
}

/**
 * Records a game action (used for tracking game progress)
 */
export async function recordGameAction(
  sessionId: string,
  odUserId: string,
  actionData?: {
    reactionTime?: number;
    action?: string;
    actionCounts?: Record<string, number>;
  },
): Promise<boolean> {
  if (actionData?.reactionTime) {
    return appendReactionTime(sessionId, odUserId, actionData.reactionTime);
  }
  if (actionData?.actionCounts) {
    return appendActionCounts(sessionId, odUserId, actionData.actionCounts);
  }
  if (actionData?.action) {
    return appendAction(sessionId, odUserId, actionData.action);
  }
  return false;
}

type GameSessionValidationOptions = {
  consumeSession?: boolean;
};

function parseSessionToken(token: string): {
  valid: boolean;
  error?: string;
  sessionId?: string;
  odUserId?: string;
  gameType?: GameType;
  startedAt?: number;
} {
  const parts = token.split(':');
  if (parts.length < 5) {
    return { valid: false, error: 'Invalid token format' };
  }

  // User IDs may contain colons (for example, `guest:<uuid>`), so peel the
  // fixed fields from both ends and treat the middle as the complete user ID.
  const sessionId = parts.shift();
  const signature = parts.pop();
  const startedAtStr = parts.pop();
  const tokenGameType = parts.pop();
  const tokenUserId = parts.join(':');
  if (
    !sessionId ||
    !tokenUserId ||
    !tokenGameType ||
    !startedAtStr ||
    !signature
  ) {
    return { valid: false, error: 'Invalid token format' };
  }

  const startedAt = parseInt(startedAtStr, 10);
  if (Number.isNaN(startedAt)) {
    return { valid: false, error: 'Invalid token timestamp' };
  }
  const tokenData = `${sessionId}:${tokenUserId}:${tokenGameType}:${startedAt}`;
  const expectedSignature = generateHmac(tokenData);
  if (signature !== expectedSignature) {
    return { valid: false, error: 'Invalid token signature' };
  }
  return {
    valid: true,
    sessionId,
    odUserId: tokenUserId,
    gameType: tokenGameType as GameType,
    startedAt,
  };
}

export async function getActiveSessionFromToken(token: string): Promise<{
  valid: boolean;
  error?: string;
  session?: NormalizedSessionRow;
}> {
  const parsed = parseSessionToken(token);
  if (!parsed.valid || !parsed.sessionId || !parsed.odUserId) {
    return { valid: false, error: parsed.error || 'Invalid token' };
  }
  const rawSession = await queryOne<StoredSessionRow>(
    `SELECT id, od_user_id, game_type, started_at, last_action_at, action_count,
            mode_sec, action_counts_json, reaction_times_json, snake_seed, flappy_seed, typing_seed, coin_flip_seed, pow_challenge_json
     FROM game_sessions
     WHERE id = $1`,
    [parsed.sessionId],
  );
  if (!rawSession) {
    return { valid: false, error: 'Session not found or expired' };
  }
  const session = normalizeSessionRow(rawSession);
  if (session.od_user_id !== parsed.odUserId) {
    return { valid: false, error: 'Session user mismatch' };
  }
  if (session.game_type !== parsed.gameType) {
    return { valid: false, error: 'Game type mismatch' };
  }
  return { valid: true, session };
}

export async function consumeGameSession(
  sessionId: string,
  odUserId: string,
): Promise<boolean> {
  try {
    const result = await query(
      'DELETE FROM game_sessions WHERE id = $1 AND od_user_id = $2',
      [sessionId, odUserId],
    );
    return (result.rowCount ?? 0) > 0;
  } catch {
    return false;
  }
}

/** Consume the session atomically; throws a 409 (handled by
 *  runScoreRoutePipeline) when another request already consumed it —
 *  i.e. a duplicate submit for the same session. */
export async function consumeGameSessionOrReject(
  sessionId: string,
  odUserId: string,
): Promise<void> {
  if (!(await consumeGameSession(sessionId, odUserId))) {
    const err = new Error(
      'Score already submitted for this session.',
    ) as Error & { status?: number };
    err.status = 409;
    throw err;
  }
}

/**
 * Validates a game session token and checks if the score is plausible
 */
export async function validateGameSession(
  token: string,
  odUserId: string,
  gameType: GameType,
  score: number,
  additionalData?: {
    averageTime?: number;
    bestTime?: number;
    mode?: number; // For typing-test game mode (15, 30, 60 seconds)
  },
  options: GameSessionValidationOptions = {},
): Promise<SessionValidationResult> {
  const parsed = parseSessionToken(token);
  if (!parsed.valid || !parsed.sessionId) {
    return { valid: false, error: parsed.error ?? 'Invalid token format' };
  }
  const sessionId = parsed.sessionId;

  if (parsed.odUserId !== odUserId) {
    return { valid: false, error: 'User mismatch' };
  }
  if (parsed.gameType !== gameType) {
    return { valid: false, error: 'Game type mismatch' };
  }

  // Check session exists
  const rawSession = await queryOne<StoredSessionRow>(
    `SELECT id, od_user_id, game_type, started_at, last_action_at, action_count,
            mode_sec, action_counts_json, reaction_times_json, snake_seed, flappy_seed, typing_seed, coin_flip_seed, pow_challenge_json
     FROM game_sessions
     WHERE id = $1`,
    [sessionId],
  );
  if (!rawSession) {
    return { valid: false, error: 'Session not found or expired' };
  }
  const session = normalizeSessionRow(rawSession);

  // Verify session belongs to user
  if (session.od_user_id !== odUserId) {
    return { valid: false, error: 'Session user mismatch' };
  }

  if (gameType === 'typing-test') {
    const requestedMode = additionalData?.mode;
    const sessionMode = session.mode_sec ?? undefined;
    if (
      requestedMode !== undefined &&
      requestedMode !== sessionMode
    ) {
      return { valid: false, error: 'Typing mode mismatch for session' };
    }
  }

  const now = Date.now();
  const durationMs = now - session.started_at;
  const actionCounts = parseJsonRecord(session.action_counts_json);
  const reactionTimes = parseJsonArray<number>(session.reaction_times_json);
  // Game-specific validation
  const validationResult = validateScorePlausibility(
    gameType,
    score,
    durationMs,
    session.action_count,
    reactionTimes,
    additionalData,
    actionCounts,
  );

  if (!validationResult.valid) {
    return validationResult;
  }

  if (options.consumeSession !== false) {
    // Mark session as used (one score submission per session)
    await query('DELETE FROM game_sessions WHERE id = $1', [sessionId]);
  }

  return {
    valid: true,
    session: {
      sessionId: sessionId,
      odUserId: session.od_user_id,
      gameType: session.game_type,
      startedAt: session.started_at,
      lastActionAt: session.last_action_at,
      durationMs,
      actionCount: session.action_count,
      modeSec: session.mode_sec ?? undefined,
      actionCounts,
      reactionTimes,
      snakeSeed: session.snake_seed ?? undefined,
      flappySeed: session.flappy_seed ?? undefined,
      typingSeed: session.typing_seed ?? undefined,
      coinFlipSeed: session.coin_flip_seed ?? undefined,
      sequenceSeed: session.game_type === 'sequence' ? deriveSessionSeed(sessionId) : undefined,
      breakoutSeed: session.game_type === 'breakout' ? deriveSessionSeed(sessionId) : undefined,
      tumblerSeed: session.game_type === 'tumbler' ? deriveSessionSeed(sessionId) : undefined,
      gopherSeed: session.game_type === 'gopher' ? deriveSessionSeed(sessionId) : undefined,
      ricochetSeed: session.game_type === 'ricochet' ? deriveSessionSeed(sessionId) : undefined,
      swerveSeed: session.game_type === 'swerve' ? deriveSessionSeed(sessionId) : undefined,
      mathSeed: session.game_type === 'math' ? deriveSessionSeed(sessionId) : undefined,
      blitzTacticsSeed: session.game_type === 'blitz-tactics' ? deriveSessionSeed(sessionId) : undefined,
      bubbleSeed: session.game_type === 'bubble-shooter' ? deriveSessionSeed(sessionId) : undefined,
      gemSeed: session.game_type === 'gem-swap' ? deriveSessionSeed(sessionId) : undefined,
      skySeed: session.game_type === 'sky-climber' ? deriveSessionSeed(sessionId) : undefined,
      minesweeperSeed: session.game_type === 'minesweeper' ? deriveSessionSeed(sessionId) : undefined,
      logSplitterSeed: session.game_type === 'log-splitter' ? deriveSessionSeed(sessionId) : undefined,
      knifeBoothSeed: session.game_type === 'knife-booth' ? deriveSessionSeed(sessionId) : undefined,
      melonChopSeed: session.game_type === 'melon-chop' ? deriveSessionSeed(sessionId) : undefined,
      tinDuckSeed: session.game_type === 'tin-duck' ? deriveSessionSeed(sessionId) : undefined,
      boardwalkSeed: session.game_type === 'boardwalk-hop' ? deriveSessionSeed(sessionId) : undefined,
      highStrikerSeed: session.game_type === 'high-striker' ? deriveSessionSeed(sessionId) : undefined,
      skeeBallSeed: session.game_type === 'skee-ball' ? deriveSessionSeed(sessionId) : undefined,
      gunrushSeed: session.game_type === 'gunrush' ? deriveSessionSeed(sessionId) : undefined,
      ticketStopSeed: session.game_type === 'ticket-stop' ? deriveSessionSeed(sessionId) : undefined,
      stackCabinetSeed: session.game_type === 'stack-cabinet' ? deriveSessionSeed(sessionId) : undefined,
      game2048Seed: session.game_type === '2048' ? deriveSessionSeed(sessionId) : undefined,
      ringTossSeed: session.game_type === 'ring-toss' ? deriveSessionSeed(sessionId) : undefined,
    },
  };
}

/**
 * Validates that a score is plausible given the game duration and type
 */
function validateScorePlausibility(
  gameType: GameType,
  score: number,
  durationMs: number,
  actionCount: number,
  reactionTimes?: number[],
  additionalData?: {
    averageTime?: number;
    bestTime?: number;
    mode?: number;
  },
  _actionCounts?: Record<string, number>,
): SessionValidationResult {
  const durationSeconds = durationMs / 1000;

  switch (gameType) {
    case 'snake': {
      // No duration or score-per-second rule here. The snake score route
      // replays the run from its seed and rejects one that needs more time at
      // the tick rate than the session has existed (snake-replay.ts), which is
      // exact where a guess at the time an apple takes was not.
      break;
    }

    case 'flappy-bird': {
      // No duration, score-per-second or flap-count rule here. The score
      // route replays the flaps from the seed and rejects a run that needs
      // more time on the sim clock than the session has existed
      // (flappy-replay.ts), which is exact where these guesses were not.
      break;
    }

    case 'reaction-time': {
      // Score is now computed server-side from tracked reaction times.
      // Session plausibility only checks basic duration.
      // Detailed integrity is validated later from authoritative WS transcripts
      // (rt_green/rt_click pairing), which is more reliable than this coarse check.
      if (durationSeconds < 3) {
        return {
          valid: false,
          error: 'Game duration too short for 5 attempts',
        };
      }

      break;
    }

    case 'typing-test': {
      // Typing Test: WPM score based on words typed correctly
      // World record is ~216 WPM, typical fast typist is 60-80 WPM
      // Score is the WPM value
      if (!additionalData) {
        return { valid: false, error: 'Missing typing test data' };
      }

      // WPM should be reasonable (0-300 range, allowing for exceptional typists)
      if (score < 0 || score > 300) {
        return { valid: false, error: 'WPM out of valid range' };
      }

      // Must have played for at least the mode duration minus a small buffer
      const { mode } = additionalData;
      if (mode && (mode === 15 || mode === 30 || mode === 60)) {
        const minDuration = mode - 2; // Allow 2 second buffer for timing
        if (durationSeconds < minDuration) {
          return {
            valid: false,
            error: 'Game duration too short for selected mode',
          };
        }
      }

      break;
    }

    case 'tetris': {
      // Tetris scoring is exponential with level — a single back-to-back
      // Tetris at level 20 with combo is 800*20*1.5 + combo = 25,000+ pts
      // in under 3 seconds. At kill-screen speeds, sustained averages of
      // 5,000-10,000 pts/sec are achievable by top players.
      //
      // Rather than a score/sec cap (which will always be either too tight
      // for elite play or too loose to catch cheating), we validate:
      // 1. Minimum duration for non-zero scores
      // 2. Hard cap at 10M total (already enforced client-side)
      // Behavioral checks (PPM, T-spin rate, input rate) are done in
      // the score route, where they can flag without hard-rejecting.
      if (durationSeconds < 2 && score > 0) {
        return { valid: false, error: 'Game duration too short' };
      }
      if (score > 10_000_000) {
        return { valid: false, error: 'Score exceeds maximum' };
      }
      break;
    }

    case 'coin-flip': {
      // Coin flip games can be very short (lose on first flip = ~2s).
      // Don't reject on duration — the server-side replay is the real check.
      if (!Number.isFinite(score) || score < 0 || score > 10000) {
        return { valid: false, error: 'Streak out of valid range' };
      }
      break;
    }

    case 'swerve': {
      // Swerve: rows arrive at ≥360ms deep in the run and the max sustainable
      // points rate (forced-streak gauntlets + cooldowns) is ~11-12 pts/s after
      // the 2026-07 difficulty tune. This is only a generous coarse bound — the
      // seed-deterministic replay in swerve-replay.ts is the authoritative check.
      if (!Number.isFinite(score) || score < 0) {
        return { valid: false, error: 'Score out of valid range' };
      }
      const maxReasonable = Math.ceil(durationSeconds * 15) + 60;
      if (score > maxReasonable) {
        return {
          valid: false,
          error: `Score too high for game duration (${Math.round(durationSeconds)}s for ${score} points)`,
        };
      }
      if (score > 0 && durationSeconds < 1) {
        return { valid: false, error: 'Game duration too short' };
      }
      break;
    }

    case 'log-splitter': {
      // Log Splitter: score is chops. The seed-deterministic replay in
      // log-splitter-replay.ts is the authoritative check; this is only a coarse
      // bound derived from the MAX INPUT RATE. Counted chops are gated by a 60ms
      // cadence floor (≈16.7 chops/s max), so a run cannot legitimately have more
      // chops than duration/60ms. We divide by 55ms (a hair looser than the 60ms
      // floor) + a small constant so client/server clock jitter never false-rejects.
      if (!Number.isFinite(score) || score < 0) {
        return { valid: false, error: 'Score out of valid range' };
      }
      const maxReasonable = Math.ceil((durationSeconds * 1000) / 55) + 16;
      if (score > maxReasonable) {
        return {
          valid: false,
          error: `Score too high for game duration (${Math.round(durationSeconds)}s for ${score} chops)`,
        };
      }
      if (score > 0 && durationSeconds < 0.3) {
        return { valid: false, error: 'Game duration too short' };
      }
      break;
    }

    case 'knife-booth': {
      // Knife Booth: score is points (1/knife, +5/fruit, depth-scaled stage-clear
      // bonuses). The seed-deterministic replay in knife-booth-replay.ts is the
      // authoritative check; this is only a generous coarse bound derived from the
      // MAX INPUT RATE. Counted throws are gated by a 120ms cadence floor (≈8.3
      // throws/s max); the absolute per-throw points ceiling is ~6 (knife+fruit)
      // plus amortized stage bonuses, so real elite play tops out near ~3 pts/s.
      // We bound at 40 pts/s (>13× the measured elite rate) so client/server clock
      // jitter never false-rejects while gross fabrication is still caught.
      if (!Number.isFinite(score) || score < 0) {
        return { valid: false, error: 'Score out of valid range' };
      }
      const maxReasonable = Math.ceil(durationSeconds * 40) + 120;
      if (score > maxReasonable) {
        return {
          valid: false,
          error: `Score too high for game duration (${Math.round(durationSeconds)}s for ${score} points)`,
        };
      }
      break;
    }

    case 'melon-chop': {
      // Melon Chop: score is points (fruit base 10, combo-multiplied up to ×3
      // for a single stroke). The seed-deterministic swipe-intersection replay in
      // melon-chop-replay.ts is the authoritative check; this is only a generous
      // coarse bound derived from the schedule's MAX FRUIT RATE. Over the 60s
      // blitz the schedule tops out near ~4.6 fruit/s and a fruit is worth at
      // most 30 pts, so the absolute instantaneous ceiling is ~140 pts/s. We
      // bound at 200 pts/s (>1.4× that hard ceiling) so client/server clock
      // jitter never false-rejects while gross fabrication is still caught.
      if (!Number.isFinite(score) || score < 0) {
        return { valid: false, error: 'Score out of valid range' };
      }
      const maxReasonable = Math.ceil(durationSeconds * 200) + 400;
      if (score > maxReasonable) {
        return {
          valid: false,
          error: `Score too high for game duration (${Math.round(durationSeconds)}s for ${score} points)`,
        };
      }
      break;
    }

    case 'blitz-tactics': {
      // Blitz Tactics: score is puzzles solved in a 5-min rush. The authoritative
      // check is the seed-deterministic replay in blitz-tactics-replay.ts (each
      // solved puzzle re-verified against the machine-verified bank + a per-solve
      // cadence floor). This is only a generous coarse bound derived from that
      // floor (BLITZ_MIN_SOLVE_INTERVAL_MS = 900ms): a human cannot legitimately
      // solve tactics faster than ~1/s sustained, so we cap at durationSec / 0.8s
      // (a hair below the 900ms floor so client/server clock jitter never
      // false-rejects) plus a small constant.
      if (!Number.isFinite(score) || score < 0) {
        return { valid: false, error: 'Score out of valid range' };
      }
      const maxReasonable = Math.ceil(durationSeconds / 0.8) + 5;
      if (score > maxReasonable) {
        return {
          valid: false,
          error: `Score too high for game duration (${Math.round(durationSeconds)}s for ${score} solved)`,
        };
      }
      break;
    }

    case 'punch-card': {
      // Punch Card (nonogram): the authoritative check is the seed-deterministic
      // replay in punch-card-replay.ts (final filled-set === solution + error
      // count). This is only a MIN-DURATION floor derived from the max input
      // rate: even a blistering drag-paint fills ≤ ~20 cells/s and only part of
      // the grid needs filling, so a legitimate solve for an n×n board must take
      // at least n*n*20ms. `additionalData.mode` carries n (5/10/15). The floor
      // is >10× below any real human solve, so it never false-rejects — it only
      // catches a bot submitting within a few hundred ms of session start.
      const n = additionalData?.mode;
      if (typeof n === 'number' && n > 0) {
        const minDurationMs = n * n * 20;
        if (durationMs < minDurationMs) {
          return {
            valid: false,
            error: `Solve too fast for a ${n}×${n} board (${Math.round(durationMs)}ms)`,
          };
        }
      }
      break;
    }

    case 'tin-duck': {
      // Tin Duck Gallery rules 2 (a thirty second gallery): score is points
      // (ducks 1 to 3, plates and bullseyes up to 9, the gold duck 10). The
      // seed-deterministic replay in tin-duck-gallery.ts is the authoritative
      // check; this is only a coarse bound from the most the gun can fire. The
      // pump floor is 170 ms and six corks reload in 1.2 s (about 3 shots a
      // second at best), and the best shot pays 10, so 30 points a second is
      // beyond any machine (the simulated bot sustains about 3).
      if (!Number.isFinite(score) || score < 0) {
        return { valid: false, error: 'Score out of valid range' };
      }
      const maxReasonable = Math.ceil(durationSeconds * 30) + 50;
      if (score > maxReasonable) {
        return {
          valid: false,
          error: `Score too high for game duration (${Math.round(durationSeconds)}s for ${score} points)`,
        };
      }
      break;
    }

    case 'boardwalk-hop': {
      // Boardwalk Hop (discrete grid road-hopper): score is furthest row +
      // close-call bonuses. The seed-deterministic replay in
      // boardwalk-hop-replay.ts is the authoritative check; this is only a
      // generous coarse bound derived from the MAX INPUT RATE. Counted forward
      // hops are gated by a 110ms cadence floor (≈9.1 rows/s peak) and the top
      // per-row value is 9 (1 + a capped ×4 close-call streak), so the absolute
      // theoretical ceiling is ~82 pts/s — while a measured perfect bot sustains
      // only ~10 pts/s. We bound at 45 pts/s (>4× the perfect sustained rate,
      // comfortably covering short close-call bursts) so client/server clock
      // jitter never false-rejects while gross fabrication is still caught.
      if (!Number.isFinite(score) || score < 0) {
        return { valid: false, error: 'Score out of valid range' };
      }
      const maxReasonable = Math.ceil(durationSeconds * 45) + 120;
      if (score > maxReasonable) {
        return {
          valid: false,
          error: `Score too high for game duration (${Math.round(durationSeconds)}s for ${score} points)`,
        };
      }
      if (score > 0 && durationSeconds < 1) {
        return { valid: false, error: 'Game duration too short' };
      }
      break;
    }

    case 'freecell': {
      // FreeCell Sprint (seeded solitaire): the authoritative check is the
      // seed-deterministic replay in freecell-replay.ts (every submitted move is
      // re-validated against the real rules and the final board must have all 52
      // cards home). This is only a MIN-DURATION floor derived from the max input
      // rate: `additionalData.mode` carries the submitted move count, and even a
      // blistering keyboard speed-runner needs ≥ ~55ms per move. The recorded
      // time is the server wall-clock, so this floor is what stops a bot that
      // precomputes a solution and submits within a second of session start from
      // topping the fastest-time board. It is >2.5× below any real human cadence,
      // so it never false-rejects — it only catches an instant fabricated solve.
      const moves = additionalData?.mode;
      if (typeof moves === 'number' && moves > 0) {
        const minDurationMs = moves * 55;
        if (durationMs < minDurationMs) {
          return {
            valid: false,
            error: `Solve too fast for ${moves} moves (${Math.round(durationMs)}ms)`,
          };
        }
      }
      break;
    }

    case 'ticket-stop': {
      // Ticket stop, rules 2 (the lock): the score is hits. The authoritative
      // check is the seeded replay in ticket-stop-lock-engine.ts (every tap
      // resolved against the needle, the run's timeline no longer than the
      // session). This is only the range: a run can't have more hits than
      // LOCK_MAX_TAPS taps.
      if (!Number.isInteger(score) || score < 0 || score > 2000) {
        return { valid: false, error: 'Score out of valid range' };
      }
      break;
    }

    case 'ring-toss': {
      // Ring toss: the score is points from at most ten rings (100 a ring
      // at most). The authoritative check is the replay in ring-toss-engine.ts.
      if (!Number.isInteger(score) || score < 0 || score > 1000) {
        return { valid: false, error: 'Score out of valid range' };
      }
      break;
    }

    case 'stack-cabinet': {
      // Stacker's cabinet mode: the score is rows placed, 0 to 15. The
      // authoritative check is the seeded replay in stack-cabinet-engine.ts.
      if (!Number.isInteger(score) || score < 0 || score > 15) {
        return { valid: false, error: 'Score out of valid range' };
      }
      break;
    }
  }

  return { valid: true };
}

/**
 * Gets session info for tracking (without consuming the session)
 */
export async function getSessionInfo(sessionId: string): Promise<{
  exists: boolean;
  reactionTimes?: number[];
}> {
  const session = await queryOne<{ reaction_times_json: string | null }>(
    'SELECT reaction_times_json FROM game_sessions WHERE id = $1',
    [sessionId],
  );
  if (!session) {
    return { exists: false };
  }
  return {
    exists: true,
    reactionTimes: parseJsonArray<number>(session.reaction_times_json),
  };
}

export function getSessionInfoForUser(
  sessionId: string,
  odUserId: string,
): Promise<{ exists: boolean; reactionTimes?: number[] }> {
  return queryOne<{
    od_user_id: string;
    reaction_times_json: string | null;
  }>(
    'SELECT od_user_id, reaction_times_json FROM game_sessions WHERE id = $1',
    [sessionId],
  ).then((session) => {
  if (!session || session.od_user_id !== odUserId) {
    return { exists: false };
  }
  return {
    exists: true,
    reactionTimes: parseJsonArray<number>(session.reaction_times_json),
  };
  });
}

function normalizeSeedOption(value: unknown) {
  if (typeof value !== 'number' || !Number.isInteger(value)) return undefined;
  if (value < 0 || value >= 2 ** 31) return undefined;
  return value;
}
