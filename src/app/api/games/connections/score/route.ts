import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { eq, and, asc } from 'drizzle-orm';
import { db } from '@/server/db/client';
import { connectionsScores, connectionsPuzzles } from '@/server/db/schema';
import { requireIdentity } from '@/server/auth';
import { broadcast } from '@/server/events';
import { awardGameRunCredits } from '@/server/arcade/rewards';
import { recordRunAchievements } from '../../_shared/run-achievements';
import { addAntiCheatLog } from '@/server/arcade/anti-cheat-logs';
import { ensureNotGameBanned } from '../../_shared/ban-helpers';
import { recordGameTimeMetric } from '@/server/arcade/game-time-metrics';
import { formatDateKey, isPuzzleDayWithBlackouts } from '@/server/arcade/connections-calendar';

type ScorePayload = {
  puzzleDate?: string;
  mistakes?: number;
  timeSeconds?: number;
  solved?: boolean;
};

const computeConnectionsScore = (mistakes: number, solved: boolean) =>
  solved ? Math.max(0, 4 - Math.floor(mistakes)) : 0;

const logConnectionsReject = async (params: {
  userId: string;
  userName?: string | null;
  score: number;
  stage: string;
  reason: string;
}) => {
  try {
    await addAntiCheatLog({
      ts: Date.now(),
      gameType: 'connections',
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
    console.error('Failed to write connections anti-cheat reject log:', error);
  }
};

const logConnectionsPass = async (params: {
  userId: string;
  userName?: string | null;
  score: number;
  reason: string;
}) => {
  try {
    await addAntiCheatLog({
      ts: Date.now(),
      gameType: 'connections',
      userId: params.userId,
      userName: params.userName,
      score: params.score,
      result: 'pass',
      reason: params.reason,
      stage: 'complete',
      checks: [],
    });
  } catch (error) {
    console.error('Failed to write connections anti-cheat pass log:', error);
  }
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

  const banResponse = await ensureNotGameBanned(identity.userId);
  if (banResponse) return banResponse;

  let payload: ScorePayload | null = null;
  try {
    payload = (await request.json()) as ScorePayload;
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON payload.' },
      { status: 400 },
    );
  }

  const puzzleDate = payload?.puzzleDate;
  const mistakes = payload?.mistakes;
  const timeSeconds = payload?.timeSeconds;
  const solved = payload?.solved;
  const identityName = identity.name || null;
  const submittedScore =
    typeof mistakes === 'number' && typeof solved === 'boolean'
      ? computeConnectionsScore(mistakes, solved)
      : 0;

  if (
    typeof puzzleDate !== 'string' ||
    typeof mistakes !== 'number' ||
    typeof timeSeconds !== 'number' ||
    typeof solved !== 'boolean'
  ) {
    await logConnectionsReject({
      userId: identity.userId,
      userName: identityName,
      score: submittedScore,
      stage: 'payload',
      reason: 'Invalid score payload shape',
    });
    return NextResponse.json(
      { error: 'Invalid score data.' },
      { status: 400 },
    );
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(puzzleDate)) {
    await logConnectionsReject({
      userId: identity.userId,
      userName: identityName,
      score: submittedScore,
      stage: 'payload',
      reason: `Invalid puzzle date format: ${puzzleDate}`,
    });
    return NextResponse.json(
      { error: 'Invalid puzzle date format.' },
      { status: 400 },
    );
  }

  // Only accept today's date
  const todayKey = formatDateKey(new Date());
  if (puzzleDate !== todayKey) {
    await logConnectionsReject({
      userId: identity.userId,
      userName: identityName,
      score: submittedScore,
      stage: 'puzzle-date',
      reason: `Submission for non-today puzzle date ${puzzleDate} (today=${todayKey})`,
    });
    return NextResponse.json(
      { error: 'Score submissions are only accepted for today\'s puzzle.' },
      { status: 400 },
    );
  }

  // Must be a valid puzzle day (not a holiday or blackout)
  if (!(await isPuzzleDayWithBlackouts(todayKey))) {
    await logConnectionsReject({
      userId: identity.userId,
      userName: identityName,
      score: submittedScore,
      stage: 'puzzle-availability',
      reason: `No puzzle available on ${todayKey}`,
    });
    return NextResponse.json(
      { error: 'No puzzle available today.' },
      { status: 400 },
    );
  }

  // Verify puzzles exist in DB
  const puzzleCount = await db
    .select({ sortOrder: connectionsPuzzles.sortOrder })
    .from(connectionsPuzzles)
    .orderBy(asc(connectionsPuzzles.sortOrder));

  if (puzzleCount.length === 0) {
    await logConnectionsReject({
      userId: identity.userId,
      userName: identityName,
      score: submittedScore,
      stage: 'puzzle-config',
      reason: 'No connections puzzles configured',
    });
    return NextResponse.json(
      { error: 'No puzzles configured.' },
      { status: 400 },
    );
  }

  if (
    !Number.isFinite(mistakes) || mistakes < 0 || mistakes > 4 ||
    !Number.isFinite(timeSeconds) || timeSeconds < 0 || timeSeconds > 86400
  ) {
    await logConnectionsReject({
      userId: identity.userId,
      userName: identityName,
      score: submittedScore,
      stage: 'validation',
      reason: `Invalid values mistakes=${mistakes} timeSeconds=${timeSeconds}`,
    });
    return NextResponse.json(
      { error: 'Invalid score values.' },
      { status: 400 },
    );
  }

  const timestamp = Date.now();

  try {
    const existing = (
      await db
        .select()
        .from(connectionsScores)
        .where(
          and(
            eq(connectionsScores.odUserId, identity.userId),
            eq(connectionsScores.puzzleDate, puzzleDate),
          ),
        )
        .limit(1)
    )[0];

    if (existing) {
      return NextResponse.json({
        success: true,
        duplicate: true,
        message: 'Score already submitted for this date.',
      });
    }

    const userName = identity.name || 'Anonymous';

    await db.insert(connectionsScores).values({
      id: crypto.randomUUID(),
      odUserId: identity.userId,
      userName,
      puzzleDate,
      mistakes: Math.floor(mistakes),
      timeSeconds: Math.round(timeSeconds * 10) / 10,
      solved: solved ? 1 : 0,
      createdAt: timestamp,
    });

    await logConnectionsPass({
      userId: identity.userId,
      userName: identityName,
      score: computeConnectionsScore(mistakes, solved),
      reason: `Accepted connections run (mistakes=${Math.floor(mistakes)}, solved=${solved ? 1 : 0}, timeSeconds=${Math.round(timeSeconds * 10) / 10})`,
    });

    const reward = await awardGameRunCredits({
      userId: identity.userId,
      context: { gameType: 'connections', solved, mistakes: Math.floor(mistakes) },
      sourceId: `connections:${puzzleDate}`,
      meta: {
        puzzleDate,
        mistakes: Math.floor(mistakes),
        timeSeconds,
        solved,
      },
    });
    const achievements = await recordRunAchievements(
      identity.userId,
      { gameType: 'connections', solved, mistakes: Math.floor(mistakes) },
      reward,
      { durationMs: Math.round(timeSeconds * 1000) },
    );

    await recordGameTimeMetric({
      userId: identity.userId,
      gameType: 'connections',
      durationMs: Math.round(timeSeconds * 1000),
      playedAtMs: timestamp,
    });

    broadcast('gameLeaderboards', {
      gameType: 'connections',
      puzzleDate,
      updatedAt: timestamp,
    });

    return NextResponse.json({
      success: true,
      reward,
      achievements,
    });
  } catch (error) {
    console.error('Failed to save connections score:', error);
    return NextResponse.json(
      { error: 'Failed to save score.' },
      { status: 500 },
    );
  }
}
