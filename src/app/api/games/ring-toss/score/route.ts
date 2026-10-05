import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { asc, desc, eq, sql } from 'drizzle-orm';

import { db, query } from '@/server/db/client';
import { ringTossScores } from '@/server/db/schema';
import { requireIdentity } from '@/server/auth';
import { broadcast } from '@/server/events';
import { consumeGameSessionOrReject, validateGameSession } from '@/server/arcade/game-session';
import {
  RING_MAX_POINTS,
  RING_MAX_THROWS,
  RING_ROUND_MS,
  RING_RULES_VERSION,
  validateRingRun,
  type RingThrow,
} from '@/server/arcade/ring-toss-engine';
import { RING_PLAY_WINDOW, ringOffsets, ringPlayCheck } from '@/server/arcade/ring-toss-play';
import { awardGameRunCredits } from '@/server/arcade/rewards';
import { recordGameTimeMetric } from '@/server/arcade/game-time-metrics';
import { recordScoreEvent } from '@/server/arcade/score-events';
import { runAntiCheat, type ActionEntry, type EnvFingerprint } from '@/server/arcade/anti-cheat';
import { recordRunAchievements } from '../../_shared/run-achievements';
import { authenticateGamePlayer, isErrorResponse, parsePayload, rejectScore } from '../../_shared/score-helpers';
import { runScoreRoutePipeline } from '../../_shared/score-route-pipeline';
import { SCORE_RESPONSE_LEADERBOARD_LIMIT } from '../../_shared/constants';

/* Ring toss's score route. HTTP only. The client posts each flick as
   { h, p, a, c, t }: the hand, the power, the aim, the curl, and whole ms
   since the run's start, which the server stamped (PATCH /api/games/session,
   'start') before the client's clock began. The server replays the flicks
   through the engine the client drew from (validateRingRun) and takes the
   score from that: the client's score is never trusted, it must match.

   What the replay rejects: a flick that isn't five finite numbers, flicks out
   of order, a flick before the last ring came to rest, a flick after the
   round or past the tenth ring, a run whose last flick is later than the
   session has existed since its start, and a run posted long after. A session
   is claimed once, so a re-posted run is a 409 and is never paid twice.

   What the replay can't see is a program that sends good flicks. The play
   check (ring-toss-play.ts) reads how tightly a player's ringers sit on the
   ideal flick over their last 50 rounds, and flags a spread no hand gets. */

type ScorePayload = {
  score?: number;
  sessionToken?: string;
  throws?: unknown;
  env?: EnvFingerprint;
};

/** A round lasts about 30 s. A session posted an hour after it began is stale. */
const MAX_SESSION_DURATION_MS = 60 * 60 * 1000;

const parseOffsets = (text: string): Array<[number, number]> => {
  try {
    const value = JSON.parse(text) as unknown;
    return Array.isArray(value)
      ? value.filter((v): v is [number, number] => Array.isArray(v) && typeof v[0] === 'number' && typeof v[1] === 'number')
      : [];
  } catch {
    return [];
  }
};

function readThrows(raw: unknown[]): RingThrow[] | null {
  const out: RingThrow[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') return null;
    const { h, p, a, c, t } = item as Record<string, unknown>;
    if (typeof h !== 'number' || typeof p !== 'number' || typeof a !== 'number' || typeof c !== 'number' || typeof t !== 'number') return null;
    if (![h, p, a, c, t].every(Number.isFinite) || !Number.isInteger(t) || t < 0) return null;
    out.push({ h, p, a, c, t });
  }
  return out;
}

export async function GET() {
  let identity;
  try {
    identity = await requireIdentity({ allowExternal: true, allowGuest: true });
  } catch {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }
  try {
    const best = await db
      .select({ score: ringTossScores.score })
      .from(ringTossScores)
      .where(eq(ringTossScores.odUserId, identity.userId))
      .orderBy(desc(ringTossScores.score))
      .limit(1);
    return NextResponse.json({ bestScore: best[0]?.score ?? 0 });
  } catch (error) {
    console.error('Failed to fetch ring toss best score:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const authResult = await authenticateGamePlayer('ring-toss');
  if (isErrorResponse(authResult)) return authResult;
  const { identity, identityName } = authResult;

  const payload = await parsePayload<ScorePayload>(request);
  if (payload instanceof NextResponse) return payload;

  if (typeof payload?.score !== 'number' || typeof payload?.sessionToken !== 'string' || !Array.isArray(payload?.throws)) {
    return NextResponse.json({ error: 'Invalid score data. Session token and throws required.' }, { status: 400 });
  }

  const claimedScore = Math.floor(payload.score);
  if (!Number.isFinite(claimedScore) || claimedScore < 0 || claimedScore > RING_MAX_POINTS) {
    return NextResponse.json({ error: 'Invalid score value.' }, { status: 400 });
  }

  const reject = (stage: string, reason: string, publicMessage?: string) =>
    rejectScore('ring-toss', {
      userId: identity.userId,
      userName: identityName,
      score: claimedScore,
      stage,
      reason,
      publicMessage,
    });

  if (payload.throws.length > RING_MAX_THROWS) {
    return reject('payload', `Too many throws (${payload.throws.length})`, 'Invalid score data.');
  }
  const throws = readThrows(payload.throws);
  if (!throws) return reject('payload', 'Malformed throws', 'Invalid score data.');

  const sessionValidation = await validateGameSession(payload.sessionToken, identity.userId, 'ring-toss', claimedScore, undefined, {
    consumeSession: false,
  });
  if (!sessionValidation.valid) {
    return reject('session', sessionValidation.error ?? 'Invalid game session.', 'Invalid game session.');
  }
  const sessionId = sessionValidation.session?.sessionId;
  const sessionDurationMs = sessionValidation.session?.durationMs ?? 0;
  const seed = sessionValidation.session?.ringTossSeed;
  if (!sessionId || typeof seed !== 'number') {
    return reject('session', 'Missing session id or seed', 'Invalid game session.');
  }
  if (sessionDurationMs > MAX_SESSION_DURATION_MS) {
    return reject('session', `Session duration exceeds window (${sessionDurationMs}ms)`, 'Invalid game session.');
  }

  // The start stamp: exactly one action, 'start', recorded before the clock began.
  const actionCounts = sessionValidation.session?.actionCounts ?? {};
  const startAt = sessionValidation.session?.lastActionAt;
  if (sessionValidation.session?.actionCount !== 1 || actionCounts.start !== 1 || typeof startAt !== 'number') {
    return reject(
      'session',
      `Missing or repeated start stamp (actions=${sessionValidation.session?.actionCount ?? 0})`,
      'Invalid game session.',
    );
  }

  // === SERVER-AUTHORITATIVE SCORE ===
  const sinceStartMs = Date.now() - startAt;
  const run = validateRingRun(seed, throws);
  if (run.stop === 'bounds' || run.stop === 'order') {
    return reject('server-replay', `Rejected throws (${run.stop} at throw ${run.inspected})`, 'Score could not be verified.');
  }
  if (run.skipped > 0) {
    return reject('server-replay', `Throws that could not be thrown (${run.skipped} skipped)`, 'Score could not be verified.');
  }
  // The client's clock starts a little after the stamp (the preroll), so a
  // flick can never be later than the time since the stamp.
  if (run.lastT > sinceStartMs + 1_000) {
    return reject('server-replay', `Timeline longer than the session (last=${run.lastT}ms, sinceStart=${sinceStartMs}ms)`, 'Score could not be verified.');
  }
  if (run.score !== claimedScore) {
    return reject('server-replay', `Authoritative score mismatch (server=${run.score}, client=${claimedScore})`);
  }

  const actions: ActionEntry[] = throws.slice(0, run.thrown).map((t, i) => {
    const o = run.outcomes[i];
    return {
      t: t.t,
      d: { p: t.p, a: t.a, ringer: o?.kind === 'ringer' ? o.bottle : -1 },
    };
  });

  // Claim the session before any anti-cheat work: a re-posted run gets a 409
  // here and is never checked, flagged or paid twice.
  try {
    await consumeGameSessionOrReject(sessionId, identity.userId);
  } catch (error) {
    const status = (error as { status?: number }).status;
    if (typeof status === 'number' && status >= 400 && status < 500) {
      return NextResponse.json({ error: (error as Error).message }, { status });
    }
    throw error;
  }

  const previousBest = await db
    .select({ score: ringTossScores.score })
    .from(ringTossScores)
    .where(eq(ringTossScores.odUserId, identity.userId))
    .limit(1)
    .then((rows: Array<{ score: number }>) => rows[0]?.score ?? null);

  const history = await query<{ offsets_json: string }>(
    `SELECT offsets_json FROM ring_toss_runs WHERE od_user_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [identity.userId, RING_PLAY_WINDOW - 1],
  ).then((result) => result.rows.reverse().map((row) => parseOffsets(row.offsets_json)));
  const offsets = ringOffsets(throws, run.outcomes);
  const play = ringPlayCheck([...history, offsets]);

  // No gameCount: the score is replayed, so the generic score-jump check
  // would only catch an honest 150 followed by a 600.
  const antiCheat = await runAntiCheat({
    gameType: 'ring-toss',
    userId: identity.userId,
    userName: identityName,
    score: run.score,
    actions,
    env: payload.env ?? null,
    previousBest,
    sessionDurationMs,
    serverActionCount: sessionValidation.session?.actionCount,
    serverActionCounts: sessionValidation.session?.actionCounts,
    gameChecks: play.flag ? [{ severity: 'flag', stage: 'ring-toss-play', reason: play.flag }] : [],
  });

  const roundMs = Math.min(RING_ROUND_MS + 4_000, run.lastT + 3_000);

  return runScoreRoutePipeline({
    antiCheat,
    identity,
    persist: async ({ now, userName }) => {
      await query(
        `INSERT INTO ring_toss_runs (id, od_user_id, session_id, score, ringers, golds, rules, offsets_json, throws_json, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (session_id) DO NOTHING`,
        [
          crypto.randomUUID(),
          identity.userId,
          sessionId,
          run.score,
          run.ringers,
          run.golds,
          RING_RULES_VERSION,
          JSON.stringify(offsets),
          JSON.stringify(throws),
          now,
        ],
      );
      // Keep only the window the play check reads.
      await query(
        `DELETE FROM ring_toss_runs
         WHERE od_user_id = $1
           AND id NOT IN (SELECT id FROM ring_toss_runs WHERE od_user_id = $1 ORDER BY created_at DESC LIMIT $2)`,
        [identity.userId, RING_PLAY_WINDOW],
      );

      // A round with no ringers has no place on the board.
      if (run.score > 0) {
        await db
          .insert(ringTossScores)
          .values({ id: crypto.randomUUID(), odUserId: identity.userId, userName, score: run.score, createdAt: now })
          .onConflictDoUpdate({
            target: ringTossScores.odUserId,
            set: { userName, score: run.score, createdAt: now },
            where: sql`excluded.score > ${ringTossScores.score}`,
          });
        await recordScoreEvent({ gameSlug: 'ring-toss', userId: identity.userId, userName, score: run.score }).catch(() => {});
      }

      const reward = await awardGameRunCredits({
        userId: identity.userId,
        context: { gameType: 'ring-toss', score: run.score },
        sourceId: `ring-toss:${sessionId}`,
        meta: {
          score: run.score,
          rules: RING_RULES_VERSION,
          ringers: run.ringers,
          golds: run.golds,
          antiCheat: antiCheat.severity ?? 'pass',
        },
      });
      const achievements = await recordRunAchievements(
        identity.userId,
        { gameType: 'ring-toss', score: run.score },
        reward,
        { durationMs: roundMs },
      );
      await recordGameTimeMetric({
        userId: identity.userId,
        gameType: 'ring-toss',
        durationMs: Math.min(sessionDurationMs, roundMs + 5_000),
        playedAtMs: now,
      });

      const leaderboard = await db
        .select()
        .from(ringTossScores)
        .orderBy(desc(ringTossScores.score), asc(ringTossScores.createdAt))
        .limit(SCORE_RESPONSE_LEADERBOARD_LIMIT);

      broadcast('gameLeaderboards', { gameType: 'ring-toss', updatedAt: now });

      return {
        success: true,
        isNewPB: run.score > 0 && (previousBest === null || run.score > previousBest),
        reward,
        achievements,
        verifiedRun: { score: run.score, ringers: run.ringers, golds: run.golds, bestStreak: run.bestStreak },
        leaderboard: leaderboard.map((entry: { id: string; odUserId: string; userName: string; score: number }) => ({
          id: entry.id,
          userId: entry.odUserId,
          userName: entry.userName,
          score: entry.score,
        })),
      };
    },
  });
}
