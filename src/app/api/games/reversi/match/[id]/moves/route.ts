import { NextResponse } from 'next/server';
import { requireIdentity } from '@/server/auth';
import { query } from '@/server/db/client';
import { getMatch, isMatchSpectatable } from '@/server/arcade/reversi-match';

export const dynamic = 'force-dynamic';

type ReversiMoveRow = {
  ply: string | number;
  moveNumber: string | number;
  cellIndex: string | number;
  boardAfter: string;
  playerId: string;
  moveDurationMs: string | number | null;
  createdAt: string | number;
};

const toNumOrNull = (value: unknown): number | null =>
  value == null ? null : Number(value);

/** GET — Full move history for a match (placements + per-move timing). */
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
  if (!match) return NextResponse.json({ error: 'Match not found.' }, { status: 404 });

  const isPlayer = match.player1Id === identity.userId || match.player2Id === identity.userId;
  if (!isPlayer && !isMatchSpectatable(match) && match.status !== 'completed' && match.status !== 'forfeited') {
    return NextResponse.json({ error: 'Not allowed.' }, { status: 403 });
  }

  const rows = await query<ReversiMoveRow>(
    `SELECT ply,
            move_number AS "moveNumber",
            cell_index AS "cellIndex",
            board_after AS "boardAfter",
            player_id AS "playerId",
            move_duration_ms AS "moveDurationMs",
            created_at AS "createdAt"
     FROM reversi_moves
     WHERE match_id = $1
     ORDER BY ply ASC`,
    [matchId],
  );

  return NextResponse.json({
    moves: rows.rows.map((m) => ({
      ply: Number(m.ply),
      moveNumber: Number(m.moveNumber),
      cell: Number(m.cellIndex),
      boardAfter: m.boardAfter,
      playerId: m.playerId,
      moveDurationMs: toNumOrNull(m.moveDurationMs),
      createdAt: Number(m.createdAt),
    })),
  });
}
