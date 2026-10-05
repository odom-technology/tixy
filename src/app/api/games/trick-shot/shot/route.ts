import { NextResponse } from 'next/server';

import { requireIdentity } from '@/server/auth';
import { consumeReadRateLimit, tooManyAttemptsResponse } from '@/server/auth/auth-rate-limit';
import { broadcast } from '@/server/events';
import { addAntiCheatLog } from '@/server/arcade/anti-cheat-logs';
import { awardGameRunCredits } from '@/server/arcade/rewards';
import { recordGameTimeMetric } from '@/server/arcade/game-time-metrics';
import {
  getTrickShotAttempt,
  getTrickShotBest,
  getTrickShotPosition,
  getTrickShotStreak,
  recordTrickShotTry,
  trickShotRewardSourceId,
  viewAttempt,
} from '@/server/arcade/trick-shot';
import { isNewBest } from '@/features/arcade/lib/new-best';
import {
  isTrickShotDateKey,
  trickShotDateKey,
  TRICK_SHOT_RULES,
} from '@/features/arcade/lib/trick-shot/rules';
import {
  normalizeTrickShotInput,
  playTrickShot,
  TRICK_SHOT_ANGLE_STEP,
} from '@/features/arcade/lib/trick-shot/shot';
import { recordRunAchievements } from '../../_shared/run-achievements';
import { ensureNotGameBanned } from '../../_shared/ban-helpers';

export const dynamic = 'force-dynamic';

/* One try at trick shot's table. The client sends the shot it fired (aim,
   power, spin) for the try the start route armed. The server puts it on the
   shooting grids, replays it on the day's table with the 8-ball engine and
   takes the result from that: the client's count is only compared, never
   used. Every try is replayed and kept, and numbered in order.

   Recording consumes the arm under a row lock (recordTrickShotTry), so a
   repeated or concurrent post records one try. The same transaction decides
   whether the try beats the day's best and what it is owed: the day's first
   try its value, a new best the difference over the old best, anything else
   nothing (rules.ts trickShotTryTickets). Tickets are keyed by the day and
   the new best's score, so each is paid once even if the payout is retried.
   Only a new best reaches the wallet, XP, the quests and the achievements;
   a try that doesn't beat the best is recorded and pays nothing.

   Rejected, and logged to anti_cheat_logs: a shot that isn't finite numbers
   inside the controls' ranges, a shot without the day's row, a shot for a
   table other than the day's, a shot after that table closed (15 minutes
   past midnight UTC, for a try armed before it). Flagged: a shot posted less
   than 250 ms after its first touch armed it, which a hand can't do (press,
   pull back, let go). Logged for review: a clear within 3 s of the first
   touch on a hard or expert table, and a client whose own replay counted
   differently (a float difference in another browser's Math). */

/** A try takes a few seconds at the quickest; 30 a minute is above a hand. */
const LIMIT = 30;
const WINDOW_MS = 60_000;
const MIN_HAND_MS = 250;
const LATE_GRACE_MS = 15 * 60 * 1000;
const QUICK_CLEAR_MS = 3_000;

type ShotPayload = {
  attemptId?: unknown;
  dateKey?: unknown;
  shot?: unknown;
  clientPots?: unknown;
};

export async function POST(request: Request) {
  let identity;
  try {
    identity = await requireIdentity({ allowExternal: true });
  } catch {
    return NextResponse.json({ error: 'Sign in to keep your tries.' }, { status: 401 });
  }
  const limited = consumeReadRateLimit(`trick-shot-shot:${identity.userId}`, LIMIT, WINDOW_MS);
  if (limited.limited) return tooManyAttemptsResponse(limited.retryAfterSeconds);
  const banned = await ensureNotGameBanned(identity.userId);
  if (banned) return banned;

  const userName = identity.name || 'Player';
  const log = (result: 'reject' | 'flag' | 'pass', stage: string, reason: string, score = 0) =>
    addAntiCheatLog({
      ts: Date.now(),
      gameType: 'trick-shot',
      userId: identity.userId,
      userName,
      score,
      result,
      severity: result === 'pass' ? undefined : result,
      reason,
      stage,
      checks: [],
    }).catch((error) => console.error('Failed to write a trick shot anti-cheat log:', error));

  const body = (await request.json().catch(() => null)) as ShotPayload | null;
  if (!body || typeof body.attemptId !== 'string' || !isTrickShotDateKey(body.dateKey)) {
    await log('reject', 'payload', 'Missing attempt id or table date');
    return NextResponse.json({ error: 'Invalid shot.' }, { status: 400 });
  }
  const input = normalizeTrickShotInput(body.shot);
  if (!input) {
    await log('reject', 'payload', `Shot outside the controls: ${JSON.stringify(body.shot).slice(0, 200)}`);
    return NextResponse.json({ error: 'Invalid shot.' }, { status: 400 });
  }

  const dateKey = body.dateKey;
  const now = Date.now();
  const attempt = await getTrickShotAttempt(identity.userId, dateKey);
  if (!attempt || attempt.id !== body.attemptId) {
    await log('reject', 'attempt', `No day row ${String(body.attemptId).slice(0, 40)} for ${dateKey}`);
    return NextResponse.json({ error: 'There is no try set up for that table.' }, { status: 409 });
  }
  const today = trickShotDateKey(now);
  if (dateKey !== today) {
    const closedAt = Date.parse(`${today}T00:00:00Z`);
    if (dateKey > today || now - closedAt > LATE_GRACE_MS) {
      await log('reject', 'date', `Shot for ${dateKey} arrived on ${today}`);
      return NextResponse.json({ error: "That table has closed. Today's is up." }, { status: 409 });
    }
  }

  // === SERVER-AUTHORITATIVE RESULT ===
  const position = getTrickShotPosition(dateKey);
  const play = playTrickShot(position.balls, input);

  const recorded = await recordTrickShotTry(
    attempt.id,
    identity.userId,
    {
      angleSteps: Math.round(input.angle / TRICK_SHOT_ANGLE_STEP),
      powerPct: Math.round(input.power * 100),
      spinX: input.spinX,
      spinY: input.spinY,
      pots: play.pots,
      ballCount: play.ballCount,
      scratch: play.scratch,
      clear: play.clear,
      score: play.score,
      nearMisses: play.nearMisses.length,
      userName,
    },
    now,
  );
  if (recorded.kind !== 'recorded') {
    // That try is in already: the repeated post gets nothing more.
    return NextResponse.json({ error: 'That try is already in.', duplicate: true }, { status: 409 });
  }

  const { tryNumber, improved, previousBest } = recorded;
  const handMs = now - recorded.armedAt;
  const clientPots = typeof body.clientPots === 'number' ? body.clientPots : null;
  if (handMs < MIN_HAND_MS) {
    await log('flag', 'trick-shot-hand', `Try ${tryNumber} posted ${handMs} ms after its first touch`, play.score);
  } else if (play.clear && handMs < QUICK_CLEAR_MS && (position.difficulty === 'hard' || position.difficulty === 'expert')) {
    await log('pass', 'trick-shot-review', `Review: ${position.difficulty} table cleared ${handMs} ms after the first touch, try ${tryNumber}`, play.score);
  }
  if (clientPots !== null && clientPots !== play.pots) {
    await log('pass', 'trick-shot-parity', `Client counted ${clientPots} pots, server ${play.pots}`, play.score);
  }
  await log(
    'pass',
    'complete',
    `Accepted trick shot try ${tryNumber} (${dateKey}, ${play.pots}/${play.ballCount}${play.clear ? ', clear' : ''}${play.scratch ? ', scratch' : ''}${improved ? ', new best' : ''}, ${handMs} ms)`,
    play.score,
  );

  const result = {
    pots: play.pots,
    ballCount: play.ballCount,
    scratch: play.scratch,
    clear: play.clear,
    score: play.score,
    pottedIds: play.pottedIds,
  };
  const day = viewAttempt(recorded.row);
  const playMs = Math.min(handMs, 10 * 60_000) + play.result.totalFrames * (1000 / 60);

  try {
    await recordGameTimeMetric({ userId: identity.userId, gameType: 'trick-shot', durationMs: playMs, playedAtMs: now });
    const streak = await getTrickShotStreak(identity.userId, today);
    if (!improved) {
      return NextResponse.json({ success: true, tryNumber, improved, result, day, streak, isNewBest: false, reward: null, achievements: [] });
    }

    const before = await getTrickShotBest(identity.userId, dateKey);
    const context = { gameType: 'trick-shot' as const, score: play.score, clear: play.clear, previousBest };
    const reward = await awardGameRunCredits({
      userId: identity.userId,
      context,
      sourceId: trickShotRewardSourceId(dateKey, previousBest, play.score),
      meta: {
        dateKey,
        rules: TRICK_SHOT_RULES,
        try: tryNumber,
        previousBest,
        pots: play.pots,
        ballCount: play.ballCount,
        clear: play.clear,
      },
    });
    const achievements = await recordRunAchievements(identity.userId, context, reward, {
      durationMs: playMs,
      trickShotStreak: play.clear ? streak : undefined,
      trickShotFirstTry: play.clear && tryNumber === 1,
    });
    broadcast('gameLeaderboards', { gameType: 'trick-shot', puzzleDate: dateKey, updatedAt: now });

    return NextResponse.json({
      success: true,
      tryNumber,
      improved,
      result,
      day,
      streak,
      isNewBest: isNewBest(play.score, Math.max(before, previousBest ?? 0)),
      reward,
      achievements,
    });
  } catch (error) {
    // The try is saved; its tickets are keyed by the day and the best, so a
    // retry of the payout can't pay twice.
    console.error('Trick shot payout failed:', error);
    return NextResponse.json({
      success: true,
      tryNumber,
      improved,
      result,
      day,
      streak: null,
      isNewBest: false,
      reward: null,
      achievements: [],
      payoutError: improved ? 'Your try is saved, but the tickets did not land.' : undefined,
    });
  }
}
