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
import type { ConnectFourMatch, GameResult, WinReason } from '@/features/arcade/lib/connect-four/types';
import type { SeriesScore } from './_series';

type EloDelta = {
  before: number;
  after: number;
  change: number;
  tier: string;
  tierColor: string;
};

type Props = {
  match: ConnectFourMatch;
  isMe: string;
  myElo: EloDelta | null;
  onRematch?: () => void | Promise<void>;
  onLobby: () => void;
  /** Hide the result to look at the final rack. */
  onDismiss: () => void;
  canRematch: boolean;
  isSpectator?: boolean;
  /** Rematch the opponent already made, found in the lobby. The rematch
   *  button becomes accept and joins it. */
  pendingRematch?: { matchId: string; senderName: string } | null;
  onAcceptPendingRematch?: () => void | Promise<void>;
  /** The best-of-three score including this game, or null for a plain match. */
  series?: SeriesScore | null;
  /** Account XP earned this match (viewer-specific). */
  accountXp?: AccountXpReward | null;
  /** Tickets, XP, and achievements earned by this viewer for the match. */
  runResult?: ArcadeRunResultSnapshot | null;
};

/**
 * The end of a Connect Four match: the shared result, drawn over the stage,
 * with rematch first. Escape, review and lobby leave it. When a best of three
 * is on it says where the series stands and what the rematch is.
 */
export function PostgameResult({
  match,
  isMe,
  myElo,
  onRematch,
  onLobby,
  onDismiss,
  canRematch,
  isSpectator = false,
  pendingRematch = null,
  onAcceptPendingRematch,
  series = null,
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
    stats.push({
      label: 'rating change',
      value: `${myElo.change > 0 ? '+' : myElo.change < 0 ? '−' : ''}${Math.abs(myElo.change)}`,
    });
  }
  if (!isSpectator && series) {
    stats.push({ label: 'series', value: `${series.me}-${series.them}` });
  }

  const showRematch = !isSpectator && (pendingRematch || (canRematch && onRematch));
  const seriesLine = !series
    ? null
    : series.over
      ? series.result === 'won'
        ? 'You won the series.'
        : series.result === 'lost'
          ? 'You lost the series.'
          : 'The series ended level.'
      : `Game ${series.played + 1} of 3 is next.`;

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
      {resolution.line ? <p>{resolution.line}</p> : null}
      {pendingRematch && !isSpectator ? <p>{pendingRematch.senderName} sent you a rematch.</p> : null}
      {seriesLine && !isSpectator ? <p>{seriesLine}</p> : null}
    </ArcadeRunResult>
  );
}

type Resolution = {
  tone: 'win' | 'loss' | 'neutral';
  title: string;
  line: string;
};

function resolveSpectatorResolution(match: ConnectFourMatch): Resolution {
  const result = match.result as GameResult | null;
  const reason = match.winReason as WinReason | null;
  if (result === '1/2-1/2' || (!match.winnerId && !match.loserId)) {
    return { tone: 'neutral', title: 'Draw', line: drawLine(reason) };
  }
  const winnerIsRed = match.winnerId === match.redId;
  const winnerName = winnerIsRed
    ? (match.redId === match.player1Id ? match.player1Name : match.player2Name)
    : (match.yellowId === match.player1Id ? match.player1Name : match.player2Name);
  return {
    tone: 'neutral',
    title: winnerIsRed ? 'Red won' : 'Yellow won',
    line: winLine(reason, winnerName ?? 'the opponent'),
  };
}

function resolveResolution(match: ConnectFourMatch, isMe: string): Resolution {
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
    case 'four_in_a_row': return `Four in a row against ${opponentName}.`;
    case 'resignation': return `${opponentName} resigned.`;
    case 'forfeit': return `${opponentName} forfeited.`;
    default: return '';
  }
}

function lossLine(reason: WinReason | null, winnerName: string): string {
  switch (reason) {
    case 'four_in_a_row': return `${winnerName} got four in a row.`;
    case 'resignation': return 'You resigned.';
    case 'forfeit': return 'You forfeited.';
    default: return '';
  }
}

function drawLine(reason: WinReason | null): string {
  switch (reason) {
    case 'draw_full_board': return 'The board filled with no four in a row.';
    default: return '';
  }
}

function nameFor(match: ConnectFourMatch, userId: string): string {
  if (match.player1Id === userId) return match.player1Name;
  if (match.player2Id === userId) return match.player2Name ?? 'Unknown';
  return 'Unknown';
}
