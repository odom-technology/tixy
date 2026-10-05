import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { eq, and } from 'drizzle-orm';
import { db } from '@/server/db/client';
import { wordGridScores } from '@/server/db/schema';
import { requireIdentity } from '@/server/auth';
import { broadcast } from '@/server/events';
import { awardGameRunCredits } from '@/server/arcade/rewards';
import { recordRunAchievements } from '../../_shared/run-achievements';
import { addAntiCheatLog } from '@/server/arcade/anti-cheat-logs';
import { ensureNotGameBanned } from '../../_shared/ban-helpers';
import { recordGameTimeMetric } from '@/server/arcade/game-time-metrics';
import {
  getUtcDateKey,
  isValidDateKey,
  getDailyAnswer,
  gradeWordGrid,
  isWinningGrade,
  WORD_GRID_MAX_GUESSES,
} from '@/server/arcade/word-grid';
import { applyDailyWordGridOverride } from '@/server/arcade/daily-puzzle-pool';

// Failed-run sentinel stored in the `guesses` column (1..6 = solved on that
// guess; 7 = did not solve).
const FAIL_GUESS_COUNT = WORD_GRID_MAX_GUESSES + 1;

type ScorePayload = {
  puzzleDate?: string;
  guesses?: unknown;
  timeSeconds?: number;
};

const logReject = async (params: {
  userId: string;
  userName?: string | null;
  score: number;
  stage: string;
  reason: string;
}) => {
  try {
    await addAntiCheatLog({
      ts: Date.now(),
      gameType: 'word-grid',
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
    console.error('Failed to write word-grid anti-cheat reject log:', error);
  }
};

const logPass = async (params: {
  userId: string;
  userName?: string | null;
  score: number;
  reason: string;
}) => {
  try {
    await addAntiCheatLog({
      ts: Date.now(),
      gameType: 'word-grid',
      userId: params.userId,
      userName: params.userName,
      score: params.score,
      result: 'pass',
      reason: params.reason,
      stage: 'complete',
      checks: [],
    });
  } catch (error) {
    console.error('Failed to write word-grid anti-cheat pass log:', error);
  }
};

export async function POST(request: Request) {
  let identity;
  try {
    identity = await requireIdentity({ allowExternal: true });
  } catch {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }

  const banResponse = await ensureNotGameBanned(identity.userId);
  if (banResponse) return banResponse;

  let payload: ScorePayload | null = null;
  try {
    payload = (await request.json()) as ScorePayload;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 });
  }

  const puzzleDate = payload?.puzzleDate;
  const timeSeconds = typeof payload?.timeSeconds === 'number' ? payload.timeSeconds : 0;
  const identityName = identity.name || null;

  // ── Payload shape ──────────────────────────────────────────────────────────
  if (!isValidDateKey(puzzleDate)) {
    await logReject({
      userId: identity.userId,
      userName: identityName,
      score: 0,
      stage: 'payload',
      reason: `Invalid puzzle date: ${String(puzzleDate)}`,
    });
    return NextResponse.json({ error: 'Invalid puzzle date format.' }, { status: 400 });
  }

  if (
    !Array.isArray(payload?.guesses) ||
    payload.guesses.length === 0 ||
    payload.guesses.length > WORD_GRID_MAX_GUESSES ||
    !payload.guesses.every(
      (g) => typeof g === 'string' && /^[a-z]{5}$/i.test(g.trim()),
    )
  ) {
    await logReject({
      userId: identity.userId,
      userName: identityName,
      score: 0,
      stage: 'payload',
      reason: 'Invalid guesses payload',
    });
    return NextResponse.json({ error: 'Invalid guesses.' }, { status: 400 });
  }

  if (!Number.isFinite(timeSeconds) || timeSeconds < 0 || timeSeconds > 86400) {
    await logReject({
      userId: identity.userId,
      userName: identityName,
      score: 0,
      stage: 'validation',
      reason: `Invalid timeSeconds=${timeSeconds}`,
    });
    return NextResponse.json({ error: 'Invalid score values.' }, { status: 400 });
  }

  // ── Only today's UTC puzzle is accepted ─────────────────────────────────────
  const todayKey = getUtcDateKey();
  if (puzzleDate !== todayKey) {
    await logReject({
      userId: identity.userId,
      userName: identityName,
      score: 0,
      stage: 'puzzle-date',
      reason: `Submission for non-today date ${puzzleDate} (today=${todayKey})`,
    });
    return NextResponse.json(
      { error: "Score submissions are only accepted for today's puzzle." },
      { status: 400 },
    );
  }

  // ── Server-authoritative re-grade (never trust the client) ──────────────────
  // INVARIANT: keep this override apply adjacent to the synchronous grade below —
  // never insert an `await` between them. The override is a per-process Map; an
  // interleaved request for another day could swap it out mid-grade.
  await applyDailyWordGridOverride(puzzleDate);
  const answer = getDailyAnswer(puzzleDate);
  const guesses = (payload.guesses as string[]).map((g) => g.trim().toLowerCase());

  let solved = false;
  let solvedAtGuess = 0; // 1-based index of the winning guess, 0 if none
  for (let i = 0; i < guesses.length; i++) {
    if (isWinningGrade(gradeWordGrid(guesses[i]!, answer))) {
      solved = true;
      solvedAtGuess = i + 1;
      break;
    }
  }

  // If the player claims a win, the winning guess must be the LAST one (you stop
  // playing once you solve). Otherwise the guess history is inconsistent.
  if (solved && solvedAtGuess !== guesses.length) {
    await logReject({
      userId: identity.userId,
      userName: identityName,
      score: 0,
      stage: 'regrade',
      reason: `Winning guess not last (won at ${solvedAtGuess}/${guesses.length})`,
    });
    return NextResponse.json({ error: 'Inconsistent guess history.' }, { status: 400 });
  }

  // A loss must have used all guesses.
  if (!solved && guesses.length !== WORD_GRID_MAX_GUESSES) {
    await logReject({
      userId: identity.userId,
      userName: identityName,
      score: 0,
      stage: 'regrade',
      reason: `Unsolved run with ${guesses.length}/${WORD_GRID_MAX_GUESSES} guesses`,
    });
    return NextResponse.json({ error: 'Inconsistent guess history.' }, { status: 400 });
  }

  const guessCount = solved ? solvedAtGuess : FAIL_GUESS_COUNT;
  const timestamp = Date.now();

  try {
    // ── Per-day lock: read-then-insert dedup (paired with the UNIQUE index +
    //    ON CONFLICT DO NOTHING the orchestrator adds in the migration). ───────
    const existing = (
      await db
        .select()
        .from(wordGridScores)
        .where(
          and(
            eq(wordGridScores.odUserId, identity.userId),
            eq(wordGridScores.puzzleDate, puzzleDate),
          ),
        )
        .limit(1)
    )[0];

    if (existing) {
      return NextResponse.json({
        success: true,
        duplicate: true,
        message: 'Score already submitted for this date.',
        // game is over for this user → safe to reveal so the UI can show it
        answer,
        solved: Boolean((existing as { solved?: unknown }).solved),
      });
    }

    const userName = identity.name || 'Anonymous';
    const roundedTime = Math.round(timeSeconds * 10) / 10;

    const inserted = await db
      .insert(wordGridScores)
      .values({
        id: crypto.randomUUID(),
        odUserId: identity.userId,
        userName,
        puzzleDate,
        guesses: guessCount,
        solved: solved ? 1 : 0,
        timeSeconds: roundedTime,
        createdAt: timestamp,
      })
      // Race-safe with the UNIQUE(od_user_id, puzzle_date) index.
      .onConflictDoNothing({
        target: [wordGridScores.odUserId, wordGridScores.puzzleDate],
      })
      .returning({ id: wordGridScores.id });

    // Lost the race to a concurrent insert — treat as duplicate, no double reward.
    if (inserted.length === 0) {
      return NextResponse.json({
        success: true,
        duplicate: true,
        message: 'Score already submitted for this date.',
        answer,
        solved,
      });
    }

    await logPass({
      userId: identity.userId,
      userName: identityName,
      score: solved ? WORD_GRID_MAX_GUESSES + 1 - guessCount : 0,
      reason: `Accepted word-grid run (solved=${solved ? 1 : 0}, guesses=${guessCount}, timeSeconds=${roundedTime})`,
    });

    const reward = await awardGameRunCredits({
      userId: identity.userId,
      context: { gameType: 'word-grid', solved, guesses: guessCount },
      sourceId: `word-grid:${puzzleDate}`,
      meta: { puzzleDate, solved, guesses: guessCount, timeSeconds: roundedTime },
    });
    const achievements = await recordRunAchievements(
      identity.userId,
      { gameType: 'word-grid', solved, guesses: guessCount },
      reward,
      { durationMs: Math.round(timeSeconds * 1000) },
    );

    await recordGameTimeMetric({
      userId: identity.userId,
      gameType: 'word-grid',
      durationMs: Math.round(timeSeconds * 1000),
      playedAtMs: timestamp,
    });

    broadcast('gameLeaderboards', {
      gameType: 'word-grid',
      puzzleDate,
      updatedAt: timestamp,
    });

    return NextResponse.json({
      success: true,
      reward,
      achievements,
      // game is over → safe to reveal the answer for the loss view
      answer,
      solved,
      guesses: guessCount,
    });
  } catch (error) {
    console.error('Failed to save word-grid score:', error);
    return NextResponse.json({ error: 'Failed to save score.' }, { status: 500 });
  }
}
