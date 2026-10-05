'use client';

import { useEffect, useState } from 'react';
import { ArrowLeft, Repeat, Trophy, X } from 'lucide-react';
import { ArcadeButton } from '@/features/arcade/components/ui/arcade-ui';
import { ArcadeRunRewards } from '@/features/arcade/components/results/arcade-run-result';
import type { ArcadeRunResultSnapshot } from '@/features/arcade/lib/run-result';
import type { AccountXpReward } from '@/server/arcade/rewards/types';
import { accuracyOf, type PublicMatch, type WinReason } from '@/features/arcade/lib/battleship';
import './_battleship.css';
import { ArcadeLoadingDots } from '@/features/arcade/components/ui/arcade-states';

type EloDelta = {
  before: number;
  after: number;
  change: number;
  tier: string;
  tierColor: string;
};

type Props = {
  match: PublicMatch;
  isMe: string;
  myElo: EloDelta | null;
  opponentElo: EloDelta | null;
  onRematch?: () => void | Promise<void>;
  onLobby: () => void;
  canRematch: boolean;
  isSpectator?: boolean;
  accountXp?: AccountXpReward | null;
  runResult?: ArcadeRunResultSnapshot | null;
};

/**
 * Full-bleed postgame overlay. Fades in over the boards, showing the result
 * headline, each player's shot accuracy, Elo deltas, and primary actions
 * (Rematch / Lobby). Esc dismisses to peek at the revealed boards.
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

  const resolution = resolveResolution(match, isMe, isSpectator);

  // My accuracy is from my own shots; the opponent's is shown only at game over.
  const myAccuracy = accuracyOf(match.myShots);
  const oppAccuracy = accuracyOf(match.incomingShots);

  return (
    <div
      className="battleship-arcade pointer-events-auto absolute inset-0 z-20 flex items-center justify-center"
      style={{ transition: 'opacity 280ms ease', opacity: visible ? 1 : 0 }}
      role="dialog"
      aria-modal="true"
    >
      <div className="absolute inset-0 bg-black/70" />

      <div
        className={`arcade-modal mx-4 max-h-[calc(100%-2rem)] max-w-md overflow-y-auto ${
          resolution.tone === 'win' ? 'border-prize' : resolution.tone === 'neutral' ? 'border-ink' : 'border-danger'
        }`}
        style={{ transform: visible ? 'translateY(0)' : 'translateY(12px)', transition: 'transform 320ms ease' }}
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
            <Trophy className={resolution.tone === 'loss' ? 'text-danger-text opacity-70' : 'text-tickets-text'} size={26} />
          </div>
          <div className="arcade-kicker text-[11px] text-faint">{resolution.reasonLabel}</div>
          <div
            className={`mt-1 text-3xl font-bold ${
              resolution.tone === 'win' ? 'text-prize-text' : resolution.tone === 'neutral' ? 'text-strong' : 'text-danger-text'
            }`}
          >
            {resolution.headline}
          </div>
          {resolution.subhead && <div className="mt-1 text-sm text-faint">{resolution.subhead}</div>}

          {!isSpectator && (
            <div className="mt-3 inline-flex items-center gap-3 rounded-well border border-soft bg-well px-4 py-2 text-sm">
              <span className="text-faint">Accuracy</span>
              <span className="arcade-num font-bold text-strong">{myAccuracy}%</span>
              <span className="text-faint">vs</span>
              <span className="arcade-num font-bold text-body">{oppAccuracy}%</span>
            </div>
          )}
        </div>

        {!isSpectator && myElo && opponentElo && (
          <div className="mx-6 mt-5 grid grid-cols-2 gap-2">
            <PlayerEloCard name={nameFor(match, isMe)} side="you" elo={myElo} />
            <PlayerEloCard name={nameFor(match, otherPlayerId(match, isMe) ?? '')} side="opp" elo={opponentElo} />
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

function PlayerEloCard({ name, side, elo }: { name: string; side: 'you' | 'opp'; elo: EloDelta }) {
  const gained = elo.change > 0;
  const lost = elo.change < 0;
  return (
    <div className="rounded-well border border-soft bg-well px-3 py-2">
      <div className="truncate text-[10px] font-semibold uppercase tracking-wider text-faint">
        {side === 'you' ? 'You' : 'Opponent'} · {name}
      </div>
      <div className="mt-0.5 flex items-baseline gap-2">
        <span className="arcade-num text-lg font-bold text-strong">{elo.after}</span>
        <span className={`arcade-num text-base font-bold ${gained ? 'text-prize-text' : lost ? 'text-danger-text' : 'text-faint'}`}>
          {gained ? '+' : ''}{elo.change}
        </span>
      </div>
      <div className="text-[10px] text-info-text">{elo.tier}</div>
    </div>
  );
}

type Resolution = {
  tone: 'win' | 'loss' | 'neutral';
  headline: string;
  subhead: string | null;
  reasonLabel: string;
};

function resolveResolution(match: PublicMatch, isMe: string, isSpectator: boolean): Resolution {
  const reason = match.winReason;
  const reasonLabel = reasonToLabel(reason);

  if (isSpectator) {
    const winnerName = match.winnerId ? nameFor(match, match.winnerId) : 'Someone';
    return { tone: 'neutral', headline: `${winnerName} wins`, subhead: spectatorSubhead(reason), reasonLabel };
  }

  if (match.winnerId === isMe) {
    const opponentName = nameFor(match, match.loserId ?? '') || 'your opponent';
    return { tone: 'win', headline: 'Victory', subhead: winSubhead(reason, opponentName), reasonLabel };
  }
  const winnerName = match.winnerId ? nameFor(match, match.winnerId) : 'Opponent';
  return { tone: 'loss', headline: 'Defeat', subhead: lossSubhead(reason, winnerName), reasonLabel };
}

function reasonToLabel(reason: WinReason | null): string {
  switch (reason) {
    case 'fleet_destroyed': return 'Fleet destroyed';
    case 'resignation': return 'Resignation';
    case 'forfeit': return 'Forfeit';
    default: return 'Game over';
  }
}

function winSubhead(reason: WinReason | null, opponentName: string): string | null {
  switch (reason) {
    case 'fleet_destroyed': return `you sank ${opponentName}'s entire fleet`;
    case 'resignation': return `${opponentName} resigned`;
    case 'forfeit': return `${opponentName} forfeited`;
    default: return null;
  }
}

function lossSubhead(reason: WinReason | null, winnerName: string): string | null {
  switch (reason) {
    case 'fleet_destroyed': return `${winnerName} sank your fleet`;
    case 'resignation': return 'You resigned';
    case 'forfeit': return 'You forfeited';
    default: return null;
  }
}

function spectatorSubhead(reason: WinReason | null): string | null {
  switch (reason) {
    case 'fleet_destroyed': return 'the enemy fleet was destroyed';
    case 'resignation': return 'by resignation';
    case 'forfeit': return 'by forfeit';
    default: return null;
  }
}

function nameFor(match: PublicMatch, userId: string): string {
  if (match.player1Id === userId) return match.player1Name;
  if (match.player2Id === userId) return match.player2Name ?? 'Unknown';
  return 'Unknown';
}

function otherPlayerId(match: PublicMatch, userId: string): string | null {
  if (match.player1Id === userId) return match.player2Id;
  if (match.player2Id === userId) return match.player1Id;
  return null;
}
