import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { and, desc, eq, count, sql } from 'drizzle-orm';
import { db } from '@/server/db/client';
import { highStrikerScores } from '@/server/db/schema';
import { requireIdentity } from '@/server/auth';
import { broadcast } from '@/server/events';
import {
  consumeGameSessionOrReject,
  validateGameSession,
} from '@/server/arcade/game-session';
import {
  strikerMinRunMs,
  strikerPlayCheck,
  validateStrikerRun,
  STRIKER_MAX_SCORE,
  STRIKER_MAX_SWINGS,
  STRIKER_MIN_SWING_GAP_MS,
  STRIKER_RULES_VERSION,
  type StrikerSwing,
} from '@/server/arcade/high-striker-replay';
import { awardGameRunCredits } from '@/server/arcade/rewards';
import { recordRunAchievements } from '../../_shared/run-achievements';
import { recordGameTimeMetric } from '@/server/arcade/game-time-metrics';
import { addAntiCheatLog } from '@/server/arcade/anti-cheat-logs';
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

/* High striker's score route, rules 3 (the endless tower). The client posts
   every hold of the run, the ending miss included, as `{ t }` (ms from the
   press to the release). The server replays them from the session's seed
   with the same state machine the client judged with, and the score is the
   replay's: a client score that differs is rejected.

   Rejected: a list that doesn't end on the run's end (a miss, or the top) or
   runs on past it, a tap or a malformed hold, a run whose holds and climbs
   take longer than the session has existed, and a session posted twice
   (409). What the replay can't see, a program sending valid holds, is the
   spread check (strikerPlayCheck): a run of 30 swings or more whose holds
   land within 6 ms of their peaks is flagged, and a long bell streak is
   logged for a person to look at.

   Rules 1 and 2 rows stay in high_striker_scores under their own `rules`;
   nothing here rewrites them. */

type RawSwing = { t?: unknown };

/** A player's row under the current rules. Earlier rules' rows are never read or written here. */
const currentRulesOf = (userId: string) =>
  and(eq(highStrikerScores.odUserId, userId), eq(highStrikerScores.rules, STRIKER_RULES_VERSION));

/** The rules the board's "last season" shows: the five-swing run. */
const LAST_SEASON_RULES = STRIKER_RULES_VERSION - 1;

type ScorePayload = {
  score?: number;
  sessionToken?: string;
  swings?: RawSwing[];
  clientDurationMs?: number;
  env?: EnvFingerprint;
};

// The longest a run can plausibly last on the server clock. An expert's
// deepest simulated runs take five minutes; a session posted an hour after
// it began is a stalled tab or a clock-stretch attempt.
const MAX_SESSION_DURATION_MS = 60 * 60 * 1000;

/** Slack on the timing floor for the time between the session's creation and the first press. */
const TIMING_FLOOR_SLACK_MS = 2_000;

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
    // The board and the strip read the current rules. Last season's best
    // (the five-swing run) stays readable and is returned on its own.
    const rows = await db
      .select({
        rules: highStrikerScores.rules,
        score: highStrikerScores.score,
      })
      .from(highStrikerScores)
      .where(eq(highStrikerScores.odUserId, identity.userId));
    const current = rows.find((row: { rules: number }) => row.rules === STRIKER_RULES_VERSION);
    const lastSeason = rows.find((row: { rules: number }) => row.rules === LAST_SEASON_RULES);

    return NextResponse.json({
      bestScore: current?.score ?? 0,
      lastSeasonBest: lastSeason?.score ?? null,
    });
  } catch (error) {
    console.error('Failed to fetch user best score:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const authResult = await authenticateGamePlayer('high-striker');
  if (isErrorResponse(authResult)) return authResult;
  const { identity, identityName } = authResult;

  const payload = await parsePayload<ScorePayload>(request);
  if (payload instanceof NextResponse) return payload;

  if (
    typeof payload?.score !== 'number' ||
    typeof payload?.sessionToken !== 'string' ||
    !Array.isArray(payload?.swings)
  ) {
    return NextResponse.json(
      { error: 'Invalid score data. Session token and swings required.' },
      { status: 400 },
    );
  }

  const { sessionToken, env } = payload;
  const claimedScore = Math.floor(payload.score);

  if (
    !Number.isFinite(claimedScore) ||
    claimedScore < 0 ||
    claimedScore > STRIKER_MAX_SCORE
  ) {
    return NextResponse.json({ error: 'Invalid score value.' }, { status: 400 });
  }

  // A run is at most the tower's hits plus the miss that ends it.
  if (payload.swings.length > STRIKER_MAX_SWINGS + 1) {
    return rejectScore('high-striker', {
      userId: identity.userId,
      userName: identityName,
      score: claimedScore,
      stage: 'payload',
      reason: `Swing payload too large (${payload.swings.length})`,
      publicMessage: 'Invalid score data.',
    });
  }

  // We trust only each hold's length; the replay derives every strength.
  const swings: StrikerSwing[] = payload.swings.map((entry) => ({
    t: Number((entry as RawSwing)?.t),
  }));

  const sessionValidation = await validateGameSession(
    sessionToken,
    identity.userId,
    'high-striker',
    claimedScore,
    undefined,
    { consumeSession: false },
  );

  if (!sessionValidation.valid) {
    return rejectScore('high-striker', {
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
  const highStrikerSeed = sessionValidation.session?.highStrikerSeed;

  if (!sessionId) {
    return rejectScore('high-striker', {
      userId: identity.userId,
      userName: identityName,
      score: claimedScore,
      stage: 'session',
      reason: 'Missing session id',
      publicMessage: 'Invalid game session.',
    });
  }

  if (typeof highStrikerSeed !== 'number') {
    return rejectScore('high-striker', {
      userId: identity.userId,
      userName: identityName,
      score: claimedScore,
      stage: 'session',
      reason: 'Missing high-striker seed for session',
      publicMessage: 'Invalid game session.',
    });
  }

  if (sessionDurationMs > MAX_SESSION_DURATION_MS) {
    return rejectScore('high-striker', {
      userId: identity.userId,
      userName: identityName,
      score: claimedScore,
      stage: 'session',
      reason: `Session duration exceeds window (${sessionDurationMs}ms)`,
      publicMessage: 'Invalid game session.',
    });
  }

  // === SERVER-AUTHORITATIVE SCORE ===
  const runResult = validateStrikerRun(highStrikerSeed, swings);
  const authoritativeScore = runResult.score;

  // A run is saved whole: every hold up to the one that ended it, nothing after.
  if (!runResult.complete) {
    return rejectScore('high-striker', {
      userId: identity.userId,
      userName: identityName,
      score: claimedScore,
      stage: 'server-replay',
      reason: `Run not complete (stop=${runResult.stop}, used=${runResult.swingsUsed}, swings=${swings.length})`,
      publicMessage: 'Invalid score data.',
    });
  }

  if (claimedScore !== authoritativeScore) {
    return rejectScore('high-striker', {
      userId: identity.userId,
      userName: identityName,
      score: claimedScore,
      stage: 'server-replay',
      reason: `Authoritative score mismatch (server=${authoritativeScore}, client=${claimedScore}, hits=${runResult.rounds}, stop=${runResult.stop}, swings=${swings.length}, session=${sessionDurationMs}ms)`,
    });
  }

  // The timing floor: the holds alone, plus the shortest climb between
  // swings, can't take longer than the session has existed.
  const minRunMs = strikerMinRunMs(runResult);
  if (minRunMs > sessionDurationMs + TIMING_FLOOR_SLACK_MS) {
    return rejectScore('high-striker', {
      userId: identity.userId,
      userName: identityName,
      score: claimedScore,
      stage: 'server-replay',
      reason: `Run faster than its holds allow (${Math.round(minRunMs)}ms of holds and climbs in a ${sessionDurationMs}ms session)`,
      publicMessage: 'Invalid score data.',
    });
  }

  // The generic pass gets a lower-bound timeline: each swing at the end of its
  // hold, with the shortest climb between swings.
  const swingActions: ActionEntry[] = [];
  {
    let at = 0;
    swings.forEach((swing, i) => {
      at += swing.t + (i > 0 ? STRIKER_MIN_SWING_GAP_MS : 0);
      swingActions.push({ t: Math.floor(at), d: { swing: i } });
    });
  }

  const play = strikerPlayCheck(runResult);

  const gameCount = await db
    .select({ count: count() })
    .from(highStrikerScores)
    .where(currentRulesOf(identity.userId))
    .then((rows: Array<{ count: number }>) => rows[0]?.count ?? 0);

  const antiCheat = await runAntiCheat({
    gameType: 'high-striker',
    userId: identity.userId,
    userName: identityName,
    score: authoritativeScore,
    actions: swingActions,
    env: env ?? null,
    // The score is bounded by the replay, so the jump heuristic for
    // unvalidated scores only misfires here (an honest 12, then a 140).
    previousBest: null,
    sessionDurationMs,
    serverActionCount: sessionValidation.session?.actionCount,
    serverActionCounts: sessionValidation.session?.actionCounts,
    gameCount,
    gameChecks: play.flag ? [{ severity: 'flag', stage: 'high-striker-play', reason: play.flag }] : [],
  });
  // A long bell streak is logged for a person to look at, as a pass, so the
  // flag escalation (which counts result = 'flag') never sees it.
  if (play.review) {
    await addAntiCheatLog({
      ts: Date.now(),
      gameType: 'high-striker',
      userId: identity.userId,
      userName: identityName,
      score: authoritativeScore,
      result: 'pass',
      reason: `Review: ${play.review}`,
      stage: 'high-striker-review',
      checks: [`hits=${runResult.rounds}`, `bells=${runResult.bells}`, `sdMs=${play.sdMs?.toFixed(1) ?? 'n/a'}`],
    }).catch(() => {});
  }

  return runScoreRoutePipeline({
    antiCheat,
    identity,
    persist: async ({ now, userName }) => {
      // Atomically claim the session first: a losing duplicate submit throws a
      // 409 here and performs zero writes.
      await consumeGameSessionOrReject(sessionId, identity.userId);

      const existing = (
        await db
          .select({ score: highStrikerScores.score })
          .from(highStrikerScores)
          .where(currentRulesOf(identity.userId))
          .limit(1)
      )[0];

      // One row per player per rules version; the name, the date and the
      // score change only when the score beats it.
      await db
        .insert(highStrikerScores)
        .values({
          id: crypto.randomUUID(),
          odUserId: identity.userId,
          userName,
          score: authoritativeScore,
          createdAt: now,
          rules: STRIKER_RULES_VERSION,
          bestStrength: runResult.bestStrength,
        })
        .onConflictDoUpdate({
          target: [highStrikerScores.odUserId, highStrikerScores.rules],
          set: {
            bestStrength: sql`GREATEST(COALESCE(${highStrikerScores.bestStrength}, 0), excluded.best_strength)`,
            score: sql`GREATEST(${highStrikerScores.score}, excluded.score)`,
            userName: sql`CASE WHEN excluded.score > ${highStrikerScores.score} THEN excluded.user_name ELSE ${highStrikerScores.userName} END`,
            createdAt: sql`CASE WHEN excluded.score > ${highStrikerScores.score} THEN excluded.created_at ELSE ${highStrikerScores.createdAt} END`,
          },
        });

      await recordScoreEvent({
        gameSlug: 'high-striker',
        userId: identity.userId,
        userName,
        score: authoritativeScore,
        // The windowed boards read events of the current rules only.
        mode: STRIKER_RULES_VERSION,
      }).catch(() => {});

      const reward = await awardGameRunCredits({
        userId: identity.userId,
        context: { gameType: 'high-striker', score: authoritativeScore },
        sourceId: `high-striker:${sessionId}`,
        meta: {
          score: authoritativeScore,
          rules: STRIKER_RULES_VERSION,
          hits: runResult.rounds,
          bells: runResult.bells,
          antiCheat: antiCheat.severity ?? 'pass',
        },
      });
      const achievements = await recordRunAchievements(
        identity.userId,
        { gameType: 'high-striker', score: authoritativeScore },
        reward,
        {
          durationMs: sessionDurationMs,
          strikerSwings: runResult.rounds,
          strikerBellStreak: runResult.bestBellStreak,
        },
      );

      await recordGameTimeMetric({
        userId: identity.userId,
        gameType: 'high-striker',
        durationMs: Math.min(sessionDurationMs, MAX_SESSION_DURATION_MS),
        playedAtMs: now,
      });

      const leaderboard = await db
        .select()
        .from(highStrikerScores)
        .where(eq(highStrikerScores.rules, STRIKER_RULES_VERSION))
        .orderBy(desc(highStrikerScores.score))
        .limit(SCORE_RESPONSE_LEADERBOARD_LIMIT);

      broadcast('gameLeaderboards', {
        gameType: 'high-striker',
        updatedAt: now,
      });

      return {
        success: true,
        isNewPB: !existing || authoritativeScore > existing.score,
        reward,
        achievements,
        leaderboard: leaderboard.map((entry: { id: string; odUserId: string; userName: string; score: number }) => ({
          id: entry.id,
          userId: entry.odUserId,
          userName: entry.userName,
          score: entry.score,
        })),
      };
    },
  });
}
