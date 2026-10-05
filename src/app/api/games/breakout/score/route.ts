import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { desc, eq, count, sql } from 'drizzle-orm';
import { db } from '@/server/db/client';
import { breakoutScores } from '@/server/db/schema';
import { requireIdentity } from '@/server/auth';
import { broadcast } from '@/server/events';
import { consumeGameSessionOrReject, validateGameSession } from '@/server/arcade/game-session';
import { getGameEvents } from '@/server/arcade/game-events';
import { replayBreakoutSession } from '@/server/arcade/breakout-replay';
import { awardGameRunCredits } from '@/server/arcade/rewards';
import { recordRunAchievements } from '../../_shared/run-achievements';
import { recordGameTimeMetric } from '@/server/arcade/game-time-metrics';
import { runAntiCheat, type ActionEntry } from '@/server/arcade/anti-cheat';
import {
  authenticateGamePlayer,
  isErrorResponse,
  parsePayload,
  rejectScore,
  type BaseScorePayload,
} from '../../_shared/score-helpers';
import { runScoreRoutePipeline } from '../../_shared/score-route-pipeline';
import { recordScoreEvent } from '@/server/arcade/score-events';
import {
  SCORE_RESPONSE_LEADERBOARD_LIMIT,
  BREAKOUT_MAX_CLIENT_SCORE,
} from '../../_shared/constants';

type ScorePayload = BaseScorePayload;

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
      .select({ score: breakoutScores.score })
      .from(breakoutScores)
      .where(eq(breakoutScores.odUserId, identity.userId))
      .orderBy(desc(breakoutScores.score))
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
  const authResult = await authenticateGamePlayer('breakout');
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

  if (
    !Number.isFinite(score) ||
    score < 0 ||
    score > BREAKOUT_MAX_CLIENT_SCORE
  ) {
    return NextResponse.json({ error: 'Invalid score value.' }, { status: 400 });
  }

  const sessionValidation = await validateGameSession(
    sessionToken,
    identity.userId,
    'breakout',
    score,
    undefined,
    { consumeSession: false },
  );

  if (!sessionValidation.valid) {
    return rejectScore('breakout', {
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
  const breakoutSeed = sessionValidation.session?.breakoutSeed;
  if (!sessionId || breakoutSeed === undefined) {
    return rejectScore('breakout', {
      userId: identity.userId,
      userName: identityName,
      score,
      stage: 'session',
      reason: 'Missing session id or breakout seed',
      publicMessage: 'Invalid game session.',
    });
  }

  const parseTimelineEvent = (event: {
    ts: number;
    data?: unknown;
  }): {
    serverTs: number;
    clientT: number | null;
    seq: number;
    points: number | null;
    level: number | null;
  } => {
    const data = event.data as
      | { clientT?: unknown; seq?: unknown; points?: unknown; level?: unknown }
      | undefined;
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
    const points =
      typeof data?.points === 'number' &&
      Number.isFinite(data.points) &&
      data.points > 0
        ? Math.floor(data.points)
        : null;
    const level =
      typeof data?.level === 'number' &&
      Number.isInteger(data.level) &&
      data.level >= 1
        ? data.level
        : null;
    return { serverTs: event.ts, clientT, seq, points, level };
  };

  const brickRows = (await getGameEvents(sessionId, 'brick'))
    .map(parseTimelineEvent)
    .sort((a, b) => a.serverTs - b.serverTs || a.seq - b.seq);
  const levelRows = (await getGameEvents(sessionId, 'level'))
    .map(parseTimelineEvent)
    .sort((a, b) => a.serverTs - b.serverTs || a.seq - b.seq);

  // Reconstruct the replay start preferring client-relative timing.
  const replayStartCandidates = [...brickRows, ...levelRows]
    .filter((event) => event.clientT !== null)
    .map((event) => event.serverTs - (event.clientT as number));
  const firstRecordedServerTs =
    brickRows.length > 0 || levelRows.length > 0
      ? Math.min(
          brickRows[0]?.serverTs ?? Number.POSITIVE_INFINITY,
          levelRows[0]?.serverTs ?? Number.POSITIVE_INFINITY,
        )
      : null;
  const replayStartedAt =
    replayStartCandidates.length > 0
      ? Math.max(sessionStartedAt, Math.floor(Math.min(...replayStartCandidates)))
      : firstRecordedServerTs !== null
        ? Math.max(sessionStartedAt, firstRecordedServerTs - 250)
        : sessionStartedAt;

  const relativeT = (event: { clientT: number | null; serverTs: number }) =>
    event.clientT !== null
      ? Math.max(0, event.clientT)
      : Math.max(0, event.serverTs - replayStartedAt);

  const brickEvents = brickRows
    .filter((event) => event.points !== null)
    .map((event) => ({ t: relativeT(event), points: event.points as number }));
  const levelEvents = levelRows
    .filter((event) => event.level !== null)
    .map((event) => ({ t: relativeT(event), level: event.level as number }));

  const maxBrickT =
    brickEvents.length > 0 ? brickEvents[brickEvents.length - 1]!.t : 0;
  const maxLevelT =
    levelEvents.length > 0 ? levelEvents[levelEvents.length - 1]!.t : 0;
  const maxEventT = Math.max(maxBrickT, maxLevelT);
  const derivedDurationMs = Math.max(0, Date.now() - replayStartedAt);
  const replayDurationMs =
    clientDurationMs !== null
      ? Math.max(maxEventT, Math.min(sessionDurationMs, clientDurationMs))
      : Math.max(maxEventT, derivedDurationMs);

  // A non-trivial run must have recorded brick events.
  if (score > 0 && brickEvents.length === 0) {
    return rejectScore('breakout', {
      userId: identity.userId,
      userName: identityName,
      score,
      stage: 'session',
      reason: 'No brick events recorded for a non-trivial run',
      publicMessage: 'Invalid game session.',
    });
  }

  const replay = replayBreakoutSession(
    brickEvents,
    levelEvents,
    replayDurationMs,
    breakoutSeed,
  );

  if (replay.rejected) {
    return rejectScore('breakout', {
      userId: identity.userId,
      userName: identityName,
      score,
      stage: 'server-replay',
      reason: `Replay implausible: ${replay.reason} (client=${score}, bricks=${brickEvents.length}, levels=${levelEvents.length}, maxEvent=${Math.round(maxEventT)}ms, session=${sessionDurationMs}ms, replay=${Math.round(replayDurationMs)}ms)`,
    });
  }

  // The replay returns the seed-derived MAXIMUM legitimate score for this event
  // log. Brick points are no longer summed from client-supplied per-event values
  // (a tampered client could inflate them by labeling every brick a top-row
  // value); we accept the client's claimed score only up to that ceiling — an
  // honest run's exact score is always <= it — and persist the claim itself.
  const maxLegitScore = replay.maxScore;
  if (score > maxLegitScore) {
    return rejectScore('breakout', {
      userId: identity.userId,
      userName: identityName,
      score,
      stage: 'server-replay',
      reason: `Score exceeds seed maximum (client=${score}, max=${maxLegitScore}, maxBrickPts=${replay.brickPoints}, bonus=${replay.bonusPoints}, bricks=${replay.bricksDestroyed}, levels=${replay.levelsReached}, maxEvent=${Math.round(maxEventT)}ms, session=${sessionDurationMs}ms, replay=${Math.round(replayDurationMs)}ms)`,
    });
  }
  const authoritativeScore = score;

  const serverActions: ActionEntry[] = [
    ...brickEvents.map((e) => ({ t: e.t, d: { type: 'brick', points: e.points } })),
    ...levelEvents.map((e) => ({ t: e.t, d: { type: 'level', level: e.level } })),
  ].sort((a, b) => a.t - b.t);

  const [previousBest, gameCount] = await Promise.all([
    db
      .select({ score: breakoutScores.score })
      .from(breakoutScores)
      .where(eq(breakoutScores.odUserId, identity.userId))
      .orderBy(desc(breakoutScores.score))
      .limit(1)
      .then((rows) => rows[0]?.score ?? null),
    db
      .select({ count: count() })
      .from(breakoutScores)
      .where(eq(breakoutScores.odUserId, identity.userId))
      .then((rows) => rows[0]?.count ?? 0),
  ]);

  const antiCheat = await runAntiCheat({
    gameType: 'breakout',
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
      brick: brickEvents.length,
      level: levelEvents.length,
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
        .insert(breakoutScores)
        .values({
          id: crypto.randomUUID(),
          odUserId: identity.userId,
          userName,
          score: authoritativeScore,
          createdAt: now,
        })
        .onConflictDoUpdate({
          target: breakoutScores.odUserId,
          set: {
            userName,
            score: authoritativeScore,
            createdAt: now,
          },
          where: sql`excluded.score > ${breakoutScores.score}`,
        });
      await recordScoreEvent({
        gameSlug: 'breakout',
        userId: identity.userId,
        userName,
        score: authoritativeScore,
      }).catch(() => {});
      const reward = await awardGameRunCredits({
        userId: identity.userId,
        context: { gameType: 'breakout', score: authoritativeScore },
        sourceId: `breakout:${sessionId}`,
        meta: {
          score: authoritativeScore,
          antiCheat: antiCheat.severity ?? 'pass',
        },
      });
      const achievements = await recordRunAchievements(
        identity.userId,
        { gameType: 'breakout', score: authoritativeScore },
        reward,
        { durationMs: replayDurationMs },
      );
      await recordGameTimeMetric({
        userId: identity.userId,
        gameType: 'breakout',
        durationMs: replayDurationMs,
        playedAtMs: now,
      });

      const leaderboard = await db
        .select()
        .from(breakoutScores)
        .orderBy(desc(breakoutScores.score))
        .limit(SCORE_RESPONSE_LEADERBOARD_LIMIT);

      broadcast('gameLeaderboards', {
        gameType: 'breakout',
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
