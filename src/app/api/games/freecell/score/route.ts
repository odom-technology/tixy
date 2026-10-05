import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { asc, eq, and, sql } from 'drizzle-orm';
import { db } from '@/server/db/client';
import { freecellScores } from '@/server/db/schema';
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
import { runAntiCheat, type EnvFingerprint } from '@/server/arcade/anti-cheat';
import {
  resolveDeal,
  replayFreecell,
  normalizeEvents,
  dailySeedForDay,
  dayNumberFromMs,
  FREECELL_MIN_RECORDED_MS,
  FREECELL_MAX_SOLVE_MS,
} from '@/server/arcade/freecell-replay';
import {
  authenticateGamePlayer,
  isErrorResponse,
  parsePayload,
  rejectScore,
} from '../../_shared/score-helpers';
import { runScoreRoutePipeline } from '../../_shared/score-route-pipeline';
import { SCORE_RESPONSE_LEADERBOARD_LIMIT } from '../../_shared/constants';

type FreecellMode = 'daily' | 'free';
const isMode = (v: unknown): v is FreecellMode => v === 'daily' || v === 'free';

type ScorePayload = {
  sessionToken?: string;
  mode?: string;
  events?: unknown;
  clientDurationMs?: number;
  env?: EnvFingerprint;
};

/**
 * GET /api/games/freecell/score?mode=<daily|free> — the player's personal best
 * (fastest) clear time for a mode, in ms (null if none). For daily, scoped to
 * today's shared deal.
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
  const mode = searchParams.get('mode');
  if (!isMode(mode)) {
    return NextResponse.json({ error: 'Invalid mode.' }, { status: 400 });
  }
  const dealKey =
    mode === 'daily' ? String(dayNumberFromMs(Date.now())) : 'free';

  try {
    const best = await db
      .select({ solveTimeMs: freecellScores.solveTimeMs })
      .from(freecellScores)
      .where(
        and(
          eq(freecellScores.odUserId, identity.userId),
          eq(freecellScores.mode, mode),
          eq(freecellScores.dealKey, dealKey),
        ),
      )
      .orderBy(asc(freecellScores.solveTimeMs))
      .limit(1);

    return NextResponse.json({ bestSolveTimeMs: best[0]?.solveTimeMs ?? null });
  } catch (error) {
    console.error('Failed to fetch user best freecell time:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const authResult = await authenticateGamePlayer('freecell');
  if (isErrorResponse(authResult)) return authResult;
  const { identity, identityName } = authResult;

  const payload = await parsePayload<ScorePayload>(request);
  if (payload instanceof NextResponse) return payload;

  if (typeof payload?.sessionToken !== 'string' || !isMode(payload?.mode)) {
    return NextResponse.json(
      { error: 'Invalid score data. Session token and mode required.' },
      { status: 400 },
    );
  }

  const mode: FreecellMode = payload.mode;
  const { sessionToken, env } = payload;

  const events = normalizeEvents(payload.events);
  if (!events) {
    return NextResponse.json(
      { error: 'Invalid or missing move events.' },
      { status: 400 },
    );
  }

  // Validate the session token + server clock. Plausibility for a time-based
  // game is a MIN-duration floor keyed on the submitted move count (passed via
  // `mode`); the hint score itself is not meaningful, so we pass 0.
  const sessionValidation = await validateGameSession(
    sessionToken,
    identity.userId,
    'freecell',
    0,
    { mode: events.length },
    { consumeSession: false },
  );

  if (!sessionValidation.valid) {
    return rejectScore('freecell', {
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
  const startedAt = sessionValidation.session?.startedAt ?? 0;
  if (!sessionId) {
    return rejectScore('freecell', {
      userId: identity.userId,
      userName: identityName,
      score: 0,
      stage: 'session',
      reason: 'Missing session id',
      publicMessage: 'Invalid game session.',
    });
  }

  // Re-derive the SAME deal the client played (free → session seed; daily → the
  // shared UTC-day seed fixed at session start), running the identical
  // `resolveDeal` solvability re-derivation, then replay every submitted move
  // against the real rules. `solved` requires all 52 cards on foundations.
  const dayNumber = dayNumberFromMs(startedAt);
  const baseSeed =
    mode === 'daily' ? dailySeedForDay(dayNumber) : deriveSessionSeed(sessionId);
  const dealKey = mode === 'daily' ? String(dayNumber) : 'free';
  const { deal } = resolveDeal(baseSeed);

  const result = replayFreecell(deal, events);

  if (!result.solved) {
    return rejectScore('freecell', {
      userId: identity.userId,
      userName: identityName,
      score: 0,
      stage: 'server-replay',
      reason:
        result.reason ?? 'Replayed moves do not clear the deal (not solved)',
      publicMessage: 'That deal is not cleared.',
      includeDetails: true,
    });
  }

  const moveCount = result.moveCount;

  // Authoritative base time = SERVER-measured wall-clock elapsed since the deal
  // was dealt (Date.now() - started_at), floored at 1s. Deliberately NOT clamped
  // down to a client-reported duration: a dishonest client could report ~0ms and,
  // floored at 1s, top the fastest-time board with a physically-impossible solve.
  // The server duration already passed the move-count plausibility floor
  // (moves × 55ms), so the recorded time can never fall below that floor.
  const solveTimeMs = Math.max(
    FREECELL_MIN_RECORDED_MS,
    Math.floor(serverDurationMs),
  );

  if (solveTimeMs > FREECELL_MAX_SOLVE_MS) {
    return rejectScore('freecell', {
      userId: identity.userId,
      userName: identityName,
      score: solveTimeMs,
      stage: 'hard-cap',
      reason: `Recorded time exceeds cap (${solveTimeMs}ms)`,
      publicMessage: 'Solve time too long to record.',
    });
  }

  // Anti-cheat: environment / webdriver / time-ratio checks. Lower time is
  // better, so previousBest is omitted. One synthetic completion action + the
  // server-measured duration.
  const antiCheat = await runAntiCheat({
    gameType: 'freecell',
    userId: identity.userId,
    userName: identityName,
    score: solveTimeMs,
    actions: [
      { t: Math.max(0, Math.floor(serverDurationMs)), d: { type: 'solve', mode } },
    ],
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
          .select({
            solveTimeMs: freecellScores.solveTimeMs,
            moveCount: freecellScores.moveCount,
          })
          .from(freecellScores)
          .where(
            and(
              eq(freecellScores.odUserId, identity.userId),
              eq(freecellScores.mode, mode),
              eq(freecellScores.dealKey, dealKey),
            ),
          )
          .limit(1)
      )[0];

      // Upsert keeping the best (MIN time, then MIN moves) per (user, mode, deal).
      await db
        .insert(freecellScores)
        .values({
          id: crypto.randomUUID(),
          odUserId: identity.userId,
          userName,
          mode,
          dealKey,
          solveTimeMs,
          moveCount,
          createdAt: now,
        })
        .onConflictDoUpdate({
          target: [
            freecellScores.odUserId,
            freecellScores.mode,
            freecellScores.dealKey,
          ],
          set: { userName, solveTimeMs, moveCount, createdAt: now },
          where: sql`excluded.solve_time_ms < ${freecellScores.solveTimeMs} OR (excluded.solve_time_ms = ${freecellScores.solveTimeMs} AND excluded.move_count < ${freecellScores.moveCount})`,
        });

      // NOTE (review fix): deliberately NO recordScoreEvent here. freecell is
      // not in SCORE_LEADERBOARD_GAMES (its boards are per-mode solve times via
      // the per-game route, like punch-card), so the call was a guaranteed
      // no-op — and a foot-gun if freecell were ever added to that map without
      // rethinking direction (it would feed ms into a higher-is-better log).

      const reward = await awardGameRunCredits({
        userId: identity.userId,
        context: { gameType: 'freecell', solveTimeMs, mode, moveCount },
        sourceId: `freecell:${sessionId}`,
        meta: {
          mode,
          dealKey,
          solveTimeMs,
          moveCount,
          antiCheat: antiCheat.severity ?? 'pass',
        },
      });
      const achievements = await recordRunAchievements(
        identity.userId,
        { gameType: 'freecell', solveTimeMs, mode, moveCount },
        reward,
        { durationMs: solveTimeMs },
      );

      await recordGameTimeMetric({
        userId: identity.userId,
        gameType: 'freecell',
        durationMs: solveTimeMs,
        playedAtMs: now,
      });

      const leaderboard = await db
        .select()
        .from(freecellScores)
        .where(
          and(eq(freecellScores.mode, mode), eq(freecellScores.dealKey, dealKey)),
        )
        .orderBy(
          asc(freecellScores.solveTimeMs),
          asc(freecellScores.moveCount),
          asc(freecellScores.createdAt),
        )
        .limit(SCORE_RESPONSE_LEADERBOARD_LIMIT);

      broadcast('gameLeaderboards', {
        gameType: 'freecell',
        mode,
        updatedAt: now,
      });

      const isNewPB =
        !existing ||
        solveTimeMs < existing.solveTimeMs ||
        (solveTimeMs === existing.solveTimeMs && moveCount < existing.moveCount);

      return {
        success: true,
        isNewPB,
        solveTimeMs,
        moveCount,
        mode,
        reward,
        achievements,
        leaderboard: leaderboard.map((entry) => ({
          id: entry.id,
          userId: entry.odUserId,
          userName: entry.userName,
          score: entry.solveTimeMs,
          solveTimeMs: entry.solveTimeMs,
          moveCount: entry.moveCount,
          mode: entry.mode,
        })),
      };
    },
  });
}
