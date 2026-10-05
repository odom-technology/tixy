import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { desc, eq, count, sql } from 'drizzle-orm';
import { db } from '@/server/db/client';
import { gunrushScores } from '@/server/db/schema';
import { requireIdentity } from '@/server/auth';
import { broadcast } from '@/server/events';
import {
  consumeGameSessionOrReject,
  validateGameSession,
} from '@/server/arcade/game-session';
import {
  replayGunrushSession,
  GUNRUSH_MAX_ROWS,
  GUNRUSH_SCORE_CAP,
  type GunrushPick,
} from '@/server/arcade/gunrush-replay';
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

type RawPick = { row?: unknown; lane?: unknown; t?: unknown };

type ScorePayload = {
  score?: number;
  sessionToken?: string;
  picks?: RawPick[];
  endRow?: number;
  clientDurationMs?: number;
  env?: EnvFingerprint;
};

// Hard ceiling on accepted client score — mirrors the replay's cap. (No shared
// GUNRUSH_MAX_CLIENT_SCORE constant exists in _shared/constants.ts; the
// seed-derived cap is the authority and the route rejects anything above it
// before doing any work.)
const GUNRUSH_MAX_CLIENT_SCORE = GUNRUSH_SCORE_CAP;

// The run has no fixed clock but is still bounded: the squad auto-runs at the
// seeded speed schedule and the wave HP curve outruns the DPS ceiling, so even
// perfect play dies. A measured greedy-optimal run lasts ~262s (p50) and 326s
// (max over 60 seeds), so 20 minutes is ~4x the longest achievable run — a
// marathon legit run is never rejected for length while a clock-stretched /
// stalled-tab post is still bounded.
const MAX_SESSION_DURATION_MS = 20 * 60 * 1000;

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
      .select({ score: gunrushScores.score })
      .from(gunrushScores)
      .where(eq(gunrushScores.odUserId, identity.userId))
      .orderBy(desc(gunrushScores.score))
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
  const authResult = await authenticateGamePlayer('gunrush');
  if (isErrorResponse(authResult)) return authResult;
  const { identity, identityName } = authResult;

  const payload = await parsePayload<ScorePayload>(request);
  if (payload instanceof NextResponse) return payload;

  if (
    typeof payload?.score !== 'number' ||
    typeof payload?.sessionToken !== 'string' ||
    !Array.isArray(payload?.picks) ||
    typeof payload?.endRow !== 'number' ||
    !Number.isInteger(payload.endRow) ||
    payload.endRow < 0
  ) {
    return NextResponse.json(
      { error: 'Invalid score data. Session token, picks and end row required.' },
      { status: 400 },
    );
  }

  const { sessionToken, env } = payload;
  const claimedScore = Math.floor(payload.score);
  const endRow = payload.endRow;

  if (
    !Number.isFinite(claimedScore) ||
    claimedScore < 0 ||
    claimedScore > GUNRUSH_MAX_CLIENT_SCORE
  ) {
    return NextResponse.json({ error: 'Invalid score value.' }, { status: 400 });
  }

  // Reject obviously oversized payloads before doing any work. A legit run
  // records at most one pick per gate row, and no run can reach past
  // GUNRUSH_MAX_ROWS, so anything larger is junk.
  if (payload.picks.length > GUNRUSH_MAX_ROWS) {
    return rejectScore('gunrush', {
      userId: identity.userId,
      userName: identityName,
      score: claimedScore,
      stage: 'payload',
      reason: `Pick payload too large (${payload.picks.length})`,
      publicMessage: 'Invalid score data.',
    });
  }

  // Normalize the submitted picks to the validator's shape. Malformed entries
  // are passed through as-is; replayGunrushSession rejects them.
  const picks: GunrushPick[] = payload.picks.map((entry) => ({
    row: Number((entry as RawPick)?.row),
    lane: Number((entry as RawPick)?.lane),
    t: Number((entry as RawPick)?.t),
  }));

  // Validate the game session token + server clock.
  const sessionValidation = await validateGameSession(
    sessionToken,
    identity.userId,
    'gunrush',
    claimedScore,
    undefined,
    { consumeSession: false },
  );

  if (!sessionValidation.valid) {
    return rejectScore('gunrush', {
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
  const gunrushSeed = sessionValidation.session?.gunrushSeed;

  if (!sessionId) {
    return rejectScore('gunrush', {
      userId: identity.userId,
      userName: identityName,
      score: claimedScore,
      stage: 'session',
      reason: 'Missing session id',
      publicMessage: 'Invalid game session.',
    });
  }

  if (typeof gunrushSeed !== 'number') {
    return rejectScore('gunrush', {
      userId: identity.userId,
      userName: identityName,
      score: claimedScore,
      stage: 'session',
      reason: 'Missing gunrush seed for session',
      publicMessage: 'Invalid game session.',
    });
  }

  // Server-clock ceiling: a run cannot have lasted materially longer than the
  // bounded marathon window. A post far past it is rejected (clock-stretch /
  // stalled tab). The client clock is cosmetic — only this elapsed is trusted.
  if (sessionDurationMs > MAX_SESSION_DURATION_MS) {
    return rejectScore('gunrush', {
      userId: identity.userId,
      userName: identityName,
      score: claimedScore,
      stage: 'session',
      reason: `Session duration exceeds window (${sessionDurationMs}ms)`,
      publicMessage: 'Invalid game session.',
    });
  }

  // === SERVER-AUTHORITATIVE SCORE ===
  // Re-derive the track from the seed and replay the reported pick stream: every
  // gate row must be resolved exactly once in ascending order, the simulation
  // (not the client) decides when the squad wipes, and each pick must be
  // physically reachable and inside the session window. The client-claimed score
  // is never trusted; it must equal the replayed row-payout total.
  const runResult = replayGunrushSession(
    picks,
    endRow,
    sessionDurationMs,
    gunrushSeed,
  );

  if (runResult.rejected) {
    return rejectScore('gunrush', {
      userId: identity.userId,
      userName: identityName,
      score: claimedScore,
      stage: 'server-replay',
      reason: runResult.reason ?? 'Implausible gunrush run.',
    });
  }

  const authoritativeScore = runResult.score;

  if (claimedScore !== authoritativeScore) {
    return rejectScore('gunrush', {
      userId: identity.userId,
      userName: identityName,
      score: claimedScore,
      stage: 'server-replay',
      reason: `Authoritative score mismatch (server=${authoritativeScore}, client=${claimedScore}, endRow=${endRow}, counted=${runResult.counted}, session=${sessionDurationMs}ms)`,
    });
  }

  // Build a per-pick ActionEntry timeline for the generic anti-cheat pass
  // (env/webdriver/time-ratio + score-jump anomaly). One action per recorded
  // gate decision, `t` = ms since the run began.
  const pickActions: ActionEntry[] = picks
    .filter(
      (entry) =>
        Number.isInteger(entry.row) &&
        entry.row >= 1 &&
        Number.isInteger(entry.lane) &&
        Number.isFinite(entry.t) &&
        entry.t >= 0,
    )
    .map((entry) => ({
      t: Math.max(0, Math.floor(entry.t)),
      d: { row: entry.row, lane: entry.lane },
    }))
    .sort((a, b) => a.t - b.t);

  const [previousBest, gameCount] = await Promise.all([
    db
      .select({ score: gunrushScores.score })
      .from(gunrushScores)
      .where(eq(gunrushScores.odUserId, identity.userId))
      .orderBy(desc(gunrushScores.score))
      .limit(1)
      .then((rows) => rows[0]?.score ?? null),
    db
      .select({ count: count() })
      .from(gunrushScores)
      .where(eq(gunrushScores.odUserId, identity.userId))
      .then((rows) => rows[0]?.count ?? 0),
  ]);

  const antiCheat = await runAntiCheat({
    gameType: 'gunrush',
    userId: identity.userId,
    userName: identityName,
    score: authoritativeScore,
    actions: pickActions,
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
          .select({ score: gunrushScores.score })
          .from(gunrushScores)
          .where(eq(gunrushScores.odUserId, identity.userId))
          .limit(1)
      )[0];

      await db
        .insert(gunrushScores)
        .values({
          id: crypto.randomUUID(),
          odUserId: identity.userId,
          userName,
          score: authoritativeScore,
          createdAt: now,
        })
        .onConflictDoUpdate({
          target: gunrushScores.odUserId,
          set: {
            userName,
            score: authoritativeScore,
            createdAt: now,
          },
          where: sql`excluded.score > ${gunrushScores.score}`,
        });

      await recordScoreEvent({
        gameSlug: 'gunrush',
        userId: identity.userId,
        userName,
        score: authoritativeScore,
      }).catch(() => {});

      const reward = await awardGameRunCredits({
        userId: identity.userId,
        context: { gameType: 'gunrush', score: authoritativeScore },
        sourceId: `gunrush:${sessionId}`,
        meta: {
          score: authoritativeScore,
          antiCheat: antiCheat.severity ?? 'pass',
        },
      });
      const achievements = await recordRunAchievements(
        identity.userId,
        { gameType: 'gunrush', score: authoritativeScore },
        reward,
        { durationMs: sessionDurationMs },
      );

      await recordGameTimeMetric({
        userId: identity.userId,
        gameType: 'gunrush',
        durationMs: Math.min(sessionDurationMs, MAX_SESSION_DURATION_MS),
        playedAtMs: now,
      });

      const leaderboard = await db
        .select()
        .from(gunrushScores)
        .orderBy(desc(gunrushScores.score))
        .limit(SCORE_RESPONSE_LEADERBOARD_LIMIT);

      broadcast('gameLeaderboards', {
        gameType: 'gunrush',
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
