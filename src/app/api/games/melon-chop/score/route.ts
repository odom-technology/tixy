import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { desc, eq, count, sql } from 'drizzle-orm';
import { db } from '@/server/db/client';
import { melonChopScores } from '@/server/db/schema';
import { requireIdentity } from '@/server/auth';
import { broadcast } from '@/server/events';
import {
  consumeGameSessionOrReject,
  validateGameSession,
} from '@/server/arcade/game-session';
import {
  validateMelonRun,
  melonScoreCeiling,
  MELON_ABS_MAX_SCORE,
  MELON_MAX_SWIPES,
  MELON_MAX_SWIPE_POINTS,
  type MelonSwipe,
  type MelonSwipePoint,
} from '@/server/arcade/melon-chop-replay';
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

type RawPoint = { x?: unknown; y?: unknown; t?: unknown };
type RawSwipe = { points?: RawPoint[] };

type ScorePayload = {
  score?: number;
  sessionToken?: string;
  swipes?: RawSwipe[];
  clientDurationMs?: number;
  env?: EnvFingerprint;
};

// The longest a single Melon Chop run can plausibly last on the server clock. A
// 60-second blitz is well inside this; a session posting far past it (a stalled
// tab, or a clock-stretch attempt) is rejected outright.
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
      .select({ score: melonChopScores.score })
      .from(melonChopScores)
      .where(eq(melonChopScores.odUserId, identity.userId))
      .orderBy(desc(melonChopScores.score))
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
  const authResult = await authenticateGamePlayer('melon-chop');
  if (isErrorResponse(authResult)) return authResult;
  const { identity, identityName } = authResult;

  const payload = await parsePayload<ScorePayload>(request);
  if (payload instanceof NextResponse) return payload;

  if (
    typeof payload?.score !== 'number' ||
    typeof payload?.sessionToken !== 'string' ||
    !Array.isArray(payload?.swipes)
  ) {
    return NextResponse.json(
      { error: 'Invalid score data. Session token and swipes required.' },
      { status: 400 },
    );
  }

  const { sessionToken, env } = payload;
  const claimedScore = Math.floor(payload.score);

  if (
    !Number.isFinite(claimedScore) ||
    claimedScore < 0 ||
    claimedScore > MELON_ABS_MAX_SCORE
  ) {
    return NextResponse.json({ error: 'Invalid score value.' }, { status: 400 });
  }

  // Reject obviously oversized payloads before doing any work.
  if (payload.swipes.length > MELON_MAX_SWIPES) {
    return rejectScore('melon-chop', {
      userId: identity.userId,
      userName: identityName,
      score: claimedScore,
      stage: 'payload',
      reason: `Swipe payload too large (${payload.swipes.length})`,
      publicMessage: 'Invalid score data.',
    });
  }

  // Normalize the submitted swipes to the validator's shape. We trust ONLY the
  // recorded polyline coords + times; validateMelonRun re-derives every fruit
  // position from the seed and recomputes all intersections.
  const swipes: MelonSwipe[] = payload.swipes.map((sw) => {
    const rawPoints = Array.isArray(sw?.points) ? sw.points : [];
    const points: MelonSwipePoint[] = rawPoints
      .slice(0, MELON_MAX_SWIPE_POINTS)
      .map((p) => ({
        x: Number((p as RawPoint)?.x),
        y: Number((p as RawPoint)?.y),
        t: Number((p as RawPoint)?.t),
      }));
    return { points };
  });

  // Validate the game session token + server clock.
  const sessionValidation = await validateGameSession(
    sessionToken,
    identity.userId,
    'melon-chop',
    claimedScore,
    undefined,
    { consumeSession: false },
  );

  if (!sessionValidation.valid) {
    return rejectScore('melon-chop', {
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
  const melonChopSeed = sessionValidation.session?.melonChopSeed;

  if (!sessionId) {
    return rejectScore('melon-chop', {
      userId: identity.userId,
      userName: identityName,
      score: claimedScore,
      stage: 'session',
      reason: 'Missing session id',
      publicMessage: 'Invalid game session.',
    });
  }

  if (typeof melonChopSeed !== 'number') {
    return rejectScore('melon-chop', {
      userId: identity.userId,
      userName: identityName,
      score: claimedScore,
      stage: 'session',
      reason: 'Missing melon-chop seed for session',
      publicMessage: 'Invalid game session.',
    });
  }

  // Server-clock ceiling: reject a run that posts implausibly long after it
  // began (stalled tab / clock-stretch). The client timeline is cosmetic — only
  // this server-measured elapsed gates the session.
  if (sessionDurationMs > MAX_SESSION_DURATION_MS) {
    return rejectScore('melon-chop', {
      userId: identity.userId,
      userName: identityName,
      score: claimedScore,
      stage: 'session',
      reason: `Session duration exceeds window (${sessionDurationMs}ms)`,
      publicMessage: 'Invalid game session.',
    });
  }

  // === SERVER-AUTHORITATIVE SCORE ===
  // Re-derive the ballistic fruit schedule from the seed and replay every
  // recorded swipe through the same intersection + scoring primitive the client
  // ran. The client-claimed number is never trusted; it must equal this.
  const runResult = validateMelonRun(melonChopSeed, swipes, sessionDurationMs);
  const authoritativeScore = runResult.score;

  if (claimedScore !== authoritativeScore) {
    return rejectScore('melon-chop', {
      userId: identity.userId,
      userName: identityName,
      score: claimedScore,
      stage: 'server-replay',
      reason: `Authoritative score mismatch (server=${authoritativeScore}, client=${claimedScore}, sliced=${runResult.sliced}, bestCombo=${runResult.bestCombo}, bomb=${runResult.bombHit}, stop=${runResult.stop}, swipes=${swipes.length}, ceiling=${melonScoreCeiling(melonChopSeed)}, session=${sessionDurationMs}ms)`,
    });
  }

  // Build a per-slice ActionEntry timeline for the generic anti-cheat pass
  // (env/webdriver/time-ratio + score-jump anomaly). The validator already
  // reconstructed the ms of every counted slice.
  const sliceActions: ActionEntry[] = runResult.sliceTimesMs.map((ms, i) => ({
    t: Math.max(0, Math.floor(ms)),
    d: { i },
  }));

  const [previousBest, gameCount] = await Promise.all([
    db
      .select({ score: melonChopScores.score })
      .from(melonChopScores)
      .where(eq(melonChopScores.odUserId, identity.userId))
      .orderBy(desc(melonChopScores.score))
      .limit(1)
      .then((rows) => rows[0]?.score ?? null),
    db
      .select({ count: count() })
      .from(melonChopScores)
      .where(eq(melonChopScores.odUserId, identity.userId))
      .then((rows) => rows[0]?.count ?? 0),
  ]);

  const antiCheat = await runAntiCheat({
    gameType: 'melon-chop',
    userId: identity.userId,
    userName: identityName,
    score: authoritativeScore,
    actions: sliceActions,
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
          .select({ score: melonChopScores.score })
          .from(melonChopScores)
          .where(eq(melonChopScores.odUserId, identity.userId))
          .limit(1)
      )[0];

      await db
        .insert(melonChopScores)
        .values({
          id: crypto.randomUUID(),
          odUserId: identity.userId,
          userName,
          score: authoritativeScore,
          createdAt: now,
        })
        .onConflictDoUpdate({
          target: melonChopScores.odUserId,
          set: {
            userName,
            score: authoritativeScore,
            createdAt: now,
          },
          where: sql`excluded.score > ${melonChopScores.score}`,
        });

      await recordScoreEvent({
        gameSlug: 'melon-chop',
        userId: identity.userId,
        userName,
        score: authoritativeScore,
      }).catch(() => {});

      const reward = await awardGameRunCredits({
        userId: identity.userId,
        context: { gameType: 'melon-chop', score: authoritativeScore },
        sourceId: `melon-chop:${sessionId}`,
        meta: {
          score: authoritativeScore,
          antiCheat: antiCheat.severity ?? 'pass',
        },
      });
      const achievements = await recordRunAchievements(
        identity.userId,
        { gameType: 'melon-chop', score: authoritativeScore },
        reward,
        { durationMs: sessionDurationMs },
      );

      await recordGameTimeMetric({
        userId: identity.userId,
        gameType: 'melon-chop',
        durationMs: Math.min(sessionDurationMs, MAX_SESSION_DURATION_MS),
        playedAtMs: now,
      });

      const leaderboard = await db
        .select()
        .from(melonChopScores)
        .orderBy(desc(melonChopScores.score))
        .limit(SCORE_RESPONSE_LEADERBOARD_LIMIT);

      broadcast('gameLeaderboards', {
        gameType: 'melon-chop',
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
