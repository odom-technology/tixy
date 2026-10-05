import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { desc, eq, count, sql } from 'drizzle-orm';
import { db } from '@/server/db/client';
import { skyClimberScores } from '@/server/db/schema';
import { requireIdentity } from '@/server/auth';
import { broadcast } from '@/server/events';
import {
  consumeGameSessionOrReject,
  validateGameSession,
} from '@/server/arcade/game-session';
import {
  replaySkySession,
  SKY_SCORE_CAP,
  type SkyLanding,
} from '@/server/arcade/sky-climber-replay';
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

type RawLanding = { row?: unknown; t?: unknown };

type ScorePayload = {
  score?: number;
  sessionToken?: string;
  landings?: RawLanding[];
  clientDurationMs?: number;
  env?: EnvFingerprint;
};

// Hard ceiling on accepted client score — mirrors the replay's cap. (No shared
// SKY_MAX_CLIENT_SCORE constant exists in _shared/constants.ts; the seed-derived
// cap is the authority and the route rejects anything above it before any work.)
const SKY_CLIMBER_MAX_CLIENT_SCORE = SKY_SCORE_CAP;

// The climb has no fixed clock but is still bounded: every recorded landing is a
// bounce, and a bounce takes at least the per-launch min airtime. Give a generous
// ceiling so a marathon legit run is never rejected for length while a clock-
// stretched / stalled-tab post is still bounded. (~20 min hard cap.)
const MAX_SESSION_DURATION_MS = 20 * 60 * 1000;

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
      .select({ score: skyClimberScores.score })
      .from(skyClimberScores)
      .where(eq(skyClimberScores.odUserId, identity.userId))
      .orderBy(desc(skyClimberScores.score))
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
  const authResult = await authenticateGamePlayer('sky-climber');
  if (isErrorResponse(authResult)) return authResult;
  const { identity, identityName } = authResult;

  const payload = await parsePayload<ScorePayload>(request);
  if (payload instanceof NextResponse) return payload;

  if (
    typeof payload?.score !== 'number' ||
    typeof payload?.sessionToken !== 'string' ||
    !Array.isArray(payload?.landings)
  ) {
    return NextResponse.json(
      { error: 'Invalid score data. Session token and landings required.' },
      { status: 400 },
    );
  }

  const { sessionToken, env } = payload;
  const claimedScore = Math.floor(payload.score);

  if (
    !Number.isFinite(claimedScore) ||
    claimedScore < 0 ||
    claimedScore > SKY_CLIMBER_MAX_CLIENT_SCORE
  ) {
    return NextResponse.json({ error: 'Invalid score value.' }, { status: 400 });
  }

  // Reject obviously oversized payloads before doing any work. A legit run
  // records one landing per bounce, so anything past the score cap is junk.
  if (payload.landings.length > SKY_SCORE_CAP) {
    return rejectScore('sky-climber', {
      userId: identity.userId,
      userName: identityName,
      score: claimedScore,
      stage: 'payload',
      reason: `Landing payload too large (${payload.landings.length})`,
      publicMessage: 'Invalid score data.',
    });
  }

  // Normalize the submitted landings to the validator's shape. Malformed entries
  // are passed through as-is; replaySkySession drops/rejects them.
  const landings: SkyLanding[] = payload.landings.map((entry) => ({
    row: Number((entry as RawLanding)?.row),
    t: Number((entry as RawLanding)?.t),
  }));

  // Validate the game session token + server clock.
  const sessionValidation = await validateGameSession(
    sessionToken,
    identity.userId,
    'sky-climber',
    claimedScore,
    undefined,
    { consumeSession: false },
  );

  if (!sessionValidation.valid) {
    return rejectScore('sky-climber', {
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
  const skySeed = sessionValidation.session?.skySeed;

  if (!sessionId) {
    return rejectScore('sky-climber', {
      userId: identity.userId,
      userName: identityName,
      score: claimedScore,
      stage: 'session',
      reason: 'Missing session id',
      publicMessage: 'Invalid game session.',
    });
  }

  if (typeof skySeed !== 'number') {
    return rejectScore('sky-climber', {
      userId: identity.userId,
      userName: identityName,
      score: claimedScore,
      stage: 'session',
      reason: 'Missing sky seed for session',
      publicMessage: 'Invalid game session.',
    });
  }

  // Server-clock ceiling: a run cannot have lasted materially longer than the
  // bounded marathon window. A post far past it is rejected (clock-stretch /
  // stalled tab). The client clock is cosmetic — only this elapsed is trusted.
  if (sessionDurationMs > MAX_SESSION_DURATION_MS) {
    return rejectScore('sky-climber', {
      userId: identity.userId,
      userName: identityName,
      score: claimedScore,
      stage: 'session',
      reason: `Session duration exceeds window (${sessionDurationMs}ms)`,
      publicMessage: 'Invalid game session.',
    });
  }

  // === SERVER-AUTHORITATIVE SCORE ===
  // Re-derive the platform tower from the seed and bound-check the recorded
  // landings (ascending rows, each step within the seeded reach, each spaced by
  // the bounce min-airtime, all inside the session window). The client-claimed
  // height is never trusted; it must equal the highest validated row.
  const runResult = replaySkySession(landings, sessionDurationMs, skySeed);

  if (runResult.rejected) {
    return rejectScore('sky-climber', {
      userId: identity.userId,
      userName: identityName,
      score: claimedScore,
      stage: 'server-replay',
      reason: runResult.reason ?? 'Implausible sky-climber run.',
    });
  }

  const authoritativeScore = runResult.score;

  if (claimedScore !== authoritativeScore) {
    return rejectScore('sky-climber', {
      userId: identity.userId,
      userName: identityName,
      score: claimedScore,
      stage: 'server-replay',
      reason: `Authoritative score mismatch (server=${authoritativeScore}, client=${claimedScore}, counted=${runResult.counted}, session=${sessionDurationMs}ms)`,
    });
  }

  // Build a per-landing ActionEntry timeline for the generic anti-cheat pass
  // (env/webdriver/time-ratio + score-jump anomaly). One action per recorded
  // landing, `t` = ms since the run began.
  const landingActions: ActionEntry[] = landings
    .filter(
      (entry) =>
        Number.isInteger(entry.row) &&
        entry.row >= 1 &&
        Number.isFinite(entry.t) &&
        entry.t >= 0,
    )
    .map((entry) => ({
      t: Math.max(0, Math.floor(entry.t)),
      d: { row: entry.row },
    }))
    .sort((a, b) => a.t - b.t);

  const [previousBest, gameCount] = await Promise.all([
    db
      .select({ score: skyClimberScores.score })
      .from(skyClimberScores)
      .where(eq(skyClimberScores.odUserId, identity.userId))
      .orderBy(desc(skyClimberScores.score))
      .limit(1)
      .then((rows) => rows[0]?.score ?? null),
    db
      .select({ count: count() })
      .from(skyClimberScores)
      .where(eq(skyClimberScores.odUserId, identity.userId))
      .then((rows) => rows[0]?.count ?? 0),
  ]);

  const antiCheat = await runAntiCheat({
    gameType: 'sky-climber',
    userId: identity.userId,
    userName: identityName,
    score: authoritativeScore,
    actions: landingActions,
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
          .select({ score: skyClimberScores.score })
          .from(skyClimberScores)
          .where(eq(skyClimberScores.odUserId, identity.userId))
          .limit(1)
      )[0];

      await db
        .insert(skyClimberScores)
        .values({
          id: crypto.randomUUID(),
          odUserId: identity.userId,
          userName,
          score: authoritativeScore,
          createdAt: now,
        })
        .onConflictDoUpdate({
          target: skyClimberScores.odUserId,
          set: {
            userName,
            score: authoritativeScore,
            createdAt: now,
          },
          where: sql`excluded.score > ${skyClimberScores.score}`,
        });

      await recordScoreEvent({
        gameSlug: 'sky-climber',
        userId: identity.userId,
        userName,
        score: authoritativeScore,
      }).catch(() => {});

      const reward = await awardGameRunCredits({
        userId: identity.userId,
        context: { gameType: 'sky-climber', score: authoritativeScore },
        sourceId: `sky-climber:${sessionId}`,
        meta: {
          score: authoritativeScore,
          antiCheat: antiCheat.severity ?? 'pass',
        },
      });
      const achievements = await recordRunAchievements(
        identity.userId,
        { gameType: 'sky-climber', score: authoritativeScore },
        reward,
        { durationMs: sessionDurationMs },
      );

      await recordGameTimeMetric({
        userId: identity.userId,
        gameType: 'sky-climber',
        durationMs: Math.min(sessionDurationMs, MAX_SESSION_DURATION_MS),
        playedAtMs: now,
      });

      const leaderboard = await db
        .select()
        .from(skyClimberScores)
        .orderBy(desc(skyClimberScores.score))
        .limit(SCORE_RESPONSE_LEADERBOARD_LIMIT);

      broadcast('gameLeaderboards', {
        gameType: 'sky-climber',
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
