import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { desc, eq, count, sql } from 'drizzle-orm';
import { db } from '@/server/db/client';
import { sequenceScores } from '@/server/db/schema';
import { requireIdentity } from '@/server/auth';
import { broadcast } from '@/server/events';
import { consumeGameSessionOrReject, validateGameSession } from '@/server/arcade/game-session';
import { getGameEvents } from '@/server/arcade/game-events';
import {
  replaySequenceSession,
  type SequenceTapEvent,
} from '@/server/arcade/sequence-replay';
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
import { SCORE_RESPONSE_LEADERBOARD_LIMIT, SEQUENCE_MAX_CLIENT_SCORE } from '../../_shared/constants';

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
      .select({ score: sequenceScores.score })
      .from(sequenceScores)
      .where(eq(sequenceScores.odUserId, identity.userId))
      .orderBy(desc(sequenceScores.score))
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
  const authResult = await authenticateGamePlayer('sequence');
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

  if (!Number.isFinite(score) || score < 0 || score > SEQUENCE_MAX_CLIENT_SCORE) {
    return NextResponse.json(
      { error: 'Invalid score value.' },
      { status: 400 },
    );
  }

  // Validate game session token (keep the row so we can read events + seed).
  const sessionValidation = await validateGameSession(
    sessionToken,
    identity.userId,
    'sequence',
    score,
    undefined,
    { consumeSession: false },
  );

  if (!sessionValidation.valid) {
    return rejectScore('sequence', {
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
  const sequenceSeed = sessionValidation.session?.sequenceSeed;
  if (!sessionId || sequenceSeed === undefined) {
    return rejectScore('sequence', {
      userId: identity.userId,
      userName: identityName,
      score,
      stage: 'session',
      reason: 'Missing session id or sequence seed',
      publicMessage: 'Invalid game session.',
    });
  }

  // Read the recorded tap timeline back. Each row carries the player's pad
  // answer plus round/index and the client-relative timestamp.
  const parseTapEvent = (event: {
    ts: number;
    data?: unknown;
  }): { tap: SequenceTapEvent | null; serverTs: number; clientT: number | null; seq: number } => {
    const data = event.data as
      | { clientT?: unknown; seq?: unknown; round?: unknown; index?: unknown; pad?: unknown }
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
    const round =
      typeof data?.round === 'number' && Number.isInteger(data.round) && data.round >= 1
        ? data.round
        : null;
    const index =
      typeof data?.index === 'number' && Number.isInteger(data.index) && data.index >= 0
        ? data.index
        : null;
    const pad =
      typeof data?.pad === 'number' && Number.isInteger(data.pad) && data.pad >= 0 && data.pad < 4
        ? data.pad
        : null;
    const tap: SequenceTapEvent | null =
      round !== null && index !== null && pad !== null
        ? { t: clientT ?? event.ts, round, index, pad }
        : null;
    return { tap, serverTs: event.ts, clientT, seq };
  };

  const tapRows = (await getGameEvents(sessionId, 'tap'))
    .map(parseTapEvent)
    .sort((a, b) => a.serverTs - b.serverTs || a.seq - b.seq);

  const replayStartCandidates = tapRows
    .filter((row) => row.clientT !== null)
    .map((row) => row.serverTs - (row.clientT as number));
  const firstRecordedServerTs =
    tapRows.length > 0 ? tapRows[0]!.serverTs : null;
  const replayStartedAt =
    replayStartCandidates.length > 0
      ? Math.max(sessionStartedAt, Math.floor(Math.min(...replayStartCandidates)))
      : firstRecordedServerTs !== null
        ? Math.max(sessionStartedAt, firstRecordedServerTs - 250)
        : sessionStartedAt;

  // Build the authoritative tap list, preferring client-relative timing.
  const tapEvents: SequenceTapEvent[] = tapRows
    .filter((row): row is typeof row & { tap: SequenceTapEvent } => row.tap !== null)
    .map((row) => ({
      ...row.tap,
      t:
        row.clientT !== null
          ? Math.max(0, row.clientT)
          : Math.max(0, row.serverTs - replayStartedAt),
    }));

  // A non-trivial claimed score with no recorded taps is impossible.
  if (score >= 1 && tapEvents.length === 0) {
    return rejectScore('sequence', {
      userId: identity.userId,
      userName: identityName,
      score,
      stage: 'session',
      reason: 'No tap events recorded for a non-trivial run',
      publicMessage: 'Invalid game session.',
    });
  }

  const replay = replaySequenceSession(tapEvents, sequenceSeed);
  const authoritativeScore = replay.score;

  if (score !== authoritativeScore) {
    return rejectScore('sequence', {
      userId: identity.userId,
      userName: identityName,
      score,
      stage: 'server-replay',
      reason: `Authoritative score mismatch (server=${authoritativeScore}, client=${score}, taps=${tapEvents.length}, session=${sessionDurationMs}ms)`,
    });
  }

  const maxTapT =
    tapEvents.length > 0
      ? tapEvents.reduce((acc, tap) => Math.max(acc, tap.t), 0)
      : 0;
  const derivedDurationMs = Math.max(0, Date.now() - replayStartedAt);
  const replayDurationMs =
    clientDurationMs !== null
      ? Math.max(maxTapT, Math.min(sessionDurationMs, clientDurationMs))
      : Math.max(maxTapT, derivedDurationMs);

  // Each tap is one server action; the count is the total pads the player
  // entered across all rounds.
  const serverActions: ActionEntry[] = tapEvents
    .map((tap) => ({ t: tap.t, d: { type: 'tap' } }))
    .sort((a, b) => a.t - b.t);

  const [previousBest, gameCount] = await Promise.all([
    db
      .select({ score: sequenceScores.score })
      .from(sequenceScores)
      .where(eq(sequenceScores.odUserId, identity.userId))
      .orderBy(desc(sequenceScores.score))
      .limit(1)
      .then((rows) => rows[0]?.score ?? null),
    db
      .select({ count: count() })
      .from(sequenceScores)
      .where(eq(sequenceScores.odUserId, identity.userId))
      .then((rows) => rows[0]?.count ?? 0),
  ]);

  const antiCheat = await runAntiCheat({
    gameType: 'sequence',
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
      tap: tapEvents.length,
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
        .insert(sequenceScores)
        .values({
          id: crypto.randomUUID(),
          odUserId: identity.userId,
          userName,
          score: authoritativeScore,
          createdAt: now,
        })
        .onConflictDoUpdate({
          target: sequenceScores.odUserId,
          set: {
            userName,
            score: authoritativeScore,
            createdAt: now,
          },
          where: sql`excluded.score > ${sequenceScores.score}`,
        });
      await recordScoreEvent({
        gameSlug: 'sequence',
        userId: identity.userId,
        userName,
        score: authoritativeScore,
      }).catch(() => {});
      const reward = await awardGameRunCredits({
        userId: identity.userId,
        context: { gameType: 'sequence', score: authoritativeScore },
        sourceId: `sequence:${sessionId}`,
        meta: {
          score: authoritativeScore,
          antiCheat: antiCheat.severity ?? 'pass',
        },
      });
      const achievements = await recordRunAchievements(
        identity.userId,
        { gameType: 'sequence', score: authoritativeScore },
        reward,
        { durationMs: replayDurationMs },
      );
      await recordGameTimeMetric({
        userId: identity.userId,
        gameType: 'sequence',
        durationMs: replayDurationMs,
        playedAtMs: now,
      });

      const leaderboard = await db
        .select()
        .from(sequenceScores)
        .orderBy(desc(sequenceScores.score))
        .limit(SCORE_RESPONSE_LEADERBOARD_LIMIT);

      broadcast('gameLeaderboards', {
        gameType: 'sequence',
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
