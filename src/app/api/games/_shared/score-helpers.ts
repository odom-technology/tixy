import { NextResponse } from 'next/server';
import { requireIdentity } from '@/server/auth';
import { getGameBanStatus } from '@/server/arcade/game-bans';
import { checkScoreSubmitLimit } from '@/server/arcade/game-rate-limit';
import { addAntiCheatLog } from '@/server/arcade/anti-cheat-logs';
import type { ActionEntry, EnvFingerprint } from '@/server/arcade/anti-cheat';

type GameType = 'snake' | 'flappy-bird' | 'reaction-time' | 'typing-test' | '8-ball' | 'tetris' | '2048' | 'stack' | 'sequence' | 'breakout' | 'tumbler' | 'gopher' | 'ricochet' | 'swerve' | 'sudoku' | 'math' | 'bubble-shooter' | 'gem-swap' | 'sky-climber' | 'minesweeper' | 'log-splitter' | 'knife-booth' | 'melon-chop' | 'tin-duck' | 'boardwalk-hop' | 'punch-card' | 'freecell' | 'blitz-tactics' | 'high-striker' | 'skee-ball' | 'gunrush' | 'ticket-stop' | 'stack-cabinet' | 'ring-toss' | 'mini-golf';

export type BaseScorePayload = {
  score?: number;
  sessionToken?: string;
  clientDurationMs?: number;
  continued?: boolean;
  actions?: ActionEntry[];
  env?: EnvFingerprint;
};

type AuthenticatedPlayer = {
  identity: Awaited<ReturnType<typeof requireIdentity>>;
  identityName: string | null;
};

/**
 * Runs auth, ban check, and rate limit check. Returns either the
 * authenticated player info or an error response.
 */
export async function authenticateGamePlayer(
  gameType: GameType,
): Promise<AuthenticatedPlayer | NextResponse> {
  let identity;
  try {
    identity = await requireIdentity({ allowExternal: true });
  } catch {
    return NextResponse.json(
      { error: 'Sign in to play for tickets.' },
      { status: 401 },
    );
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

  const limit = await checkScoreSubmitLimit(identity.userId, gameType);
  if (!limit.ok) {
    return NextResponse.json(
      {
        error: limit.reason,
        retryAfterSec: Math.ceil(limit.retryAfterMs / 1000),
      },
      { status: 429 },
    );
  }

  return {
    identity,
    identityName: identity.name || null,
  };
}

export function isErrorResponse(
  result: AuthenticatedPlayer | NextResponse,
): result is NextResponse {
  return result instanceof NextResponse;
}

/**
 * Parses JSON from the request body. Returns the parsed payload or an error response.
 */
export async function parsePayload<T>(
  request: Request,
): Promise<T | NextResponse> {
  try {
    return (await request.json()) as T;
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON payload.' },
      { status: 400 },
    );
  }
}

/**
 * Logs an anti-cheat rejection and returns an error response.
 */
export async function rejectScore(
  gameType: GameType,
  params: {
    userId: string;
    userName?: string | null;
    score: number;
    modeSec?: number;
    stage: string;
    reason: string;
    status?: number;
    publicMessage?: string;
    includeDetails?: boolean;
  },
): Promise<NextResponse> {
  try {
    await addAntiCheatLog({
      ts: Date.now(),
      gameType,
      userId: params.userId,
      userName: params.userName,
      score: params.score,
      modeSec: params.modeSec,
      result: 'reject',
      severity: 'reject',
      reason: params.reason,
      stage: params.stage,
      checks: [],
    });
  } catch (error) {
    console.error(`Failed to write ${gameType} anti-cheat reject log:`, error);
  }

  const body: Record<string, unknown> = {
    error: params.publicMessage ?? 'Score validation failed.',
  };
  if (params.includeDetails) {
    body.details = params.reason;
  }

  return NextResponse.json(body, { status: params.status ?? 403 });
}
