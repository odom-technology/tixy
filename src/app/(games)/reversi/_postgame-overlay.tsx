'use client';

import { useEffect, useState } from 'react';
import { ArrowLeft, Handshake, Repeat, Trophy, X } from 'lucide-react';
import { ArcadeButton } from '@/features/arcade/components/ui/arcade-ui';
import { ArcadeRunRewards } from '@/features/arcade/components/results/arcade-run-result';
import type { ArcadeRunResultSnapshot } from '@/features/arcade/lib/run-result';
import type { AccountXpReward } from '@/server/arcade/rewards/types';
import { countDiscs } from '@/features/arcade/lib/reversi';
import type { ReversiMatch, GameResult, WinReason } from '@/features/arcade/lib/reversi/types';
import './_reversi.css';
import { ArcadeLoadingDots } from '@/features/arcade/components/ui/arcade-states';

type EloDelta = {
  before: number;
  after: number;
  change: number;
  tier: string;
  tierColor: string;
};

type Props = {
  match: ReversiMatch;
  isMe: string;
  myElo: EloDelta | null;
  opponentElo: EloDelta | null;
  onRematch?: () => void | Promise<void>;
  onLobby: () => void;
  canRematch: boolean;
  isSpectator?: boolean;
  pendingRematch?: { matchId: string; senderName: string } | null;
  onAcceptPendingRematch?: () => void;
  /** Account XP earned this match for the end-of-game burst (viewer-specific). */
  accountXp?: AccountXpReward | null;
  runResult?: ArcadeRunResultSnapshot | null;
};

/**
 * Full-bleed postgame overlay. Fades in over the board, showing the result
 * headline, final disc score, Elo deltas for both players, and primary actions
 * (Rematch / Lobby). Esc dismisses to peek at the final board.
 */
export function PostgameOverlay({
  match,
  isMe,
  myElo,
  opponentElo,
  onRematch,
  onLobby,
  canRematch,
  isSpectator = false,
  pendingRematch = null,
  onAcceptPendingRematch,
  accountXp = null,
  runResult = null,
}: Props) {
  const [visible, setVisible] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [rematchPending, setRematchPending] = useState(false);

  useEffect(() => {
    const t = window.setTimeout(() => setVisible(true), 40);
    return () => window.clearTimeout(t);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDismissed(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (dismissed) return null;

  const resolution = isSpectator
    ? resolveSpectatorResolution(match)
    : resolveResolution(match, isMe);

  const { black, white } = countDiscs(match.board);

  return (
    <div
      className="reversi-arcade pointer-events-auto absolute inset-0 z-20 flex items-center justify-center"
      style={{ transition: 'opacity 280ms ease', opacity: visible ? 1 : 0 }}
      role="dialog"
      aria-modal="true"
    >
      <div className="absolute inset-0 bg-black/70" />

      <div
        className={`arcade-modal mx-4 max-h-[calc(100%-2rem)] max-w-md overflow-y-auto ${
          resolution.tone === 'win'
            ? 'border-prize'
            : resolution.tone === 'draw'
            ? 'border-ink'
            : 'border-danger'
        }`}
        style={{
          transform: visible ? 'translateY(0)' : 'translateY(12px)',
          transition: 'transform 320ms ease',
        }}
      >
        <ArcadeButton
          tone="ghost"
          size="icon-xs"
          className="absolute right-3 top-3"
          onClick={() => setDismissed(true)}
          aria-label="Dismiss"
        >
          <X size={16} />
        </ArcadeButton>

        <div className="px-6 pt-8 text-center">
          <div className="mb-2 inline-flex items-center justify-center rounded-full border border-soft bg-raised p-3">
            {resolution.tone === 'win' && <Trophy className="text-tickets-text" size={26} />}
            {resolution.tone === 'draw' && <Handshake className="text-body" size={26} />}
            {resolution.tone === 'loss' && <Trophy className="text-danger-text opacity-70" size={26} />}
          </div>
          <div className="arcade-kicker text-[11px] text-faint">
            {resolution.reasonLabel}
          </div>
          <div
            className={`mt-1 text-3xl font-bold ${
              resolution.tone === 'win'
                ? 'text-prize-text'
                : resolution.tone === 'draw'
                ? 'text-strong'
                : 'text-danger-text'
            }`}
          >
            {resolution.headline}
          </div>
          {resolution.subhead && (
            <div className="mt-1 text-sm text-faint">{resolution.subhead}</div>
          )}
          <div className="mt-3 inline-flex items-center gap-3 rounded-well border border-soft bg-well px-4 py-2">
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-3.5 w-3.5 rounded-full" style={{ background: '#1b1d22', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.25)' }} aria-hidden />
              <span className="arcade-num text-lg font-bold text-strong">{black}</span>
            </span>
            <span className="text-faint">–</span>
            <span className="flex items-center gap-1.5">
              <span className="arcade-num text-lg font-bold text-strong">{white}</span>
              <span className="inline-block h-3.5 w-3.5 rounded-full" style={{ background: '#f3eee2', boxShadow: 'inset 0 -2px 3px rgba(0,0,0,0.3)' }} aria-hidden />
            </span>
          </div>
        </div>

        {!isSpectator && myElo && opponentElo && (
          <div className="mx-6 mt-5 grid grid-cols-2 gap-2">
            <PlayerEloCard name={nameFor(match, isMe)} side="you" elo={myElo} />
            <PlayerEloCard
              name={nameFor(match, otherPlayerId(match, isMe) ?? '')}
              side="opp"
              elo={opponentElo}
            />
          </div>
        )}

        {!isSpectator && (runResult || accountXp) && (
          <div className="mx-6 mt-4">
            <ArcadeRunRewards
              reward={runResult?.reward ?? (accountXp ? { account: accountXp } : null)}
              achievements={runResult?.achievements ?? []}
              ticketSound={false}
            />
          </div>
        )}

        {!isSpectator && pendingRematch && onAcceptPendingRematch && (
          <div className="arcade-card-inset mx-6 mt-4 flex flex-col items-stretch gap-2 px-3 py-3 text-center">
            <div className="text-xs text-tickets-text">
              <span className="font-semibold">{pendingRematch.senderName}</span>{' '}
              sent you a rematch
            </div>
            <ArcadeButton tone="primary" size="sm" onClick={onAcceptPendingRematch}>
              <Repeat size={14} />
              Accept rematch
            </ArcadeButton>
          </div>
        )}

        <div className="mt-6 flex gap-2 px-6 pb-6">
          <ArcadeButton tone="default" size="sm" className="flex-1" onClick={onLobby}>
            <ArrowLeft size={14} />
            Lobby
          </ArcadeButton>
          {!isSpectator && canRematch && onRematch && (
            <ArcadeButton
              tone="primary"
              size="sm"
              className="flex-1"
              onClick={async () => {
                setRematchPending(true);
                try { await onRematch(); }
                finally { setRematchPending(false); }
              }}
              disabled={rematchPending}
            >
              {rematchPending ? <ArcadeLoadingDots /> : <Repeat size={14} />}
              Rematch
            </ArcadeButton>
          )}
        </div>
      </div>
    </div>
  );
}

function PlayerEloCard({
  name,
  side,
  elo,
}: {
  name: string;
  side: 'you' | 'opp';
  elo: EloDelta;
}) {
  const gained = elo.change > 0;
  const lost = elo.change < 0;
  return (
    <div className="rounded-well border border-soft bg-well px-3 py-2">
      <div className="truncate text-[10px] font-semibold uppercase tracking-wider text-faint">
        {side === 'you' ? 'You' : 'Opponent'} · {name}
      </div>
      <div className="mt-0.5 flex items-baseline gap-2">
        <span className="arcade-num text-lg font-bold text-strong">{elo.after}</span>
        <span
          className={`arcade-num text-base font-bold ${
            gained ? 'text-prize-text' : lost ? 'text-danger-text' : 'text-faint'
          }`}
        >
          {gained ? '+' : ''}{elo.change}
        </span>
      </div>
      <div className="text-[10px] text-info-text">{elo.tier}</div>
    </div>
  );
}

type Resolution = {
  tone: 'win' | 'loss' | 'draw';
  headline: string;
  subhead: string | null;
  reasonLabel: string;
};

function resolveSpectatorResolution(match: ReversiMatch): Resolution {
  const result = match.result as GameResult | null;
  const reason = match.winReason as WinReason | null;
  const reasonLabel = reasonToLabel(reason);
  if (result === '1/2-1/2' || (!match.winnerId && !match.loserId)) {
    return { tone: 'draw', headline: 'Draw', subhead: drawSubhead(reason), reasonLabel };
  }
  const winnerIsBlack = match.winnerId === match.blackId;
  const winnerName = winnerIsBlack
    ? (match.blackId === match.player1Id ? match.player1Name : match.player2Name)
    : (match.whiteId === match.player1Id ? match.player1Name : match.player2Name);
  return {
    tone: 'win',
    headline: `${winnerIsBlack ? 'Black' : 'White'} wins`,
    subhead: winSubhead(reason, winnerName ?? 'the opponent'),
    reasonLabel,
  };
}

function resolveResolution(match: ReversiMatch, isMe: string): Resolution {
  const winner = match.winnerId;
  const loser = match.loserId;
  const result = match.result as GameResult | null;
  const reason = match.winReason as WinReason | null;
  const reasonLabel = reasonToLabel(reason);

  if (result === '1/2-1/2' || (!winner && !loser)) {
    return { tone: 'draw', headline: 'Draw', subhead: drawSubhead(reason), reasonLabel };
  }

  if (winner === isMe) {
    const opponentName = nameFor(match, loser ?? '') || 'your opponent';
    return { tone: 'win', headline: 'You win', subhead: winSubhead(reason, opponentName), reasonLabel };
  }

  const winnerName = winner ? nameFor(match, winner) : 'Opponent';
  return { tone: 'loss', headline: 'You lose', subhead: lossSubhead(reason, winnerName), reasonLabel };
}

function reasonToLabel(reason: WinReason | null): string {
  switch (reason) {
    case 'disc_majority': return 'Most discs';
    case 'resignation': return 'Resignation';
    case 'draw_full_board': return 'Even board';
    case 'forfeit': return 'Forfeit';
    default: return 'Game over';
  }
}

function winSubhead(reason: WinReason | null, opponentName: string): string | null {
  switch (reason) {
    case 'disc_majority': return `you out-flanked ${opponentName}`;
    case 'resignation': return `${opponentName} resigned`;
    case 'forfeit': return `${opponentName} forfeited`;
    default: return null;
  }
}

function lossSubhead(reason: WinReason | null, winnerName: string): string | null {
  switch (reason) {
    case 'disc_majority': return `${winnerName} held more discs`;
    case 'resignation': return 'You resigned';
    case 'forfeit': return 'You forfeited';
    default: return null;
  }
}

function drawSubhead(reason: WinReason | null): string | null {
  switch (reason) {
    case 'draw_full_board': return 'The board ended with discs split evenly';
    default: return null;
  }
}

function nameFor(match: ReversiMatch, userId: string): string {
  if (match.player1Id === userId) return match.player1Name;
  if (match.player2Id === userId) return match.player2Name ?? 'Unknown';
  return 'Unknown';
}

function otherPlayerId(match: ReversiMatch, userId: string): string | null {
  if (match.player1Id === userId) return match.player2Id;
  if (match.player2Id === userId) return match.player1Id;
  return null;
}
