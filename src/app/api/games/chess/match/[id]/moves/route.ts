import { NextResponse } from 'next/server';
import { requireIdentity } from '@/server/auth';
import { query } from '@/server/db/client';
import { getMatch, isMatchSpectatable } from '@/server/arcade/chess-match';
import { getStartingPositionEvalCp } from '@/server/arcade/chess-bot';

export const dynamic = 'force-dynamic';

type ChessMoveRow = {
  ply: string | number;
  moveNumber: string | number;
  uci: string;
  san: string;
  fenAfter: string;
  playerId: string;
  clockRemainingMs: string | number | null;
  moveDurationMs: string | number | null;
  evalCentipawns: string | number | null;
  analysisBestMoveUci: string | null;
  createdAt: string | number;
};

const toNumOrNull = (value: unknown): number | null =>
  value == null ? null : Number(value);

/** GET — Full move history for a match (SAN + UCI + per-move timing). */
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

  const rows = await query<ChessMoveRow>(
    `SELECT ply,
            move_number AS "moveNumber",
            uci,
            san,
            fen_after AS "fenAfter",
            player_id AS "playerId",
            clock_remaining_ms AS "clockRemainingMs",
            move_duration_ms AS "moveDurationMs",
            eval_centipawns AS "evalCentipawns",
            analysis_best_move_uci AS "analysisBestMoveUci",
            created_at AS "createdAt"
     FROM chess_moves
     WHERE match_id = $1
     ORDER BY ply ASC`,
    [matchId],
  );

  return NextResponse.json({
    moves: rows.rows.map((m) => ({
      ply: Number(m.ply),
      moveNumber: Number(m.moveNumber),
      uci: m.uci,
      san: m.san,
      fenAfter: m.fenAfter,
      playerId: m.playerId,
      clockRemainingMs: toNumOrNull(m.clockRemainingMs),
      moveDurationMs: toNumOrNull(m.moveDurationMs),
      evalCentipawns: toNumOrNull(m.evalCentipawns),
      analysisBestMoveUci: m.analysisBestMoveUci ?? null,
      createdAt: Number(m.createdAt),
    })),
    // White-POV centipawn eval of the starting position, once the analyze
    // route has cached it at the module level. Clients use this as the
    // "prev" baseline for the first move's accuracy + move-quality calc
    // and for the eval bar at ply 0; null means no analysis has run yet
    // on this process and callers fall back to 0.
    baselineCp: await getStartingPositionEvalCp(),
  });
}
