import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { desc } from 'drizzle-orm';
import { db, query } from '@/server/db/client';
import { tetrisScores } from '@/server/db/schema';
import { broadcast } from '@/server/events';
import { consumeGameSessionOrReject, validateGameSession } from '@/server/arcade/game-session';
import { getGameEvents } from '@/server/arcade/game-events';
import { awardGameRunCredits } from '@/server/arcade/rewards';
import { recordRunAchievements } from '../../_shared/run-achievements';
import { recordGameTimeMetric } from '@/server/arcade/game-time-metrics';
import { recordScoreEvent } from '@/server/arcade/score-events';
import { recordHighScoreIfBeaten } from '@/server/services/activity-events';
import { addAntiCheatLog } from '@/server/arcade/anti-cheat-logs';
import { consumeContinueForGameRun } from '@/server/monetization/continued-runs';
import {
  authenticateGamePlayer,
  isErrorResponse,
  parsePayload,
  type BaseScorePayload,
} from '../../_shared/score-helpers';
import { SCORE_RESPONSE_LEADERBOARD_LIMIT } from '../../_shared/constants';

type TetrisScorePayload = BaseScorePayload & {
  level?: number;
  lines?: number;
  stats?: {
    piecesPlaced?: number;
    tSpins?: number;
    singles?: number;
    doubles?: number;
    triples?: number;
    tetrises?: number;
    maxCombo?: number;
    totalInputs?: number;
  };
};

const TETRIS_MAX_CLIENT_SCORE = 10_000_000;
const TETRIS_MAX_PIECES_PER_MINUTE = 80;

export async function GET() {
  return NextResponse.json({ error: 'Use POST to submit scores.' }, { status: 405 });
}

export async function POST(request: Request) {
  const authResult = await authenticateGamePlayer('tetris');
  if (isErrorResponse(authResult)) return authResult;
  const { identity, identityName } = authResult;

  const payload = await parsePayload<TetrisScorePayload>(request);
  if (payload instanceof NextResponse) return payload;

  if (
    typeof payload?.score !== 'number' ||
    typeof payload?.sessionToken !== 'string'
  ) {
    return NextResponse.json(
      { error: 'Invalid score data. Session token required.' },
      { status: 400 },
    );
  }

  const clientScore = Math.floor(payload.score);
  const continuedRun = payload.continued === true;
  const clientLevel = typeof payload.level === 'number' ? Math.floor(payload.level) : 1;
  const clientLines = typeof payload.lines === 'number' ? Math.floor(payload.lines) : 0;
  const clientDurationMs =
    typeof payload.clientDurationMs === 'number' &&
    Number.isFinite(payload.clientDurationMs) &&
    payload.clientDurationMs >= 0
      ? payload.clientDurationMs
      : null;

  if (!Number.isFinite(clientScore) || clientScore < 0 || clientScore > TETRIS_MAX_CLIENT_SCORE) {
    return NextResponse.json({ error: 'Invalid score value.' }, { status: 400 });
  }

  // Validate game session
  const sessionValidation = await validateGameSession(
    payload.sessionToken,
    identity.userId,
    'tetris',
    clientScore,
    undefined,
    { consumeSession: false },
  );

  if (!sessionValidation.valid) {
    await addAntiCheatLog({
      ts: Date.now(),
      gameType: 'tetris',
      userId: identity.userId,
      userName: identityName,
      score: clientScore,
      result: 'reject',
      severity: 'reject',
      reason: sessionValidation.error ?? 'Invalid session',
      stage: 'session',
      checks: [],
    }).catch(() => {});
    return NextResponse.json({ error: 'Invalid game session.' }, { status: 403 });
  }

  const sessionId = sessionValidation.session?.sessionId;
  const sessionDurationMs = sessionValidation.session?.durationMs ?? 0;
  // `durationMs` is used for anti-cheat ratio checks (PPM, IPS, duration
  // sanity) — we need *some* denominator, so fall back to wall-clock if
  // the client didn't supply one.
  const durationMs = clientDurationMs ?? sessionDurationMs;
  // `activePlayTimeMs` is used for persisted play time (leaderboard
  // aggregate + game-time-metrics). This must only come from the client's
  // engine.activePlayTime — it excludes pauses, pre-game menu time, and
  // the idle between session creation and score submit. Falling back to
  // the session wall-clock here inflated tetris time by menu + dialog
  // idle, which is what we were seeing. If the client doesn't report a
  // duration we refuse to make one up and record 0 instead.
  const activePlayTimeMs =
    clientDurationMs != null ? Math.round(clientDurationMs) : 0;
  const clientStats = payload.stats;
  const durationMinutes = durationMs / 60000;

  // ---------------------------------------------------------------------------
  // Server-side action counting from game events
  // piece_lock events are the authoritative record of how many pieces were
  // placed. Client-reported totalInputs is kept separate (it counts
  // move/rotate/drop/hold key presses, not piece locks).
  // ---------------------------------------------------------------------------
  let serverPieceLocks = 0;
  let hasServerEvents = false;
  if (sessionId) {
    const events = await getGameEvents(sessionId, 'piece_lock');
    serverPieceLocks = events.length;
    hasServerEvents = serverPieceLocks > 0;
  }

  const clientPiecesPlaced = clientStats?.piecesPlaced ?? 0;
  // Prefer server-recorded piece count; fall back to client only when no WS data
  const piecesPlaced = hasServerEvents ? serverPieceLocks : clientPiecesPlaced;
  const tSpinsCount = clientStats?.tSpins ?? 0;
  // totalInputs is always client-reported (WS only records piece_lock, not every keystroke)
  const clientTotalInputs = clientStats?.totalInputs ?? 0;

  // ---------------------------------------------------------------------------
  // Anticheat checks
  // ---------------------------------------------------------------------------
  const acChecks: string[] = [];
  let acResult: 'pass' | 'flag' | 'reject' = 'pass';
  let acReason = '';

  // 0. Missing server event stream — flag non-trivial runs without WS evidence
  if (!hasServerEvents && clientScore > 500) {
    acChecks.push('no-server-events');
    acResult = 'flag';
    acReason += 'No server-recorded piece_lock events (WS missing). ';
  }

  // 1. Pieces per minute (uses authoritative piece count)
  if (durationMinutes > 0.5 && piecesPlaced > 0) {
    const ppmVal = piecesPlaced / durationMinutes;
    if (ppmVal > TETRIS_MAX_PIECES_PER_MINUTE) {
      acChecks.push('pieces-per-minute');
      acResult = 'flag';
      acReason += `PPM=${ppmVal.toFixed(1)}. `;
    }
  }

  // 2. Score-to-lines ratio
  if (clientLines > 0 && clientScore / clientLines > 5000) {
    acChecks.push('score-lines-ratio');
    acResult = 'flag';
    acReason += `Score/lines=${(clientScore / clientLines).toFixed(0)}. `;
  }

  // 3. T-Spin proportion
  if (piecesPlaced > 20 && tSpinsCount > 0 && tSpinsCount / piecesPlaced > 0.4) {
    acChecks.push('tspin-rate');
    acResult = 'flag';
    acReason += `T-Spin rate=${((tSpinsCount / piecesPlaced) * 100).toFixed(1)}%. `;
  }

  // 4. Input rate (client-reported, not piece locks)
  if (durationMs > 5000 && clientTotalInputs > 0) {
    const ips = clientTotalInputs / (durationMs / 1000);
    if (ips > 15) {
      acChecks.push('input-rate');
      acResult = 'flag';
      acReason += `Inputs/sec=${ips.toFixed(1)}. `;
    }
  }

  // 5. Duration sanity — only HARD-REJECT when the authoritative piece count
  // also can't justify a real game. `durationMs` is client-reported (it falls
  // back to wall-clock only when absent), so a clock anomaly or a tab restored
  // from sleep can under-report it for a genuine run. Such a run still placed
  // real pieces (serverPieceLocks when WS is present), so we never reject it on
  // the client clock alone — a piece-corroborated run is flagged for review
  // instead of blocked. A sub-2s run with a positive score and almost no pieces
  // is physically impossible in real play, so that case is still rejected.
  if (durationMs > 0 && durationMs < 2000 && clientScore > 0) {
    if (piecesPlaced < 10) {
      acChecks.push('duration-too-short');
      acResult = 'reject';
      acReason += 'Game too short and too few pieces for claimed score. ';
    } else {
      acChecks.push('duration-too-short-flagged');
      if (acResult === 'pass') acResult = 'flag';
      acReason += 'Short duration but pieces corroborate score. ';
    }
  }

  // 6. Server vs client piece count mismatch
  if (hasServerEvents && clientPiecesPlaced > 0) {
    const mismatch = Math.abs(serverPieceLocks - clientPiecesPlaced);
    if (mismatch > Math.max(3, clientPiecesPlaced * 0.2)) {
      acChecks.push('server-action-mismatch');
      acResult = 'flag';
      acReason += `Server pieces=${serverPieceLocks} vs client=${clientPiecesPlaced}. `;
    }
  }

  // Build structured run data for the log
  const ppmVal = durationMinutes > 0 ? piecesPlaced / durationMinutes : 0;
  const runData = {
    score: clientScore, level: clientLevel, lines: clientLines,
    piecesPlaced, tSpins: tSpinsCount,
    durationMs: Math.round(durationMs),
    ppm: Math.round(ppmVal * 10) / 10,
    scoreLinesRatio: clientLines > 0 ? Math.round(clientScore / clientLines) : 0,
    clientTotalInputs, hasServerEvents, serverPieceLocks,
    singles: clientStats?.singles ?? 0, doubles: clientStats?.doubles ?? 0,
    triples: clientStats?.triples ?? 0, tetrises: clientStats?.tetrises ?? 0,
    maxCombo: clientStats?.maxCombo ?? 0,
  };

  const reasonStr = acResult === 'pass'
    ? `OK | ${JSON.stringify(runData)}`
    : `${acReason}| ${JSON.stringify(runData)}`;

  await addAntiCheatLog({
    ts: Date.now(), gameType: 'tetris',
    userId: identity.userId, userName: identityName, score: clientScore,
    result: acResult,
    severity: acResult === 'pass' ? undefined : acResult,
    reason: reasonStr,
    stage: acResult === 'pass' ? 'complete' : 'behavioral',
    checks: acChecks,
  }).catch(() => {});

  if (acResult === 'reject') {
    return NextResponse.json({ error: 'Score validation failed.' }, { status: 403 });
  }

  // ---------------------------------------------------------------------------
  // Persist — separate score PB and lines PB + aggregates
  // ---------------------------------------------------------------------------
  try {
    const now = Date.now();
    const userName = identityName || 'Anonymous';

    // Atomically claim the session first (both branches): a losing duplicate
    // submit throws a 409 here — caught below — and performs zero writes.
    if (sessionId) {
      await consumeGameSessionOrReject(sessionId, identity.userId);
    }

    if (continuedRun) {
      const entitlement = await consumeContinueForGameRun({
        userId: identity.userId,
        gameType: 'tetris',
        score: clientScore,
        sessionId,
        meta: {
          level: clientLevel,
          lines: clientLines,
          durationMs: activePlayTimeMs,
        },
      });

      await recordGameTimeMetric({
        userId: identity.userId,
        gameType: 'tetris',
        durationMs: activePlayTimeMs,
        playedAtMs: now,
      });

      const leaderboard = await db
        .select()
        .from(tetrisScores)
        .orderBy(desc(tetrisScores.score))
        .limit(SCORE_RESPONSE_LEADERBOARD_LIMIT);

      return NextResponse.json({
        success: true,
        continued: true,
        reward: null,
        entitlement: {
          type: 'continue',
          balanceAfter: entitlement.balanceAfter,
        },
        leaderboard: leaderboard.map((entry) => ({
          id: entry.id, userName: entry.userName, score: entry.score,
          level: entry.level, lines: entry.lines,
        })),
      });
    }

    await recordHighScoreIfBeaten({
      userId: identity.userId,
      gameSlug: 'tetris',
      table: 'tetris_scores',
      userColumn: 'od_user_id',
      scoreColumn: 'score',
      newScore: clientScore,
    });

    await query(
      `
        INSERT INTO tetris_scores (
          id, od_user_id, user_name,
          score, level, lines,
          best_lines, best_lines_score, best_lines_level, best_lines_created_at,
          total_games, total_lines, total_play_time_ms,
          created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 1, $11, $12, $13)
        ON CONFLICT(od_user_id) DO UPDATE SET
          user_name = excluded.user_name,
          score = CASE WHEN excluded.score > tetris_scores.score
                         OR (excluded.score = tetris_scores.score AND excluded.lines < tetris_scores.lines)
                       THEN excluded.score ELSE tetris_scores.score END,
          level = CASE WHEN excluded.score > tetris_scores.score
                         OR (excluded.score = tetris_scores.score AND excluded.lines < tetris_scores.lines)
                       THEN excluded.level ELSE tetris_scores.level END,
          lines = CASE WHEN excluded.score > tetris_scores.score
                         OR (excluded.score = tetris_scores.score AND excluded.lines < tetris_scores.lines)
                       THEN excluded.lines ELSE tetris_scores.lines END,
          best_lines = CASE WHEN excluded.best_lines > tetris_scores.best_lines THEN excluded.best_lines ELSE tetris_scores.best_lines END,
          best_lines_score = CASE WHEN excluded.best_lines > tetris_scores.best_lines THEN excluded.best_lines_score ELSE tetris_scores.best_lines_score END,
          best_lines_level = CASE WHEN excluded.best_lines > tetris_scores.best_lines THEN excluded.best_lines_level ELSE tetris_scores.best_lines_level END,
          best_lines_created_at = CASE WHEN excluded.best_lines > tetris_scores.best_lines THEN excluded.best_lines_created_at ELSE tetris_scores.best_lines_created_at END,
          total_games = tetris_scores.total_games + 1,
          total_lines = tetris_scores.total_lines + excluded.total_lines,
          total_play_time_ms = tetris_scores.total_play_time_ms + excluded.total_play_time_ms,
          created_at = CASE WHEN excluded.score > tetris_scores.score
                             OR (excluded.score = tetris_scores.score AND excluded.lines < tetris_scores.lines)
                           THEN excluded.created_at ELSE tetris_scores.created_at END
      `,
      [
        crypto.randomUUID(),
        identity.userId,
        userName,
        clientScore,
        clientLevel,
        clientLines,
        clientLines,
        clientScore,
        clientLevel,
        now,
        clientLines,
        activePlayTimeMs,
        now,
      ],
    );

    await recordScoreEvent({
      gameSlug: 'tetris',
      userId: identity.userId,
      userName,
      score: clientScore,
    }).catch(() => {});

    const reward = await awardGameRunCredits({
      userId: identity.userId,
      context: { gameType: 'tetris' as const, score: clientScore },
      sourceId: `tetris:${sessionId ?? 'nosession'}`,
      meta: { score: clientScore, level: clientLevel, lines: clientLines },
    });
    const achievements = await recordRunAchievements(
      identity.userId,
      { gameType: 'tetris' as const, score: clientScore },
      reward,
      { durationMs: activePlayTimeMs, tetrisLines: clientLines, tetrisLevel: clientLevel, tetrisTetrises: clientStats?.tetrises ?? 0 },
    );

    await recordGameTimeMetric({
      userId: identity.userId,
      gameType: 'tetris',
      durationMs: activePlayTimeMs,
      playedAtMs: now,
    });

    const leaderboard = await db
      .select()
      .from(tetrisScores)
      .orderBy(desc(tetrisScores.score))
      .limit(SCORE_RESPONSE_LEADERBOARD_LIMIT);

    broadcast('gameLeaderboards', { gameType: 'tetris', updatedAt: now });

    return NextResponse.json({
      success: true,
      reward,
      achievements,
      leaderboard: leaderboard.map((entry) => ({
        id: entry.id, userName: entry.userName, score: entry.score,
        level: entry.level, lines: entry.lines,
      })),
    });
  } catch (error) {
    const routeError = error as Error & { status?: number };
    if (
      typeof routeError.status === 'number' &&
      routeError.status >= 400 &&
      routeError.status < 500
    ) {
      return NextResponse.json(
        { error: routeError.message || 'Failed to save score.' },
        { status: routeError.status },
      );
    }
    console.error('Failed to save Tetris score:', error);
    return NextResponse.json({ error: 'Failed to save score.' }, { status: 500 });
  }
}
