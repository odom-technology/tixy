import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { desc, eq, count, sql } from 'drizzle-orm';
import { db } from '@/server/db/client';
import { boardwalkHopScores } from '@/server/db/schema';
import { requireIdentity } from '@/server/auth';
import { broadcast } from '@/server/events';
import {
  consumeGameSessionOrReject,
  validateGameSession,
} from '@/server/arcade/game-session';
import {
  replayBoardwalkRun,
  BOARDWALK_SCORE_CAP,
  BOARDWALK_MAX_EVENTS,
  type BoardwalkHopEvent,
  type HopDir,
} from '@/server/arcade/boardwalk-hop-replay';
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

type RawHop = { dir?: unknown; t?: unknown };

type ScorePayload = {
  score?: number;
  sessionToken?: string;
  hops?: RawHop[];
  env?: EnvFingerprint;
};

// Hard ceiling on accepted client score — mirrors the replay's cap. The
// seed-derived cap is the authority; the route rejects anything above it before
// doing any work.
const BOARDWALK_MAX_CLIENT_SCORE = BOARDWALK_SCORE_CAP;

// The hopper has no fixed clock (endless run), but a run is still bounded. Give a
// generous ceiling so a marathon legit run is never rejected just for being long,
// while a clock-stretched / stalled-tab post is still bounded. (~10 min hard cap.)
const MAX_SESSION_DURATION_MS = 10 * 60 * 1000;

const DIRS = new Set<HopDir>(['U', 'D', 'L', 'R']);

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
      .select({ score: boardwalkHopScores.score })
      .from(boardwalkHopScores)
      .where(eq(boardwalkHopScores.odUserId, identity.userId))
      .orderBy(desc(boardwalkHopScores.score))
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
  const authResult = await authenticateGamePlayer('boardwalk-hop');
  if (isErrorResponse(authResult)) return authResult;
  const { identity, identityName } = authResult;

  const payload = await parsePayload<ScorePayload>(request);
  if (payload instanceof NextResponse) return payload;

  if (
    typeof payload?.score !== 'number' ||
    typeof payload?.sessionToken !== 'string' ||
    !Array.isArray(payload?.hops)
  ) {
    return NextResponse.json(
      { error: 'Invalid score data. Session token and hops required.' },
      { status: 400 },
    );
  }

  const { sessionToken, env } = payload;
  const claimedScore = Math.floor(payload.score);

  if (
    !Number.isFinite(claimedScore) ||
    claimedScore < 0 ||
    claimedScore > BOARDWALK_MAX_CLIENT_SCORE
  ) {
    return NextResponse.json({ error: 'Invalid score value.' }, { status: 400 });
  }

  // Reject obviously oversized payloads before doing any work.
  if (payload.hops.length > BOARDWALK_MAX_EVENTS) {
    return rejectScore('boardwalk-hop', {
      userId: identity.userId,
      userName: identityName,
      score: claimedScore,
      stage: 'payload',
      reason: `Hop payload too large (${payload.hops.length})`,
      publicMessage: 'Invalid score data.',
    });
  }

  // Normalize the submitted hops to the validator's shape. Malformed entries are
  // passed through as-is; replayBoardwalkRun drops anything non-conforming.
  const hops: BoardwalkHopEvent[] = payload.hops.map((entry) => ({
    dir: (entry as RawHop)?.dir as HopDir,
    t: Number((entry as RawHop)?.t),
  }));

  // Validate the game session token + server clock (do not consume yet).
  const sessionValidation = await validateGameSession(
    sessionToken,
    identity.userId,
    'boardwalk-hop',
    claimedScore,
    undefined,
    { consumeSession: false },
  );

  if (!sessionValidation.valid) {
    return rejectScore('boardwalk-hop', {
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
  const boardwalkSeed = sessionValidation.session?.boardwalkSeed;

  if (!sessionId) {
    return rejectScore('boardwalk-hop', {
      userId: identity.userId,
      userName: identityName,
      score: claimedScore,
      stage: 'session',
      reason: 'Missing session id',
      publicMessage: 'Invalid game session.',
    });
  }

  if (typeof boardwalkSeed !== 'number') {
    return rejectScore('boardwalk-hop', {
      userId: identity.userId,
      userName: identityName,
      score: claimedScore,
      stage: 'session',
      reason: 'Missing boardwalk seed for session',
      publicMessage: 'Invalid game session.',
    });
  }

  // Server-clock ceiling: a run cannot have lasted materially longer than the
  // bounded marathon window. A post far past it is rejected (clock-stretch /
  // stalled tab). The client clock is cosmetic — only this elapsed is trusted.
  if (sessionDurationMs > MAX_SESSION_DURATION_MS) {
    return rejectScore('boardwalk-hop', {
      userId: identity.userId,
      userName: identityName,
      score: claimedScore,
      stage: 'session',
      reason: `Session duration exceeds window (${sessionDurationMs}ms)`,
      publicMessage: 'Invalid game session.',
    });
  }

  // === SERVER-AUTHORITATIVE SCORE ===
  // Re-derive the lane layout + hazard motion from the seed and re-simulate the
  // recorded hops. The client-claimed number is never trusted; it must equal
  // this authoritative recompute.
  const runResult = replayBoardwalkRun(hops, sessionDurationMs, boardwalkSeed);

  if (runResult.rejected) {
    return rejectScore('boardwalk-hop', {
      userId: identity.userId,
      userName: identityName,
      score: claimedScore,
      stage: 'server-replay',
      reason: runResult.reason ?? 'Implausible boardwalk run.',
    });
  }

  const authoritativeScore = runResult.score;

  if (claimedScore !== authoritativeScore) {
    return rejectScore('boardwalk-hop', {
      userId: identity.userId,
      userName: identityName,
      score: claimedScore,
      stage: 'server-replay',
      reason: `Authoritative score mismatch (server=${authoritativeScore}, client=${claimedScore}, furthest=${runResult.furthest}, counted=${runResult.counted}, session=${sessionDurationMs}ms)`,
    });
  }

  // Build a per-hop ActionEntry timeline for the generic anti-cheat pass
  // (env/webdriver/time-ratio + score-jump anomaly). One action per recorded hop.
  const hopActions: ActionEntry[] = hops
    .filter(
      (entry) =>
        DIRS.has(entry.dir) &&
        Number.isFinite(entry.t) &&
        entry.t >= 0,
    )
    .map((entry) => ({
      t: Math.max(0, Math.floor(entry.t)),
      d: { dir: entry.dir },
    }))
    .sort((a, b) => a.t - b.t);

  const [previousBest, gameCount] = await Promise.all([
    db
      .select({ score: boardwalkHopScores.score })
      .from(boardwalkHopScores)
      .where(eq(boardwalkHopScores.odUserId, identity.userId))
      .orderBy(desc(boardwalkHopScores.score))
      .limit(1)
      .then((rows) => rows[0]?.score ?? null),
    db
      .select({ count: count() })
      .from(boardwalkHopScores)
      .where(eq(boardwalkHopScores.odUserId, identity.userId))
      .then((rows) => rows[0]?.count ?? 0),
  ]);

  const antiCheat = await runAntiCheat({
    gameType: 'boardwalk-hop',
    userId: identity.userId,
    userName: identityName,
    score: authoritativeScore,
    actions: hopActions,
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
          .select({ score: boardwalkHopScores.score })
          .from(boardwalkHopScores)
          .where(eq(boardwalkHopScores.odUserId, identity.userId))
          .limit(1)
      )[0];

      await db
        .insert(boardwalkHopScores)
        .values({
          id: crypto.randomUUID(),
          odUserId: identity.userId,
          userName,
          score: authoritativeScore,
          createdAt: now,
        })
        .onConflictDoUpdate({
          target: boardwalkHopScores.odUserId,
          set: {
            userName,
            score: authoritativeScore,
            createdAt: now,
          },
          where: sql`excluded.score > ${boardwalkHopScores.score}`,
        });

      await recordScoreEvent({
        gameSlug: 'boardwalk-hop',
        userId: identity.userId,
        userName,
        score: authoritativeScore,
      }).catch(() => {});

      const reward = await awardGameRunCredits({
        userId: identity.userId,
        context: { gameType: 'boardwalk-hop', score: authoritativeScore },
        sourceId: `boardwalk-hop:${sessionId}`,
        meta: {
          score: authoritativeScore,
          antiCheat: antiCheat.severity ?? 'pass',
        },
      });
      const achievements = await recordRunAchievements(
        identity.userId,
        { gameType: 'boardwalk-hop', score: authoritativeScore },
        reward,
        { durationMs: sessionDurationMs },
      );

      await recordGameTimeMetric({
        userId: identity.userId,
        gameType: 'boardwalk-hop',
        durationMs: Math.min(sessionDurationMs, MAX_SESSION_DURATION_MS),
        playedAtMs: now,
      });

      const leaderboard = await db
        .select()
        .from(boardwalkHopScores)
        .orderBy(desc(boardwalkHopScores.score))
        .limit(SCORE_RESPONSE_LEADERBOARD_LIMIT);

      broadcast('gameLeaderboards', {
        gameType: 'boardwalk-hop',
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
