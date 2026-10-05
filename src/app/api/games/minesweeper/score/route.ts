import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { asc, eq, and, sql } from 'drizzle-orm';
import { db } from '@/server/db/client';
import { minesweeperScores } from '@/server/db/schema';
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
  MINESWEEPER_MAX_SOLVE_MS,
  generateMinesweeper,
  isFullSafeClear,
  isMinesweeperDifficulty,
  normalizeRevealedCells,
  type MinesweeperDifficulty,
} from '@/server/arcade/minesweeper-generator';
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
  difficulty?: string;
  revealedCells?: unknown;
  clientDurationMs?: number;
  env?: EnvFingerprint;
};

/**
 * GET /api/games/minesweeper/score?difficulty=<...> — the player's personal
 * best (fastest) solve time for a difficulty, in ms (null if none).
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
  const difficulty = searchParams.get('difficulty');
  if (!isMinesweeperDifficulty(difficulty)) {
    return NextResponse.json({ error: 'Invalid difficulty.' }, { status: 400 });
  }

  try {
    const best = await db
      .select({ solveTimeMs: minesweeperScores.solveTimeMs })
      .from(minesweeperScores)
      .where(
        and(
          eq(minesweeperScores.odUserId, identity.userId),
          eq(minesweeperScores.difficulty, difficulty),
        ),
      )
      .orderBy(asc(minesweeperScores.solveTimeMs))
      .limit(1);

    return NextResponse.json({ bestSolveTimeMs: best[0]?.solveTimeMs ?? null });
  } catch (error) {
    console.error('Failed to fetch user best minesweeper time:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const authResult = await authenticateGamePlayer('minesweeper');
  if (isErrorResponse(authResult)) return authResult;
  const { identity, identityName } = authResult;

  const payload = await parsePayload<ScorePayload>(request);
  if (payload instanceof NextResponse) return payload;

  if (
    typeof payload?.sessionToken !== 'string' ||
    !isMinesweeperDifficulty(payload?.difficulty)
  ) {
    return NextResponse.json(
      { error: 'Invalid score data. Session token and difficulty required.' },
      { status: 400 },
    );
  }

  const difficulty: MinesweeperDifficulty = payload.difficulty;
  const { sessionToken, env } = payload;

  // Validate the session token + server clock. The plausibility hint score is
  // not meaningful for a time-based game, so we pass 0; the authoritative
  // metric is the server-measured durationMs.
  const sessionValidation = await validateGameSession(
    sessionToken,
    identity.userId,
    'minesweeper',
    0,
    undefined,
    { consumeSession: false },
  );

  if (!sessionValidation.valid) {
    return rejectScore('minesweeper', {
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
    return rejectScore('minesweeper', {
      userId: identity.userId,
      userName: identityName,
      score: 0,
      stage: 'session',
      reason: 'Missing session id',
      publicMessage: 'Invalid game session.',
    });
  }

  // Re-derive the seed + regenerate the SAME board the client played.
  const seed = deriveSessionSeed(sessionId);
  const generated = generateMinesweeper(seed, difficulty);

  // Sanitize then verify the submitted full-clear proof: the revealed set must
  // equal every non-mine cell (no mine revealed, all safe cells revealed).
  const revealedCells = normalizeRevealedCells(
    payload.revealedCells,
    generated.total,
  );
  if (!revealedCells) {
    return NextResponse.json(
      { error: 'Invalid solve. Expected a list of revealed cell indices.' },
      { status: 400 },
    );
  }

  if (!isFullSafeClear(generated, revealedCells)) {
    return rejectScore('minesweeper', {
      userId: identity.userId,
      userName: identityName,
      score: 0,
      stage: 'server-validate',
      reason: 'Revealed cells are not a complete, mine-free clear of the board',
      publicMessage: 'That board was not fully cleared.',
      includeDetails: true,
    });
  }

  // SERVER-AUTHORITATIVE solve time = wall-clock elapsed since session start.
  // The client timer anchors at board-load (right after the session + puzzle
  // fetch), so the only legitimate gap between the server's session start and
  // the client's play start is the two fetch round-trips + render — a few
  // seconds at most. We therefore let the client trim the server-measured
  // elapsed ONLY by that bounded amount (MAX_CLOCK_TRIM_MS). A client that
  // claims a much smaller duration (e.g. clientDurationMs:0 to forge a 1.000s
  // clear) exceeds the trim cap, so we fall back to the server clock minus the
  // allowed gap. This keeps honest fast solves accurate while making the
  // leaderboard unspoofable — the server clock can't run faster than reality.
  const clientDurationMs =
    typeof payload.clientDurationMs === 'number' &&
    Number.isFinite(payload.clientDurationMs) &&
    payload.clientDurationMs >= 0
      ? Math.floor(payload.clientDurationMs)
      : null;

  const MAX_CLOCK_TRIM_MS = 8000;
  let solveTimeMs = Math.floor(serverDurationMs);
  if (clientDurationMs !== null && clientDurationMs < solveTimeMs) {
    solveTimeMs =
      serverDurationMs - clientDurationMs <= MAX_CLOCK_TRIM_MS
        ? clientDurationMs
        : Math.max(clientDurationMs, serverDurationMs - MAX_CLOCK_TRIM_MS);
  }
  solveTimeMs = Math.max(1000, solveTimeMs);

  if (solveTimeMs > MINESWEEPER_MAX_SOLVE_MS) {
    return rejectScore('minesweeper', {
      userId: identity.userId,
      userName: identityName,
      score: solveTimeMs,
      stage: 'hard-cap',
      reason: `Solve time exceeds cap (${solveTimeMs}ms)`,
      publicMessage: 'Solve time too long to record.',
    });
  }

  // Anti-cheat: environment / webdriver / time-ratio checks. There is no
  // per-cell replay (the seed fully verifies the clear), so we pass a single
  // completion action + the server-measured duration. Lower is better, so the
  // score-jump heuristics (which assume higher = better) are not meaningful;
  // previousBest is omitted so they don't fire on faster (lower) times.
  const antiCheat = await runAntiCheat({
    gameType: 'minesweeper',
    userId: identity.userId,
    userName: identityName,
    score: solveTimeMs,
    actions: [{ t: Math.max(0, solveTimeMs), d: { type: 'clear', difficulty } }],
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
          .select({ solveTimeMs: minesweeperScores.solveTimeMs })
          .from(minesweeperScores)
          .where(
            and(
              eq(minesweeperScores.odUserId, identity.userId),
              eq(minesweeperScores.difficulty, difficulty),
            ),
          )
          .limit(1)
      )[0];

      // Upsert keeping the MIN solve time per (user, difficulty).
      await db
        .insert(minesweeperScores)
        .values({
          id: crypto.randomUUID(),
          odUserId: identity.userId,
          userName,
          difficulty,
          solveTimeMs,
          createdAt: now,
        })
        .onConflictDoUpdate({
          target: [minesweeperScores.odUserId, minesweeperScores.difficulty],
          set: {
            userName,
            solveTimeMs,
            createdAt: now,
          },
          where: sql`excluded.solve_time_ms < ${minesweeperScores.solveTimeMs}`,
        });

      await recordScoreEvent({
        gameSlug: 'minesweeper',
        userId: identity.userId,
        userName,
        score: solveTimeMs,
        mode: difficulty,
      }).catch(() => {});

      const reward = await awardGameRunCredits({
        userId: identity.userId,
        context: { gameType: 'minesweeper', solveTimeMs, difficulty },
        sourceId: `minesweeper:${sessionId}`,
        meta: {
          difficulty,
          solveTimeMs,
          antiCheat: antiCheat.severity ?? 'pass',
        },
      });
      const achievements = await recordRunAchievements(
        identity.userId,
        { gameType: 'minesweeper', solveTimeMs, difficulty },
        reward,
        { durationMs: solveTimeMs },
      );

      await recordGameTimeMetric({
        userId: identity.userId,
        gameType: 'minesweeper',
        durationMs: solveTimeMs,
        playedAtMs: now,
      });

      const leaderboard = await db
        .select()
        .from(minesweeperScores)
        .where(eq(minesweeperScores.difficulty, difficulty))
        .orderBy(
          asc(minesweeperScores.solveTimeMs),
          asc(minesweeperScores.createdAt),
        )
        .limit(SCORE_RESPONSE_LEADERBOARD_LIMIT);

      broadcast('gameLeaderboards', {
        gameType: 'minesweeper',
        mode: difficulty,
        updatedAt: now,
      });

      const isNewPB = !existing || solveTimeMs < existing.solveTimeMs;

      return {
        success: true,
        isNewPB,
        solveTimeMs,
        difficulty,
        reward,
        achievements,
        leaderboard: leaderboard.map((entry) => ({
          id: entry.id,
          userId: entry.odUserId,
          userName: entry.userName,
          score: entry.solveTimeMs,
          solveTimeMs: entry.solveTimeMs,
          difficulty: entry.difficulty,
        })),
      };
    },
  });
}
