import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { asc, desc, eq, sql } from 'drizzle-orm';
import { db } from '@/server/db/client';
import { reactionTimeScores } from '@/server/db/schema';
import { broadcast } from '@/server/events';
import { consumeGameSessionOrReject, validateGameSession } from '@/server/arcade/game-session';
import { getGameEvents } from '@/server/arcade/game-events';
import {
  runAntiCheat,
  type ActionEntry,
  type EnvFingerprint,
} from '@/server/arcade/anti-cheat';
import { awardGameRunCredits } from '@/server/arcade/rewards';
import { recordRunAchievements } from '../../_shared/run-achievements';
import { recordGameTimeMetric } from '@/server/arcade/game-time-metrics';
import { recordScoreEvent } from '@/server/arcade/score-events';
import {
  authenticateGamePlayer,
  isErrorResponse,
  parsePayload,
  rejectScore,
} from '../../_shared/score-helpers';
import { runScoreRoutePipeline } from '../../_shared/score-route-pipeline';
import { SCORE_RESPONSE_LEADERBOARD_LIMIT } from '../../_shared/constants';

type ScorePayload = {
  score?: number;
  averageTime?: number;
  bestTime?: number;
  attempts?: number;
  sessionToken?: string;
  actions?: ActionEntry[];
  env?: EnvFingerprint;
};

const roundToHundredth = (value: number) => Math.round(value * 100) / 100;
const REACTION_TRANSCRIPT_GRACE_ATTEMPTS = 3;
const REACTION_TRANSCRIPT_GRACE_DELAY_MS = 120;

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

const readFiniteNumber = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

type ReactionRound = {
  roundId: string;
  round: number;
  greenTs: number;
  clickTs?: number;
  reactionMs?: number;
};

type ReactionTranscript = {
  completedRounds: ReactionRound[];
  invalidClicks: number;
  clickEvents: Awaited<ReturnType<typeof getGameEvents>>;
};

const buildReactionTranscript = async (sessionId: string): Promise<ReactionTranscript> => {
  const [greenEvents, clickEvents] = await Promise.all([
    getGameEvents(sessionId, 'rt_green'),
    getGameEvents(sessionId, 'rt_click'),
  ]);

  const rounds = new Map<string, ReactionRound>();
  for (const event of greenEvents) {
    const data = event.data as { round?: unknown; roundId?: unknown } | undefined;
    if (typeof data?.round !== 'number' || typeof data?.roundId !== 'string') {
      continue;
    }
    rounds.set(data.roundId, {
      roundId: data.roundId,
      round: data.round,
      greenTs: event.ts,
    });
  }

  let invalidClicks = 0;
  for (const event of clickEvents) {
    const data = event.data as
      | {
          roundId?: unknown;
          reactionMs?: unknown;
          clientReactionMs?: unknown;
          serverReactionMs?: unknown;
          stableRttMs?: unknown;
          rttAdjustMs?: unknown;
        }
      | undefined;
    if (typeof data?.roundId !== 'string') {
      invalidClicks += 1;
      continue;
    }
    const round = rounds.get(data.roundId);
    if (!round || round.clickTs !== undefined || event.ts < round.greenTs) {
      invalidClicks += 1;
      continue;
    }
    round.clickTs = event.ts;
    const serverDeltaMs = event.ts - round.greenTs;
    const claimedReaction =
      readFiniteNumber(data.clientReactionMs) ??
      readFiniteNumber(data.reactionMs);
    if (claimedReaction !== null) {
      // Trust the client-measured reaction time — it's captured locally
      // with performance.now() and is the most accurate measurement.
      // Cheating protection comes from the hard cap (avg < 75ms = reject),
      // behavioral anomaly detection (avg < 100ms), and timing variance
      // analysis (bot-like consistency). The old server-delta validation
      // was adding 50-100ms+ of network overhead to legitimate scores.
      round.reactionMs = roundToHundredth(Math.max(0, claimedReaction));
    } else {
      const serverMeasuredReaction = readFiniteNumber(data.serverReactionMs);
      if (serverMeasuredReaction !== null) {
        round.reactionMs = roundToHundredth(Math.max(0, serverMeasuredReaction));
      } else {
        round.reactionMs = roundToHundredth(Math.max(0, serverDeltaMs));
      }
    }
  }

  const completedRounds = [...rounds.values()]
    .filter((round) => typeof round.clickTs === 'number')
    .sort((a, b) => a.round - b.round);

  return {
    completedRounds,
    invalidClicks,
    clickEvents,
  };
};

export async function POST(request: Request) {
  const authResult = await authenticateGamePlayer('reaction-time');
  if (isErrorResponse(authResult)) return authResult;
  const { identity, identityName } = authResult;

  const payload = await parsePayload<ScorePayload>(request);
  if (payload instanceof NextResponse) return payload;

  if (typeof payload?.sessionToken !== 'string') {
    return NextResponse.json(
      { error: 'Invalid score data. Session token required.' },
      { status: 400 },
    );
  }

  const { sessionToken, env } = payload;

  // Validate game session token — pass client-claimed values for plausibility checks
  // but we will compute the actual score from server-tracked reaction times
  const clientScore = typeof payload.score === 'number' ? payload.score : 0;
  const clientAvg =
    typeof payload.averageTime === 'number' ? payload.averageTime : 0;
  const clientBest =
    typeof payload.bestTime === 'number' ? payload.bestTime : 0;

  const sessionValidation = await validateGameSession(
    sessionToken,
    identity.userId,
    'reaction-time',
    clientScore,
    { averageTime: clientAvg, bestTime: clientBest },
    { consumeSession: false },
  );

  if (!sessionValidation.valid) {
    const errorMessage =
      sessionValidation.error || 'Invalid game session token';
    return rejectScore('reaction-time', {
      userId: identity.userId,
      userName: identityName,
      score: clientAvg > 0 ? clientAvg : clientScore,
      stage: 'session',
      reason: errorMessage,
      publicMessage: 'Invalid game session.',
      includeDetails: true,
    });
  }

  // === SERVER-SIDE SCORE COMPUTATION ===
  // Build authoritative per-round transcript from WS events and derive score.
  const sessionId = sessionValidation.session?.sessionId;
  const startedAt = sessionValidation.session?.startedAt ?? Date.now();
  let transcript: ReactionTranscript = sessionId
    ? await buildReactionTranscript(sessionId)
    : { completedRounds: [], invalidClicks: 0, clickEvents: [] };

  // WS score submit can race the final rt_click write. Allow a short grace
  // window so the last click event has time to persist.
  if (sessionId && transcript.completedRounds.length < 5) {
    for (let attempt = 1; attempt <= REACTION_TRANSCRIPT_GRACE_ATTEMPTS; attempt++) {
      await sleep(REACTION_TRANSCRIPT_GRACE_DELAY_MS);
      transcript = await buildReactionTranscript(sessionId);
      if (transcript.completedRounds.length >= 5) break;
    }
  }

  // Allow up to 5 invalid clicks. Early/accidental taps during the wait phase
  // are normal human behavior, especially on touch devices. The old limit of 2
  // was causing false rejections ("invalid game session") for legitimate players
  // who tapped during the red "wait" screen or double-tapped accidentally.
  const MAX_ALLOWED_INVALID_CLICKS = 5;
  if (transcript.completedRounds.length < 5) {
    return rejectScore('reaction-time', {
      userId: identity.userId,
      userName: identityName,
      score: clientAvg > 0 ? clientAvg : clientScore,
      stage: 'reaction-transcript',
      reason: `Incomplete transcript (completed=${transcript.completedRounds.length}/5, invalidClicks=${transcript.invalidClicks})`,
      publicMessage: 'Score could not be verified. Please try again.',
      includeDetails: true,
    });
  }
  if (transcript.invalidClicks > MAX_ALLOWED_INVALID_CLICKS) {
    return rejectScore('reaction-time', {
      userId: identity.userId,
      userName: identityName,
      score: clientAvg > 0 ? clientAvg : clientScore,
      stage: 'reaction-transcript',
      reason: `Too many invalid clicks (${transcript.invalidClicks} > ${MAX_ALLOWED_INVALID_CLICKS})`,
      publicMessage: 'Too many early clicks detected. Please try again.',
      includeDetails: true,
    });
  }

  const authoritativeRounds = transcript.completedRounds.slice(0, 5);
  const runDurationMs = Math.max(
    0,
    (authoritativeRounds[authoritativeRounds.length - 1]?.clickTs ?? Date.now()) -
      startedAt,
  );
  const reactionTimes = authoritativeRounds.map((round) => {
    if (typeof round.reactionMs === 'number' && Number.isFinite(round.reactionMs)) {
      return roundToHundredth(round.reactionMs);
    }
    const clickTs = round.clickTs as number;
    return Math.max(0, clickTs - round.greenTs);
  });
  const averageTime = roundToHundredth(
    reactionTimes.reduce((a, b) => a + b, 0) / reactionTimes.length,
  );
  const bestTime = roundToHundredth(Math.min(...reactionTimes));
  const worstTime = roundToHundredth(Math.max(...reactionTimes));
  const score = roundToHundredth(Math.max(0, 500 - averageTime));
  const attempts = reactionTimes.length;

  // Validate computed values are within human capability
  if (averageTime < 75 || bestTime < 75) {
    return rejectScore('reaction-time', {
      userId: identity.userId,
      userName: identityName,
      score: averageTime,
      stage: 'hard-cap',
      reason: `Superhuman reaction times [check=hard-cap, avgActual=${averageTime}ms, bestActual=${bestTime}ms, minAllowed=75ms]`,
      includeDetails: true,
    });
  }

  // Anti-cheat validation (using server-computed values)
  const previousBest = await db
    .select({ score: reactionTimeScores.score })
    .from(reactionTimeScores)
    .where(eq(reactionTimeScores.odUserId, identity.userId))
    .orderBy(desc(reactionTimeScores.score))
    .limit(1)
    .then((rows) => rows[0]?.score ?? null);

  const serverActions: ActionEntry[] = transcript.clickEvents
    .map((event) => {
      const data = event.data as
        | {
            greenTs?: number;
            clickTs?: number;
            reactionMs?: number;
            roundId?: string;
          }
        | undefined;
      if (!data || typeof data.roundId !== 'string') {
        return null;
      }
      const matchedRound = authoritativeRounds.find(
        (round) => round.roundId === data.roundId,
      );
      if (!matchedRound || typeof matchedRound.clickTs !== 'number') {
        return null;
      }
      const reactionMs =
        typeof matchedRound.reactionMs === 'number'
          ? matchedRound.reactionMs
          : Math.max(0, matchedRound.clickTs - matchedRound.greenTs);
      return {
        t: Math.max(0, matchedRound.clickTs - startedAt),
        d: { greenAt: 0, clickAt: reactionMs, roundId: data.roundId },
      } as ActionEntry;
    })
    .filter(Boolean) as ActionEntry[];

  const antiCheat = await runAntiCheat({
    gameType: 'reaction-time',
    userId: identity.userId,
    userName: identityName,
    score,
    actions: serverActions,
    env: env ?? null,
    previousBest,
    sessionDurationMs: sessionValidation.session?.durationMs,
    serverActionCount: sessionValidation.session?.actionCount,
    serverActionCounts: sessionValidation.session?.actionCounts,
    claimedAvgTime: averageTime,
    claimedBestTime: bestTime,
  });

  return runScoreRoutePipeline({
    antiCheat,
    identity,
    persist: async ({ now, userName }) => {
      // Atomically claim the session first: a losing duplicate submit throws a
      // 409 here and performs zero writes.
      if (sessionId) {
        await consumeGameSessionOrReject(sessionId, identity.userId);
      }
      await db
        .insert(reactionTimeScores)
        .values({
          id: crypto.randomUUID(),
          odUserId: identity.userId,
          userName,
          score,
          averageTime,
          bestTime,
          attempts: attempts || 5,
          createdAt: now,
        })
        .onConflictDoUpdate({
          target: reactionTimeScores.odUserId,
          set: {
            userName,
            score,
            averageTime,
            bestTime,
            attempts: attempts || 5,
            createdAt: now,
          },
          where: sql`excluded.score > ${reactionTimeScores.score}`,
        });
      await recordScoreEvent({
        gameSlug: 'reaction-time',
        userId: identity.userId,
        userName,
        score: bestTime,
      }).catch(() => {});
      const reward = await awardGameRunCredits({
        userId: identity.userId,
        context: { gameType: 'reaction-time', averageTime },
        sourceId: `reaction:${sessionId ?? crypto.randomUUID()}`,
        meta: {
          averageTime,
          bestTime,
          antiCheat: antiCheat.severity ?? 'pass',
        },
      });
      const achievements = await recordRunAchievements(
        identity.userId,
        { gameType: 'reaction-time', averageTime },
        reward,
        { durationMs: runDurationMs },
      );
      await recordGameTimeMetric({
        userId: identity.userId,
        gameType: 'reaction-time',
        durationMs: runDurationMs,
        playedAtMs: now,
      });

      const leaderboard = await db
        .select()
        .from(reactionTimeScores)
        .orderBy(
          asc(reactionTimeScores.averageTime),
          asc(reactionTimeScores.bestTime),
        )
        .limit(SCORE_RESPONSE_LEADERBOARD_LIMIT);

      broadcast('gameLeaderboards', {
        gameType: 'reaction-time',
        updatedAt: now,
      });

      return {
        success: true,
        reward,
        achievements,
        verifiedRun: {
          averageTime,
          bestTime,
          worstTime,
          range: roundToHundredth(worstTime - bestTime),
          score,
          attempts,
        },
        leaderboard: leaderboard.map((entry) => ({
          id: entry.id,
          userName: entry.userName,
          score: entry.score,
          averageTime: entry.averageTime,
          bestTime: entry.bestTime,
        })),
      };
    },
  });
}
