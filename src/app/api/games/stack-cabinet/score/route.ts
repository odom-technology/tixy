import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { desc, eq, sql } from 'drizzle-orm';

import { db, query } from '@/server/db/client';
import { stackCabinetScores } from '@/server/db/schema';
import { requireIdentity } from '@/server/auth';
import {
  consumeGameSessionOrReject,
  validateGameSession,
} from '@/server/arcade/game-session';
import {
  scoreStackerRun,
  stackerCheckPhases,
  stackerPlayCheck,
  STACKER_PLAY_WINDOW,
  STACKER_ROWS,
  type StackerRunSummary,
} from '@/server/arcade/stack-cabinet-engine';
import { awardGameRunCredits } from '@/server/arcade/rewards';
import { recordGameTimeMetric } from '@/server/arcade/game-time-metrics';
import { addAntiCheatLog } from '@/server/arcade/anti-cheat-logs';
import {
  runAntiCheat,
  type ActionEntry,
  type EnvFingerprint,
} from '@/server/arcade/anti-cheat';
import { recordRunAchievements } from '../../_shared/run-achievements';
import {
  authenticateGamePlayer,
  isErrorResponse,
  parsePayload,
  rejectScore,
} from '../../_shared/score-helpers';
import { runScoreRoutePipeline } from '../../_shared/score-route-pipeline';

/* Stacker's cabinet mode: score route. Ticket stop's pattern: the client
   posts its stop times (whole ms since the run's first input) and the server
   rebuilds the whole run from the session's seed with the engine the client
   drew from. Rows placed and the prize come from the replay; the client's
   number must match it.

   Endless stack (/api/games/stack/score) is a different game type with its
   own table, and nothing here touches it.

   What the server bounds:
   - The first press records a 'start' action on the session before the
     client's clock starts, so a run can't be posted faster than its own
     timeline, or long after it.
   - Every stop must come after its row armed, the run must end (a miss or
     row 15), and nothing may follow the end.
   - Each saved run's rows and its fast-row in-step points go into
     stack_cabinet_runs. Stops at the same point in their step, run after
     run, are flagged into the anti-cheat's escalation. A run of majors
     beyond the sharpest honest player is only logged for review.

   No score events: rows 0 to 15 aren't a leaderboard metric, and writing
   them under 'stack' would mix them into endless's boards. */

type ScorePayload = {
  score?: number;
  sessionToken?: string;
  stops?: unknown;
  env?: EnvFingerprint;
};

const parsePhases = (text: string): number[] => {
  try {
    const value = JSON.parse(text) as unknown;
    return Array.isArray(value) ? value.filter((v): v is number => typeof v === 'number') : [];
  } catch {
    return [];
  }
};

/** A run lasts seconds. A session posted an hour after it began is stale. */
const MAX_SESSION_DURATION_MS = 60 * 60 * 1000;

export async function GET() {
  let identity;
  try {
    identity = await requireIdentity({ allowExternal: true, allowGuest: true });
  } catch {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }

  try {
    const best = await db
      .select({ score: stackCabinetScores.score })
      .from(stackCabinetScores)
      .where(eq(stackCabinetScores.odUserId, identity.userId))
      .orderBy(desc(stackCabinetScores.score))
      .limit(1);
    return NextResponse.json({ bestScore: best[0]?.score ?? 0 });
  } catch (error) {
    console.error('Failed to fetch stacker cabinet best:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const authResult = await authenticateGamePlayer('stack-cabinet');
  if (isErrorResponse(authResult)) return authResult;
  const { identity, identityName } = authResult;

  const payload = await parsePayload<ScorePayload>(request);
  if (payload instanceof NextResponse) return payload;

  if (
    typeof payload?.score !== 'number' ||
    typeof payload?.sessionToken !== 'string' ||
    !Array.isArray(payload?.stops)
  ) {
    return NextResponse.json(
      { error: 'Invalid score data. Session token and stops required.' },
      { status: 400 },
    );
  }

  const claimedRows = Math.floor(payload.score);
  if (!Number.isFinite(claimedRows) || claimedRows < 0 || claimedRows > STACKER_ROWS) {
    return NextResponse.json({ error: 'Invalid score value.' }, { status: 400 });
  }

  const reject = (stage: string, reason: string, publicMessage?: string) =>
    rejectScore('stack-cabinet', {
      userId: identity.userId,
      userName: identityName,
      score: claimedRows,
      stage,
      reason,
      publicMessage,
    });

  if (payload.stops.length < 1 || payload.stops.length > STACKER_ROWS) {
    return reject('payload', `Expected 1 to ${STACKER_ROWS} stops, got ${payload.stops.length}`, 'Invalid score data.');
  }

  const sessionValidation = await validateGameSession(
    payload.sessionToken,
    identity.userId,
    'stack-cabinet',
    claimedRows,
    undefined,
    { consumeSession: false },
  );
  if (!sessionValidation.valid) {
    return reject('session', sessionValidation.error ?? 'Invalid game session.', 'Invalid game session.');
  }

  const sessionId = sessionValidation.session?.sessionId;
  const sessionDurationMs = sessionValidation.session?.durationMs ?? 0;
  const seed = sessionValidation.session?.stackCabinetSeed;
  if (!sessionId || typeof seed !== 'number') {
    return reject('session', 'Missing session id or seed', 'Invalid game session.');
  }
  if (sessionDurationMs > MAX_SESSION_DURATION_MS) {
    return reject('session', `Session duration exceeds window (${sessionDurationMs}ms)`, 'Invalid game session.');
  }

  // The start stamp: exactly one action, 'start', recorded at the first press.
  const actionCounts = sessionValidation.session?.actionCounts ?? {};
  const startAt = sessionValidation.session?.lastActionAt;
  if (
    sessionValidation.session?.actionCount !== 1 ||
    actionCounts.start !== 1 ||
    typeof startAt !== 'number'
  ) {
    return reject(
      'session',
      `Missing or repeated start stamp (actions=${sessionValidation.session?.actionCount ?? 0})`,
      'Invalid game session.',
    );
  }

  // === SERVER-AUTHORITATIVE RUN ===
  const sinceStartMs = Date.now() - startAt;
  const run = scoreStackerRun(seed, payload.stops, { sinceStartMs });
  if (run.ok === false) {
    const { reason, row } = run as Extract<typeof run, { ok: false }>;
    return reject(
      'server-replay',
      `Rejected stops (${reason}${row === undefined ? '' : `, row ${row + 1}`}, sinceStart=${sinceStartMs}ms)`,
      'Run could not be verified.',
    );
  }
  if (run.rows !== claimedRows) {
    return reject(
      'server-replay',
      `Authoritative rows mismatch (server=${run.rows}, client=${claimedRows})`,
    );
  }

  const actions: ActionEntry[] = run.results.map((result) => ({
    t: result.stopMs,
    d: { row: result.row, left: result.moving.left, lost: result.lost },
  }));

  // Claim the session before any anti-cheat work: a re-posted run gets a
  // 409 here and is never checked, flagged or paid twice.
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
    .select({ score: stackCabinetScores.score })
    .from(stackCabinetScores)
    .where(eq(stackCabinetScores.odUserId, identity.userId))
    .limit(1)
    .then((rows: Array<{ score: number }>) => rows[0]?.score ?? null);

  // The play check over this player's recent runs, this one included.
  const history = await query<{ rows_placed: number; phases_json: string }>(
    `SELECT rows_placed, phases_json FROM stack_cabinet_runs
     WHERE od_user_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [identity.userId, STACKER_PLAY_WINDOW - 1],
  ).then((result) =>
    result.rows
      .reverse()
      .map((row): StackerRunSummary => ({
        rows: Number(row.rows_placed),
        phases: parsePhases(row.phases_json),
      })),
  );
  const phases = stackerCheckPhases(run.results);
  const play = stackerPlayCheck([...history, { rows: run.rows, phases }]);

  // No gameCount: rows are bounded (0 to 15) and fully replayed, so the
  // generic score-jump check would only catch an honest 4 followed by a 12.
  const antiCheat = await runAntiCheat({
    gameType: 'stack-cabinet',
    userId: identity.userId,
    userName: identityName,
    score: run.rows,
    actions,
    env: payload.env ?? null,
    previousBest,
    sessionDurationMs,
    serverActionCount: sessionValidation.session?.actionCount,
    serverActionCounts: sessionValidation.session?.actionCounts,
    gameChecks: play.flag ? [{ severity: 'flag', stage: 'stack-cabinet-play', reason: play.flag }] : [],
  });
  // Major streaks are logged for a person to look at, as a pass, so the
  // flag escalation (which counts result = 'flag') never sees them.
  if (play.review) {
    await addAntiCheatLog({
      ts: Date.now(),
      gameType: 'stack-cabinet',
      userId: identity.userId,
      userName: identityName,
      score: run.rows,
      result: 'pass',
      reason: `Review: ${play.review}`,
      stage: 'stack-cabinet-review',
      checks: [`runs=${play.runs}`, `majorRate=${play.majorRate.toFixed(2)}`, `phaseR=${play.phaseR.toFixed(2)}`],
    }).catch(() => {});
  }

  return runScoreRoutePipeline({
    antiCheat,
    identity,
    persist: async ({ now, userName }) => {
      // The session was claimed above, so this runs once per run.
      await query(
        `INSERT INTO stack_cabinet_runs (id, od_user_id, session_id, rows_placed, phases_json, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (session_id) DO NOTHING`,
        [crypto.randomUUID(), identity.userId, sessionId, run.rows, JSON.stringify(phases), now],
      );
      // Keep only the window the play check reads.
      await query(
        `DELETE FROM stack_cabinet_runs
         WHERE od_user_id = $1
           AND id NOT IN (
             SELECT id FROM stack_cabinet_runs WHERE od_user_id = $1
             ORDER BY created_at DESC LIMIT $2
           )`,
        [identity.userId, STACKER_PLAY_WINDOW],
      );

      await db
        .insert(stackCabinetScores)
        .values({
          id: crypto.randomUUID(),
          odUserId: identity.userId,
          userName,
          score: run.rows,
          createdAt: now,
        })
        .onConflictDoUpdate({
          target: stackCabinetScores.odUserId,
          set: { userName, score: run.rows, createdAt: now },
          where: sql`excluded.score > ${stackCabinetScores.score}`,
        });

      const reward = await awardGameRunCredits({
        userId: identity.userId,
        context: { gameType: 'stack-cabinet', score: run.rows },
        sourceId: `stack-cabinet:${sessionId}`,
        meta: {
          rows: run.rows,
          prize: run.prize,
          perfects: run.perfects,
          antiCheat: antiCheat.severity ?? 'pass',
        },
      });
      const achievements = await recordRunAchievements(
        identity.userId,
        { gameType: 'stack-cabinet', score: run.rows },
        reward,
        { durationMs: run.durationMs },
      );
      await recordGameTimeMetric({
        userId: identity.userId,
        gameType: 'stack-cabinet',
        durationMs: Math.min(sessionDurationMs, run.durationMs + 5_000),
        playedAtMs: now,
      });

      return {
        success: true,
        isNewPB: previousBest === null || run.rows > previousBest,
        reward,
        achievements,
        verifiedRun: {
          rows: run.rows,
          perfects: run.perfects,
          prize: run.prize,
        },
      };
    },
  });
}
