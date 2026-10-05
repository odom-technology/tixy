import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { desc, eq, and, sql } from 'drizzle-orm';
import { db } from '@/server/db/client';
import { typingTestScores } from '@/server/db/schema';
import { requireIdentity } from '@/server/auth';
import { broadcast } from '@/server/events';
import { consumeGameSessionOrReject, validateGameSession } from '@/server/arcade/game-session';
import { getGameEvents } from '@/server/arcade/game-events';
import {
  runAntiCheat,
  type ActionEntry,
  type EnvFingerprint,
} from '@/server/arcade/anti-cheat';
import {
  replayTypingSession,
  TYPING_PREV_WORD_TOKEN,
} from '@/server/arcade/typing-replay';
import {
  getTypingDuelSnapshot,
  recordTypingDuelResult,
} from '@/server/arcade/typing-duel';
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
import {
  SCORE_RESPONSE_LEADERBOARD_LIMIT,
  TYPING_TEST_MODES,
  TYPING_MAX_WPM,
  TYPING_MAX_KEYS_PER_SEC,
} from '../../_shared/constants';

type ScorePayload = {
  wpm?: number;
  rawWpm?: number;
  accuracy?: number;
  mode?: number;
  correctChars?: number;
  incorrectChars?: number;
  totalChars?: number;
  wordsCompleted?: number;
  sessionToken?: string;
  actions?: ActionEntry[];
  env?: EnvFingerprint;
  multiplayerSessionId?: string;
};

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
  const mode = parseInt(searchParams.get('mode') || '60', 10);

  if (!(TYPING_TEST_MODES as readonly number[]).includes(mode)) {
    return NextResponse.json(
      { error: 'Invalid mode. Must be 15, 30, or 60.' },
      { status: 400 },
    );
  }

  try {
    const bestScore = await db
      .select({
        wpm: typingTestScores.wpm,
        accuracy: typingTestScores.accuracy,
      })
      .from(typingTestScores)
      .where(
        and(
          eq(typingTestScores.odUserId, identity.userId),
          eq(typingTestScores.mode, mode),
        ),
      )
      .orderBy(desc(typingTestScores.wpm))
      .limit(1);

    return NextResponse.json({
      bestWpm: bestScore[0]?.wpm ?? 0,
      bestAccuracy: bestScore[0]?.accuracy ?? 0,
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
  const authResult = await authenticateGamePlayer('typing-test');
  if (isErrorResponse(authResult)) return authResult;
  const { identity, identityName } = authResult;

  const payload = await parsePayload<ScorePayload>(request);
  if (payload instanceof NextResponse) return payload;

  if (
    typeof payload?.sessionToken !== 'string' ||
    typeof payload?.mode !== 'number'
  ) {
    return NextResponse.json(
      { error: 'Invalid score data. Session token and mode required.' },
      { status: 400 },
    );
  }

  const { sessionToken, env, mode } = payload;

  // Validate mode
  if (!(TYPING_TEST_MODES as readonly number[]).includes(mode)) {
    return NextResponse.json(
      { error: 'Invalid mode. Must be 15, 30, or 60.' },
      { status: 400 },
    );
  }

  const multiplayerSessionId =
    typeof payload.multiplayerSessionId === 'string'
      ? payload.multiplayerSessionId.trim()
      : null;
  if (payload.multiplayerSessionId !== undefined && !multiplayerSessionId) {
    return NextResponse.json(
      { error: 'Invalid multiplayer session.' },
      { status: 400 },
    );
  }

  if (multiplayerSessionId) {
    const duelSnapshot = await getTypingDuelSnapshot(multiplayerSessionId);
    if (!duelSnapshot) {
      return NextResponse.json(
        { error: 'Typing duel not found.' },
        { status: 404 },
      );
    }
    if (!duelSnapshot.players.some((player) => player.userId === identity.userId)) {
      return NextResponse.json(
        { error: 'You are not a player in this typing duel.' },
        { status: 403 },
      );
    }
    if (duelSnapshot.session.status !== 'active') {
      return NextResponse.json(
        { error: 'This typing duel is not active.' },
        { status: 409 },
      );
    }
    if (duelSnapshot.results.some((result) => result.userId === identity.userId)) {
      return NextResponse.json(
        { error: 'You already submitted a result for this duel.' },
        { status: 409 },
      );
    }
  }

  // Validate game session token
  const clientWpm = typeof payload.wpm === 'number' ? payload.wpm : 0;
  const sessionValidation = await validateGameSession(
    sessionToken,
    identity.userId,
    'typing-test',
    clientWpm,
    { mode },
    { consumeSession: false },
  );

  if (!sessionValidation.valid) {
    return rejectScore('typing-test', {
      userId: identity.userId,
      userName: identityName,
      score: clientWpm,
      modeSec: mode,
      stage: 'session',
      reason: sessionValidation.error ?? 'Invalid game session.',
      publicMessage: 'Invalid game session.',
    });
  }

  // === SERVER-SIDE SCORE COMPUTATION ===
  // Replay timestamped key events within the session mode window.
  // This prevents late-injected keystrokes from affecting score computation.
  const typingSeed = sessionValidation.session?.typingSeed;
  if (typingSeed === undefined) {
    return rejectScore('typing-test', {
      userId: identity.userId,
      userName: identityName,
      score: clientWpm,
      modeSec: mode,
      stage: 'session',
      reason: 'Missing typing seed for session',
      publicMessage: 'Invalid game session.',
    });
  }

  const sessionModeSec = sessionValidation.session?.modeSec ?? mode;
  const sessionId = sessionValidation.session?.sessionId;
  const startedAt = sessionValidation.session?.startedAt ?? Date.now();
  const allTypingEvents = sessionId
    ? (await getGameEvents(sessionId)).filter(
        (event) =>
          event.eventType === 'key' || event.eventType === 'typing_prev_word',
      )
    : [];

  const isSingleCharKey = (value: unknown): value is string =>
    typeof value === 'string' && value.length === 1;

  // Typing timer begins on first keypress in the UI, not at session creation.
  // Anchor the authoritative scoring window to the first recorded key event.
  const firstKeyTs = allTypingEvents.find(
    (event) =>
      event.eventType === 'key' &&
      isSingleCharKey((event.data as { key?: unknown } | undefined)?.key),
  )?.ts;
  const replayWindowEndTs =
    typeof firstKeyTs === 'number'
      ? firstKeyTs + sessionModeSec * 1000 + 300
      : startedAt + sessionModeSec * 1000 + 300;

  const replayEvents = allTypingEvents
    .filter((event) => event.ts <= replayWindowEndTs)
    .sort((a, b) => {
      if (a.ts !== b.ts) return a.ts - b.ts;
      const seqA = (a.data as { seq?: unknown } | undefined)?.seq;
      const seqB = (b.data as { seq?: unknown } | undefined)?.seq;
      const normA = typeof seqA === 'number' ? seqA : Number.MAX_SAFE_INTEGER;
      const normB = typeof seqB === 'number' ? seqB : Number.MAX_SAFE_INTEGER;
      return normA - normB;
    });

  const keyEvents = replayEvents.filter((event) => event.eventType === 'key');
  const hasPostCutoffKeyEvents = allTypingEvents.some(
    (event) => event.ts > replayWindowEndTs,
  );

  if (keyEvents.length === 0) {
    return rejectScore('typing-test', {
      userId: identity.userId,
      userName: identityName,
      score: clientWpm,
      modeSec: mode,
      stage: 'server-events',
      reason: 'No key events recorded inside session time window',
      publicMessage: 'Invalid game session.',
    });
  }

  const timedKeystrokes = replayEvents
    .map((event) => {
      if (event.eventType === 'typing_prev_word') {
        return TYPING_PREV_WORD_TOKEN;
      }
      const data = event.data as { key?: unknown } | undefined;
      return isSingleCharKey(data?.key) ? data.key : null;
    })
    .filter(
      (key): key is string =>
        key === TYPING_PREV_WORD_TOKEN || isSingleCharKey(key),
    );

  if (timedKeystrokes.length === 0) {
    return rejectScore('typing-test', {
      userId: identity.userId,
      userName: identityName,
      score: clientWpm,
      modeSec: mode,
      stage: 'server-events',
      reason: 'No valid typed keys recorded inside session time window',
      publicMessage: 'Invalid game session.',
    });
  }

  const replay = replayTypingSession(typingSeed, timedKeystrokes, sessionModeSec);
  const {
    wpm,
    rawWpm,
    accuracy,
    correctChars,
    incorrectChars,
    totalChars,
    wordsCompleted,
  } = replay;

  const keyActions: ActionEntry[] = keyEvents
    .map((event) => {
      const data = event.data as { key?: unknown; seq?: unknown } | undefined;
      if (
        typeof data?.key !== 'string' ||
        data.key.length !== 1 ||
        typeof data.seq !== 'number'
      ) {
        return null;
      }
      return {
        t: Math.max(0, event.ts - startedAt),
        d: { key: data.key, seq: data.seq },
      } as ActionEntry;
    })
    .filter(Boolean) as ActionEntry[];
  if (keyEvents.length === 0 || keyActions.length === 0) {
    return rejectScore('typing-test', {
      userId: identity.userId,
      userName: identityName,
      score: wpm,
      modeSec: mode,
      stage: 'server-events',
      reason: 'No valid key events recorded for session',
      publicMessage: 'Invalid game session.',
    });
  }

  const isAllowedTypingKey = (key: string) => {
    if (key === '\b' || key === ' ') return true;
    const code = key.charCodeAt(0);
    return code >= 32 && code <= 126;
  };
  let previousSeq = -1;
  for (const action of keyActions) {
    const data = action.d as { key: string; seq: number };
    if (!isAllowedTypingKey(data.key) || !Number.isInteger(data.seq)) {
      return rejectScore('typing-test', {
        userId: identity.userId,
        userName: identityName,
        score: wpm,
        modeSec: mode,
        stage: 'server-events',
        reason: 'Invalid key payload in server event stream',
      });
    }
    if (data.seq <= previousSeq) {
      return rejectScore('typing-test', {
        userId: identity.userId,
        userName: identityName,
        score: wpm,
        modeSec: mode,
        stage: 'server-events',
        reason: `Out-of-order key sequence detected (seq=${data.seq}, previous=${previousSeq})`,
      });
    }
    previousSeq = data.seq;
  }

  if (keyEvents.length > 10) {
    const firstTs = keyEvents[0]?.ts ?? 0;
    const lastTs = keyEvents[keyEvents.length - 1]?.ts ?? firstTs;
    const spanMs = Math.max(1, lastTs - firstTs);
    const keysPerSec = keyEvents.length / (spanMs / 1000);
    const maxKeysPerSec = TYPING_MAX_KEYS_PER_SEC;
    if (keysPerSec > maxKeysPerSec) {
      return rejectScore('typing-test', {
        userId: identity.userId,
        userName: identityName,
        score: wpm,
        modeSec: mode,
        stage: 'rate-limit',
        reason: `Keystroke rate too high (${keysPerSec.toFixed(2)} keys/s)`,
      });
    }

    // Sliding window burst check (1s window)
    let maxWindow = 0;
    let left = 0;
    for (let right = 0; right < keyEvents.length; right++) {
      const rightTs = keyEvents[right]!.ts;
      while (rightTs - keyEvents[left]!.ts > 1000) {
        left += 1;
      }
      const windowCount = right - left + 1;
      if (windowCount > maxWindow) maxWindow = windowCount;
    }
    if (maxWindow > maxKeysPerSec) {
      return rejectScore('typing-test', {
        userId: identity.userId,
        userName: identityName,
        score: wpm,
        modeSec: mode,
        stage: 'rate-limit',
        reason: `Keystroke burst too high (${maxWindow} keys in 1s window)`,
      });
    }
  }

  if (hasPostCutoffKeyEvents) {
    console.warn(
      `Typing session had key events after cutoff (session=${sessionId})`,
    );
  }

  // Validate server-computed values are within human capability
  if (wpm > TYPING_MAX_WPM) {
    return rejectScore('typing-test', {
      userId: identity.userId,
      userName: identityName,
      score: wpm,
      modeSec: mode,
      stage: 'hard-cap',
      reason: `WPM exceeds cap (${wpm})`,
    });
  }

  // Anti-cheat validation (using server-computed values)
  const previousBest = await db
    .select({ wpm: typingTestScores.wpm })
    .from(typingTestScores)
    .where(
      and(
        eq(typingTestScores.odUserId, identity.userId),
        eq(typingTestScores.mode, mode),
      ),
    )
    .orderBy(desc(typingTestScores.wpm))
    .limit(1)
    .then((rows) => rows[0]?.wpm ?? null);

  const antiCheat = await runAntiCheat({
    gameType: 'typing-test',
    userId: identity.userId,
    userName: identityName,
    score: wpm,
    actions: keyActions,
    env: env ?? null,
    previousBest,
    sessionDurationMs: sessionValidation.session?.durationMs,
    serverActionCount: sessionValidation.session?.actionCount,
    serverActionCounts: sessionValidation.session?.actionCounts,
    claimedWpm: wpm,
    claimedAccuracy: accuracy,
    claimedCorrectChars: correctChars,
    claimedIncorrectChars: incorrectChars,
    modeDurationSec: sessionModeSec,
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

      // Check for existing score for this user and mode
      const existing = (
        await db
          .select()
          .from(typingTestScores)
          .where(
            and(
              eq(typingTestScores.odUserId, identity.userId),
              eq(typingTestScores.mode, mode),
            ),
          )
          .limit(1)
      )[0];

      await db
        .insert(typingTestScores)
        .values({
          id: crypto.randomUUID(),
          odUserId: identity.userId,
          userName,
          wpm,
          rawWpm,
          accuracy,
          mode,
          correctChars,
          incorrectChars,
          totalChars,
          wordsCompleted,
          createdAt: now,
        })
        .onConflictDoUpdate({
          target: [typingTestScores.odUserId, typingTestScores.mode],
          set: {
            userName,
            wpm,
            rawWpm,
            accuracy,
            correctChars,
            incorrectChars,
            totalChars,
            wordsCompleted,
            createdAt: now,
          },
          where: sql`excluded.wpm > ${typingTestScores.wpm} OR (excluded.wpm = ${typingTestScores.wpm} AND excluded.accuracy > ${typingTestScores.accuracy})`,
        });
      await recordScoreEvent({
        gameSlug: 'typing-test',
        userId: identity.userId,
        userName,
        score: wpm,
        mode,
      }).catch(() => {});
      const reward = await awardGameRunCredits({
        userId: identity.userId,
        context: { gameType: 'typing-test', wpm, mode: mode as 15 | 30 | 60 },
        sourceId: `typing:${sessionId ?? crypto.randomUUID()}`,
        meta: {
          mode,
          wpm,
          accuracy,
          antiCheat: antiCheat.severity ?? 'pass',
        },
      });
      const achievements = await recordRunAchievements(
        identity.userId,
        { gameType: 'typing-test', wpm, mode: mode as 15 | 30 | 60 },
        reward,
        { durationMs: sessionModeSec * 1000, typingAccuracy: accuracy, typingWords: wordsCompleted },
      );
      await recordGameTimeMetric({
        userId: identity.userId,
        gameType: 'typing-test',
        durationMs: sessionModeSec * 1000,
        playedAtMs: now,
      });
      if (multiplayerSessionId) {
        await recordTypingDuelResult({
          sessionId: multiplayerSessionId,
          userId: identity.userId,
          userName,
          gameSessionId: sessionId ?? null,
          modeSec: sessionModeSec,
          wpm,
          rawWpm,
          accuracy,
          correctChars,
          incorrectChars,
          totalChars,
          wordsCompleted,
          now,
        });
      }

      // Fetch updated leaderboard for this mode
      const leaderboard = await db
        .select()
        .from(typingTestScores)
        .where(eq(typingTestScores.mode, mode))
        .orderBy(desc(typingTestScores.wpm))
        .limit(SCORE_RESPONSE_LEADERBOARD_LIMIT);

      broadcast('gameLeaderboards', {
        gameType: 'typing-test',
        mode,
        updatedAt: now,
      });

      return {
        success: true,
        multiplayerResult: multiplayerSessionId
          ? { sessionId: multiplayerSessionId }
          : undefined,
        isNewPB: !existing || wpm > existing.wpm,
        reward,
        achievements,
        leaderboard: leaderboard.map((entry) => ({
          id: entry.id,
          userId: entry.odUserId,
          userName: entry.userName,
          wpm: entry.wpm,
          accuracy: entry.accuracy,
        })),
      };
    },
  });
}
