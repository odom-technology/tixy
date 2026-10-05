import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { and, desc, eq, count, sql } from 'drizzle-orm';
import { db } from '@/server/db/client';
import { stackScores } from '@/server/db/schema';
import { requireIdentity } from '@/server/auth';
import { broadcast } from '@/server/events';
import { consumeGameSessionOrReject, validateGameSession } from '@/server/arcade/game-session';
import { getGameEvents } from '@/server/arcade/game-events';
import { STACK_RULES_VERSION, replayStackRun } from '@/server/arcade/stack-replay';
import { awardGameRunCredits } from '@/server/arcade/rewards';
import { recordRunAchievements } from '../../_shared/run-achievements';
import { recordGameTimeMetric } from '@/server/arcade/game-time-metrics';
import {
  runAntiCheat,
  type ActionEntry,
} from '@/server/arcade/anti-cheat';
import {
  authenticateGamePlayer,
  isErrorResponse,
  parsePayload,
  rejectScore,
  type BaseScorePayload,
} from '../../_shared/score-helpers';
import { runScoreRoutePipeline } from '../../_shared/score-route-pipeline';
import { recordScoreEvent } from '@/server/arcade/score-events';
import { SCORE_RESPONSE_LEADERBOARD_LIMIT, STACK_MAX_CLIENT_SCORE } from '../../_shared/constants';

type ScorePayload = BaseScorePayload & { rules?: unknown };

/** A player's row under the current rules. Last season's row (rules 1) is
 *  never read or written here. */
const currentRulesOf = (userId: string) =>
  and(eq(stackScores.odUserId, userId), eq(stackScores.rules, STACK_RULES_VERSION));

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
    // The strip and the board read the current rules (2). Last season's best
    // (rules 1) stays readable and is returned on its own.
    const rows = await db
      .select({ rules: stackScores.rules, score: stackScores.score })
      .from(stackScores)
      .where(eq(stackScores.odUserId, identity.userId));
    const current = rows.find((row: { rules: number }) => row.rules === STACK_RULES_VERSION);
    const lastSeason = rows.find((row: { rules: number }) => row.rules === 1);

    return NextResponse.json({
      bestScore: current?.score ?? 0,
      lastSeasonBest: lastSeason?.score ?? null,
    });
  } catch (error) {
    console.error('Failed to fetch user best score:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const authResult = await authenticateGamePlayer('stack');
  if (isErrorResponse(authResult)) return authResult;
  const { identity, identityName } = authResult;

  const payload = await parsePayload<ScorePayload>(request);
  if (payload instanceof NextResponse) return payload;

  if (
    typeof payload?.score !== 'number' ||
    typeof payload?.sessionToken !== 'string'
  ) {
    return NextResponse.json(
      { error: 'Invalid score data. Session token required.' },
      { status: 400 },
    );
  }

  const { sessionToken, env } = payload;
  const score = Math.floor(payload.score);
  const clientDurationMs =
    typeof payload.clientDurationMs === 'number' &&
    Number.isFinite(payload.clientDurationMs) &&
    payload.clientDurationMs >= 0
      ? payload.clientDurationMs
      : null;

  if (!Number.isFinite(score) || score < 0 || score > STACK_MAX_CLIENT_SCORE) {
    return NextResponse.json(
      { error: 'Invalid score value.' },
      { status: 400 },
    );
  }

  // A page from before rules 2 played different rules; its drops would
  // replay to a different height. Ask for a reload instead of a mismatch.
  if (payload.rules !== STACK_RULES_VERSION) {
    return NextResponse.json(
      { error: 'Stacker has new rules. Reload the page to play them.' },
      { status: 409 },
    );
  }

  // Validate game session token
  const sessionValidation = await validateGameSession(
    sessionToken,
    identity.userId,
    'stack',
    score,
    undefined,
    { consumeSession: false },
  );

  if (!sessionValidation.valid) {
    return rejectScore('stack', {
      userId: identity.userId,
      userName: identityName,
      score,
      stage: 'session',
      reason: sessionValidation.error ?? 'Invalid game session.',
      publicMessage: 'Invalid game session.',
    });
  }

  const sessionId = sessionValidation.session?.sessionId;
  const sessionStartedAt = sessionValidation.session?.startedAt ?? Date.now();
  const sessionDurationMs = sessionValidation.session?.durationMs ?? 0;
  if (!sessionId) {
    return rejectScore('stack', {
      userId: identity.userId,
      userName: identityName,
      score,
      stage: 'session',
      reason: 'Missing session id',
      publicMessage: 'Invalid game session.',
    });
  }

  const parseTimelineEvent = (event: {
    ts: number;
    data?: unknown;
  }): { serverTs: number; clientT: number | null; seq: number } => {
    const data = event.data as { clientT?: unknown; seq?: unknown } | undefined;
    const clientT =
      typeof data?.clientT === 'number' &&
      Number.isFinite(data.clientT) &&
      data.clientT >= 0
        ? data.clientT
        : null;
    const seq =
      typeof data?.seq === 'number' &&
      Number.isInteger(data.seq) &&
      Number.isFinite(data.seq) &&
      data.seq >= 0
        ? data.seq
        : Number.MAX_SAFE_INTEGER;
    return {
      serverTs: event.ts,
      clientT,
      seq,
    };
  };

  const dropEvents = (await getGameEvents(sessionId, 'drop'))
    .map(parseTimelineEvent)
    .sort((a, b) => a.serverTs - b.serverTs || a.seq - b.seq);
  const replayStartCandidates = dropEvents
    .filter((event) => event.clientT !== null)
    .map((event) => event.serverTs - (event.clientT as number));
  const firstRecordedServerTs =
    dropEvents.length > 0 ? dropEvents[0]!.serverTs : null;
  // Prefer client-relative timings from WS event payloads so replay stays
  // aligned even if WS delivery is delayed.
  const replayStartedAt =
    replayStartCandidates.length > 0
      ? Math.max(sessionStartedAt, Math.floor(Math.min(...replayStartCandidates)))
      : firstRecordedServerTs !== null
        ? Math.max(sessionStartedAt, firstRecordedServerTs - 250)
        : sessionStartedAt;
  const dropActions: ActionEntry[] = dropEvents.map((event) => ({
    t:
      event.clientT !== null
        ? Math.max(0, event.clientT)
        : Math.max(0, event.serverTs - replayStartedAt),
    d: { type: 'drop' },
  }));
  const maxDropT =
    dropActions.length > 0 ? dropActions[dropActions.length - 1]!.t : 0;
  const derivedDurationMs = Math.max(0, Date.now() - replayStartedAt);
  // The run can end on a missed drop; give the sim a frame of slack past the
  // last recorded drop so that final drop is always resolved.
  const replayDurationMs =
    clientDurationMs !== null
      ? Math.max(
          maxDropT + 100,
          Math.min(sessionDurationMs, clientDurationMs),
        )
      : Math.max(maxDropT + 100, derivedDurationMs);

  // A non-trivial run must have recorded drop events; height N requires at
  // least N successful drops.
  if (score >= 1 && dropActions.length === 0) {
    return rejectScore('stack', {
      userId: identity.userId,
      userName: identityName,
      score,
      stage: 'session',
      reason: 'No drop events recorded for a non-trivial run',
      publicMessage: 'Invalid game session.',
    });
  }

  // Authoritative height is computed entirely server-side: the replay samples
  // each drop's block position from the deterministic sweep, slices the
  // overhang, and counts successful placements (a miss ends the run).
  // Rules 2: each drop is scored at its own time (whole ms since the run
  // began), with the same function the client drew and scored it with.
  const replay = replayStackRun(
    dropActions.map((action) => action.t),
    replayDurationMs,
  );
  const replayScore = replay.score;
  const authoritativeScore = replayScore;
  if (score !== authoritativeScore) {
    return rejectScore('stack', {
      userId: identity.userId,
      userName: identityName,
      score,
      stage: 'server-replay',
      reason: `Authoritative score mismatch (server=${authoritativeScore}, client=${score}, drops=${dropActions.length}, maxDrop=${Math.round(maxDropT)}ms, session=${sessionDurationMs}ms, replay=${Math.round(replayDurationMs)}ms, died=${replay.died}, authority=replay)`,
    });
  }

  const serverActions: ActionEntry[] = [...dropActions].sort(
    (a, b) => a.t - b.t,
  );

  // Anti-cheat validation
  const [previousBest, gameCount] = await Promise.all([
    db
      .select({ score: stackScores.score })
      .from(stackScores)
      .where(currentRulesOf(identity.userId))
      .orderBy(desc(stackScores.score))
      .limit(1)
      .then((rows) => rows[0]?.score ?? null),
    db
      .select({ count: count() })
      .from(stackScores)
      .where(currentRulesOf(identity.userId))
      .then((rows) => rows[0]?.count ?? 0),
  ]);

  const antiCheat = await runAntiCheat({
    gameType: 'stack',
    userId: identity.userId,
    userName: identityName,
    score: authoritativeScore,
    actions: serverActions,
    env: env ?? null,
    previousBest,
    sessionDurationMs: replayDurationMs,
    serverActionCount: sessionValidation.session?.actionCount,
    serverActionCounts: {
      ...(sessionValidation.session?.actionCounts ?? {}),
      drop: dropActions.length,
    },
    gameCount,
  });

  return runScoreRoutePipeline({
    antiCheat,
    identity,
    persist: async ({ now, userName }) => {
      // Atomically claim the session first: a losing duplicate submit throws a
      // 409 here and performs zero writes.
      await consumeGameSessionOrReject(sessionId, identity.userId);
      await db
        .insert(stackScores)
        .values({
          id: crypto.randomUUID(),
          odUserId: identity.userId,
          userName,
          score: authoritativeScore,
          createdAt: now,
          rules: STACK_RULES_VERSION,
        })
        .onConflictDoUpdate({
          target: [stackScores.odUserId, stackScores.rules],
          set: {
            userName,
            score: authoritativeScore,
            createdAt: now,
          },
          where: sql`excluded.score > ${stackScores.score}`,
        });
      await recordScoreEvent({
        gameSlug: 'stack',
        userId: identity.userId,
        userName,
        score: authoritativeScore,
        // The windowed boards read events of the current rules only.
        mode: STACK_RULES_VERSION,
      }).catch(() => {});
      const reward = await awardGameRunCredits({
        userId: identity.userId,
        context: { gameType: 'stack', score: authoritativeScore },
        sourceId: `stack:${sessionId}`,
        meta: {
          score: authoritativeScore,
          antiCheat: antiCheat.severity ?? 'pass',
        },
      });
      const achievements = await recordRunAchievements(
        identity.userId,
        { gameType: 'stack', score: authoritativeScore },
        reward,
        { durationMs: replayDurationMs },
      );
      await recordGameTimeMetric({
        userId: identity.userId,
        gameType: 'stack',
        durationMs: replayDurationMs,
        playedAtMs: now,
      });

      const leaderboard = await db
        .select()
        .from(stackScores)
        .where(eq(stackScores.rules, STACK_RULES_VERSION))
        .orderBy(desc(stackScores.score))
        .limit(SCORE_RESPONSE_LEADERBOARD_LIMIT);

      broadcast('gameLeaderboards', {
        gameType: 'stack',
        updatedAt: now,
      });

      return {
        success: true,
        reward,
        achievements,
        leaderboard: leaderboard.map((entry) => ({
          id: entry.id,
          userName: entry.userName,
          score: entry.score,
        })),
      };
    },
  });
}
