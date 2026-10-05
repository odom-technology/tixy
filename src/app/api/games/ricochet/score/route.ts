import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { desc, eq, sql } from 'drizzle-orm';
import { db } from '@/server/db/client';
import { ricochetScores } from '@/server/db/schema';
import { requireIdentity } from '@/server/auth';
import { broadcast } from '@/server/events';
import {
  consumeGameSessionOrReject,
  validateGameSession,
} from '@/server/arcade/game-session';
import {
  RICOCHET_MAX_TAPS,
  RICOCHET_STEP_MS,
  parseRicochetTaps,
  verifyRicochetRun,
} from '@/server/arcade/ricochet-replay';
import { awardGameRunCredits } from '@/server/arcade/rewards';
import { recordRunAchievements } from '../../_shared/run-achievements';
import { recordGameTimeMetric } from '@/server/arcade/game-time-metrics';
import {
  runAntiCheat,
  type ActionEntry,
  type EnvFingerprint,
} from '@/server/arcade/anti-cheat';
import {
  authenticateGamePlayer,
  isErrorResponse,
  parsePayload,
  rejectScore,
} from '../../_shared/score-helpers';
import { runScoreRoutePipeline } from '../../_shared/score-route-pipeline';
import { recordScoreEvent } from '@/server/arcade/score-events';
import {
  SCORE_RESPONSE_LEADERBOARD_LIMIT,
  RICOCHET_MAX_CLIENT_SCORE,
} from '../../_shared/constants';

/* Ricochet's score route. HTTP only. The client posts the taps it flapped
   with, each as the number of 60 Hz steps already played when it landed. The
   server plays the run again from the session's seed with the engine the
   client drew from (verifyRicochetRun) and takes the score from that: the
   client's score is never read as a score, it has to match.

   The server also stamps the run's start (PATCH /api/games/session, 'start',
   before the client's clock starts). A run of S steps takes at least S steps
   of real time, so a run longer than the stamp's age is rejected.

   What the replay rejects: taps that aren't whole non-negative numbers, taps
   out of order, a tap after the run ended, a run longer than the session has
   existed, a score that isn't the replay's. A session is claimed once, so a
   replayed post is a 409 and is never checked, flagged or paid twice.

   What it can't see is a program that flies the seed's gaps perfectly in real
   time: the gaps come from a seed the client has to know to draw them. That
   program still needs the run's real minutes, and the daily ticket cap stops
   it paying more than a person can.

   A client from before the replay check posts wall events, not taps. It gets
   one 409 and a reload fixes it. */

type ScorePayload = {
  score?: number;
  sessionToken?: string;
  taps?: unknown;
  env?: EnvFingerprint;
};

const OLD_CLIENT_MESSAGE = 'This page is out of date. Reload it and play again.';

/** A run lasts minutes. A session posted this long after it began is stale. */
const MAX_SESSION_DURATION_MS = 30 * 60 * 1000;

export async function GET() {
  let identity;
  try {
    identity = await requireIdentity({ allowExternal: true, allowGuest: true });
  } catch {
    return NextResponse.json(
      { error: 'Authentication required.' },
      { status: 401 },
    );
  }

  try {
    const bestScore = await db
      .select({ score: ricochetScores.score })
      .from(ricochetScores)
      .where(eq(ricochetScores.odUserId, identity.userId))
      .orderBy(desc(ricochetScores.score))
      .limit(1);

    return NextResponse.json({ bestScore: bestScore[0]?.score ?? 0 });
  } catch (error) {
    console.error('Failed to fetch user best score:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const authResult = await authenticateGamePlayer('ricochet');
  if (isErrorResponse(authResult)) return authResult;
  const { identity, identityName } = authResult;

  const payload = await parsePayload<ScorePayload>(request);
  if (payload instanceof NextResponse) return payload;

  if (typeof payload?.score !== 'number' || typeof payload?.sessionToken !== 'string') {
    return NextResponse.json(
      { error: 'Invalid score data. Session token and taps required.' },
      { status: 400 },
    );
  }

  const claimedScore = Math.floor(payload.score);
  if (
    !Number.isFinite(claimedScore) ||
    claimedScore < 0 ||
    claimedScore > RICOCHET_MAX_CLIENT_SCORE
  ) {
    return NextResponse.json({ error: 'Invalid score value.' }, { status: 400 });
  }

  const reject = (stage: string, reason: string, publicMessage?: string, status?: number) =>
    rejectScore('ricochet', {
      userId: identity.userId,
      userName: identityName,
      score: claimedScore,
      stage,
      reason,
      publicMessage,
      status,
    });

  if (Array.isArray(payload.taps) && payload.taps.length > RICOCHET_MAX_TAPS) {
    return reject('payload', `Too many taps (${payload.taps.length})`, 'Invalid score data.');
  }
  const taps = parseRicochetTaps(payload.taps);
  if (taps === null) {
    return reject(
      'payload',
      Array.isArray(payload.taps)
        ? 'Malformed tap list'
        : 'No tap list (client from before the replay check)',
      Array.isArray(payload.taps) ? 'Invalid score data.' : OLD_CLIENT_MESSAGE,
      Array.isArray(payload.taps) ? undefined : 409,
    );
  }

  const sessionValidation = await validateGameSession(
    payload.sessionToken,
    identity.userId,
    'ricochet',
    claimedScore,
    undefined,
    { consumeSession: false },
  );
  if (!sessionValidation.valid) {
    return reject('session', sessionValidation.error ?? 'Invalid game session.', 'Invalid game session.');
  }

  const sessionId = sessionValidation.session?.sessionId;
  const sessionDurationMs = sessionValidation.session?.durationMs ?? 0;
  const seed = sessionValidation.session?.ricochetSeed;
  if (!sessionId || typeof seed !== 'number') {
    return reject('session', 'Missing session id or ricochet seed', 'Invalid game session.');
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
  const run = verifyRicochetRun(seed, taps, claimedScore, { elapsedMs: sinceStartMs });
  if (run.ok === false) {
    const { reason, tap } = run as Extract<typeof run, { ok: false }>;
    if (reason.startsWith('Authoritative score mismatch')) {
      return reject('server-replay', `${reason}, sinceStart=${sinceStartMs}ms`);
    }
    return reject(
      'server-replay',
      `Rejected taps (${reason}${tap === undefined ? '' : `, tap ${tap + 1}`}, sinceStart=${sinceStartMs}ms)`,
      'Score could not be verified.',
    );
  }

  // One action per wall the replay cleared, on the run's own clock.
  const wallActions: ActionEntry[] = run.bounceSteps.map((step, index) => ({
    t: Math.round(step * RICOCHET_STEP_MS),
    d: { wall: index + 1 },
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
    .select({ score: ricochetScores.score })
    .from(ricochetScores)
    .where(eq(ricochetScores.odUserId, identity.userId))
    .orderBy(desc(ricochetScores.score))
    .limit(1)
    .then((rows) => rows[0]?.score ?? null);

  // No gameCount: the score is replayed, so the generic score-jump check
  // would only catch an honest 10 followed by a 60.
  const antiCheat = await runAntiCheat({
    gameType: 'ricochet',
    userId: identity.userId,
    userName: identityName,
    score: run.score,
    actions: wallActions,
    env: payload.env ?? null,
    previousBest,
    sessionDurationMs,
    serverActionCount: sessionValidation.session?.actionCount,
    serverActionCounts: sessionValidation.session?.actionCounts,
  });

  return runScoreRoutePipeline({
    antiCheat,
    identity,
    persist: async ({ now, userName }) => {
      // The session was claimed above, so this runs once per run.
      const existing = (
        await db
          .select({ score: ricochetScores.score })
          .from(ricochetScores)
          .where(eq(ricochetScores.odUserId, identity.userId))
          .limit(1)
      )[0];

      // A run with no wall has no place on the board.
      if (run.score > 0) {
        await db
          .insert(ricochetScores)
          .values({
            id: crypto.randomUUID(),
            odUserId: identity.userId,
            userName,
            score: run.score,
            createdAt: now,
          })
          .onConflictDoUpdate({
            target: ricochetScores.odUserId,
            set: { userName, score: run.score, createdAt: now },
            where: sql`excluded.score > ${ricochetScores.score}`,
          });

        await recordScoreEvent({
          gameSlug: 'ricochet',
          userId: identity.userId,
          userName,
          score: run.score,
        }).catch(() => {});
      }

      const reward = await awardGameRunCredits({
        userId: identity.userId,
        context: { gameType: 'ricochet', score: run.score },
        sourceId: `ricochet:${sessionId}`,
        meta: {
          score: run.score,
          steps: run.steps,
          antiCheat: antiCheat.severity ?? 'pass',
        },
      });
      const achievements = await recordRunAchievements(
        identity.userId,
        { gameType: 'ricochet', score: run.score },
        reward,
        { durationMs: Math.round(run.durationMs) },
      );

      await recordGameTimeMetric({
        userId: identity.userId,
        gameType: 'ricochet',
        durationMs: Math.min(sessionDurationMs, Math.round(run.durationMs) + 5_000),
        playedAtMs: now,
      });

      const leaderboard = await db
        .select()
        .from(ricochetScores)
        .orderBy(desc(ricochetScores.score))
        .limit(SCORE_RESPONSE_LEADERBOARD_LIMIT);

      broadcast('gameLeaderboards', {
        gameType: 'ricochet',
        updatedAt: now,
      });

      return {
        success: true,
        isNewPB: run.score > 0 && (!existing || run.score > existing.score),
        reward,
        achievements,
        verifiedRun: { score: run.score, steps: run.steps, end: run.cause },
        leaderboard: leaderboard.map((entry) => ({
          id: entry.id,
          userId: entry.odUserId,
          userName: entry.userName,
          score: entry.score,
        })),
      };
    },
  });
}
