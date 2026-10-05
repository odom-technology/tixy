import { NextResponse } from 'next/server';
import { requireIdentity } from '@/server/auth';
import { queryOne } from '@/server/db/client';
import {
  getMatch,
  isMatchSpectatable,
  trackSpectator,
  getSpectatorCount,
  runBotReply,
} from '@/server/arcade/battleship-match';
import { redactMatchForViewer } from '@/server/arcade/battleship-engine';
import { isBotUser } from '@/server/arcade/battleship-bot';
import { getTierName, getTierColor } from '@/server/arcade/battleship-elo';
import { takeMatchRunResult } from '@/server/arcade/match-run-results';

export const dynamic = 'force-dynamic';

type EloHistoryRow = {
  playerAId: string;
  playerBId: string;
  outcome: string;
  playerAEloBefore: string | number;
  playerBEloBefore: string | number;
  playerAEloAfter: string | number;
  playerBEloAfter: string | number;
  playerAEloChange: string | number;
  playerBEloChange: string | number;
};

/** GET — Current state of a match, REDACTED for the requesting viewer. The
 *  opponent's un-hit ship cells are never present in the response. */
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

  const { id } = await params;
  const match = await getMatch(id);
  if (!match) return NextResponse.json({ error: 'Match not found.' }, { status: 404 });

  // Recovery — re-kick a stuck bot job (e.g. after a dev-server restart).
  if (
    match.status === 'active'
    && (isBotUser(match.player1Id) || (match.player2Id != null && isBotUser(match.player2Id)))
  ) {
    void runBotReply(id);
  }

  const isPlayer = match.player1Id === identity.userId || match.player2Id === identity.userId;
  const isSpectator = !isPlayer && isMatchSpectatable(match);
  if (!isPlayer && !isSpectator) {
    return NextResponse.json({ error: 'Not a player in this match.' }, { status: 403 });
  }
  if (isSpectator) trackSpectator(id, identity.userId);
  const spectatorCount = getSpectatorCount(id);

  // Elo change for completed human matches.
  let eloChange:
    | {
        outcome: 'win_a' | 'win_b' | 'draw';
        playerA: { id: string; before: number; after: number; change: number; tier: string; tierColor: string };
        playerB: { id: string; before: number; after: number; change: number; tier: string; tierColor: string };
      }
    | undefined;
  const isCompleted = match.status === 'completed' || match.status === 'forfeited';
  const isHumanMatch = match.player2Id && !match.player2Id.startsWith('bot:');
  if (isCompleted && isHumanMatch) {
    const history = await queryOne<EloHistoryRow>(
      `SELECT player_a_id AS "playerAId",
              player_b_id AS "playerBId",
              outcome,
              player_a_elo_before AS "playerAEloBefore",
              player_b_elo_before AS "playerBEloBefore",
              player_a_elo_after AS "playerAEloAfter",
              player_b_elo_after AS "playerBEloAfter",
              player_a_elo_change AS "playerAEloChange",
              player_b_elo_change AS "playerBEloChange"
       FROM battleship_elo_history
       WHERE match_id = $1
       LIMIT 1`,
      [id],
    );
    if (history) {
      eloChange = {
        outcome: history.outcome as 'win_a' | 'win_b' | 'draw',
        playerA: {
          id: history.playerAId,
          before: Number(history.playerAEloBefore),
          after: Number(history.playerAEloAfter),
          change: Number(history.playerAEloChange),
          tier: getTierName(Number(history.playerAEloAfter)),
          tierColor: getTierColor(Number(history.playerAEloAfter)),
        },
        playerB: {
          id: history.playerBId,
          before: Number(history.playerBEloBefore),
          after: Number(history.playerBEloAfter),
          change: Number(history.playerBEloChange),
          tier: getTierName(Number(history.playerBEloAfter)),
          tierColor: getTierColor(Number(history.playerBEloAfter)),
        },
      };
    }
  }

  const runResult = isPlayer ? takeMatchRunResult(id, identity.userId) : null;

  return NextResponse.json({
    match: redactMatchForViewer(match, identity.userId, { isSpectator }),
    userId: identity.userId,
    isSpectator,
    spectatorCount,
    eloChange,
    runResult,
  });
}
