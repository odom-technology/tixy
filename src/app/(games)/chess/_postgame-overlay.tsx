'use client';

import { useEffect, useState } from 'react';
import { ArcadeButton } from '@/features/arcade/components/ui/arcade-ui';
import {
  ArcadeRematchButton,
  ArcadeRunResult,
  type ArcadeRunStat,
} from '@/features/arcade/components/results/arcade-run-result';
import type { ArcadeRunResultSnapshot } from '@/features/arcade/lib/run-result';
import type { AccountXpReward } from '@/server/arcade/rewards/types';
import type { ChessMatch, GameResult, WinReason } from '@/features/arcade/lib/chess/types';

type EloDelta = {
  before: number;
  after: number;
  change: number;
  tier: string;
  tierColor: string;
};

type Props = {
  match: ChessMatch;
  isMe: string;
  myElo: EloDelta | null;
  onRematch?: () => void | Promise<void>;
  onLobby: () => void;
  /** Hide the result to look at the final position. */
  onDismiss: () => void;
  canRematch: boolean;
  /** Post-analysis accuracy 0 to 100 for the viewer's own colour, or null. */
  accuracy?: number | null;
  /** A neutral result ("white won") with no rematch. */
  isSpectator?: boolean;
  /** Rematch invite received from the opponent while viewing the result. The
   *  rematch button becomes accept and jumps to the new match. */
  pendingRematch?: { matchId: string; senderName: string } | null;
  /** The opponent sent a challenge that is not a plain rematch (a wager or
   *  another time format). It is only a line here; the lobby shows the stake. */
  incomingChallenge?: { senderName: string } | null;
  onAcceptPendingRematch?: () => void | Promise<void>;
  /** Account XP earned this match (viewer-specific). */
  accountXp?: AccountXpReward | null;
  /** Tickets, XP, and achievements earned by this viewer for the match. */
  runResult?: ArcadeRunResultSnapshot | null;
};

/**
 * The end of a chess match: the shared result, drawn over the stage, with
 * rematch first. Escape hides it so the final position can be looked at; the
 * lobby and review buttons do the same.
 */
export function PostgameResult({
  match,
  isMe,
  myElo,
  onRematch,
  onLobby,
  onDismiss,
  canRematch,
  accuracy = null,
  isSpectator = false,
  pendingRematch = null,
  incomingChallenge = null,
  onAcceptPendingRematch,
  accountXp = null,
  runResult = null,
}: Props) {
  const [rematchPending, setRematchPending] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDismiss();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onDismiss]);

  const resolution = isSpectator ? resolveSpectatorResolution(match) : resolveResolution(match, isMe);

  const stats: ArcadeRunStat[] = [];
  if (!isSpectator && myElo) {
    stats.push({ label: 'rating', value: myElo.after, highlight: myElo.change > 0 });
    stats.push({ label: 'rating change', value: `${myElo.change > 0 ? '+' : myElo.change < 0 ? '−' : ''}${Math.abs(myElo.change)}` });
  }
  if (!isSpectator && accuracy != null) {
    stats.push({ label: 'accuracy', value: `${accuracy}%` });
  }

  const showRematch = !isSpectator && (pendingRematch || (canRematch && onRematch));

  return (
    <ArcadeRunResult
      title={resolution.title}
      tone={resolution.tone}
      stats={stats}
      reward={isSpectator ? null : (runResult?.reward ?? (accountXp ? { account: accountXp } : null))}
      achievements={isSpectator ? [] : (runResult?.achievements ?? [])}
      back={{ label: 'lobby', onClick: onLobby }}
      actions={
        <>
          {showRematch ? (
            <ArcadeRematchButton
              disabled={rematchPending}
              onClick={async () => {
                setRematchPending(true);
                try {
                  if (pendingRematch && onAcceptPendingRematch) await onAcceptPendingRematch();
                  else if (onRematch) await onRematch();
                } finally {
                  setRematchPending(false);
                }
              }}
            >
              {pendingRematch ? 'accept' : 'rematch'}
            </ArcadeRematchButton>
          ) : null}
          <ArcadeButton tone='default' onClick={onDismiss}>
            review
          </ArcadeButton>
        </>
      }
    >
      {pendingRematch && !isSpectator ? (
        <p>{pendingRematch.senderName} sent you a rematch.</p>
      ) : incomingChallenge && !isSpectator ? (
        <>
          {resolution.line ? <p>{resolution.line}</p> : null}
          <p>{incomingChallenge.senderName} sent you a challenge. Open the lobby to see it.</p>
        </>
      ) : resolution.line ? (
        <p>{resolution.line}</p>
      ) : null}
    </ArcadeRunResult>
  );
}

type Resolution = {
  tone: 'win' | 'loss' | 'neutral';
  title: string;
  line: string;
};

/** A neutral "white won" / "draw" framing for spectators. */
function resolveSpectatorResolution(match: ChessMatch): Resolution {
  const result = match.result as GameResult | null;
  const reason = match.winReason as WinReason | null;
  if (result === '1/2-1/2' || (!match.winnerId && !match.loserId)) {
    return { tone: 'neutral', title: 'Draw', line: drawLine(reason) };
  }
  const winnerIsWhite = match.winnerId === match.whiteId;
  const winnerName = winnerIsWhite
    ? (match.whiteId === match.player1Id ? match.player1Name : match.player2Name)
    : (match.blackId === match.player1Id ? match.player1Name : match.player2Name);
  return {
    tone: 'neutral',
    title: winnerIsWhite ? 'White won' : 'Black won',
    line: winLine(reason, winnerName ?? 'the opponent'),
  };
}

function resolveResolution(match: ChessMatch, isMe: string): Resolution {
  const winner = match.winnerId;
  const loser = match.loserId;
  const result = match.result as GameResult | null;
  const reason = match.winReason as WinReason | null;

  if (result === '1/2-1/2' || (!winner && !loser)) {
    return { tone: 'neutral', title: 'Draw', line: drawLine(reason) };
  }

  if (winner === isMe) {
    const opponentName = nameFor(match, loser ?? '') || 'your opponent';
    return { tone: 'win', title: 'You won', line: winLine(reason, opponentName) };
  }

  const winnerName = winner ? nameFor(match, winner) : 'Your opponent';
  return { tone: 'loss', title: 'You lost', line: lossLine(reason, winnerName) };
}

function winLine(reason: WinReason | null, opponentName: string): string {
  switch (reason) {
    case 'checkmate': return `Checkmate against ${opponentName}.`;
    case 'resignation': return `${opponentName} resigned.`;
    case 'timeout': return `${opponentName} ran out of time.`;
    case 'forfeit': return `${opponentName} forfeited.`;
    default: return '';
  }
}

function lossLine(reason: WinReason | null, winnerName: string): string {
  switch (reason) {
    case 'checkmate': return `${winnerName} checkmated you.`;
    case 'resignation': return 'You resigned.';
    case 'timeout': return 'You ran out of time.';
    case 'forfeit': return 'You forfeited.';
    default: return '';
  }
}

function drawLine(reason: WinReason | null): string {
  switch (reason) {
    case 'stalemate': return 'Stalemate: no legal moves.';
    case 'threefold': return 'The same position came up three times.';
    case 'fifty_move': return '50 moves without a capture or a pawn move.';
    case 'insufficient_material': return 'Neither side can give checkmate.';
    case 'draw_agreement': return 'Both players agreed to a draw.';
    default: return '';
  }
}

function nameFor(match: ChessMatch, userId: string): string {
  if (match.player1Id === userId) return match.player1Name;
  if (match.player2Id === userId) return match.player2Name ?? 'Unknown';
  return 'Unknown';
}
