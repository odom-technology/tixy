import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { asc, eq, and, sql } from 'drizzle-orm';
import { db } from '@/server/db/client';
import { punchCardScores } from '@/server/db/schema';
import { requireIdentity } from '@/server/auth';
import { broadcast } from '@/server/events';
import {
  consumeGameSessionOrReject,
  deriveSessionSeed,
  validateGameSession,
} from '@/server/arcade/game-session';
import { awardGameRunCredits } from '@/server/arcade/rewards';
import { recordRunAchievements } from '../../_shared/run-achievements';
import { recordGameTimeMetric } from '@/server/arcade/game-time-metrics';
import { recordScoreEvent } from '@/server/arcade/score-events';
import { runAntiCheat, type EnvFingerprint } from '@/server/arcade/anti-cheat';
import {
  generatePunchCard,
  computePunchCardResult,
  computeRecordedTimeMs,
  normalizeEvents,
  isPunchCardSize,
  SIZE_TO_N,
  PUNCH_CARD_MAX_SOLVE_MS,
  type PunchCardSize,
} from '@/server/arcade/punch-card-replay';
import {
  authenticateGamePlayer,
  isErrorResponse,
  parsePayload,
  rejectScore,
} from '../../_shared/score-helpers';
import { runScoreRoutePipeline } from '../../_shared/score-route-pipeline';
import { SCORE_RESPONSE_LEADERBOARD_LIMIT } from '../../_shared/constants';

type ScorePayload = {
  sessionToken?: string;
  size?: string;
  events?: unknown;
  clientDurationMs?: number;
  env?: EnvFingerprint;
};

/**
 * GET /api/games/punch-card/score?size=<...> — the player's personal best
 * (fastest) recorded time for a size, in ms (null if none).
 */
export async function GET(request: Request) {
  let identity;
  try {
    identity = await requireIdentity({ allowExternal: true, allowGuest: true });
  } catch {
    return NextResponse.json(
      { error: 'Authentication required.' },
      { status: 401 },
    );
  }

  const { searchParams } = new URL(request.url);
  const size = searchParams.get('size');
  if (!isPunchCardSize(size)) {
    return NextResponse.json({ error: 'Invalid size.' }, { status: 400 });
  }

  try {
    const best = await db
      .select({ solveTimeMs: punchCardScores.solveTimeMs })
      .from(punchCardScores)
      .where(
        and(
          eq(punchCardScores.odUserId, identity.userId),
          eq(punchCardScores.size, size),
        ),
      )
      .orderBy(asc(punchCardScores.solveTimeMs))
      .limit(1);

    return NextResponse.json({ bestSolveTimeMs: best[0]?.solveTimeMs ?? null });
  } catch (error) {
    console.error('Failed to fetch user best punch-card time:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const authResult = await authenticateGamePlayer('punch-card');
  if (isErrorResponse(authResult)) return authResult;
  const { identity, identityName } = authResult;

  const payload = await parsePayload<ScorePayload>(request);
  if (payload instanceof NextResponse) return payload;

  if (
    typeof payload?.sessionToken !== 'string' ||
    !isPunchCardSize(payload?.size)
  ) {
    return NextResponse.json(
      { error: 'Invalid score data. Session token and size required.' },
      { status: 400 },
    );
  }

  const size: PunchCardSize = payload.size;
  const { sessionToken, env } = payload;
  const n = SIZE_TO_N[size];

  const events = normalizeEvents(payload.events, n * n);
  if (!events) {
    return NextResponse.json(
      { error: 'Invalid or missing move events.' },
      { status: 400 },
    );
  }

  // Validate the session token + server clock. Score plausibility for a
  // time-based game is a MIN-duration floor keyed on the board size (n), passed
  // via `mode`; the hint score itself is not meaningful, so we pass 0.
  const sessionValidation = await validateGameSession(
    sessionToken,
    identity.userId,
    'punch-card',
    0,
    { mode: n },
    { consumeSession: false },
  );

  if (!sessionValidation.valid) {
    return rejectScore('punch-card', {
      userId: identity.userId,
      userName: identityName,
      score: 0,
      stage: 'session',
      reason: sessionValidation.error ?? 'Invalid game session.',
      publicMessage: 'Invalid game session.',
    });
  }

  const sessionId = sessionValidation.session?.sessionId;
  const serverDurationMs = sessionValidation.session?.durationMs ?? 0;
  if (!sessionId) {
    return rejectScore('punch-card', {
      userId: identity.userId,
      userName: identityName,
      score: 0,
      stage: 'session',
      reason: 'Missing session id',
      publicMessage: 'Invalid game session.',
    });
  }

  // Re-derive the seed + regenerate the nonogram and its UNIQUE solution, then
  // replay the client's events against it. `solved` requires the final
  // filled-set to match the solution exactly (the "you solved it" gate).
  const seed = deriveSessionSeed(sessionId);
  const { solution } = generatePunchCard(seed, size);
  const result = computePunchCardResult(events, n, solution);

  if (!result.solved) {
    return rejectScore('punch-card', {
      userId: identity.userId,
      userName: identityName,
      score: 0,
      stage: 'server-validate',
      reason: 'Replayed events do not reproduce the solution',
      publicMessage: 'That board is not solved correctly.',
      includeDetails: true,
    });
  }

  // Authoritative base time = SERVER-measured wall-clock elapsed since the
  // session was created (Date.now() - started_at), with a 1s floor. The recorded
  // time is deliberately NOT clamped down to a client-reported duration: a
  // dishonest client could report ~0ms and, floored at 1s, top the fastest-time
  // leaderboard with a physically-impossible solve (and simultaneously max the
  // ticket payout + unlock every achievement tier). The clock therefore starts
  // when the board is dealt and is fully server-authoritative; the server
  // duration already passed the size-keyed plausibility floor (n²*20ms), so the
  // recorded base can never fall below that floor. The +10s/error penalty and
  // clean-solve bonus are then applied from the server-replayed error count.
  const baseSolveMs = Math.max(1000, Math.floor(serverDurationMs));

  const solveTimeMs = computeRecordedTimeMs(baseSolveMs, result.errorCount);

  if (solveTimeMs > PUNCH_CARD_MAX_SOLVE_MS) {
    return rejectScore('punch-card', {
      userId: identity.userId,
      userName: identityName,
      score: solveTimeMs,
      stage: 'hard-cap',
      reason: `Recorded time exceeds cap (${solveTimeMs}ms)`,
      publicMessage: 'Solve time too long to record.',
    });
  }

  // Anti-cheat: environment / webdriver / time-ratio checks. Lower time is
  // better, so previousBest is omitted (the higher=better jump heuristics don't
  // apply). We pass a single completion action + the server-measured duration.
  const antiCheat = await runAntiCheat({
    gameType: 'punch-card',
    userId: identity.userId,
    userName: identityName,
    score: solveTimeMs,
    actions: [{ t: Math.max(0, baseSolveMs), d: { type: 'solve', size } }],
    env: env ?? null,
    previousBest: null,
    sessionDurationMs: serverDurationMs,
    serverActionCount: sessionValidation.session?.actionCount,
    serverActionCounts: sessionValidation.session?.actionCounts,
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
          .select({ solveTimeMs: punchCardScores.solveTimeMs })
          .from(punchCardScores)
          .where(
            and(
              eq(punchCardScores.odUserId, identity.userId),
              eq(punchCardScores.size, size),
            ),
          )
          .limit(1)
      )[0];

      // Upsert keeping the MIN recorded time per (user, size).
      await db
        .insert(punchCardScores)
        .values({
          id: crypto.randomUUID(),
          odUserId: identity.userId,
          userName,
          size,
          solveTimeMs,
          createdAt: now,
        })
        .onConflictDoUpdate({
          target: [punchCardScores.odUserId, punchCardScores.size],
          set: {
            userName,
            solveTimeMs,
            createdAt: now,
          },
          where: sql`excluded.solve_time_ms < ${punchCardScores.solveTimeMs}`,
        });

      await recordScoreEvent({
        gameSlug: 'punch-card',
        userId: identity.userId,
        userName,
        score: solveTimeMs,
      }).catch(() => {});

      const reward = await awardGameRunCredits({
        userId: identity.userId,
        context: { gameType: 'punch-card', solveTimeMs, size },
        sourceId: `punch-card:${sessionId}`,
        meta: {
          size,
          solveTimeMs,
          errorCount: result.errorCount,
          antiCheat: antiCheat.severity ?? 'pass',
        },
      });
      const achievements = await recordRunAchievements(
        identity.userId,
        { gameType: 'punch-card', solveTimeMs, size },
        reward,
        { durationMs: solveTimeMs },
      );

      await recordGameTimeMetric({
        userId: identity.userId,
        gameType: 'punch-card',
        durationMs: solveTimeMs,
        playedAtMs: now,
      });

      const leaderboard = await db
        .select()
        .from(punchCardScores)
        .where(eq(punchCardScores.size, size))
        .orderBy(asc(punchCardScores.solveTimeMs), asc(punchCardScores.createdAt))
        .limit(SCORE_RESPONSE_LEADERBOARD_LIMIT);

      broadcast('gameLeaderboards', {
        gameType: 'punch-card',
        mode: size,
        updatedAt: now,
      });

      const isNewPB = !existing || solveTimeMs < existing.solveTimeMs;

      return {
        success: true,
        isNewPB,
        solveTimeMs,
        size,
        errorCount: result.errorCount,
        reward,
        achievements,
        leaderboard: leaderboard.map((entry) => ({
          id: entry.id,
          userId: entry.odUserId,
          userName: entry.userName,
          score: entry.solveTimeMs,
          solveTimeMs: entry.solveTimeMs,
          size: entry.size,
        })),
      };
    },
  });
}
