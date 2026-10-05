import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { desc, eq, count, sql } from 'drizzle-orm';
import { db } from '@/server/db/client';
import { swerveScores } from '@/server/db/schema';
import { requireIdentity } from '@/server/auth';
import { broadcast } from '@/server/events';
import {
  consumeGameSessionOrReject,
  validateGameSession,
} from '@/server/arcade/game-session';
import {
  replaySwerveSession,
  LANE_COUNT,
  SWERVE_SCORE_CAP,
  type SwervePassEvent,
} from '@/server/arcade/swerve-replay';
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

type RawPass = { row?: unknown; lane?: unknown; t?: unknown };

type ScorePayload = {
  score?: number;
  sessionToken?: string;
  passes?: RawPass[];
  clientDurationMs?: number;
  env?: EnvFingerprint;
};

// Hard ceiling on accepted client score — mirrors the replay's cap. (No shared
// SWERVE_MAX_CLIENT_SCORE constant exists yet; the seed-derived cap is the
// authority and the route rejects anything above it before doing any work.)
const SWERVE_MAX_CLIENT_SCORE = SWERVE_SCORE_CAP;

// The chute has no fixed clock, but a run is still bounded: the longest honest
// session is the score cap × the slowest per-row interval. Give a generous
// ceiling so a marathon legit run is never rejected just for being long, while
// a clock-stretched / stalled-tab post is still bounded. (~10 min hard cap.)
const MAX_SESSION_DURATION_MS = 10 * 60 * 1000;

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
      .select({ score: swerveScores.score })
      .from(swerveScores)
      .where(eq(swerveScores.odUserId, identity.userId))
      .orderBy(desc(swerveScores.score))
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
  const authResult = await authenticateGamePlayer('swerve');
  if (isErrorResponse(authResult)) return authResult;
  const { identity, identityName } = authResult;

  const payload = await parsePayload<ScorePayload>(request);
  if (payload instanceof NextResponse) return payload;

  if (
    typeof payload?.score !== 'number' ||
    typeof payload?.sessionToken !== 'string' ||
    !Array.isArray(payload?.passes)
  ) {
    return NextResponse.json(
      { error: 'Invalid score data. Session token and passes required.' },
      { status: 400 },
    );
  }

  const { sessionToken, env } = payload;
  const claimedScore = Math.floor(payload.score);

  if (
    !Number.isFinite(claimedScore) ||
    claimedScore < 0 ||
    claimedScore > SWERVE_MAX_CLIENT_SCORE
  ) {
    return NextResponse.json({ error: 'Invalid score value.' }, { status: 400 });
  }

  // Reject obviously oversized payloads before doing any work. A legit run
  // records exactly one pass per safe row, so anything past the cap is junk.
  if (payload.passes.length > SWERVE_SCORE_CAP) {
    return rejectScore('swerve', {
      userId: identity.userId,
      userName: identityName,
      score: claimedScore,
      stage: 'payload',
      reason: `Pass payload too large (${payload.passes.length})`,
      publicMessage: 'Invalid score data.',
    });
  }

  // Normalize the submitted passes to the validator's shape. Malformed entries
  // are passed through as-is; replaySwerveSession drops anything non-conforming.
  const passes: SwervePassEvent[] = payload.passes.map((entry) => ({
    row: Number((entry as RawPass)?.row),
    lane: Number((entry as RawPass)?.lane),
    t: Number((entry as RawPass)?.t),
  }));

  // Validate the game session token + server clock.
  const sessionValidation = await validateGameSession(
    sessionToken,
    identity.userId,
    'swerve',
    claimedScore,
    undefined,
    { consumeSession: false },
  );

  if (!sessionValidation.valid) {
    return rejectScore('swerve', {
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
  const swerveSeed = sessionValidation.session?.swerveSeed;

  if (!sessionId) {
    return rejectScore('swerve', {
      userId: identity.userId,
      userName: identityName,
      score: claimedScore,
      stage: 'session',
      reason: 'Missing session id',
      publicMessage: 'Invalid game session.',
    });
  }

  if (typeof swerveSeed !== 'number') {
    return rejectScore('swerve', {
      userId: identity.userId,
      userName: identityName,
      score: claimedScore,
      stage: 'session',
      reason: 'Missing swerve seed for session',
      publicMessage: 'Invalid game session.',
    });
  }

  // Server-clock ceiling: a run cannot have lasted materially longer than the
  // bounded marathon window. A post far past it is rejected (clock-stretch /
  // stalled tab). The client clock is cosmetic — only this elapsed is trusted.
  if (sessionDurationMs > MAX_SESSION_DURATION_MS) {
    return rejectScore('swerve', {
      userId: identity.userId,
      userName: identityName,
      score: claimedScore,
      stage: 'session',
      reason: `Session duration exceeds window (${sessionDurationMs}ms)`,
      publicMessage: 'Invalid game session.',
    });
  }

  // === SERVER-AUTHORITATIVE SCORE ===
  // Re-derive the chute layout + speed ramp from the seed and count the safe
  // rows the recorded passes legitimately prove. The client-claimed number is
  // never trusted; it must equal this authoritative count.
  const runResult = replaySwerveSession(passes, sessionDurationMs, swerveSeed);

  if (runResult.rejected) {
    return rejectScore('swerve', {
      userId: identity.userId,
      userName: identityName,
      score: claimedScore,
      stage: 'server-replay',
      reason: runResult.reason ?? 'Implausible swerve run.',
    });
  }

  const authoritativeScore = runResult.score;

  if (claimedScore !== authoritativeScore) {
    return rejectScore('swerve', {
      userId: identity.userId,
      userName: identityName,
      score: claimedScore,
      stage: 'server-replay',
      reason: `Authoritative score mismatch (server=${authoritativeScore}, client=${claimedScore}, counted=${runResult.counted}, session=${sessionDurationMs}ms)`,
    });
  }

  // Build a per-pass ActionEntry timeline for the generic anti-cheat pass
  // (env/webdriver/time-ratio + score-jump anomaly). One action per recorded
  // safe row, `t` = ms since the first obstacle row appeared.
  const passActions: ActionEntry[] = passes
    .filter(
      (entry) =>
        Number.isInteger(entry.row) &&
        entry.row >= 1 &&
        Number.isInteger(entry.lane) &&
        entry.lane >= 0 &&
        entry.lane < LANE_COUNT &&
        Number.isFinite(entry.t) &&
        entry.t >= 0,
    )
    .map((entry) => ({
      t: Math.max(0, Math.floor(entry.t)),
      d: { row: entry.row, lane: entry.lane },
    }))
    .sort((a, b) => a.t - b.t);

  const [previousBest, gameCount] = await Promise.all([
    db
      .select({ score: swerveScores.score })
      .from(swerveScores)
      .where(eq(swerveScores.odUserId, identity.userId))
      .orderBy(desc(swerveScores.score))
      .limit(1)
      .then((rows) => rows[0]?.score ?? null),
    db
      .select({ count: count() })
      .from(swerveScores)
      .where(eq(swerveScores.odUserId, identity.userId))
      .then((rows) => rows[0]?.count ?? 0),
  ]);

  const antiCheat = await runAntiCheat({
    gameType: 'swerve',
    userId: identity.userId,
    userName: identityName,
    score: authoritativeScore,
    actions: passActions,
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
          .select({ score: swerveScores.score })
          .from(swerveScores)
          .where(eq(swerveScores.odUserId, identity.userId))
          .limit(1)
      )[0];

      await db
        .insert(swerveScores)
        .values({
          id: crypto.randomUUID(),
          odUserId: identity.userId,
          userName,
          score: authoritativeScore,
          createdAt: now,
        })
        .onConflictDoUpdate({
          target: swerveScores.odUserId,
          set: {
            userName,
            score: authoritativeScore,
            createdAt: now,
          },
          where: sql`excluded.score > ${swerveScores.score}`,
        });

      await recordScoreEvent({
        gameSlug: 'swerve',
        userId: identity.userId,
        userName,
        score: authoritativeScore,
      }).catch(() => {});

      const reward = await awardGameRunCredits({
        userId: identity.userId,
        context: { gameType: 'swerve', score: authoritativeScore },
        sourceId: `swerve:${sessionId}`,
        meta: {
          score: authoritativeScore,
          antiCheat: antiCheat.severity ?? 'pass',
        },
      });
      const achievements = await recordRunAchievements(
        identity.userId,
        { gameType: 'swerve', score: authoritativeScore },
        reward,
        { durationMs: sessionDurationMs },
      );

      await recordGameTimeMetric({
        userId: identity.userId,
        gameType: 'swerve',
        durationMs: Math.min(sessionDurationMs, MAX_SESSION_DURATION_MS),
        playedAtMs: now,
      });

      const leaderboard = await db
        .select()
        .from(swerveScores)
        .orderBy(desc(swerveScores.score))
        .limit(SCORE_RESPONSE_LEADERBOARD_LIMIT);

      broadcast('gameLeaderboards', {
        gameType: 'swerve',
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
