import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { desc, eq, count, sql } from 'drizzle-orm';
import { db } from '@/server/db/client';
import { logSplitterScores } from '@/server/db/schema';
import { requireIdentity } from '@/server/auth';
import { broadcast } from '@/server/events';
import {
  consumeGameSessionOrReject,
  validateGameSession,
} from '@/server/arcade/game-session';
import {
  validateLogSplitterRun,
  LOG_SPLITTER_MAX_SCORE,
  LOG_SPLITTER_MAX_EVENTS,
  type LogSplitterChop,
  type LogSplitterSide,
} from '@/server/arcade/log-splitter-replay';
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
import { SCORE_RESPONSE_LEADERBOARD_LIMIT } from '../../_shared/constants';

type RawChop = { side?: unknown; t?: unknown };

type ScorePayload = {
  score?: number;
  sessionToken?: string;
  chops?: RawChop[];
  clientDurationMs?: number;
  env?: EnvFingerprint;
};

// The longest a single Log Splitter run can plausibly last on the server clock.
// The time bar caps a run well under this; a session posting far past it (a
// stalled tab / clock-stretch attempt) is rejected outright.
const MAX_SESSION_DURATION_MS = 60 * 60 * 1000; // 1 hour

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
      .select({ score: logSplitterScores.score })
      .from(logSplitterScores)
      .where(eq(logSplitterScores.odUserId, identity.userId))
      .orderBy(desc(logSplitterScores.score))
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
  const authResult = await authenticateGamePlayer('log-splitter');
  if (isErrorResponse(authResult)) return authResult;
  const { identity, identityName } = authResult;

  const payload = await parsePayload<ScorePayload>(request);
  if (payload instanceof NextResponse) return payload;

  if (
    typeof payload?.score !== 'number' ||
    typeof payload?.sessionToken !== 'string' ||
    !Array.isArray(payload?.chops)
  ) {
    return NextResponse.json(
      { error: 'Invalid score data. Session token and chops required.' },
      { status: 400 },
    );
  }

  const { sessionToken, env } = payload;
  const claimedScore = Math.floor(payload.score);

  if (
    !Number.isFinite(claimedScore) ||
    claimedScore < 0 ||
    claimedScore > LOG_SPLITTER_MAX_SCORE
  ) {
    return NextResponse.json({ error: 'Invalid score value.' }, { status: 400 });
  }

  // Reject obviously oversized payloads before doing any work. A run submits at
  // most one chop per event plus a little slack.
  if (payload.chops.length > LOG_SPLITTER_MAX_EVENTS) {
    return rejectScore('log-splitter', {
      userId: identity.userId,
      userName: identityName,
      score: claimedScore,
      stage: 'payload',
      reason: `Chop payload too large (${payload.chops.length})`,
      publicMessage: 'Invalid score data.',
    });
  }

  // Normalize the submitted chops to the validator's shape. We trust ONLY the
  // side + timestamp; validateLogSplitterRun re-derives every branch from the seed.
  const chops: LogSplitterChop[] = payload.chops.map((entry) => ({
    side: (entry as RawChop)?.side === 'R' ? 'R' : 'L',
    t: Number((entry as RawChop)?.t),
  })) as LogSplitterChop[];
  // Preserve any non-L/R side so a malformed side is caught by the validator
  // (which treats an unknown side as a bounds stop) rather than silently coerced.
  payload.chops.forEach((entry, i) => {
    const raw = (entry as RawChop)?.side;
    chops[i]!.side = (raw === 'L' || raw === 'R' ? raw : (raw as LogSplitterSide));
  });

  // Validate the game session token + server clock.
  const sessionValidation = await validateGameSession(
    sessionToken,
    identity.userId,
    'log-splitter',
    claimedScore,
    undefined,
    { consumeSession: false },
  );

  if (!sessionValidation.valid) {
    return rejectScore('log-splitter', {
      userId: identity.userId,
      userName: identityName,
      score: claimedScore,
      stage: 'session',
      reason: sessionValidation.error ?? 'Invalid game session.',
      publicMessage: 'Invalid game session.',
    });
  }

  const sessionId = sessionValidation.session?.sessionId;
  const sessionDurationMs = sessionValidation.session?.durationMs ?? 0;
  const logSplitterSeed = sessionValidation.session?.logSplitterSeed;

  if (!sessionId) {
    return rejectScore('log-splitter', {
      userId: identity.userId,
      userName: identityName,
      score: claimedScore,
      stage: 'session',
      reason: 'Missing session id',
      publicMessage: 'Invalid game session.',
    });
  }

  if (typeof logSplitterSeed !== 'number') {
    return rejectScore('log-splitter', {
      userId: identity.userId,
      userName: identityName,
      score: claimedScore,
      stage: 'session',
      reason: 'Missing log-splitter seed for session',
      publicMessage: 'Invalid game session.',
    });
  }

  // Server-clock ceiling: reject a run that posts implausibly long after it began.
  if (sessionDurationMs > MAX_SESSION_DURATION_MS) {
    return rejectScore('log-splitter', {
      userId: identity.userId,
      userName: identityName,
      score: claimedScore,
      stage: 'session',
      reason: `Session duration exceeds window (${sessionDurationMs}ms)`,
      publicMessage: 'Invalid game session.',
    });
  }

  // === SERVER-AUTHORITATIVE SCORE ===
  // Re-derive every branch from the seed and re-run the fixed-point time-bar sim
  // over the recorded chops. The client-claimed number is never trusted.
  const runResult = validateLogSplitterRun(logSplitterSeed, chops);
  const authoritativeScore = runResult.score;

  if (claimedScore !== authoritativeScore) {
    return rejectScore('log-splitter', {
      userId: identity.userId,
      userName: identityName,
      score: claimedScore,
      stage: 'server-replay',
      reason: `Authoritative score mismatch (server=${authoritativeScore}, client=${claimedScore}, inspected=${runResult.inspected}, stop=${runResult.stop}, chops=${chops.length}, session=${sessionDurationMs}ms)`,
    });
  }

  // Build a per-chop ActionEntry timeline for the generic anti-cheat pass.
  const chopActions: ActionEntry[] = runResult.chopTimes.map((t, i) => ({
    t: Math.max(0, Math.floor(t)),
    d: { chop: i },
  }));

  const [previousBest, gameCount] = await Promise.all([
    db
      .select({ score: logSplitterScores.score })
      .from(logSplitterScores)
      .where(eq(logSplitterScores.odUserId, identity.userId))
      .orderBy(desc(logSplitterScores.score))
      .limit(1)
      .then((rows) => rows[0]?.score ?? null),
    db
      .select({ count: count() })
      .from(logSplitterScores)
      .where(eq(logSplitterScores.odUserId, identity.userId))
      .then((rows) => rows[0]?.count ?? 0),
  ]);

  const antiCheat = await runAntiCheat({
    gameType: 'log-splitter',
    userId: identity.userId,
    userName: identityName,
    score: authoritativeScore,
    actions: chopActions,
    env: env ?? null,
    previousBest,
    sessionDurationMs,
    serverActionCount: sessionValidation.session?.actionCount,
    serverActionCounts: sessionValidation.session?.actionCounts,
    gameCount,
  });

  return runScoreRoutePipeline({
    antiCheat,
    identity,
    persist: async ({ now, userName }) => {
      // Atomically claim the session first: a losing duplicate submit throws a
      // 409 here and performs zero writes.
      await consumeGameSessionOrReject(sessionId, identity.userId);

      const existing = (
        await db
          .select({ score: logSplitterScores.score })
          .from(logSplitterScores)
          .where(eq(logSplitterScores.odUserId, identity.userId))
          .limit(1)
      )[0];

      await db
        .insert(logSplitterScores)
        .values({
          id: crypto.randomUUID(),
          odUserId: identity.userId,
          userName,
          score: authoritativeScore,
          createdAt: now,
        })
        .onConflictDoUpdate({
          target: logSplitterScores.odUserId,
          set: {
            userName,
            score: authoritativeScore,
            createdAt: now,
          },
          where: sql`excluded.score > ${logSplitterScores.score}`,
        });

      await recordScoreEvent({
        gameSlug: 'log-splitter',
        userId: identity.userId,
        userName,
        score: authoritativeScore,
      }).catch(() => {});

      const reward = await awardGameRunCredits({
        userId: identity.userId,
        context: { gameType: 'log-splitter', score: authoritativeScore },
        sourceId: `log-splitter:${sessionId}`,
        meta: {
          score: authoritativeScore,
          antiCheat: antiCheat.severity ?? 'pass',
        },
      });
      const achievements = await recordRunAchievements(
        identity.userId,
        { gameType: 'log-splitter', score: authoritativeScore },
        reward,
        { durationMs: sessionDurationMs },
      );

      await recordGameTimeMetric({
        userId: identity.userId,
        gameType: 'log-splitter',
        durationMs: Math.min(sessionDurationMs, MAX_SESSION_DURATION_MS),
        playedAtMs: now,
      });

      const leaderboard = await db
        .select()
        .from(logSplitterScores)
        .orderBy(desc(logSplitterScores.score))
        .limit(SCORE_RESPONSE_LEADERBOARD_LIMIT);

      broadcast('gameLeaderboards', {
        gameType: 'log-splitter',
        updatedAt: now,
      });

      return {
        success: true,
        isNewPB: !existing || authoritativeScore > existing.score,
        reward,
        achievements,
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
