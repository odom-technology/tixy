import crypto from 'node:crypto';

import { query, queryOne, withTransaction } from '@/server/db/client';
import {
  getMultiplayerSessionSnapshot,
  type MultiplayerSession,
  type MultiplayerSessionPlayer,
  type MultiplayerSessionSnapshot,
} from '@/server/arcade/multiplayer';

export type TypingDuelResult = {
  id: string;
  sessionId: string;
  userId: string;
  userName: string;
  gameType: 'typing-test';
  gameSessionId: string | null;
  modeSec: number;
  wpm: number;
  rawWpm: number;
  accuracy: number;
  correctChars: number;
  incorrectChars: number;
  totalChars: number;
  wordsCompleted: number;
  createdAt: number;
};

export type TypingDuelOutcome = {
  complete: boolean;
  draw: boolean;
  winnerUserId: string | null;
  reason: 'all-results' | 'timeout' | 'draw' | null;
};

export type TypingDuelSnapshot = MultiplayerSessionSnapshot & {
  results: TypingDuelResult[];
  outcome: TypingDuelOutcome;
};

type SessionRow = {
  id: string;
  gameType: string;
  mode: string;
  status: string;
  minPlayers: string | number;
  maxPlayers: string | number;
  metadataJson: string | null;
  startedAt: string | number | null;
};

type ResultRow = {
  id: string;
  sessionId: string;
  userId: string;
  userName: string;
  gameType: 'typing-test';
  gameSessionId: string | null;
  modeSec: string | number;
  wpm: string | number;
  rawWpm: string | number;
  accuracy: string | number;
  correctChars: string | number;
  incorrectChars: string | number;
  totalChars: string | number;
  wordsCompleted: string | number;
  createdAt: string | number;
};

export class DuplicateTypingDuelResultError extends Error {
  constructor() {
    super('You already submitted a result for this duel.');
  }
}

const DUEL_COMPLETION_GRACE_MS = 45_000;

const resultSelect = `
  id,
  session_id AS "sessionId",
  user_id AS "userId",
  user_name AS "userName",
  game_type AS "gameType",
  game_session_id AS "gameSessionId",
  mode_sec AS "modeSec",
  wpm,
  raw_wpm AS "rawWpm",
  accuracy,
  correct_chars AS "correctChars",
  incorrect_chars AS "incorrectChars",
  total_chars AS "totalChars",
  words_completed AS "wordsCompleted",
  created_at AS "createdAt"
`;

function toNumber(value: string | number | null | undefined) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function rowToResult(row: ResultRow): TypingDuelResult {
  return {
    id: row.id,
    sessionId: row.sessionId,
    userId: row.userId,
    userName: row.userName,
    gameType: row.gameType,
    gameSessionId: row.gameSessionId,
    modeSec: toNumber(row.modeSec),
    wpm: toNumber(row.wpm),
    rawWpm: toNumber(row.rawWpm),
    accuracy: toNumber(row.accuracy),
    correctChars: toNumber(row.correctChars),
    incorrectChars: toNumber(row.incorrectChars),
    totalChars: toNumber(row.totalChars),
    wordsCompleted: toNumber(row.wordsCompleted),
    createdAt: toNumber(row.createdAt),
  };
}

export function getTypingDuelModeSec(session: MultiplayerSession) {
  const value = Number(session.metadata.modeSec);
  return value === 15 || value === 30 || value === 60 ? value : 30;
}

export function getTypingDuelSeed(session: MultiplayerSession) {
  const value = Number(session.metadata.typingSeed);
  return Number.isInteger(value) && value >= 0 && value < 2 ** 31
    ? value
    : null;
}

export async function listTypingDuelResults(sessionId: string) {
  const result = await query<ResultRow>(
    `
      SELECT ${resultSelect}
      FROM arcade_skill_duel_results
      WHERE session_id = $1
      ORDER BY created_at ASC
    `,
    [sessionId],
  );
  return result.rows.map(rowToResult);
}

export async function hasTypingDuelResult(input: {
  sessionId: string;
  userId: string;
}) {
  const row = await queryOne<{ id: string }>(
    `
      SELECT id
      FROM arcade_skill_duel_results
      WHERE session_id = $1 AND user_id = $2
      LIMIT 1
    `,
    [input.sessionId, input.userId],
  );
  return Boolean(row);
}

export function getTypingDuelOutcome(input: {
  session: MultiplayerSession;
  players: MultiplayerSessionPlayer[];
  results: TypingDuelResult[];
}): TypingDuelOutcome {
  const { session, players, results } = input;
  const hasAllResults =
    players.length >= session.minPlayers &&
    players.every((player) =>
      results.some((result) => result.userId === player.userId),
    );

  if (!hasAllResults && session.status !== 'completed') {
    return { complete: false, draw: false, winnerUserId: null, reason: null };
  }

  if (results.length === 0) {
    return { complete: true, draw: true, winnerUserId: null, reason: 'draw' };
  }

  const ranked = [...results].sort(compareTypingDuelResults);
  const [first, second] = ranked;
  if (first && second && compareTypingDuelResults(first, second) === 0) {
    return { complete: true, draw: true, winnerUserId: null, reason: 'draw' };
  }

  return {
    complete: true,
    draw: false,
    winnerUserId: first?.userId ?? null,
    reason: hasAllResults ? 'all-results' : 'timeout',
  };
}

export async function getTypingDuelSnapshot(
  sessionId: string,
): Promise<TypingDuelSnapshot | null> {
  await finalizeExpiredTypingDuel(sessionId);
  const snapshot = await getMultiplayerSessionSnapshot(sessionId);
  if (!snapshot || snapshot.session.gameType !== 'typing-test') return null;
  const results = await listTypingDuelResults(sessionId);
  return {
    ...snapshot,
    results,
    outcome: getTypingDuelOutcome({
      session: snapshot.session,
      players: snapshot.players,
      results,
    }),
  };
}

export async function recordTypingDuelResult(input: {
  sessionId: string;
  userId: string;
  userName: string;
  gameSessionId?: string | null;
  modeSec: number;
  wpm: number;
  rawWpm: number;
  accuracy: number;
  correctChars: number;
  incorrectChars: number;
  totalChars: number;
  wordsCompleted: number;
  now?: number;
}) {
  const now = input.now ?? Date.now();
  await withTransaction(async (client) => {
    const sessionResult = await client.query<SessionRow>(
      `
        SELECT id,
               game_type AS "gameType",
               mode,
               status,
               min_players AS "minPlayers",
               max_players AS "maxPlayers",
               metadata_json AS "metadataJson",
               started_at AS "startedAt"
        FROM arcade_multiplayer_sessions
        WHERE id = $1
        LIMIT 1
        FOR UPDATE
      `,
      [input.sessionId],
    );
    const session = sessionResult.rows[0];
    if (!session) throw new Error('Typing duel not found.');
    if (session.gameType !== 'typing-test' || session.mode !== 'versus') {
      throw new Error('This is not a typing duel.');
    }
    if (session.status !== 'active' && session.status !== 'completed') {
      throw new Error('This typing duel is not active.');
    }

    const playerResult = await client.query<{ userId: string }>(
      `
        SELECT user_id AS "userId"
        FROM arcade_multiplayer_session_players
        WHERE session_id = $1
          AND user_id = $2
          AND status <> 'left'
          AND left_at IS NULL
        LIMIT 1
      `,
      [input.sessionId, input.userId],
    );
    if (!playerResult.rows[0]) {
      throw new Error('You are not a player in this typing duel.');
    }

    const insertResult = await client.query(
      `
        INSERT INTO arcade_skill_duel_results (
          id,
          session_id,
          user_id,
          user_name,
          game_type,
          game_session_id,
          mode_sec,
          wpm,
          raw_wpm,
          accuracy,
          correct_chars,
          incorrect_chars,
          total_chars,
          words_completed,
          created_at
        ) VALUES ($1, $2, $3, $4, 'typing-test', $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        ON CONFLICT (session_id, user_id) DO NOTHING
      `,
      [
        crypto.randomUUID(),
        input.sessionId,
        input.userId,
        input.userName,
        input.gameSessionId ?? null,
        input.modeSec,
        input.wpm,
        input.rawWpm,
        input.accuracy,
        input.correctChars,
        input.incorrectChars,
        input.totalChars,
        input.wordsCompleted,
        now,
      ],
    );
    if ((insertResult.rowCount ?? 0) === 0) {
      throw new DuplicateTypingDuelResultError();
    }

    const playersResult = await client.query<{ userId: string }>(
      `
        SELECT user_id AS "userId"
        FROM arcade_multiplayer_session_players
        WHERE session_id = $1
          AND status <> 'left'
          AND left_at IS NULL
      `,
      [input.sessionId],
    );
    const resultsResult = await client.query<{ userId: string }>(
      `
        SELECT user_id AS "userId"
        FROM arcade_skill_duel_results
        WHERE session_id = $1
      `,
      [input.sessionId],
    );

    const minPlayers = toNumber(session.minPlayers);
    const allPlayersSubmitted =
      playersResult.rows.length >= minPlayers &&
      playersResult.rows.every((player) =>
        resultsResult.rows.some((result) => result.userId === player.userId),
      );
    if (allPlayersSubmitted) {
      await client.query(
        `
          UPDATE arcade_multiplayer_sessions
          SET status = 'completed',
              updated_at = $1,
              completed_at = COALESCE(completed_at, $1)
          WHERE id = $2
        `,
        [now, input.sessionId],
      );
    }
  });
}

async function finalizeExpiredTypingDuel(sessionId: string) {
  const now = Date.now();
  await withTransaction(async (client) => {
    const sessionResult = await client.query<SessionRow>(
      `
        SELECT id,
               game_type AS "gameType",
               mode,
               status,
               min_players AS "minPlayers",
               max_players AS "maxPlayers",
               metadata_json AS "metadataJson",
               started_at AS "startedAt"
        FROM arcade_multiplayer_sessions
        WHERE id = $1
        LIMIT 1
        FOR UPDATE
      `,
      [sessionId],
    );
    const session = sessionResult.rows[0];
    if (!session || session.gameType !== 'typing-test' || session.status !== 'active') {
      return;
    }

    const metadata = parseMetadata(session.metadataJson);
    const modeSec = Number(metadata.modeSec);
    const normalizedModeSec = modeSec === 15 || modeSec === 30 || modeSec === 60
      ? modeSec
      : 30;
    const startedAt = Number(session.startedAt ?? 0);
    if (startedAt <= 0) return;
    const expiresAt = startedAt + normalizedModeSec * 1000 + DUEL_COMPLETION_GRACE_MS;
    if (now < expiresAt) return;

    await client.query(
      `
        UPDATE arcade_multiplayer_sessions
        SET status = 'completed',
            updated_at = $1,
            completed_at = COALESCE(completed_at, $1)
        WHERE id = $2
      `,
      [now, sessionId],
    );
  });
}

function parseMetadata(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function compareTypingDuelResults(a: TypingDuelResult, b: TypingDuelResult) {
  if (b.wpm !== a.wpm) return b.wpm - a.wpm;
  if (b.accuracy !== a.accuracy) return b.accuracy - a.accuracy;
  if (b.rawWpm !== a.rawWpm) return b.rawWpm - a.rawWpm;
  return 0;
}
