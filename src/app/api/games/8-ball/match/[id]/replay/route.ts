import { NextResponse } from 'next/server';
import { requireIdentity } from '@/server/auth';
import { query } from '@/server/db/client';
import type { Ball, ShotInput } from '@/features/arcade/lib/pool-physics';
import { getMatch } from '@/server/arcade/pool-match';

export const dynamic = 'force-dynamic';

type PoolMoveRow = {
  moveNumber: string | number;
  playerId: string;
  angle: number;
  power: number;
  cuePositionJson: string | null;
  pocketedBallsJson: string | null;
  scratch: boolean | number | null;
  firstContactBallId: number | null;
  railContacts: string | number | null;
  foulType: string | null;
  resultJson: string | null;
  turnDurationMs: string | number | null;
  createdAt: string | number;
};

type StoredMoveResult = {
  version?: number;
  shotInput?: ShotInput;
  ballsBefore?: Ball[];
  ballsAfter?: Ball[];
  pocketedBallIds?: number[];
  scratch?: boolean;
  firstContactBallId?: number | null;
  railContacts?: number;
  foulType?: string | null;
  totalFrames?: number;
};

type ReplayMove = {
  moveNumber: number;
  playerId: string;
  playerName: string;
  createdAt: number;
  turnDurationMs: number;
  shotInput: ShotInput;
  ballsBefore: Ball[];
  ballsAfter: Ball[];
  pocketedBallIds: number[];
  scratch: boolean;
  firstContactBallId: number | null;
  railContacts: number;
  foulType: string | null;
  totalFrames: number;
};

function parseJson<T>(value: string | null | undefined): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isCuePosition(value: unknown): value is { x: number; y: number } {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as { x?: unknown; y?: unknown };
  return isFiniteNumber(candidate.x) && isFiniteNumber(candidate.y);
}

function isShotInput(value: unknown): value is ShotInput {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as {
    angle?: unknown;
    power?: unknown;
    cuePosition?: unknown;
    spinX?: unknown;
    spinY?: unknown;
  };
  const cuePosOk = candidate.cuePosition === null || isCuePosition(candidate.cuePosition);
  const spinXOk = candidate.spinX === undefined || isFiniteNumber(candidate.spinX);
  const spinYOk = candidate.spinY === undefined || isFiniteNumber(candidate.spinY);
  return isFiniteNumber(candidate.angle)
    && isFiniteNumber(candidate.power)
    && cuePosOk
    && spinXOk
    && spinYOk;
}

function isBall(value: unknown): value is Ball {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as {
    id?: unknown;
    pos?: unknown;
    vel?: unknown;
    pocketed?: unknown;
    spinX?: unknown;
    spinY?: unknown;
  };
  const pos = candidate.pos as { x?: unknown; y?: unknown } | undefined;
  const vel = candidate.vel as { x?: unknown; y?: unknown } | undefined;
  const spinXOk = candidate.spinX === undefined || isFiniteNumber(candidate.spinX);
  const spinYOk = candidate.spinY === undefined || isFiniteNumber(candidate.spinY);
  return typeof candidate.id === 'number'
    && pos !== undefined
    && vel !== undefined
    && isFiniteNumber(pos.x)
    && isFiniteNumber(pos.y)
    && isFiniteNumber(vel.x)
    && isFiniteNumber(vel.y)
    && typeof candidate.pocketed === 'boolean'
    && spinXOk
    && spinYOk;
}

function isBallArray(value: unknown): value is Ball[] {
  return Array.isArray(value) && value.every(isBall);
}

function cloneBalls(balls: Ball[]): Ball[] {
  return balls.map((ball) => ({
    id: ball.id,
    pos: { x: ball.pos.x, y: ball.pos.y },
    vel: { x: ball.vel.x, y: ball.vel.y },
    pocketed: ball.pocketed,
    spinX: ball.spinX,
    spinY: ball.spinY,
  }));
}

function normalizeShotInput(
  stored: unknown,
  fallback: {
    angle: number;
    power: number;
    cuePosition: { x: number; y: number } | null;
  },
): ShotInput {
  if (isShotInput(stored)) {
    return {
      angle: stored.angle,
      power: stored.power,
      cuePosition: stored.cuePosition,
      spinX: stored.spinX ?? 0,
      spinY: stored.spinY ?? 0,
    };
  }

  return {
    angle: fallback.angle,
    power: fallback.power,
    cuePosition: fallback.cuePosition,
    spinX: 0,
    spinY: 0,
  };
}

function normalizePocketedIds(stored: unknown, fallback: string | null): number[] {
  if (Array.isArray(stored) && stored.every((id) => typeof id === 'number')) {
    return [...stored];
  }
  const parsedFallback = parseJson<number[]>(fallback);
  if (Array.isArray(parsedFallback) && parsedFallback.every((id) => typeof id === 'number')) {
    return parsedFallback;
  }
  return [];
}

/** GET — Fetch full replay data for a match (move-by-move snapshots). */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  let identity;
  try {
    identity = await requireIdentity({ allowExternal: true });
  } catch {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }

  const { id: matchId } = await params;
  const match = await getMatch(matchId);
  if (!match) {
    return NextResponse.json({ error: 'Match not found.' }, { status: 404 });
  }

  if (match.player1Id !== identity.userId && match.player2Id !== identity.userId) {
    return NextResponse.json({ error: 'Not a player in this match.' }, { status: 403 });
  }

  const rows = (await query<PoolMoveRow>(
    `SELECT move_number AS "moveNumber",
            player_id AS "playerId",
            angle,
            power,
            cue_position_json AS "cuePositionJson",
            pocketed_balls_json AS "pocketedBallsJson",
            scratch,
            first_contact_ball_id AS "firstContactBallId",
            rail_contacts AS "railContacts",
            foul_type AS "foulType",
            result_json AS "resultJson",
            turn_duration_ms AS "turnDurationMs",
            created_at AS "createdAt"
     FROM pool_moves
     WHERE match_id = $1
     ORDER BY move_number ASC`,
    [matchId],
  )).rows;

  if (rows.length === 0) {
    return NextResponse.json({
      replayAvailable: false,
      reason: 'No recorded moves were found for this match.',
    });
  }

  const replayMoves: ReplayMove[] = [];
  let initialBalls: Ball[] | null = null;
  let lastAfterBalls: Ball[] | null = null;

  for (const row of rows) {
    const result = parseJson<StoredMoveResult>(row.resultJson);
    const parsedCuePosition = parseJson<unknown>(row.cuePositionJson);
    const cuePosition = isCuePosition(parsedCuePosition) ? parsedCuePosition : null;
    const shotInput = normalizeShotInput(result?.shotInput, {
      angle: row.angle,
      power: row.power,
      cuePosition: cuePosition ?? null,
    });

    let ballsBefore = isBallArray(result?.ballsBefore) ? cloneBalls(result!.ballsBefore) : null;
    const ballsAfter = isBallArray(result?.ballsAfter) ? cloneBalls(result!.ballsAfter) : null;

    if (!ballsBefore) {
      ballsBefore = lastAfterBalls ? cloneBalls(lastAfterBalls) : null;
    }

    if (!ballsBefore || !ballsAfter) {
      return NextResponse.json({
        replayAvailable: false,
        reason: 'Replay is unavailable for this match (older move format without board snapshots).',
      });
    }

    if (!initialBalls) {
      initialBalls = cloneBalls(ballsBefore);
    }
    lastAfterBalls = cloneBalls(ballsAfter);

    const playerName = row.playerId === match.player1Id
      ? match.player1Name
      : row.playerId === match.player2Id
        ? (match.player2Name ?? 'Opponent')
        : row.playerId;

    replayMoves.push({
      moveNumber: Number(row.moveNumber),
      playerId: row.playerId,
      playerName,
      createdAt: Number(row.createdAt),
      turnDurationMs: row.turnDurationMs == null ? 0 : Number(row.turnDurationMs),
      shotInput,
      ballsBefore,
      ballsAfter,
      pocketedBallIds: normalizePocketedIds(result?.pocketedBallIds, row.pocketedBallsJson),
      scratch: Boolean(result?.scratch ?? row.scratch),
      firstContactBallId: typeof result?.firstContactBallId === 'number'
        ? result.firstContactBallId
        : row.firstContactBallId,
      railContacts: typeof result?.railContacts === 'number'
        ? result.railContacts
        : Number(row.railContacts ?? 0),
      foulType: typeof result?.foulType === 'string' || result?.foulType === null
        ? (result.foulType ?? null)
        : (row.foulType ?? null),
      totalFrames: typeof result?.totalFrames === 'number'
        ? result.totalFrames
        : 0,
    });
  }

  return NextResponse.json({
    replayAvailable: true,
    replay: {
      matchId,
      createdAt: match.createdAt,
      completedAt: match.completedAt,
      moveCount: replayMoves.length,
      initialBalls,
      moves: replayMoves,
    },
  });
}
