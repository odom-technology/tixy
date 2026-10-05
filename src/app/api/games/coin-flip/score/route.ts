import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { desc, eq, sql } from 'drizzle-orm';
import { db } from '@/server/db/client';
import { coinFlipScores } from '@/server/db/schema';
import { requireIdentity } from '@/server/auth';
import { broadcast } from '@/server/events';
import { consumeGameSession, validateGameSession } from '@/server/arcade/game-session';
import { checkScoreSubmitLimit } from '@/server/arcade/game-rate-limit';
import { addAntiCheatLog } from '@/server/arcade/anti-cheat-logs';
import {
  runAntiCheat,
  type ActionEntry,
  type EnvFingerprint,
} from '@/server/arcade/anti-cheat';
import { awardGameRunCredits } from '@/server/arcade/rewards';
import { recordRunAchievements } from '../../_shared/run-achievements';
import { recordGameTimeMetric } from '@/server/arcade/game-time-metrics';
import { recordScoreEvent } from '@/server/arcade/score-events';
import { getGameBanStatus } from '@/server/arcade/game-bans';
import { getGameEvents } from '@/server/arcade/game-events';

type ScorePayload = {
  streak?: number;
  chosenSides?: string[];
  sessionToken?: string;
  actions?: ActionEntry[];
  env?: EnvFingerprint;
};

/**
 * Mulberry32 seeded PRNG — must match the client-side implementation exactly.
 */
function mulberry32(seed: number) {
  let s = seed | 0;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function replayCoinFlips(
  seed: number,
  chosenSides: ('heads' | 'tails')[],
): number {
  const rng = mulberry32(seed);
  let streak = 0;
  for (const side of chosenSides) {
    const result = rng() < 0.5 ? 'heads' : 'tails';
    if (result === side) {
      streak++;
    } else {
      break;
    }
    if (streak >= 10000) break;
  }
  return streak;
}

const rejectCoinFlipScore = async (params: {
  userId: string;
  userName?: string | null;
  score: number;
  stage: string;
  reason: string;
  status?: number;
  publicMessage?: string;
}) => {
  try {
    await addAntiCheatLog({
      ts: Date.now(),
      gameType: 'coin-flip',
      userId: params.userId,
      userName: params.userName,
      score: params.score,
      result: 'reject',
      severity: 'reject',
      reason: params.reason,
      stage: params.stage,
      checks: [],
    });
  } catch (error) {
    console.error('Failed to write coin-flip anti-cheat reject log:', error);
  }

  return NextResponse.json(
    { error: params.publicMessage ?? 'Score validation failed.' },
    { status: params.status ?? 403 },
  );
};

export async function POST(request: Request) {
  let identity;
  try {
    identity = await requireIdentity({ allowExternal: true });
  } catch {
    return NextResponse.json(
      { error: 'Authentication required.' },
      { status: 401 },
    );
  }
  const identityName = identity.name || null;

  const gameBan = await getGameBanStatus(identity.userId);
  if (gameBan.isBanned) {
    return NextResponse.json(
      {
        error: gameBan.isIndefinite
          ? 'You are currently banned from playing games until an admin removes the ban.'
          : 'You are temporarily banned from playing games.',
        retryAfterSec:
          gameBan.isIndefinite || gameBan.remainingMs <= 0
            ? undefined
            : Math.ceil(gameBan.remainingMs / 1000),
        isIndefinite: gameBan.isIndefinite,
      },
      { status: 403 },
    );
  }

  const limit = await checkScoreSubmitLimit(identity.userId, 'coin-flip');
  if (!limit.ok) {
    return NextResponse.json(
      {
        error: limit.reason,
        retryAfterSec: Math.ceil(limit.retryAfterMs / 1000),
      },
      { status: 429 },
    );
  }

  let payload: ScorePayload | null = null;
  try {
    payload = (await request.json()) as ScorePayload;
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON payload.' },
      { status: 400 },
    );
  }

  if (
    typeof payload?.streak !== 'number' ||
    typeof payload?.sessionToken !== 'string' ||
    !Array.isArray(payload?.chosenSides) ||
    payload.chosenSides.length === 0
  ) {
    return NextResponse.json(
      { error: 'Invalid score data. Session token, streak, and chosen sides required.' },
      { status: 400 },
    );
  }

  const { sessionToken, env } = payload;
  const clientStreak = Math.floor(payload.streak);
  const chosenSides = payload.chosenSides;

  for (const side of chosenSides) {
    if (side !== 'heads' && side !== 'tails') {
      return NextResponse.json(
        { error: 'Invalid chosen side. Each entry must be "heads" or "tails".' },
        { status: 400 },
      );
    }
  }

  if (chosenSides.length !== clientStreak + 1) {
    return NextResponse.json(
      { error: 'Chosen sides array length must equal streak + 1.' },
      { status: 400 },
    );
  }

  if (!Number.isFinite(clientStreak) || clientStreak < 0 || clientStreak > 10000) {
    return NextResponse.json(
      { error: 'Invalid streak value.' },
      { status: 400 },
    );
  }

  const sessionValidation = await validateGameSession(
    sessionToken,
    identity.userId,
    'coin-flip',
    clientStreak,
    undefined,
    { consumeSession: false },
  );

  if (!sessionValidation.valid) {
    return rejectCoinFlipScore({
      userId: identity.userId,
      userName: identityName,
      score: clientStreak,
      stage: 'session',
      reason: sessionValidation.error ?? 'Invalid game session.',
      publicMessage: 'Invalid game session.',
    });
  }

  const sessionId = sessionValidation.session?.sessionId;
  const coinFlipSeed = sessionValidation.session?.coinFlipSeed;
  const recordedFlipCount = sessionValidation.session?.actionCounts?.flip ?? 0;

  if (!sessionId || coinFlipSeed === undefined) {
    return rejectCoinFlipScore({
      userId: identity.userId,
      userName: identityName,
      score: clientStreak,
      stage: 'session',
      reason: 'Missing session id or coin flip seed',
      publicMessage: 'Invalid game session.',
    });
  }

  if (recordedFlipCount !== chosenSides.length) {
    return rejectCoinFlipScore({
      userId: identity.userId,
      userName: identityName,
      score: clientStreak,
      stage: 'session-actions',
      reason: `Recorded flips (${recordedFlipCount}) do not match submitted flips (${chosenSides.length})`,
    });
  }

  const flipEvents = await getGameEvents(sessionId, 'coin_flip_pick');
  if (flipEvents.length !== chosenSides.length) {
    return rejectCoinFlipScore({
      userId: identity.userId,
      userName: identityName,
      score: clientStreak,
      stage: 'session-events',
      reason: `Recorded flip events (${flipEvents.length}) do not match submitted flips (${chosenSides.length})`,
    });
  }

  const flipEventsByIndex = new Map<number, { side?: unknown }>();
  for (const event of flipEvents) {
    const data = event.data as { flipIndex?: unknown; side?: unknown } | undefined;
    if (typeof data?.flipIndex === 'number') {
      flipEventsByIndex.set(data.flipIndex, { side: data.side });
    }
  }
  for (let i = 0; i < chosenSides.length; i++) {
    const event = flipEventsByIndex.get(i + 1);
    if (!event || event.side !== chosenSides[i]) {
      return rejectCoinFlipScore({
        userId: identity.userId,
        userName: identityName,
        score: clientStreak,
        stage: 'session-events',
        reason: `Submitted side at flip ${i + 1} does not match server record`,
      });
    }
  }

  // Server-side replay: compute the actual streak from the seed
  const serverStreak = replayCoinFlips(
    coinFlipSeed,
    chosenSides as ('heads' | 'tails')[],
  );

  if (serverStreak !== clientStreak) {
    return rejectCoinFlipScore({
      userId: identity.userId,
      userName: identityName,
      score: clientStreak,
      stage: 'server-replay',
      reason: `Streak mismatch (server=${serverStreak}, client=${clientStreak}, seed=${coinFlipSeed}, sides=${chosenSides.length})`,
    });
  }

  const sessionDurationMs = sessionValidation.session?.durationMs ?? 0;
  const minExpectedDurationMs = chosenSides.length * 1000;
  if (sessionDurationMs < minExpectedDurationMs) {
    return rejectCoinFlipScore({
      userId: identity.userId,
      userName: identityName,
      score: clientStreak,
      stage: 'session-duration',
      reason: `Session too short (${sessionDurationMs}ms for ${chosenSides.length} flips, minimum=${minExpectedDurationMs}ms)`,
    });
  }

  // Anti-cheat validation
  const previousBest = await db
    .select({ streak: coinFlipScores.streak })
    .from(coinFlipScores)
    .where(eq(coinFlipScores.odUserId, identity.userId))
    .orderBy(desc(coinFlipScores.streak))
    .limit(1)
    .then((rows) => rows[0]?.streak ?? null);

  const serverActions: ActionEntry[] = Array.from({ length: serverStreak + 1 }, (_, i) => ({
    t: i * 2000,
    d: { type: 'flip', index: i },
  }));

  // Coin flip integrity is enforced primarily by the authoritative server-side
  // flip sequence plus server-recorded per-flip session counts (see the
  // /api/games/coin-flip/flip endpoint).
  await runAntiCheat({
    gameType: 'coin-flip',
    userId: identity.userId,
    userName: identityName,
    score: serverStreak,
    actions: serverActions,
    env: env ?? null,
    previousBest,
    sessionDurationMs,
    serverActionCount: serverStreak + 1,
  });

  try {
    const now = Date.now();
    const userName = identity.name || 'Anonymous';

    // Atomically claim the session first: a losing duplicate submit gets a 409
    // and performs zero writes. This matters doubly here because the upsert
    // below accumulates lifetime totals (games/flips), which a duplicate would
    // otherwise double-count. This route does not use runScoreRoutePipeline
    // (its catch maps everything to 500), so return the 409 directly instead
    // of throwing consumeGameSessionOrReject.
    if (!(await consumeGameSession(sessionId, identity.userId))) {
      return NextResponse.json(
        { error: 'Score already submitted for this session.' },
        { status: 409 },
      );
    }

    await db
      .insert(coinFlipScores)
      .values({
        id: crypto.randomUUID(),
        odUserId: identity.userId,
        userName,
        streak: serverStreak,
        chosenSide: 'mixed',
        totalGamesPlayed: 1,
        totalCorrectFlips: serverStreak,
        totalFlips: chosenSides.length,
        createdAt: now,
      })
      .onConflictDoUpdate({
        target: coinFlipScores.odUserId,
        set: {
          userName,
          streak: sql`CASE
            WHEN excluded.streak > ${coinFlipScores.streak}
            THEN excluded.streak
            ELSE ${coinFlipScores.streak}
          END`,
          chosenSide: 'mixed',
          totalGamesPlayed: sql`${coinFlipScores.totalGamesPlayed} + excluded.total_games_played`,
          totalCorrectFlips: sql`${coinFlipScores.totalCorrectFlips} + excluded.total_correct_flips`,
          totalFlips: sql`${coinFlipScores.totalFlips} + excluded.total_flips`,
          createdAt: sql`CASE
            WHEN excluded.streak > ${coinFlipScores.streak}
            THEN excluded.created_at
            ELSE ${coinFlipScores.createdAt}
          END`,
        },
      });

    await recordScoreEvent({
      gameSlug: 'coin-flip',
      userId: identity.userId,
      userName,
      score: serverStreak,
    }).catch(() => {});

    const reward = await awardGameRunCredits({
      userId: identity.userId,
      context: { gameType: 'coin-flip', streak: serverStreak },
      sourceId: `coin-flip:${sessionId}`,
      meta: {
        streak: serverStreak,
        flips: chosenSides.length,
        antiCheat: 'pass',
      },
    });
    const achievements = await recordRunAchievements(
      identity.userId,
      { gameType: 'coin-flip', streak: serverStreak },
      reward,
      { durationMs: sessionDurationMs },
    );

    await recordGameTimeMetric({
      userId: identity.userId,
      gameType: 'coin-flip',
      durationMs: sessionDurationMs,
      playedAtMs: now,
    });

    const leaderboard = await db
      .select()
      .from(coinFlipScores)
      .orderBy(desc(coinFlipScores.streak))
      .limit(10);

    broadcast('gameLeaderboards', {
      gameType: 'coin-flip',
      updatedAt: now,
    });

    return NextResponse.json({
      success: true,
      reward,
      achievements,
      leaderboard: leaderboard.map((entry) => ({
        id: entry.id,
        userName: entry.userName,
        score: entry.streak,
        streak: entry.streak,
        chosenSide: entry.chosenSide,
      })),
    });
  } catch (error) {
    console.error('Failed to save score:', error);
    return NextResponse.json(
      { error: 'Failed to save score.' },
      { status: 500 },
    );
  }
}
