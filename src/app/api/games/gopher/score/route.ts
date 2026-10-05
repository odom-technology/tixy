import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { desc, eq, count, sql } from 'drizzle-orm';
import { db } from '@/server/db/client';
import { gopherScores } from '@/server/db/schema';
import { requireIdentity } from '@/server/auth';
import { broadcast } from '@/server/events';
import {
  consumeGameSessionOrReject,
  validateGameSession,
} from '@/server/arcade/game-session';
import {
  validateGopherRun,
  GOPHER_SPRINT_DURATION_SEC,
  GOPHER_MAX_BONKS,
  GOPHER_HOLE_COUNT,
  type GopherBonk,
} from '@/server/arcade/gopher-replay';
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
  GOPHER_MAX_CLIENT_SCORE,
} from '../../_shared/constants';

type RawBonk = { hole?: unknown; t?: unknown };

type ScorePayload = {
  score?: number;
  sessionToken?: string;
  bonks?: RawBonk[];
  clientDurationMs?: number;
  env?: EnvFingerprint;
};

// The whole sprint runs on the server clock. Reject any session whose
// server-measured elapsed exceeds the sprint + grace (a stalled tab that posts
// late, or a clock-stretch attempt). 60s window + 5s network/persist grace.
const MAX_SESSION_DURATION_MS = GOPHER_SPRINT_DURATION_SEC * 1000 + 5_000;

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
      .select({ score: gopherScores.score })
      .from(gopherScores)
      .where(eq(gopherScores.odUserId, identity.userId))
      .orderBy(desc(gopherScores.score))
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
  const authResult = await authenticateGamePlayer('gopher');
  if (isErrorResponse(authResult)) return authResult;
  const { identity, identityName } = authResult;

  const payload = await parsePayload<ScorePayload>(request);
  if (payload instanceof NextResponse) return payload;

  if (
    typeof payload?.score !== 'number' ||
    typeof payload?.sessionToken !== 'string' ||
    !Array.isArray(payload?.bonks)
  ) {
    return NextResponse.json(
      { error: 'Invalid score data. Session token and bonks required.' },
      { status: 400 },
    );
  }

  const { sessionToken, env } = payload;
  const claimedScore = Math.floor(payload.score);

  if (
    !Number.isFinite(claimedScore) ||
    claimedScore < 0 ||
    claimedScore > GOPHER_MAX_CLIENT_SCORE
  ) {
    return NextResponse.json({ error: 'Invalid score value.' }, { status: 400 });
  }

  // Reject obviously oversized payloads before doing any work.
  if (payload.bonks.length > GOPHER_MAX_BONKS * 3) {
    return rejectScore('gopher', {
      userId: identity.userId,
      userName: identityName,
      score: claimedScore,
      stage: 'payload',
      reason: `Bonk payload too large (${payload.bonks.length})`,
      publicMessage: 'Invalid score data.',
    });
  }

  // Normalize the submitted bonks to the validator's shape. Malformed entries
  // are passed through as-is; validateGopherRun drops anything non-conforming.
  const bonks: GopherBonk[] = payload.bonks.map((entry) => ({
    hole: Number((entry as RawBonk)?.hole),
    t: Number((entry as RawBonk)?.t),
  }));

  // Validate the game session token + server clock.
  const sessionValidation = await validateGameSession(
    sessionToken,
    identity.userId,
    'gopher',
    claimedScore,
    undefined,
    { consumeSession: false },
  );

  if (!sessionValidation.valid) {
    return rejectScore('gopher', {
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
  const gopherSeed = sessionValidation.session?.gopherSeed;

  if (!sessionId) {
    return rejectScore('gopher', {
      userId: identity.userId,
      userName: identityName,
      score: claimedScore,
      stage: 'session',
      reason: 'Missing session id',
      publicMessage: 'Invalid game session.',
    });
  }

  if (typeof gopherSeed !== 'number') {
    return rejectScore('gopher', {
      userId: identity.userId,
      userName: identityName,
      score: claimedScore,
      stage: 'session',
      reason: 'Missing gopher seed for session',
      publicMessage: 'Invalid game session.',
    });
  }

  // Server-clock ceiling: the sprint cannot have lasted materially longer than
  // 60s. A run that posts far past the window is rejected outright (the client
  // countdown is cosmetic — only this server-measured elapsed is trusted).
  if (sessionDurationMs > MAX_SESSION_DURATION_MS) {
    return rejectScore('gopher', {
      userId: identity.userId,
      userName: identityName,
      score: claimedScore,
      stage: 'session',
      reason: `Session duration exceeds sprint window (${sessionDurationMs}ms)`,
      publicMessage: 'Invalid game session.',
    });
  }

  // === SERVER-AUTHORITATIVE SCORE ===
  // Re-derive the entire pop schedule from the seed and count validated gopher
  // bonks inside the 60s window + cadence floor (a bomb hit stops counting). The
  // client-claimed number is never trusted; it must equal this authoritative
  // count.
  const runResult = validateGopherRun(gopherSeed, bonks, sessionDurationMs);
  const authoritativeScore = runResult.score;

  if (claimedScore !== authoritativeScore) {
    return rejectScore('gopher', {
      userId: identity.userId,
      userName: identityName,
      score: claimedScore,
      stage: 'server-replay',
      reason: `Authoritative score mismatch (server=${authoritativeScore}, client=${claimedScore}, counted=${runResult.counted}, dropped=${runResult.dropped}, bomb=${runResult.bombHit}, session=${sessionDurationMs}ms)`,
    });
  }

  // Build per-bonk ActionEntry timeline for the generic anti-cheat pass
  // (env/webdriver/time-ratio + score-jump anomaly). One action per submitted
  // bonk, `t` = ms since sprint start.
  const bonkActions: ActionEntry[] = bonks
    .filter(
      (entry) =>
        Number.isInteger(entry.hole) &&
        entry.hole >= 0 &&
        entry.hole < GOPHER_HOLE_COUNT &&
        Number.isFinite(entry.t) &&
        entry.t >= 0,
    )
    .map((entry) => ({
      t: Math.max(0, Math.floor(entry.t)),
      d: { hole: entry.hole },
    }))
    .sort((a, b) => a.t - b.t);

  const gameCount = await db
    .select({ count: count() })
    .from(gopherScores)
    .where(eq(gopherScores.odUserId, identity.userId))
    .then((rows) => rows[0]?.count ?? 0);

  const antiCheat = await runAntiCheat({
    gameType: 'gopher',
    userId: identity.userId,
    userName: identityName,
    score: authoritativeScore,
    actions: bonkActions,
    env: env ?? null,
    // Score-jump anomaly is intentionally disabled for gopher: the score is
    // fully recomputed by the deterministic server replay above (a mismatch is
    // already a hard reject), and the 2026-07 combo-scoring rescale (bonk count
    // → points) makes every legacy best a false 10x+ "jump".
    previousBest: null,
    sessionDurationMs,
    serverActionCount: sessionValidation.session?.actionCount,
    serverActionCounts: sessionValidation.session?.actionCounts,
    modeDurationSec: GOPHER_SPRINT_DURATION_SEC,
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
          .select({ score: gopherScores.score })
          .from(gopherScores)
          .where(eq(gopherScores.odUserId, identity.userId))
          .limit(1)
      )[0];

      await db
        .insert(gopherScores)
        .values({
          id: crypto.randomUUID(),
          odUserId: identity.userId,
          userName,
          score: authoritativeScore,
          createdAt: now,
        })
        .onConflictDoUpdate({
          target: gopherScores.odUserId,
          set: {
            userName,
            score: authoritativeScore,
            createdAt: now,
          },
          where: sql`excluded.score > ${gopherScores.score}`,
        });

      await recordScoreEvent({
        gameSlug: 'gopher',
        userId: identity.userId,
        userName,
        score: authoritativeScore,
      }).catch(() => {});

      const reward = await awardGameRunCredits({
        userId: identity.userId,
        context: { gameType: 'gopher', score: authoritativeScore },
        sourceId: `gopher:${sessionId}`,
        meta: {
          score: authoritativeScore,
          antiCheat: antiCheat.severity ?? 'pass',
        },
      });
      const achievements = await recordRunAchievements(
        identity.userId,
        { gameType: 'gopher', score: authoritativeScore },
        reward,
        { durationMs: sessionDurationMs },
      );

      await recordGameTimeMetric({
        userId: identity.userId,
        gameType: 'gopher',
        durationMs: Math.min(sessionDurationMs, MAX_SESSION_DURATION_MS),
        playedAtMs: now,
      });

      const leaderboard = await db
        .select()
        .from(gopherScores)
        .orderBy(desc(gopherScores.score))
        .limit(SCORE_RESPONSE_LEADERBOARD_LIMIT);

      broadcast('gameLeaderboards', {
        gameType: 'gopher',
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
