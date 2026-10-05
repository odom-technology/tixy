import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { desc, eq, count, sql } from 'drizzle-orm';
import { db } from '@/server/db/client';
import { bubbleShooterScores } from '@/server/db/schema';
import { requireIdentity } from '@/server/auth';
import { broadcast } from '@/server/events';
import {
  consumeGameSessionOrReject,
  validateGameSession,
} from '@/server/arcade/game-session';
import {
  replayGumballDropSession,
  BUBBLE_SCORE_CAP,
  GUMBALL_MAX_EVENTS,
  MAX_TIER,
  type GumballEvent,
} from '@/server/arcade/bubble-shooter-replay';
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

type RawEvent = { type?: unknown; tier?: unknown; t?: unknown };

type ScorePayload = {
  score?: number;
  sessionToken?: string;
  events?: RawEvent[];
  clientDurationMs?: number;
  env?: EnvFingerprint;
};

// Hard ceiling on accepted client score — mirrors the replay's cap. (No shared
// BUBBLE_MAX_CLIENT_SCORE constant exists in _shared/constants.ts; the seed-
// derived cap is the authority and the route rejects anything above it before
// doing any work.)
const BUBBLE_MAX_CLIENT_SCORE = BUBBLE_SCORE_CAP;

// A run has no fixed clock but is still bounded: at most GUMBALL_MAX_EVENTS
// events, each drop a couple of seconds apart. Give a generous ceiling so a
// marathon legit run is never rejected for length while a clock-stretched post
// is still bounded.
const MAX_SESSION_DURATION_MS = 30 * 60 * 1000;

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
      .select({ score: bubbleShooterScores.score })
      .from(bubbleShooterScores)
      .where(eq(bubbleShooterScores.odUserId, identity.userId))
      .orderBy(desc(bubbleShooterScores.score))
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
  const authResult = await authenticateGamePlayer('bubble-shooter');
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
    claimedScore > BUBBLE_MAX_CLIENT_SCORE
  ) {
    return NextResponse.json({ error: 'Invalid score value.' }, { status: 400 });
  }

  // Reject obviously oversized payloads before doing any work. A legit run
  // records a drop per gumball + a bounded number of merges, so anything past the
  // cap is junk.
  if (payload.events.length > GUMBALL_MAX_EVENTS) {
    return rejectScore('bubble-shooter', {
      userId: identity.userId,
      userName: identityName,
      score: claimedScore,
      stage: 'payload',
      reason: `Event payload too large (${payload.events.length})`,
      publicMessage: 'Invalid score data.',
    });
  }

  // Normalize the submitted events to the validator's shape. Malformed entries
  // are passed through as-is; replayGumballDropSession drops/rejects them.
  const events: GumballEvent[] = payload.events.map((entry) => ({
    type: (entry as RawEvent)?.type as GumballEvent['type'],
    tier: Number((entry as RawEvent)?.tier),
    t: Number((entry as RawEvent)?.t),
  }));

  // Validate the game session token + server clock.
  const sessionValidation = await validateGameSession(
    sessionToken,
    identity.userId,
    'bubble-shooter',
    claimedScore,
    undefined,
    { consumeSession: false },
  );

  if (!sessionValidation.valid) {
    return rejectScore('bubble-shooter', {
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
  const bubbleSeed = sessionValidation.session?.bubbleSeed;

  if (!sessionId) {
    return rejectScore('bubble-shooter', {
      userId: identity.userId,
      userName: identityName,
      score: claimedScore,
      stage: 'session',
      reason: 'Missing session id',
      publicMessage: 'Invalid game session.',
    });
  }

  if (typeof bubbleSeed !== 'number') {
    return rejectScore('bubble-shooter', {
      userId: identity.userId,
      userName: identityName,
      score: claimedScore,
      stage: 'session',
      reason: 'Missing bubble seed for session',
      publicMessage: 'Invalid game session.',
    });
  }

  // Server-clock ceiling: a run cannot have lasted materially longer than the
  // bounded marathon window. A post far past it is rejected (clock-stretch /
  // stalled tab). The client clock is cosmetic — only this elapsed is trusted.
  if (sessionDurationMs > MAX_SESSION_DURATION_MS) {
    return rejectScore('bubble-shooter', {
      userId: identity.userId,
      userName: identityName,
      score: claimedScore,
      stage: 'session',
      reason: `Session duration exceeds window (${sessionDurationMs}ms)`,
      publicMessage: 'Invalid game session.',
    });
  }

  // === SERVER-AUTHORITATIVE SCORE ===
  // Bound-check the recorded event log against the conservation invariant +
  // timing/window bounds and recompute the score from the merge tiers. The
  // client-claimed number is never trusted; it must equal this authoritative sum.
  const runResult = replayGumballDropSession(events, sessionDurationMs, bubbleSeed);

  if (runResult.rejected) {
    return rejectScore('bubble-shooter', {
      userId: identity.userId,
      userName: identityName,
      score: claimedScore,
      stage: 'server-replay',
      reason: runResult.reason ?? 'Implausible bubble-shooter run.',
    });
  }

  const authoritativeScore = runResult.score;

  if (claimedScore !== authoritativeScore) {
    return rejectScore('bubble-shooter', {
      userId: identity.userId,
      userName: identityName,
      score: claimedScore,
      stage: 'server-replay',
      reason: `Authoritative score mismatch (server=${authoritativeScore}, client=${claimedScore}, drops=${runResult.drops}, merges=${runResult.merges}, won=${runResult.won}, session=${sessionDurationMs}ms)`,
    });
  }

  // Build a per-event ActionEntry timeline for the generic anti-cheat pass
  // (env/webdriver/time-ratio + score-jump anomaly). One action per recorded
  // event, `t` = ms since the run began.
  const eventActions: ActionEntry[] = events
    .filter(
      (entry) =>
        (entry.type === 'drop' || entry.type === 'merge') &&
        Number.isFinite(entry.t) &&
        entry.t >= 0,
    )
    .map((entry) => ({
      t: Math.max(0, Math.floor(entry.t)),
      d: {
        type: entry.type,
        tier:
          entry.type === 'merge' &&
          Number.isInteger(entry.tier) &&
          entry.tier! >= 0 &&
          entry.tier! <= MAX_TIER
            ? entry.tier
            : undefined,
      },
    }))
    .sort((a, b) => a.t - b.t);

  const [previousBest, gameCount] = await Promise.all([
    db
      .select({ score: bubbleShooterScores.score })
      .from(bubbleShooterScores)
      .where(eq(bubbleShooterScores.odUserId, identity.userId))
      .orderBy(desc(bubbleShooterScores.score))
      .limit(1)
      .then((rows) => rows[0]?.score ?? null),
    db
      .select({ count: count() })
      .from(bubbleShooterScores)
      .where(eq(bubbleShooterScores.odUserId, identity.userId))
      .then((rows) => rows[0]?.count ?? 0),
  ]);

  const antiCheat = await runAntiCheat({
    gameType: 'bubble-shooter',
    userId: identity.userId,
    userName: identityName,
    score: authoritativeScore,
    actions: eventActions,
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
          .select({ score: bubbleShooterScores.score })
          .from(bubbleShooterScores)
          .where(eq(bubbleShooterScores.odUserId, identity.userId))
          .limit(1)
      )[0];

      await db
        .insert(bubbleShooterScores)
        .values({
          id: crypto.randomUUID(),
          odUserId: identity.userId,
          userName,
          score: authoritativeScore,
          createdAt: now,
        })
        .onConflictDoUpdate({
          target: bubbleShooterScores.odUserId,
          set: {
            userName,
            score: authoritativeScore,
            createdAt: now,
          },
          where: sql`excluded.score > ${bubbleShooterScores.score}`,
        });

      await recordScoreEvent({
        gameSlug: 'bubble-shooter',
        userId: identity.userId,
        userName,
        score: authoritativeScore,
      }).catch(() => {});

      const reward = await awardGameRunCredits({
        userId: identity.userId,
        context: { gameType: 'bubble-shooter', score: authoritativeScore },
        sourceId: `bubble-shooter:${sessionId}`,
        meta: {
          score: authoritativeScore,
          antiCheat: antiCheat.severity ?? 'pass',
        },
      });
      const achievements = await recordRunAchievements(
        identity.userId,
        { gameType: 'bubble-shooter', score: authoritativeScore },
        reward,
        { durationMs: sessionDurationMs },
      );

      await recordGameTimeMetric({
        userId: identity.userId,
        gameType: 'bubble-shooter',
        durationMs: Math.min(sessionDurationMs, MAX_SESSION_DURATION_MS),
        playedAtMs: now,
      });

      const leaderboard = await db
        .select()
        .from(bubbleShooterScores)
        .orderBy(desc(bubbleShooterScores.score))
        .limit(SCORE_RESPONSE_LEADERBOARD_LIMIT);

      broadcast('gameLeaderboards', {
        gameType: 'bubble-shooter',
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
