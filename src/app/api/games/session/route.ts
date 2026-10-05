import { checkNewGameAvailability, gameUnavailableResponse } from '@/server/arcade/game-availability';
import { NextResponse } from 'next/server';
import { requireIdentity } from '@/server/auth';
import {
  availabilityGameType,
  createGameSession,
  getSessionInfo,
  getSessionInfoForUser,
  recordGameAction,
  type GameType,
} from '@/server/arcade/game-session';
import { checkSessionStartLimit } from '@/server/arcade/game-rate-limit';
import { getGameBanStatus } from '@/server/arcade/game-bans';

export const dynamic = 'force-dynamic';

type StartSessionPayload = {
  gameType?: string;
  mode?: number;
};

type RecordActionPayload = {
  sessionId?: string;
  reactionTime?: number;
  action?: string;
  actionCounts?: Record<string, number>;
};

type SessionInfoResponse = {
  exists: boolean;
  reactionCount?: number;
};

export async function POST(request: Request) {
  let identity;
  try {
    identity = await requireIdentity({ allowExternal: true });
  } catch {
    return NextResponse.json(
      { error: 'Sign in to save scores and earn tickets.' },
      { status: 401 },
    );
  }

  let payload: StartSessionPayload | null = null;
  try {
    payload = (await request.json()) as StartSessionPayload;
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON payload.' },
      { status: 400 },
    );
  }

  const gameType = payload?.gameType;
  if (
    !gameType ||
    !['snake', 'flappy-bird', 'reaction-time', 'typing-test', 'coin-flip', 'tetris', '2048', 'stack', 'sequence', 'breakout', 'sudoku', 'math', 'tumbler', 'gopher', 'ricochet', 'swerve', 'bubble-shooter', 'gem-swap', 'sky-climber', 'minesweeper', 'log-splitter', 'knife-booth', 'melon-chop', 'tin-duck', 'boardwalk-hop', 'punch-card', 'freecell', 'blitz-tactics', 'high-striker', 'skee-ball', 'gunrush', 'ticket-stop', 'stack-cabinet', 'ring-toss'].includes(gameType)
  ) {
    return NextResponse.json({ error: 'Invalid game type.' }, { status: 400 });
  }

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

  const sessionLimit = await checkSessionStartLimit(
    identity.userId,
    gameType as GameType,
  );
  if (!sessionLimit.ok) {
    return NextResponse.json(
      {
        error: sessionLimit.reason,
        retryAfterSec: Math.ceil(sessionLimit.retryAfterMs / 1000),
      },
      { status: 429 },
    );
  }

  const sessionMode =
    gameType === 'typing-test' &&
    (payload?.mode === 15 || payload?.mode === 30 || payload?.mode === 60)
      ? payload.mode
      : undefined;
  const unavailable = await checkNewGameAvailability(availabilityGameType(gameType as GameType));
  if (unavailable) return unavailable;

  let session;
  try {
    session = await createGameSession(identity.userId, gameType as GameType, {
      modeSec: sessionMode,
    });
  } catch (error) {
    const response = gameUnavailableResponse(error);
    if (response) return response;
    throw error;
  }

  return NextResponse.json({
    success: true,
    sessionId: session.sessionId,
    token: session.token,
    modeSec: session.modeSec,
    snakeSeed: session.snakeSeed,
    flappySeed: session.flappySeed,
    typingSeed: session.typingSeed,
    sequenceSeed: session.sequenceSeed,
    breakoutSeed: session.breakoutSeed,
    mathSeed: session.mathSeed,
    blitzTacticsSeed: session.blitzTacticsSeed,
    tumblerSeed: session.tumblerSeed,
    gopherSeed: session.gopherSeed,
    ricochetSeed: session.ricochetSeed,
    swerveSeed: session.swerveSeed,
    bubbleSeed: session.bubbleSeed,
    gemSeed: session.gemSeed,
    skySeed: session.skySeed,
    minesweeperSeed: session.minesweeperSeed,
    logSplitterSeed: session.logSplitterSeed,
    knifeBoothSeed: session.knifeBoothSeed,
    melonChopSeed: session.melonChopSeed,
    tinDuckSeed: session.tinDuckSeed,
    boardwalkSeed: session.boardwalkSeed,
    highStrikerSeed: session.highStrikerSeed,
    skeeBallSeed: session.skeeBallSeed,
    gunrushSeed: session.gunrushSeed,
    ticketStopSeed: session.ticketStopSeed,
    stackCabinetSeed: session.stackCabinetSeed,
    game2048Seed: session.game2048Seed,
    ringTossSeed: session.ringTossSeed,
  });
}

// PATCH endpoint for recording game actions (used for reaction time tracking)
export async function PATCH(request: Request) {
  let identity;
  try {
    identity = await requireIdentity({ allowExternal: true });
  } catch {
    return NextResponse.json(
      { error: 'Sign in to play for tickets.' },
      { status: 401 },
    );
  }

  let payload: RecordActionPayload | null = null;
  try {
    payload = (await request.json()) as RecordActionPayload;
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON payload.' },
      { status: 400 },
    );
  }

  if (!payload?.sessionId) {
    return NextResponse.json(
      { error: 'Session ID required.' },
      { status: 400 },
    );
  }

  const success = await recordGameAction(payload.sessionId, identity.userId, {
    reactionTime: payload.reactionTime,
    action: payload.action,
    actionCounts: payload.actionCounts,
  });

  if (!success) {
    return NextResponse.json(
      { error: 'Invalid or expired session.' },
      { status: 400 },
    );
  }

  const info = await getSessionInfo(payload.sessionId);
  return NextResponse.json({
    success: true,
    reactionCount: info.reactionTimes?.length ?? 0,
  });
}

export async function GET(request: Request) {
  let identity;
  try {
    identity = await requireIdentity({ allowExternal: true });
  } catch {
    return NextResponse.json(
      { error: 'Sign in to play for tickets.' },
      { status: 401 },
    );
  }

  const url = new URL(request.url);
  const sessionId = url.searchParams.get('sessionId');
  if (!sessionId) {
    return NextResponse.json(
      { error: 'Session ID required.' },
      { status: 400 },
    );
  }

  const info = await getSessionInfoForUser(sessionId, identity.userId);
  const response: SessionInfoResponse = info.exists
    ? { exists: true, reactionCount: info.reactionTimes?.length ?? 0 }
    : { exists: false };

  return NextResponse.json(response);
}
