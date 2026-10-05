import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { asc, eq, and, sql } from 'drizzle-orm';
import { db } from '@/server/db/client';
import { sudokuScores } from '@/server/db/schema';
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
  generateSudoku,
  gridsEqual,
  isSudokuDifficulty,
  isValidSolution,
  normalizeBoard,
  type SudokuDifficulty,
} from '@/server/arcade/sudoku-generator';
import {
  authenticateGamePlayer,
  isErrorResponse,
  parsePayload,
  rejectScore,
} from '../../_shared/score-helpers';
import { runScoreRoutePipeline } from '../../_shared/score-route-pipeline';
import {
  SCORE_RESPONSE_LEADERBOARD_LIMIT,
  SUDOKU_MAX_SOLVE_MS,
} from '../../_shared/constants';

type ScorePayload = {
  sessionToken?: string;
  difficulty?: string;
  solution?: unknown;
  clientDurationMs?: number;
  env?: EnvFingerprint;
};

/**
 * GET /api/games/sudoku/score?difficulty=<...> — the player's personal best
 * (fastest) solve time for a difficulty, in ms (null if none).
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
  if (!isSudokuDifficulty(difficulty)) {
    return NextResponse.json({ error: 'Invalid difficulty.' }, { status: 400 });
  }

  try {
    const best = await db
      .select({ solveTimeMs: sudokuScores.solveTimeMs })
      .from(sudokuScores)
      .where(
        and(
          eq(sudokuScores.odUserId, identity.userId),
          eq(sudokuScores.difficulty, difficulty),
        ),
      )
      .orderBy(asc(sudokuScores.solveTimeMs))
      .limit(1);

    return NextResponse.json({ bestSolveTimeMs: best[0]?.solveTimeMs ?? null });
  } catch (error) {
    console.error('Failed to fetch user best sudoku time:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const authResult = await authenticateGamePlayer('sudoku');
  if (isErrorResponse(authResult)) return authResult;
  const { identity, identityName } = authResult;

  const payload = await parsePayload<ScorePayload>(request);
  if (payload instanceof NextResponse) return payload;

  if (
    typeof payload?.sessionToken !== 'string' ||
    !isSudokuDifficulty(payload?.difficulty)
  ) {
    return NextResponse.json(
      { error: 'Invalid score data. Session token and difficulty required.' },
      { status: 400 },
    );
  }

  const difficulty: SudokuDifficulty = payload.difficulty;
  const { sessionToken, env } = payload;

  const submittedSolution = normalizeBoard(payload.solution);
  if (!submittedSolution) {
    return NextResponse.json(
      { error: 'Invalid solution. Expected 81 cells (0-9).' },
      { status: 400 },
    );
  }

  // Validate the session token + server clock. The plausibility hint score is
  // not meaningful for a time-based game, so we pass 0; the authoritative
  // metric is the server-measured durationMs.
  const sessionValidation = await validateGameSession(
    sessionToken,
    identity.userId,
    'sudoku',
    0,
    undefined,
    { consumeSession: false },
  );

  if (!sessionValidation.valid) {
    return rejectScore('sudoku', {
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
    return rejectScore('sudoku', {
      userId: identity.userId,
      userName: identityName,
      score: 0,
      stage: 'session',
      reason: 'Missing session id',
      publicMessage: 'Invalid game session.',
    });
  }

  // SERVER-AUTHORITATIVE solve time = wall-clock elapsed since session start
  // (Date.now() - started_at), measured on the server. The client-reported
  // duration is only a sanity bound; never the source of truth.
  const clientDurationMs =
    typeof payload.clientDurationMs === 'number' &&
    Number.isFinite(payload.clientDurationMs) &&
    payload.clientDurationMs >= 0
      ? Math.floor(payload.clientDurationMs)
      : null;

  // Re-derive the seed + regenerate the puzzle and its UNIQUE solution.
  const seed = deriveSessionSeed(sessionId);
  const { puzzle, solution } = generateSudoku(seed, difficulty);

  // (a) submission is a fully-valid Sudoku AND (b) keeps every given.
  if (!isValidSolution(puzzle, submittedSolution)) {
    return rejectScore('sudoku', {
      userId: identity.userId,
      userName: identityName,
      score: 0,
      stage: 'server-validate',
      reason: 'Submitted grid is not a valid solution consistent with the givens',
      publicMessage: 'That solution is not correct.',
      includeDetails: true,
    });
  }

  // (c) it equals the unique solution (defense in depth on top of a+b).
  if (!gridsEqual(submittedSolution, solution)) {
    return rejectScore('sudoku', {
      userId: identity.userId,
      userName: identityName,
      score: 0,
      stage: 'server-validate',
      reason: 'Submitted grid does not match the unique solution',
      publicMessage: 'That solution is not correct.',
      includeDetails: true,
    });
  }

  // Authoritative solve time. Use server elapsed; clamp to the client report
  // when that is smaller (the server clock can only be >= the true solve time
  // due to network latency on submit, so the lower of the two is the tighter,
  // still-trustworthy bound — but never below a 1s floor or above the cap).
  let solveTimeMs = Math.floor(serverDurationMs);
  if (clientDurationMs !== null && clientDurationMs < solveTimeMs) {
    solveTimeMs = clientDurationMs;
  }
  solveTimeMs = Math.max(1000, solveTimeMs);

  if (solveTimeMs > SUDOKU_MAX_SOLVE_MS) {
    return rejectScore('sudoku', {
      userId: identity.userId,
      userName: identityName,
      score: solveTimeMs,
      stage: 'hard-cap',
      reason: `Solve time exceeds cap (${solveTimeMs}ms)`,
      publicMessage: 'Solve time too long to record.',
    });
  }

  // Anti-cheat: environment / webdriver / time-ratio checks. There is no
  // per-cell replay (the seed fully verifies the solution), so we pass a
  // single completion action and the server-measured duration. Score passed
  // is the solve time; lower is better so the score-jump anomaly heuristics
  // (which assume higher = better) are not meaningful here — previousBest is
  // omitted so they don't fire on faster (lower) times.
  const antiCheat = await runAntiCheat({
    gameType: 'sudoku',
    userId: identity.userId,
    userName: identityName,
    score: solveTimeMs,
    actions: [{ t: Math.max(0, solveTimeMs), d: { type: 'solve', difficulty } }],
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
          .select({ solveTimeMs: sudokuScores.solveTimeMs })
          .from(sudokuScores)
          .where(
            and(
              eq(sudokuScores.odUserId, identity.userId),
              eq(sudokuScores.difficulty, difficulty),
            ),
          )
          .limit(1)
      )[0];

      // Upsert keeping the MIN solve time per (user, difficulty).
      await db
        .insert(sudokuScores)
        .values({
          id: crypto.randomUUID(),
          odUserId: identity.userId,
          userName,
          difficulty,
          solveTimeMs,
          createdAt: now,
        })
        .onConflictDoUpdate({
          target: [sudokuScores.odUserId, sudokuScores.difficulty],
          set: {
            userName,
            solveTimeMs,
            createdAt: now,
          },
          where: sql`excluded.solve_time_ms < ${sudokuScores.solveTimeMs}`,
        });

      await recordScoreEvent({
        gameSlug: 'sudoku',
        userId: identity.userId,
        userName,
        score: solveTimeMs,
        mode: difficulty,
      }).catch(() => {});

      const reward = await awardGameRunCredits({
        userId: identity.userId,
        context: { gameType: 'sudoku', solveTimeMs, difficulty },
        sourceId: `sudoku:${sessionId}`,
        meta: {
          difficulty,
          solveTimeMs,
          antiCheat: antiCheat.severity ?? 'pass',
        },
      });
      const achievements = await recordRunAchievements(
        identity.userId,
        { gameType: 'sudoku', solveTimeMs, difficulty },
        reward,
        { durationMs: solveTimeMs },
      );

      await recordGameTimeMetric({
        userId: identity.userId,
        gameType: 'sudoku',
        durationMs: solveTimeMs,
        playedAtMs: now,
      });

      const leaderboard = await db
        .select()
        .from(sudokuScores)
        .where(eq(sudokuScores.difficulty, difficulty))
        .orderBy(asc(sudokuScores.solveTimeMs), asc(sudokuScores.createdAt))
        .limit(SCORE_RESPONSE_LEADERBOARD_LIMIT);

      broadcast('gameLeaderboards', {
        gameType: 'sudoku',
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
