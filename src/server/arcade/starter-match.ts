import { createHash } from 'node:crypto';
import { query, queryOne, withTransaction } from '@/server/db/client';
import { createGameSession, deriveSessionSeed, validateGameSession } from './game-session';
import { readChoices, replayPattern, RULES_VERSION } from '@/features/arcade/lib/starter-match/engine';

export const STARTER_GAME = 'starter-match';
const MAX_RUN_MS = 15 * 60_000;

export class StarterMatchError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

type RunReceipt = { score: number; choices_json: string; rules: number };

function receiptScore(receipt: RunReceipt, choicesJson: string): number {
  if (receipt.rules !== RULES_VERSION) {
    throw new StarterMatchError('This run used older rules. Start a new run.', 409);
  }
  if (receipt.choices_json !== choicesJson) {
    throw new StarterMatchError('This run was already submitted with different choices.', 409);
  }
  return receipt.score;
}

export async function startPatternRun(userId: string) {
  const session = await createGameSession(userId, STARTER_GAME);
  await query('INSERT INTO starter_match_sessions (id, rules) VALUES ($1, $2)', [session.sessionId, RULES_VERSION]);
  return { sessionToken: session.token, seed: deriveSessionSeed(session.sessionId), rulesVersion: RULES_VERSION };
}

/** Input is untrusted. Replaying and consuming the session happen before any best-score write. */
export async function submitPatternRun(userId: string, userName: string, payload: unknown): Promise<number> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new StarterMatchError('Invalid score payload.', 400);
  }
  const input = payload as Record<string, unknown>;
  if (input.rulesVersion !== RULES_VERSION) {
    throw new StarterMatchError('Unsupported rules version. Start a new run.', 400);
  }
  if (typeof input.sessionToken !== 'string' || input.sessionToken.length > 512) {
    throw new StarterMatchError('A valid session token is required.', 400);
  }
  let choices: number[];
  try { choices = readChoices(input.choices); }
  catch (error) { throw new StarterMatchError((error as Error).message, 400); }
  const choicesJson = JSON.stringify(choices);
  // A receipt authenticates retries even after the one-use session was consumed.
  // Store a hash instead of retaining the signed bearer token.
  const tokenHash = createHash('sha256').update(input.sessionToken).digest('hex');
  const previous = await queryOne<RunReceipt>(
    'SELECT score, choices_json, rules FROM starter_match_runs WHERE token_hash = $1 AND user_id = $2',
    [tokenHash, userId],
  );
  if (previous) return receiptScore(previous, choicesJson);

  const validation = await validateGameSession(input.sessionToken, userId, STARTER_GAME, 0, undefined, { consumeSession: false });
  if (!validation.valid || !validation.session || validation.session.gameType !== STARTER_GAME) {
    // A simultaneous request may have committed while session validation ran.
    const committed = await queryOne<RunReceipt>(
      'SELECT score, choices_json, rules FROM starter_match_runs WHERE token_hash = $1 AND user_id = $2', [tokenHash, userId],
    );
    if (committed) return receiptScore(committed, choicesJson);
    throw new StarterMatchError('Invalid or expired game session. Start a new run.', 403);
  }
  const session = validation.session;
  if (session.durationMs < 0 || session.durationMs > MAX_RUN_MS) {
    throw new StarterMatchError('This run has expired. Start a new run.', 403);
  }
  // Client score/seed fields are intentionally ignored. Only the signed session chooses the seed.
  const { score } = replayPattern(deriveSessionSeed(session.sessionId), choices);
  return withTransaction(async (client) => {
    const claimed = await client.query(
      `DELETE FROM game_sessions WHERE id = $1 AND od_user_id = $2 AND game_type = $3
       AND EXISTS (SELECT 1 FROM starter_match_sessions WHERE id = $1 AND rules = $4) RETURNING id`,
      [session.sessionId, userId, STARTER_GAME, RULES_VERSION],
    );
    if (!claimed.rowCount) {
      const receipt = await client.query<RunReceipt>(
        'SELECT score, choices_json, rules FROM starter_match_runs WHERE token_hash = $1 AND user_id = $2', [tokenHash, userId],
      );
      if (receipt.rows[0]) return receiptScore(receipt.rows[0], choicesJson);
      throw new StarterMatchError('This game session is no longer available.', 409);
    }
    const now = Date.now();
    await client.query(
      `INSERT INTO starter_match_runs (id, user_id, token_hash, rules, choices_json, score, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [session.sessionId, userId, tokenHash, RULES_VERSION, choicesJson, score, now],
    );
    await client.query(
      `INSERT INTO starter_match_scores (user_id, rules, user_name, score, created_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, rules) DO UPDATE
       SET user_name = EXCLUDED.user_name, score = EXCLUDED.score, created_at = EXCLUDED.created_at
       WHERE EXCLUDED.score > starter_match_scores.score`,
      [userId, RULES_VERSION, userName, score, now],
    );
    return score;
  });
}

export async function getPatternLeaderboard() {
  const result = await query<{ userId: string; userName: string; score: number }>(
    `SELECT user_id AS "userId", user_name AS "userName", score FROM starter_match_scores
     WHERE rules = $1 ORDER BY score DESC, created_at ASC, user_id ASC LIMIT 10`, [RULES_VERSION],
  );
  return result.rows;
}
