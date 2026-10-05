import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { asc, desc, eq, sql } from 'drizzle-orm';

import { db, query } from '@/server/db/client';
import { ticketStopLockScores } from '@/server/db/schema';
import { requireIdentity } from '@/server/auth';
import { broadcast } from '@/server/events';
import {
  consumeGameSessionOrReject,
  validateGameSession,
} from '@/server/arcade/game-session';
import {
  lockCheckOffsets,
  lockNearStreak,
  lockPlayCheck,
  LOCK_MAX_TAPS,
  LOCK_PLAY_WINDOW,
  scoreLockRun,
  TICKET_STOP_LOCK_RULES,
  type LockRunSummary,
} from '@/server/arcade/ticket-stop-lock-engine';
import { awardGameRunCredits } from '@/server/arcade/rewards';
import { recordGameTimeMetric } from '@/server/arcade/game-time-metrics';
import { recordScoreEvent } from '@/server/arcade/score-events';
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
import { SCORE_RESPONSE_LEADERBOARD_LIMIT } from '../../_shared/constants';

/* Ticket stop's score route, rules 2 (the lock). HTTP only. The client posts
   the whole-ms times of its taps since the run's first input, in order. The
   server rebuilds the run from the session's seed with the engine the client
   drew from (scoreLockRun) and takes the score from that: the client's score
   is never trusted, it must match.

   What the replay rejects: taps that aren't whole non-negative numbers, taps
   out of order, a tap while the needle waits, a tap after the run ended, a
   run whose timeline is longer than the session has existed, a run posted
   long after it ended. A session is claimed once, so a replayed post is a
   409 and is never checked, flagged or paid twice.

   No /ws channel: the seed the client draws from is not a secret, and a
   server stamp would only measure network jitter. The server does stamp the
   run's start (PATCH /api/games/session, 'start', before the client's clock
   starts), which bounds the run's timeline from both ends.

   What the replay can't see is a program that sends valid taps. The spread
   of the hits' offsets from the dot's centre is checked over the player's
   last runs (lockPlayCheck): a hand spreads by 10 ms at the very least, a
   program that aims every tap at the centre by a few. That is a flag, which
   the anti-cheat escalates to a ban after repeated flags. Runs on a rounded
   clock are skipped. Streaks of near-perfect hits are only logged.

   Rules 1 (the bulb ring) scores live on in ticket_stop_scores and
   ticket_stop_runs rows with rules = 1; nothing here reads or changes them. */

type ScorePayload = {
  score?: number;
  sessionToken?: string;
  taps?: unknown;
  env?: EnvFingerprint;
};

const parseOffsets = (text: string): number[] => {
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
      .select({ score: ticketStopLockScores.score })
      .from(ticketStopLockScores)
      .where(eq(ticketStopLockScores.odUserId, identity.userId))
      .orderBy(desc(ticketStopLockScores.score))
      .limit(1);
    return NextResponse.json({ bestScore: best[0]?.score ?? 0 });
  } catch (error) {
    console.error('Failed to fetch ticket stop best score:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const authResult = await authenticateGamePlayer('ticket-stop');
  if (isErrorResponse(authResult)) return authResult;
  const { identity, identityName } = authResult;

  const payload = await parsePayload<ScorePayload>(request);
  if (payload instanceof NextResponse) return payload;

  if (
    typeof payload?.score !== 'number' ||
    typeof payload?.sessionToken !== 'string' ||
    !Array.isArray(payload?.taps)
  ) {
    return NextResponse.json(
      { error: 'Invalid score data. Session token and taps required.' },
      { status: 400 },
    );
  }

  const claimedScore = Math.floor(payload.score);
  if (!Number.isFinite(claimedScore) || claimedScore < 0 || claimedScore > LOCK_MAX_TAPS) {
    return NextResponse.json({ error: 'Invalid score value.' }, { status: 400 });
  }

  const reject = (stage: string, reason: string, publicMessage?: string) =>
    rejectScore('ticket-stop', {
      userId: identity.userId,
      userName: identityName,
      score: claimedScore,
      stage,
      reason,
      publicMessage,
    });

  if (payload.taps.length > LOCK_MAX_TAPS) {
    return reject('payload', `Too many taps (${payload.taps.length})`, 'Invalid score data.');
  }

  const sessionValidation = await validateGameSession(
    payload.sessionToken,
    identity.userId,
    'ticket-stop',
    claimedScore,
    undefined,
    { consumeSession: false },
  );
  if (!sessionValidation.valid) {
    return reject('session', sessionValidation.error ?? 'Invalid game session.', 'Invalid game session.');
  }

  const sessionId = sessionValidation.session?.sessionId;
  const sessionDurationMs = sessionValidation.session?.durationMs ?? 0;
  const seed = sessionValidation.session?.ticketStopSeed;
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

  // === SERVER-AUTHORITATIVE SCORE ===
  const sinceStartMs = Date.now() - startAt;
  const run = scoreLockRun(seed, payload.taps, { sinceStartMs });
  if (run.ok === false) {
    const { reason, tap } = run as Extract<typeof run, { ok: false }>;
    return reject(
      'server-replay',
      `Rejected taps (${reason}${tap === undefined ? '' : `, tap ${tap + 1}`}, sinceStart=${sinceStartMs}ms)`,
      'Score could not be verified.',
    );
  }
  if (run.score !== claimedScore) {
    return reject(
      'server-replay',
      `Authoritative score mismatch (server=${run.score}, client=${claimedScore})`,
    );
  }

  const actions: ActionEntry[] = run.hits.map((hit) => ({
    t: hit.atMs,
    d: { hit: hit.index, level: hit.level, offsetMs: Math.round(hit.offsetMs * 10) / 10 },
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
    .select({ score: ticketStopLockScores.score })
    .from(ticketStopLockScores)
    .where(eq(ticketStopLockScores.odUserId, identity.userId))
    .limit(1)
    .then((rows: Array<{ score: number }>) => rows[0]?.score ?? null);

  // The spread check over this player's recent rules 2 runs, this one
  // included. Rules 1 rows in the same table are never read.
  const history = await query<{ perfects: number; phases_json: string }>(
    `SELECT perfects, phases_json FROM ticket_stop_runs
     WHERE od_user_id = $1 AND rules = $2 ORDER BY created_at DESC LIMIT $3`,
    [identity.userId, TICKET_STOP_LOCK_RULES, LOCK_PLAY_WINDOW - 1],
  ).then((result) =>
    result.rows
      .reverse()
      .map((row): LockRunSummary => ({
        streak: Number(row.perfects),
        offsets: parseOffsets(row.phases_json),
      })),
  );
  const offsets = lockCheckOffsets(run.hits, payload.taps as number[]);
  const streak = lockNearStreak(run.hits);
  const play = lockPlayCheck([...history, { streak, offsets }]);

  // No gameCount: the score is replayed, so the generic score-jump check
  // would only catch an honest 10 followed by a 140.
  const antiCheat = await runAntiCheat({
    gameType: 'ticket-stop',
    userId: identity.userId,
    userName: identityName,
    score: run.score,
    actions,
    env: payload.env ?? null,
    previousBest,
    sessionDurationMs,
    serverActionCount: sessionValidation.session?.actionCount,
    serverActionCounts: sessionValidation.session?.actionCounts,
    gameChecks: play.flag ? [{ severity: 'flag', stage: 'ticket-stop-play', reason: play.flag }] : [],
  });
  // Streaks of near-perfect hits are logged for a person to look at. Logged
  // as a pass, so the flag escalation (which counts result = 'flag') never
  // sees it.
  if (play.review) {
    await addAntiCheatLog({
      ts: Date.now(),
      gameType: 'ticket-stop',
      userId: identity.userId,
      userName: identityName,
      score: run.score,
      result: 'pass',
      reason: `Review: ${play.review}`,
      stage: 'ticket-stop-review',
      checks: [`hits=${run.score}`, `streak=${play.streak}`, `sdMs=${play.sdMs?.toFixed(1) ?? 'n/a'}`],
    }).catch(() => {});
  }

  return runScoreRoutePipeline({
    antiCheat,
    identity,
    persist: async ({ now, userName }) => {
      // The session was claimed above, so this runs once per run.
      await query(
        `INSERT INTO ticket_stop_runs (id, od_user_id, session_id, score, perfects, phases_json, created_at, rules)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (session_id) DO NOTHING`,
        [crypto.randomUUID(), identity.userId, sessionId, run.score, streak, JSON.stringify(offsets), now, TICKET_STOP_LOCK_RULES],
      );
      // Keep only the window the spread check reads, rules 2 rows only.
      await query(
        `DELETE FROM ticket_stop_runs
         WHERE od_user_id = $1 AND rules = $2
           AND id NOT IN (
             SELECT id FROM ticket_stop_runs WHERE od_user_id = $1 AND rules = $2
             ORDER BY created_at DESC LIMIT $3
           )`,
        [identity.userId, TICKET_STOP_LOCK_RULES, LOCK_PLAY_WINDOW],
      );

      // A run with no hits has no place on the board.
      if (run.score > 0) {
        await db
          .insert(ticketStopLockScores)
          .values({
            id: crypto.randomUUID(),
            odUserId: identity.userId,
            userName,
            score: run.score,
            createdAt: now,
          })
          .onConflictDoUpdate({
            target: ticketStopLockScores.odUserId,
            set: { userName, score: run.score, createdAt: now },
            where: sql`excluded.score > ${ticketStopLockScores.score}`,
          });

        await recordScoreEvent({
          gameSlug: 'ticket-stop',
          userId: identity.userId,
          userName,
          score: run.score,
        }).catch(() => {});
      }

      const reward = await awardGameRunCredits({
        userId: identity.userId,
        context: { gameType: 'ticket-stop', score: run.score },
        sourceId: `ticket-stop:${sessionId}`,
        meta: {
          score: run.score,
          rules: TICKET_STOP_LOCK_RULES,
          levelsCleared: run.levelsCleared,
          antiCheat: antiCheat.severity ?? 'pass',
        },
      });
      const achievements = await recordRunAchievements(
        identity.userId,
        { gameType: 'ticket-stop', score: run.score },
        reward,
        { durationMs: run.durationMs },
      );
      await recordGameTimeMetric({
        userId: identity.userId,
        gameType: 'ticket-stop',
        durationMs: Math.min(sessionDurationMs, run.durationMs + 5_000),
        playedAtMs: now,
      });

      const leaderboard = await db
        .select()
        .from(ticketStopLockScores)
        .orderBy(desc(ticketStopLockScores.score), asc(ticketStopLockScores.createdAt))
        .limit(SCORE_RESPONSE_LEADERBOARD_LIMIT);

      broadcast('gameLeaderboards', { gameType: 'ticket-stop', updatedAt: now });

      return {
        success: true,
        isNewPB: run.score > 0 && (previousBest === null || run.score > previousBest),
        reward,
        achievements,
        verifiedRun: {
          score: run.score,
          levelsCleared: run.levelsCleared,
          end: run.end.kind,
        },
        leaderboard: leaderboard.map(
          (entry: { id: string; odUserId: string; userName: string; score: number }) => ({
            id: entry.id,
            userId: entry.odUserId,
            userName: entry.userName,
            score: entry.score,
          }),
        ),
      };
    },
  });
}
