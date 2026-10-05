import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { desc, eq, count, sql } from 'drizzle-orm';
import { db } from '@/server/db/client';
import { gemSwapScores } from '@/server/db/schema';
import { requireIdentity } from '@/server/auth';
import { broadcast } from '@/server/events';
import {
  consumeGameSessionOrReject,
  validateGameSession,
} from '@/server/arcade/game-session';
import {
  replayGemSwapSession,
  GEM_SCORE_CAP,
  GEM_MAX_SWAPS,
  GEM_GAME_DURATION_MS,
  CELLS,
  type GemSwap,
} from '@/server/arcade/gem-swap-replay';
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

type RawSwap = { a?: unknown; b?: unknown; t?: unknown };

type ScorePayload = {
  score?: number;
  sessionToken?: string;
  swaps?: RawSwap[];
  clientDurationMs?: number;
  env?: EnvFingerprint;
};

// Hard ceiling on accepted client score — mirrors the replay's cap. (No shared
// GEM_SWAP_MAX_CLIENT_SCORE constant exists in _shared/constants.ts; the seed-
// derived cap is the authority and the route rejects anything above it before
// doing any work.)
const GEM_SWAP_MAX_CLIENT_SCORE = GEM_SCORE_CAP;

// The game itself is a fixed 60s, but the SESSION (create → submit) includes
// load + the countdown + the post round-trip. Give a generous ceiling so a
// legit run is never rejected for length while a clock-stretched / stalled-tab
// post is still bounded. (~5 min hard cap.)
const MAX_SESSION_DURATION_MS = 5 * 60 * 1000;

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
      .select({ score: gemSwapScores.score })
      .from(gemSwapScores)
      .where(eq(gemSwapScores.odUserId, identity.userId))
      .orderBy(desc(gemSwapScores.score))
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
  const authResult = await authenticateGamePlayer('gem-swap');
  if (isErrorResponse(authResult)) return authResult;
  const { identity, identityName } = authResult;

  const payload = await parsePayload<ScorePayload>(request);
  if (payload instanceof NextResponse) return payload;

  if (
    typeof payload?.score !== 'number' ||
    typeof payload?.sessionToken !== 'string' ||
    !Array.isArray(payload?.swaps)
  ) {
    return NextResponse.json(
      { error: 'Invalid score data. Session token and swaps required.' },
      { status: 400 },
    );
  }

  const { sessionToken, env } = payload;
  const claimedScore = Math.floor(payload.score);

  if (
    !Number.isFinite(claimedScore) ||
    claimedScore < 0 ||
    claimedScore > GEM_SWAP_MAX_CLIENT_SCORE
  ) {
    return NextResponse.json({ error: 'Invalid score value.' }, { status: 400 });
  }

  // Reject obviously oversized payloads before doing any work. A legit 60s run
  // records exactly one swap per move, so anything past the cap is junk.
  if (payload.swaps.length > GEM_MAX_SWAPS) {
    return rejectScore('gem-swap', {
      userId: identity.userId,
      userName: identityName,
      score: claimedScore,
      stage: 'payload',
      reason: `Swap payload too large (${payload.swaps.length})`,
      publicMessage: 'Invalid score data.',
    });
  }

  // Normalize the submitted swaps to the validator's shape. Malformed entries
  // are passed through as-is; replayGemSwapSession drops/rejects them.
  const swaps: GemSwap[] = payload.swaps.map((entry) => ({
    a: Number((entry as RawSwap)?.a),
    b: Number((entry as RawSwap)?.b),
    t: Number((entry as RawSwap)?.t),
  }));

  // Validate the game session token + server clock.
  const sessionValidation = await validateGameSession(
    sessionToken,
    identity.userId,
    'gem-swap',
    claimedScore,
    undefined,
    { consumeSession: false },
  );

  if (!sessionValidation.valid) {
    return rejectScore('gem-swap', {
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
  const gemSeed = sessionValidation.session?.gemSeed;

  if (!sessionId) {
    return rejectScore('gem-swap', {
      userId: identity.userId,
      userName: identityName,
      score: claimedScore,
      stage: 'session',
      reason: 'Missing session id',
      publicMessage: 'Invalid game session.',
    });
  }

  if (typeof gemSeed !== 'number') {
    return rejectScore('gem-swap', {
      userId: identity.userId,
      userName: identityName,
      score: claimedScore,
      stage: 'session',
      reason: 'Missing gem seed for session',
      publicMessage: 'Invalid game session.',
    });
  }

  // Server-clock ceiling: a run cannot have lasted materially longer than the
  // bounded session window. A post far past it is rejected (clock-stretch /
  // stalled tab). The client clock is cosmetic — only this elapsed is trusted.
  if (sessionDurationMs > MAX_SESSION_DURATION_MS) {
    return rejectScore('gem-swap', {
      userId: identity.userId,
      userName: identityName,
      score: claimedScore,
      stage: 'session',
      reason: `Session duration exceeds window (${sessionDurationMs}ms)`,
      publicMessage: 'Invalid game session.',
    });
  }

  // === SERVER-AUTHORITATIVE SCORE ===
  // Re-derive the initial board + refill stream from the seed and re-play the
  // recorded swaps (validating each is adjacent, forms a match, and falls inside
  // the 60s window), applying cascades + seeded refills. The client-claimed
  // number is never trusted; it must equal this authoritative count.
  const runResult = replayGemSwapSession(swaps, gemSeed, sessionDurationMs);

  if (runResult.rejected) {
    return rejectScore('gem-swap', {
      userId: identity.userId,
      userName: identityName,
      score: claimedScore,
      stage: 'server-replay',
      reason: runResult.reason ?? 'Implausible gem-swap run.',
    });
  }

  const authoritativeScore = runResult.score;

  if (claimedScore !== authoritativeScore) {
    return rejectScore('gem-swap', {
      userId: identity.userId,
      userName: identityName,
      score: claimedScore,
      stage: 'server-replay',
      reason: `Authoritative score mismatch (server=${authoritativeScore}, client=${claimedScore}, counted=${runResult.counted}, session=${sessionDurationMs}ms)`,
    });
  }

  // Build a per-swap ActionEntry timeline for the generic anti-cheat pass
  // (env/webdriver/time-ratio + score-jump anomaly). One action per recorded
  // swap, `t` = ms since the run began.
  const swapActions: ActionEntry[] = swaps
    .filter(
      (entry) =>
        Number.isInteger(entry.a) &&
        entry.a >= 0 &&
        entry.a < CELLS &&
        Number.isInteger(entry.b) &&
        entry.b >= 0 &&
        entry.b < CELLS &&
        Number.isFinite(entry.t) &&
        entry.t >= 0 &&
        entry.t <= GEM_GAME_DURATION_MS + 5_000,
    )
    .map((entry) => ({
      t: Math.max(0, Math.floor(entry.t)),
      d: { a: entry.a, b: entry.b },
    }))
    .sort((a, b) => a.t - b.t);

  const [previousBest, gameCount] = await Promise.all([
    db
      .select({ score: gemSwapScores.score })
      .from(gemSwapScores)
      .where(eq(gemSwapScores.odUserId, identity.userId))
      .orderBy(desc(gemSwapScores.score))
      .limit(1)
      .then((rows) => rows[0]?.score ?? null),
    db
      .select({ count: count() })
      .from(gemSwapScores)
      .where(eq(gemSwapScores.odUserId, identity.userId))
      .then((rows) => rows[0]?.count ?? 0),
  ]);

  const antiCheat = await runAntiCheat({
    gameType: 'gem-swap',
    userId: identity.userId,
    userName: identityName,
    score: authoritativeScore,
    actions: swapActions,
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
          .select({ score: gemSwapScores.score })
          .from(gemSwapScores)
          .where(eq(gemSwapScores.odUserId, identity.userId))
          .limit(1)
      )[0];

      await db
        .insert(gemSwapScores)
        .values({
          id: crypto.randomUUID(),
          odUserId: identity.userId,
          userName,
          score: authoritativeScore,
          createdAt: now,
        })
        .onConflictDoUpdate({
          target: gemSwapScores.odUserId,
          set: {
            userName,
            score: authoritativeScore,
            createdAt: now,
          },
          where: sql`excluded.score > ${gemSwapScores.score}`,
        });

      await recordScoreEvent({
        gameSlug: 'gem-swap',
        userId: identity.userId,
        userName,
        score: authoritativeScore,
      }).catch(() => {});

      const reward = await awardGameRunCredits({
        userId: identity.userId,
        context: { gameType: 'gem-swap', score: authoritativeScore },
        sourceId: `gem-swap:${sessionId}`,
        meta: {
          score: authoritativeScore,
          antiCheat: antiCheat.severity ?? 'pass',
        },
      });
      const achievements = await recordRunAchievements(
        identity.userId,
        { gameType: 'gem-swap', score: authoritativeScore },
        reward,
        { durationMs: sessionDurationMs },
      );

      await recordGameTimeMetric({
        userId: identity.userId,
        gameType: 'gem-swap',
        durationMs: Math.min(sessionDurationMs, MAX_SESSION_DURATION_MS),
        playedAtMs: now,
      });

      const leaderboard = await db
        .select()
        .from(gemSwapScores)
        .orderBy(desc(gemSwapScores.score))
        .limit(SCORE_RESPONSE_LEADERBOARD_LIMIT);

      broadcast('gameLeaderboards', {
        gameType: 'gem-swap',
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
