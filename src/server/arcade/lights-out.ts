import { createHash } from 'node:crypto';
import { query, queryOne, withTransaction } from '@/server/db/client';
import { createGameSession, deriveSessionSeed, validateGameSession } from './game-session';
import { readMoves, replayLights, RULES_VERSION } from '@/features/arcade/lib/lights-out/engine';

export const LIGHTS_GAME = 'lights-out';
const MAX_RUN_MS = 15 * 60_000;

export class LightsOutError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export type LightsResult = { score: number; solved: boolean; moves: number };
type RunReceipt = { score: number; solved: boolean; move_count: number; moves_json: string; rules: number };

function receiptScore(receipt: RunReceipt, movesJson: string): LightsResult {
  if (receipt.rules !== RULES_VERSION) {
    throw new LightsOutError('This run used older rules. Start a new run.', 409);
  }
  if (receipt.moves_json !== movesJson) {
    throw new LightsOutError('This run was already submitted with different moves.', 409);
  }
  return { score: receipt.score, solved: receipt.solved, moves: receipt.move_count };
}

export async function startLightsRun(userId: string) {
  const session = await createGameSession(userId, LIGHTS_GAME);
  try {
    await query('INSERT INTO lights_out_sessions (id, rules) VALUES ($1, $2)', [session.sessionId, RULES_VERSION]);
  } catch (error) {
    // A failed rules write must not leave an unusable signed session behind.
    await query('DELETE FROM game_sessions WHERE id = $1 AND od_user_id = $2 AND game_type = $3', [session.sessionId, userId, LIGHTS_GAME]);
    throw error;
  }
  return { sessionToken: session.token, seed: deriveSessionSeed(session.sessionId), rulesVersion: RULES_VERSION };
}

/** Input is untrusted. Replaying and consuming the session happen before any best-score write. */
export async function submitLightsRun(userId: string, userName: string, payload: unknown): Promise<LightsResult> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new LightsOutError('Invalid score payload.', 400);
  }
  const input = payload as Record<string, unknown>;
  if (input.rulesVersion !== RULES_VERSION) {
    throw new LightsOutError('Unsupported rules version. Start a new run.', 400);
  }
  if (typeof input.sessionToken !== 'string' || input.sessionToken.length > 512) {
    throw new LightsOutError('A valid session token is required.', 400);
  }
  let moves: number[];
  try { moves = readMoves(input.moves); }
  catch (error) { throw new LightsOutError((error as Error).message, 400); }
  const movesJson = JSON.stringify(moves);
  // A receipt authenticates retries even after the one-use session was consumed.
  // Store a hash instead of retaining the signed bearer token.
  const tokenHash = createHash('sha256').update(input.sessionToken).digest('hex');
  const previous = await queryOne<RunReceipt>(
    'SELECT score, solved, move_count, moves_json, rules FROM lights_out_runs WHERE token_hash = $1 AND user_id = $2',
    [tokenHash, userId],
  );
  if (previous) return receiptScore(previous, movesJson);

  const validation = await validateGameSession(input.sessionToken, userId, LIGHTS_GAME, 0, undefined, { consumeSession: false });
  if (!validation.valid || !validation.session || validation.session.gameType !== LIGHTS_GAME) {
    // A simultaneous request may have committed while session validation ran.
    const committed = await queryOne<RunReceipt>(
      'SELECT score, solved, move_count, moves_json, rules FROM lights_out_runs WHERE token_hash = $1 AND user_id = $2', [tokenHash, userId],
    );
    if (committed) return receiptScore(committed, movesJson);
    throw new LightsOutError('Invalid or expired game session. Start a new run.', 403);
  }
  const session = validation.session;
  if (session.durationMs < 0 || session.durationMs > MAX_RUN_MS) {
    throw new LightsOutError('This run has expired. Start a new run.', 403);
  }
  // Client score/seed fields are intentionally ignored. Only the signed session chooses the seed.
  let result: LightsResult;
  try {
    const { score, solved, moves: moveCount } = replayLights(deriveSessionSeed(session.sessionId), moves);
    result = { score, solved, moves: moveCount };
  } catch (error) { throw new LightsOutError((error as Error).message, 400); }
  return withTransaction(async (client) => {
    const claimed = await client.query(
      `DELETE FROM game_sessions WHERE id = $1 AND od_user_id = $2 AND game_type = $3
       AND EXISTS (SELECT 1 FROM lights_out_sessions WHERE id = $1 AND rules = $4) RETURNING id`,
      [session.sessionId, userId, LIGHTS_GAME, RULES_VERSION],
    );
    if (!claimed.rowCount) {
      const receipt = await client.query<RunReceipt>(
        'SELECT score, solved, move_count, moves_json, rules FROM lights_out_runs WHERE token_hash = $1 AND user_id = $2', [tokenHash, userId],
      );
      if (receipt.rows[0]) return receiptScore(receipt.rows[0], movesJson);
      throw new LightsOutError('This game session is no longer available.', 409);
    }
    const now = Date.now();
    await client.query(
      `INSERT INTO lights_out_runs (id, user_id, token_hash, rules, moves_json, score, solved, move_count, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [session.sessionId, userId, tokenHash, RULES_VERSION, movesJson, result.score, result.solved, result.moves, now],
    );
    await client.query(
      `INSERT INTO lights_out_scores (user_id, rules, user_name, score, created_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, rules) DO UPDATE
       SET user_name = EXCLUDED.user_name, score = EXCLUDED.score, created_at = EXCLUDED.created_at
       WHERE EXCLUDED.score > lights_out_scores.score`,
      [userId, RULES_VERSION, userName, result.score, now],
    );
    return result;
  });
}

export async function getLightsLeaderboard() {
  const result = await query<{ userId: string; userName: string; score: number }>(
    `SELECT user_id AS "userId", user_name AS "userName", score FROM lights_out_scores
     WHERE rules = $1 ORDER BY score DESC, created_at ASC, user_id ASC LIMIT 10`, [RULES_VERSION],
  );
  return result.rows;
}
