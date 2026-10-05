import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { eq, and } from 'drizzle-orm';
import { db } from '@/server/db/client';
import { pangramScores } from '@/server/db/schema';
import { requireIdentity } from '@/server/auth';
import { broadcast } from '@/server/events';
import { awardGameRunCredits } from '@/server/arcade/rewards';
import { recordRunAchievements } from '../../_shared/run-achievements';
import { addAntiCheatLog } from '@/server/arcade/anti-cheat-logs';
import { ensureNotGameBanned } from '../../_shared/ban-helpers';
import { recordGameTimeMetric } from '@/server/arcade/game-time-metrics';
import { getUtcDateKey, finalizeScore } from '@/server/arcade/pangram';
import { applyDailyPangramOverride } from '@/server/arcade/daily-puzzle-pool';

type ScorePayload = {
  puzzleDate?: string;
  words?: unknown;
  timeSeconds?: number;
};

const logPangramReject = async (params: {
  userId: string;
  userName?: string | null;
  score: number;
  stage: string;
  reason: string;
}) => {
  try {
    await addAntiCheatLog({
      ts: Date.now(),
      gameType: 'pangram',
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
    console.error('Failed to write pangram anti-cheat reject log:', error);
  }
};

const logPangramPass = async (params: {
  userId: string;
  userName?: string | null;
  score: number;
  reason: string;
}) => {
  try {
    await addAntiCheatLog({
      ts: Date.now(),
      gameType: 'pangram',
      userId: params.userId,
      userName: params.userName,
      score: params.score,
      result: 'pass',
      reason: params.reason,
      stage: 'complete',
      checks: [],
    });
  } catch (error) {
    console.error('Failed to write pangram anti-cheat pass log:', error);
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
  const timeSeconds = payload?.timeSeconds;
  const identityName = identity.name || null;

  if (
    typeof puzzleDate !== 'string' ||
    !Array.isArray(payload?.words) ||
    typeof timeSeconds !== 'number'
  ) {
    await logPangramReject({
      userId: identity.userId,
      userName: identityName,
      score: 0,
      stage: 'payload',
      reason: 'Invalid score payload shape',
    });
    return NextResponse.json({ error: 'Invalid score data.' }, { status: 400 });
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(puzzleDate)) {
    await logPangramReject({
      userId: identity.userId,
      userName: identityName,
      score: 0,
      stage: 'payload',
      reason: `Invalid puzzle date format: ${puzzleDate}`,
    });
    return NextResponse.json({ error: 'Invalid puzzle date format.' }, { status: 400 });
  }

  // Only accept today's UTC date.
  const todayKey = getUtcDateKey();
  if (puzzleDate !== todayKey) {
    await logPangramReject({
      userId: identity.userId,
      userName: identityName,
      score: 0,
      stage: 'puzzle-date',
      reason: `Submission for non-today puzzle date ${puzzleDate} (today=${todayKey})`,
    });
    return NextResponse.json(
      { error: 'Score submissions are only accepted for today\'s puzzle.' },
      { status: 400 },
    );
  }

  if (!Number.isFinite(timeSeconds) || timeSeconds < 0 || timeSeconds > 86400) {
    await logPangramReject({
      userId: identity.userId,
      userName: identityName,
      score: 0,
      stage: 'validation',
      reason: `Invalid timeSeconds=${timeSeconds}`,
    });
    return NextResponse.json({ error: 'Invalid score values.' }, { status: 400 });
  }

  // Cap submitted word list size to avoid abuse; re-validate authoritatively.
  const submittedWords = (payload.words as unknown[]).slice(0, 500);

  // SERVER-AUTHORITATIVE: ignore any client-claimed score; re-grade every word.
  // INVARIANT: keep this override apply adjacent to the synchronous grade below —
  // never insert an `await` between them. The override is a per-process Map; an
  // interleaved request for another day could swap it out mid-grade.
  await applyDailyPangramOverride(todayKey);
  const { score, wordsFound, pangrams, missedWords } = finalizeScore(todayKey, submittedWords);

  const timestamp = Date.now();
  const safeTime = Math.round(timeSeconds * 10) / 10;

  try {
    // Read-then-insert dedup (paired with the UNIQUE (od_user_id, puzzle_date)
    // index + ON CONFLICT DO NOTHING for race safety) = the per-day lock.
    const existing = (
      await db
        .select()
        .from(pangramScores)
        .where(
          and(
            eq(pangramScores.odUserId, identity.userId),
            eq(pangramScores.puzzleDate, puzzleDate),
          ),
        )
        .limit(1)
    )[0];

    if (existing) {
      return NextResponse.json({
        success: true,
        duplicate: true,
        message: 'Score already submitted for this date.',
        missedWords,
      });
    }

    const userName = identity.name || 'Anonymous';

    const inserted = await db
      .insert(pangramScores)
      .values({
        id: crypto.randomUUID(),
        odUserId: identity.userId,
        userName,
        puzzleDate,
        score,
        wordsFound,
        pangrams,
        timeSeconds: safeTime,
        createdAt: timestamp,
      })
      .onConflictDoNothing({
        target: [pangramScores.odUserId, pangramScores.puzzleDate],
      })
      .returning({ id: pangramScores.id });

    // Lost the race to a concurrent insert — treat as duplicate, no double reward.
    if (inserted.length === 0) {
      return NextResponse.json({
        success: true,
        duplicate: true,
        message: 'Score already submitted for this date.',
      });
    }

    await logPangramPass({
      userId: identity.userId,
      userName: identityName,
      score,
      reason: `Accepted pangram run (score=${score}, wordsFound=${wordsFound}, pangrams=${pangrams}, timeSeconds=${safeTime})`,
    });

    const reward = await awardGameRunCredits({
      userId: identity.userId,
      context: { gameType: 'pangram', score, pangrams },
      sourceId: `pangram:${puzzleDate}`,
      meta: {
        puzzleDate,
        score,
        wordsFound,
        pangrams,
        timeSeconds: safeTime,
      },
    });
    const achievements = await recordRunAchievements(
      identity.userId,
      { gameType: 'pangram', score, pangrams },
      reward,
      { durationMs: Math.round(safeTime * 1000) },
    );

    await recordGameTimeMetric({
      userId: identity.userId,
      gameType: 'pangram',
      durationMs: Math.round(safeTime * 1000),
      playedAtMs: timestamp,
    });

    broadcast('gameLeaderboards', {
      gameType: 'pangram',
      puzzleDate,
      updatedAt: timestamp,
    });

    return NextResponse.json({
      success: true,
      reward,
      achievements,
      score,
      wordsFound,
      pangrams,
      missedWords,
    });
  } catch (error) {
    console.error('Failed to save pangram score:', error);
    return NextResponse.json({ error: 'Failed to save score.' }, { status: 500 });
  }
}
