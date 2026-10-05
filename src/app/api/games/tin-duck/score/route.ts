import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { and, desc, eq, count, sql } from 'drizzle-orm';
import { db } from '@/server/db/client';
import { tinDuckScores } from '@/server/db/schema';
import { requireIdentity } from '@/server/auth';
import { broadcast } from '@/server/events';
import {
  consumeGameSessionOrReject,
  validateGameSession,
} from '@/server/arcade/game-session';
import {
  validateGalleryRun,
  GALLERY_MAX_SESSION_MS,
  GALLERY_MAX_SHOTS,
  GALLERY_MAX_RUN_SCORE,
  GALLERY_ROUND_MS,
  GALLERY_RULES_VERSION,
  type GalleryShot,
} from '@/server/arcade/tin-duck-gallery';
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

type RawShot = { x?: unknown; y?: unknown; t?: unknown };

type ScorePayload = {
  score?: number;
  sessionToken?: string;
  shots?: RawShot[];
  clientDurationMs?: number;
  env?: EnvFingerprint;
};

// The whole round runs on the server clock. Reject any session whose
// server-measured elapsed exceeds the round + grace (a stalled tab that posts
// late, or a clock-stretch attempt). 30 s round + 5 s network/persist grace.
const MAX_SESSION_DURATION_MS = GALLERY_MAX_SESSION_MS;

/** A player's row under the current rules. Last season's row (rules 1) is never read or written here. */
const currentRulesOf = (userId: string) =>
  and(eq(tinDuckScores.odUserId, userId), eq(tinDuckScores.rules, GALLERY_RULES_VERSION));

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
    // The strip and the board read the current rules (2). Last season's best
    // (rules 1) stays readable and is returned on its own.
    const rows = await db
      .select({ rules: tinDuckScores.rules, score: tinDuckScores.score })
      .from(tinDuckScores)
      .where(eq(tinDuckScores.odUserId, identity.userId));
    const current = rows.find((row: { rules: number }) => row.rules === GALLERY_RULES_VERSION);
    const lastSeason = rows.find((row: { rules: number }) => row.rules === 1);

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
  const authResult = await authenticateGamePlayer('tin-duck');
  if (isErrorResponse(authResult)) return authResult;
  const { identity, identityName } = authResult;

  const payload = await parsePayload<ScorePayload>(request);
  if (payload instanceof NextResponse) return payload;

  if (
    typeof payload?.score !== 'number' ||
    typeof payload?.sessionToken !== 'string' ||
    !Array.isArray(payload?.shots)
  ) {
    return NextResponse.json(
      { error: 'Invalid score data. Session token and shots required.' },
      { status: 400 },
    );
  }

  const { sessionToken, env } = payload;
  const claimedScore = Math.floor(payload.score);

  if (
    !Number.isFinite(claimedScore) ||
    claimedScore < 0 ||
    claimedScore > GALLERY_MAX_RUN_SCORE
  ) {
    return NextResponse.json({ error: 'Invalid score value.' }, { status: 400 });
  }

  // Reject obviously oversized payloads before doing any work.
  if (payload.shots.length > GALLERY_MAX_SHOTS) {
    return rejectScore('tin-duck', {
      userId: identity.userId,
      userName: identityName,
      score: claimedScore,
      stage: 'payload',
      reason: `Shot payload too large (${payload.shots.length})`,
      publicMessage: 'Invalid score data.',
    });
  }

  // Normalize the submitted shots to the validator's shape. We trust ONLY the
  // {x, y, t}; validateTinDuckRun re-derives every duck position from the seed.
  const shots: GalleryShot[] = payload.shots.map((entry) => ({
    x: Number((entry as RawShot)?.x),
    y: Number((entry as RawShot)?.y),
    t: Number((entry as RawShot)?.t),
  }));

  // Validate the game session token + server clock.
  const sessionValidation = await validateGameSession(
    sessionToken,
    identity.userId,
    'tin-duck',
    claimedScore,
    undefined,
    { consumeSession: false },
  );

  if (!sessionValidation.valid) {
    return rejectScore('tin-duck', {
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
  const tinDuckSeed = sessionValidation.session?.tinDuckSeed;

  if (!sessionId) {
    return rejectScore('tin-duck', {
      userId: identity.userId,
      userName: identityName,
      score: claimedScore,
      stage: 'session',
      reason: 'Missing session id',
      publicMessage: 'Invalid game session.',
    });
  }

  if (typeof tinDuckSeed !== 'number') {
    return rejectScore('tin-duck', {
      userId: identity.userId,
      userName: identityName,
      score: claimedScore,
      stage: 'session',
      reason: 'Missing tin-duck seed for session',
      publicMessage: 'Invalid game session.',
    });
  }

  // Server-clock ceiling: the round cannot have lasted materially longer than
  // 75s. A run that posts far past the window is rejected outright (the client
  // countdown is cosmetic — only this server-measured elapsed is trusted).
  if (sessionDurationMs > MAX_SESSION_DURATION_MS) {
    return rejectScore('tin-duck', {
      userId: identity.userId,
      userName: identityName,
      score: claimedScore,
      stage: 'session',
      reason: `Session duration exceeds round window (${sessionDurationMs}ms)`,
      publicMessage: 'Invalid game session.',
    });
  }

  // === SERVER-AUTHORITATIVE SCORE ===
  // Re-derive the gallery (chains, plates, the gold duck) from the seed and
  // replay the recorded shots, as ray slopes at their times, through the same
  // magazine, pump and hit rules the client ran. The client-claimed number is
  // never trusted; it must equal this authoritative count.
  const runResult = validateGalleryRun(
    tinDuckSeed,
    shots,
    sessionDurationMs,
  );
  const authoritativeScore = runResult.score;

  if (claimedScore !== authoritativeScore) {
    return rejectScore('tin-duck', {
      userId: identity.userId,
      userName: identityName,
      score: claimedScore,
      stage: 'server-replay',
      reason: `Authoritative score mismatch (server=${authoritativeScore}, client=${claimedScore}, hits=${runResult.hits}, shots=${runResult.shotsFired}, dropped=${runResult.dropped}, payload=${shots.length}, session=${sessionDurationMs}ms)`,
    });
  }

  // Build a per-shot ActionEntry timeline for the generic anti-cheat pass
  // (env/webdriver/time-ratio + score-jump anomaly). One action per submitted
  // shot, `t` = ms since round start.
  const shotActions: ActionEntry[] = shots
    .filter((entry) => Number.isFinite(entry.t) && entry.t >= 0)
    .map((entry) => ({
      t: Math.max(0, Math.floor(entry.t)),
      d: {},
    }))
    .sort((a, b) => a.t - b.t);

  const gameCount = await db
    .select({ count: count() })
    .from(tinDuckScores)
    .where(currentRulesOf(identity.userId))
    .then((rows: Array<{ count: number }>) => rows[0]?.count ?? 0);

  const antiCheat = await runAntiCheat({
    gameType: 'tin-duck',
    userId: identity.userId,
    userName: identityName,
    score: authoritativeScore,
    actions: shotActions,
    env: env ?? null,
    // Score-jump anomaly is intentionally disabled: the score is fully
    // recomputed by the deterministic server replay above (a mismatch is already
    // a hard reject), so a legacy best is never a false "jump".
    previousBest: null,
    sessionDurationMs,
    serverActionCount: sessionValidation.session?.actionCount,
    serverActionCounts: sessionValidation.session?.actionCounts,
    modeDurationSec: GALLERY_ROUND_MS / 1000,
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
          .select({ score: tinDuckScores.score })
          .from(tinDuckScores)
          .where(currentRulesOf(identity.userId))
          .limit(1)
      )[0];

      await db
        .insert(tinDuckScores)
        .values({
          id: crypto.randomUUID(),
          odUserId: identity.userId,
          userName,
          score: authoritativeScore,
          createdAt: now,
          rules: GALLERY_RULES_VERSION,
        })
        .onConflictDoUpdate({
          // One row per player per rules version.
          target: [tinDuckScores.odUserId, tinDuckScores.rules],
          set: {
            userName,
            score: authoritativeScore,
            createdAt: now,
          },
          where: sql`excluded.score > ${tinDuckScores.score}`,
        });

      await recordScoreEvent({
        gameSlug: 'tin-duck',
        userId: identity.userId,
        userName,
        score: authoritativeScore,
        // The windowed boards read events of the current rules only.
        mode: GALLERY_RULES_VERSION,
      }).catch(() => {});

      const reward = await awardGameRunCredits({
        userId: identity.userId,
        context: { gameType: 'tin-duck', score: authoritativeScore },
        sourceId: `tin-duck:${sessionId}`,
        meta: {
          score: authoritativeScore,
          antiCheat: antiCheat.severity ?? 'pass',
        },
      });
      const achievements = await recordRunAchievements(
        identity.userId,
        { gameType: 'tin-duck', score: authoritativeScore },
        reward,
        { durationMs: sessionDurationMs },
      );

      await recordGameTimeMetric({
        userId: identity.userId,
        gameType: 'tin-duck',
        durationMs: Math.min(sessionDurationMs, MAX_SESSION_DURATION_MS),
        playedAtMs: now,
      });

      const leaderboard = await db
        .select()
        .from(tinDuckScores)
        .where(eq(tinDuckScores.rules, GALLERY_RULES_VERSION))
        .orderBy(desc(tinDuckScores.score))
        .limit(SCORE_RESPONSE_LEADERBOARD_LIMIT);

      broadcast('gameLeaderboards', {
        gameType: 'tin-duck',
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
