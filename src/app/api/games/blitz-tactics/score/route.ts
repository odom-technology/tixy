import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { desc, eq, count, sql } from 'drizzle-orm';
import { db } from '@/server/db/client';
import { blitzTacticsScores } from '@/server/db/schema';
import { requireIdentity } from '@/server/auth';
import { broadcast } from '@/server/events';
import {
  consumeGameSessionOrReject,
  validateGameSession,
} from '@/server/arcade/game-session';
import {
  validateBlitzRun,
  BLITZ_DURATION_SEC,
  BLITZ_LADDER_LENGTH,
  BLITZ_MAX_MOVES_PER_PUZZLE,
  type BlitzEvent,
} from '@/server/arcade/blitz-tactics-replay';
import { awardGameRunCredits } from '@/server/arcade/rewards';
import { recordRunAchievements } from '../../_shared/run-achievements';
import { recordGameTimeMetric } from '@/server/arcade/game-time-metrics';
import { recordScoreEvent } from '@/server/arcade/score-events';
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
import {
  SCORE_RESPONSE_LEADERBOARD_LIMIT,
  BLITZ_TACTICS_MAX_CLIENT_SCORE,
} from '../../_shared/constants';

type RawEvent = { i?: unknown; m?: unknown; t?: unknown };

type ScorePayload = {
  score?: number;
  sessionToken?: string;
  events?: RawEvent[];
  clientDurationMs?: number;
  env?: EnvFingerprint;
};

// The whole run is bounded by the SERVER clock. Reject any session whose
// server-measured elapsed exceeds the 5-minute rush + grace (a stalled tab that
// posts late, or a clock-stretch attempt). 300s window + 8s network/persist grace.
const MAX_SESSION_DURATION_MS = BLITZ_DURATION_SEC * 1000 + 8_000;

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
      .select({ score: blitzTacticsScores.score })
      .from(blitzTacticsScores)
      .where(eq(blitzTacticsScores.odUserId, identity.userId))
      .orderBy(desc(blitzTacticsScores.score))
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
  const authResult = await authenticateGamePlayer('blitz-tactics');
  if (isErrorResponse(authResult)) return authResult;
  const { identity, identityName } = authResult;

  const payload = await parsePayload<ScorePayload>(request);
  if (payload instanceof NextResponse) return payload;

  if (
    typeof payload?.score !== 'number' ||
    typeof payload?.sessionToken !== 'string' ||
    !Array.isArray(payload?.events)
  ) {
    return NextResponse.json(
      { error: 'Invalid score data. Session token and events required.' },
      { status: 400 },
    );
  }

  const { sessionToken, env } = payload;
  const claimedScore = Math.floor(payload.score);

  if (
    !Number.isFinite(claimedScore) ||
    claimedScore < 0 ||
    claimedScore > BLITZ_TACTICS_MAX_CLIENT_SCORE
  ) {
    return NextResponse.json({ error: 'Invalid score value.' }, { status: 400 });
  }

  // Reject obviously oversized payloads before doing any work.
  if (payload.events.length > BLITZ_LADDER_LENGTH + 8) {
    return rejectScore('blitz-tactics', {
      userId: identity.userId,
      userName: identityName,
      score: claimedScore,
      stage: 'payload',
      reason: `Event payload too large (${payload.events.length})`,
      publicMessage: 'Invalid score data.',
    });
  }

  // Normalize submitted events to the validator's shape. Malformed entries are
  // passed through as-is; validateBlitzRun drops/rejects anything non-conforming.
  const events: BlitzEvent[] = payload.events.map((entry) => ({
    i: Number((entry as RawEvent)?.i),
    m: Array.isArray((entry as RawEvent)?.m)
      ? ((entry as RawEvent).m as unknown[])
          .slice(0, BLITZ_MAX_MOVES_PER_PUZZLE)
          .map((v) => String(v))
      : [],
    t: Number((entry as RawEvent)?.t),
  }));

  // Validate the game session token + server clock.
  const sessionValidation = await validateGameSession(
    sessionToken,
    identity.userId,
    'blitz-tactics',
    claimedScore,
    undefined,
    { consumeSession: false },
  );

  if (!sessionValidation.valid) {
    return rejectScore('blitz-tactics', {
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
  const blitzSeed = sessionValidation.session?.blitzTacticsSeed;

  if (!sessionId) {
    return rejectScore('blitz-tactics', {
      userId: identity.userId,
      userName: identityName,
      score: claimedScore,
      stage: 'session',
      reason: 'Missing session id',
      publicMessage: 'Invalid game session.',
    });
  }

  if (typeof blitzSeed !== 'number') {
    return rejectScore('blitz-tactics', {
      userId: identity.userId,
      userName: identityName,
      score: claimedScore,
      stage: 'session',
      reason: 'Missing blitz-tactics seed for session',
      publicMessage: 'Invalid game session.',
    });
  }

  // Server-clock ceiling: the rush cannot have lasted materially longer than
  // 5 minutes. A run that posts far past the window is rejected outright (the
  // client countdown is cosmetic — only this server-measured elapsed is trusted).
  if (sessionDurationMs > MAX_SESSION_DURATION_MS) {
    return rejectScore('blitz-tactics', {
      userId: identity.userId,
      userName: identityName,
      score: claimedScore,
      stage: 'session',
      reason: `Session duration exceeds rush window (${sessionDurationMs}ms)`,
      publicMessage: 'Invalid game session.',
    });
  }

  // === SERVER-AUTHORITATIVE SCORE ===
  // Re-derive the seeded ladder and recompute solved puzzles from the recorded
  // moves (each solve re-verified against the machine-verified bank, bounded by
  // the 3-strike rule + the per-solve cadence floor + the server clock). The
  // client-claimed number is never trusted; it must equal this authoritative count.
  const runResult = validateBlitzRun(blitzSeed, events, sessionDurationMs);
  const authoritativeScore = runResult.solved;

  if (runResult.rejected) {
    return rejectScore('blitz-tactics', {
      userId: identity.userId,
      userName: identityName,
      score: claimedScore,
      stage: 'server-replay',
      reason: `Run rejected: ${runResult.reason ?? 'implausible event log'} (session=${sessionDurationMs}ms)`,
    });
  }

  if (claimedScore !== authoritativeScore) {
    return rejectScore('blitz-tactics', {
      userId: identity.userId,
      userName: identityName,
      score: claimedScore,
      stage: 'server-replay',
      reason: `Authoritative score mismatch (server=${authoritativeScore}, client=${claimedScore}, strikes=${runResult.strikes}, counted=${runResult.counted}, session=${sessionDurationMs}ms)`,
    });
  }

  // Build a per-event ActionEntry timeline for the generic anti-cheat pass
  // (env/webdriver/time-ratio + score-jump anomaly). One action per attempt,
  // `t` = ms since run start.
  const eventActions: ActionEntry[] = events
    .filter((e) => Number.isInteger(e.i) && e.i >= 0 && Number.isFinite(e.t) && e.t >= 0)
    .map((e) => ({ t: Math.max(0, Math.floor(e.t)), d: { i: e.i } }))
    .sort((a, b) => a.t - b.t);

  const [previousBest, gameCount] = await Promise.all([
    db
      .select({ score: blitzTacticsScores.score })
      .from(blitzTacticsScores)
      .where(eq(blitzTacticsScores.odUserId, identity.userId))
      .orderBy(desc(blitzTacticsScores.score))
      .limit(1)
      .then((rows) => rows[0]?.score ?? null),
    db
      .select({ count: count() })
      .from(blitzTacticsScores)
      .where(eq(blitzTacticsScores.odUserId, identity.userId))
      .then((rows) => rows[0]?.count ?? 0),
  ]);

  const antiCheat = await runAntiCheat({
    gameType: 'blitz-tactics',
    userId: identity.userId,
    userName: identityName,
    score: authoritativeScore,
    actions: eventActions,
    env: env ?? null,
    previousBest,
    sessionDurationMs,
    serverActionCount: sessionValidation.session?.actionCount,
    serverActionCounts: sessionValidation.session?.actionCounts,
    modeDurationSec: BLITZ_DURATION_SEC,
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
          .select({ score: blitzTacticsScores.score })
          .from(blitzTacticsScores)
          .where(eq(blitzTacticsScores.odUserId, identity.userId))
          .limit(1)
      )[0];

      await db
        .insert(blitzTacticsScores)
        .values({
          id: crypto.randomUUID(),
          odUserId: identity.userId,
          userName,
          score: authoritativeScore,
          createdAt: now,
        })
        .onConflictDoUpdate({
          target: blitzTacticsScores.odUserId,
          set: {
            userName,
            score: authoritativeScore,
            createdAt: now,
          },
          where: sql`excluded.score > ${blitzTacticsScores.score}`,
        });

      await recordScoreEvent({
        gameSlug: 'blitz-tactics',
        userId: identity.userId,
        userName,
        score: authoritativeScore,
      }).catch(() => {});

      const reward = await awardGameRunCredits({
        userId: identity.userId,
        context: { gameType: 'blitz-tactics', score: authoritativeScore },
        sourceId: `blitz-tactics:${sessionId}`,
        meta: {
          score: authoritativeScore,
          antiCheat: antiCheat.severity ?? 'pass',
        },
      });
      const achievements = await recordRunAchievements(
        identity.userId,
        { gameType: 'blitz-tactics', score: authoritativeScore },
        reward,
        { durationMs: sessionDurationMs },
      );

      await recordGameTimeMetric({
        userId: identity.userId,
        gameType: 'blitz-tactics',
        durationMs: Math.min(sessionDurationMs, MAX_SESSION_DURATION_MS),
        playedAtMs: now,
      });

      const leaderboard = await db
        .select()
        .from(blitzTacticsScores)
        .orderBy(desc(blitzTacticsScores.score))
        .limit(SCORE_RESPONSE_LEADERBOARD_LIMIT);

      broadcast('gameLeaderboards', {
        gameType: 'blitz-tactics',
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
