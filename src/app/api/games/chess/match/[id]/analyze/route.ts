import { NextResponse } from 'next/server';
import { requireIdentity } from '@/server/auth';
import { query } from '@/server/db/client';
import { getMatch } from '@/server/arcade/chess-match';
import { analyzePosition, setStartingPositionEvalCp } from '@/server/arcade/chess-bot';
import { broadcast } from '@/server/events';
import { STARTING_FEN } from '@/features/arcade/lib/chess/types';

export const dynamic = 'force-dynamic';

/**
 * Normalize a raw Stockfish score (cp or mate, from side-to-move POV) to a
 * single signed centipawn value from WHITE's perspective. Forced mates encode
 * the distance so the UI can show "M<N>": magnitude = 10_000 - |mate|,
 * clamped to the 9001..9999 band so they stay outside normal eval noise.
 */
function normalizeToWhiteCp(
  fen: string,
  cp: number | null,
  mate: number | null,
): number | null {
  const sideToMove = fen.split(' ')[1] === 'b' ? 'black' : 'white';
  const sign = sideToMove === 'white' ? 1 : -1;
  if (mate !== null) {
    const absMate = Math.max(1, Math.min(999, Math.abs(mate)));
    const magnitude = 10_000 - absMate;
    const mateSign = mate > 0 ? 1 : -1;
    return magnitude * mateSign * sign;
  }
  if (cp !== null) {
    return cp * sign;
  }
  return null;
}

/** Module-level set so concurrent POSTs for the same match don't double-run. */
const runningJobs = new Set<string>();
/** Global concurrency cap — analysis shares the single Stockfish queue with
 *  bot play, so we allow at most this many analyses in flight simultaneously
 *  to prevent bot replies from being starved. */
const MAX_CONCURRENT_ANALYSIS_JOBS = 2;

type AnalyzeMoveRow = {
  id: string;
  ply: string | number;
  fenAfter: string;
  evalCentipawns: string | number | null;
  analysisBestMoveUci: string | null;
};

async function runAnalysis(matchId: string) {
  try {
    const movesRows = await query<AnalyzeMoveRow>(
      `SELECT id,
              ply,
              fen_after AS "fenAfter",
              eval_centipawns AS "evalCentipawns",
              analysis_best_move_uci AS "analysisBestMoveUci"
       FROM chess_moves
       WHERE match_id = $1
       ORDER BY ply ASC`,
      [matchId],
    );

    // Analyze the starting position → the best move here is what Stockfish
    // would have preferred as white's first move. We store it on the ply-1
    // row's analysis_best_move_uci column.
    const start = await analyzePosition(STARTING_FEN, { depth: 12, movetime: 400 });
    const baseline = normalizeToWhiteCp(STARTING_FEN, start.cp, start.mate);
    // Cache the starting-position eval at module level so the moves endpoint
    // can serve it back to the client — previously the review UI hardcoded
    // 0 for the opening eval and the first move's "prev" in accuracy calcs.
    setStartingPositionEvalCp(baseline);
    broadcast([`chessAnalysis:${matchId}`, 'chessAnalysis'], { matchId, type: 'baseline', cp: baseline });

    // "Best move for position before ply N" carries forward from the previous
    // iteration. We seed with the baseline analysis for ply 1.
    let pendingBestMove: string | null = start.bestMove;

    for (const row of movesRows.rows) {
      const storedEval = row.evalCentipawns == null ? null : Number(row.evalCentipawns);
      const alreadyAnalyzed = storedEval !== null;

      // Write the best move that Stockfish would have preferred at the
      // pre-move position, if we have one queued from the prior iteration.
      // Only overwrite rows that haven't been analyzed yet — a re-run after
      // a partial failure must not clobber a previously-correct arrow with
      // a pendingBestMove that could be stale (if the prior iteration was
      // itself a skip that couldn't refresh its own bestMove).
      if (!alreadyAnalyzed && pendingBestMove && row.analysisBestMoveUci !== pendingBestMove) {
        await query(
          `UPDATE chess_moves SET analysis_best_move_uci = $1 WHERE id = $2`,
          [pendingBestMove, row.id],
        );
      }

      let whiteCp: number | null = alreadyAnalyzed ? storedEval : null;
      if (!alreadyAnalyzed) {
        const { cp, mate, bestMove } = await analyzePosition(row.fenAfter, { depth: 12, movetime: 500 });
        whiteCp = normalizeToWhiteCp(row.fenAfter, cp, mate);
        if (whiteCp !== null) {
          await query(
            `UPDATE chess_moves SET eval_centipawns = $1 WHERE id = $2`,
            [whiteCp, row.id],
          );
        }
        // Stockfish's move from the position AFTER this ply is the best move
        // recommendation for the NEXT ply (still to be played).
        pendingBestMove = bestMove;
      } else {
        // Row was already analyzed on a prior run. Run a shallow Stockfish
        // pass just to harvest the best-move for the next row — otherwise a
        // re-run that skips would leave the next fresh row without an arrow.
        try {
          const quick = await analyzePosition(row.fenAfter, { depth: 8, movetime: 200 });
          pendingBestMove = quick.bestMove;
        } catch {
          // If the quick pass fails, clear so we don't paint a stale arrow.
          pendingBestMove = null;
        }
      }

      broadcast([`chessAnalysis:${matchId}`, 'chessAnalysis'], { matchId, type: 'ply', ply: Number(row.ply), cp: whiteCp });
    }
    broadcast([`chessAnalysis:${matchId}`, 'chessAnalysis'], { matchId, type: 'complete' });
  } catch (error) {
    console.error('chess analysis failed:', error);
    broadcast([`chessAnalysis:${matchId}`, 'chessAnalysis'], {
      matchId,
      type: 'error',
      message: (error as Error).message ?? 'Analysis failed.',
    });
  } finally {
    runningJobs.delete(matchId);
  }
}

/** POST — kick off analysis of a finished match. Returns immediately; the
 * job writes evals to chess_moves and pushes progress on `chessAnalysis:{id}`. */
export async function POST(
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
  if (match.status !== 'completed' && match.status !== 'forfeited') {
    return NextResponse.json({ error: 'Match is still in progress.' }, { status: 409 });
  }

  // Analysis and bot play share the single serialized Stockfish queue, so a
  // drive-by user analyzing long games on the side would starve live bot
  // replies across the site. Gate to the match's participants (or tournament
  // spectators of that specific tournament). The heavy analysis cost is
  // only borne for people who actually played.
  const isPlayer = match.player1Id === identity.userId || match.player2Id === identity.userId;
  const isTournamentMatch = Boolean(match.tournamentMatchId);
  if (!isPlayer && !isTournamentMatch) {
    return NextResponse.json(
      { error: 'Only match participants can trigger analysis.' },
      { status: 403 },
    );
  }

  if (runningJobs.has(matchId)) {
    return NextResponse.json({ pending: true, alreadyRunning: true });
  }
  // Global concurrency cap — only MAX_CONCURRENT analysis jobs may run at
  // once. Prevents repeated analyses on long finished games from queuing
  // behind Stockfish and delaying bot replies for live players.
  if (runningJobs.size >= MAX_CONCURRENT_ANALYSIS_JOBS) {
    return NextResponse.json(
      {
        error: 'Too many analysis jobs are running. Please try again in a moment.',
        pending: false,
      },
      { status: 429 },
    );
  }
  runningJobs.add(matchId);
  void runAnalysis(matchId);
  return NextResponse.json({ pending: true });
}
