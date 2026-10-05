'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Shield, Trophy } from 'lucide-react';
import { ArcadeButton } from '@/features/arcade/components/ui/arcade-ui';
import { TOURNAMENT_GAME_CONFIG, type TournamentGameKey } from './config';
import type { TournamentMatch, WagerPool } from './types';

type Props = {
  match: TournamentMatch;
  gameType: TournamentGameKey;
  /** In-progress match id this bracket slot currently points at. */
  activeMatchId?: string | null;
  isAdmin: boolean;
  onOverride?: (match: TournamentMatch) => void;
  compact?: boolean;
  /** Wager pool data for betting-enabled tournaments. */
  wagerPool?: WagerPool | null;
  /** Whether the current user is allowed to bet (not a player in this match). */
  canBet?: boolean;
  /** Tournament ID for placing bets. */
  tournamentId?: string;
  /** Callback after a bet is placed. */
  onBetPlaced?: () => void;
  /** Betting range. */
  minBet?: number;
  maxBet?: number;
};

/**
 * Single bracket slot: shows both players, status colors, override controls
 * for admins, and inline wager placement when betting is enabled. Shared
 * between chess and pool — visual accent + API path come from the gameType
 * config lookup, not hard-coded.
 */
export function TournamentMatchCard({
  match,
  gameType,
  activeMatchId,
  isAdmin,
  onOverride,
  compact,
  wagerPool,
  canBet,
  tournamentId,
  onBetPlaced,
  minBet = 5,
  maxBet = 100,
}: Props) {
  const cfg = TOURNAMENT_GAME_CONFIG[gameType];
  const [betAmount, setBetAmount] = useState(minBet);
  const [betPlayerId, setBetPlayerId] = useState('');
  const [betting, setBetting] = useState(false);
  const [betError, setBetError] = useState<string | null>(null);

  const isCompleted = match.status === 'completed';
  const isActive = match.status === 'active';
  const isPending = match.status === 'pending';
  const bettingOpen = canBet && isPending && match.player1Id && match.player2Id;

  const borderColor = isActive ? cfg.accent.borderActive : 'border-soft';
  const bgColor = isActive ? cfg.accent.bgActive : 'bg-panel';

  return (
    <div
      className={`rounded-panel border ${borderColor} ${bgColor} shadow-chip ${compact ? 'px-2 py-1.5' : 'px-3 py-2'}`}
    >
      <PlayerRow
        name={match.player1Name}
        wins={match.player1Wins}
        isWinner={match.winnerId === match.player1Id}
        isCompleted={isCompleted}
        compact={compact}
      />
      <div className={`border-t border-soft ${compact ? 'my-0.5' : 'my-1'}`} />
      <PlayerRow
        name={match.player2Name}
        wins={match.player2Wins}
        isWinner={match.winnerId === match.player2Id}
        isCompleted={isCompleted}
        compact={compact}
      />

      {(match.draws ?? 0) > 0 && (
        <p className='arcade-num mt-1 text-center text-[10px] text-faint'>
          {match.draws} draw{match.draws === 1 ? '' : 's'}
        </p>
      )}

      {match.isBye && (
        <p className='mt-1 text-center text-[10px] text-faint'>
          Bye
        </p>
      )}

      {match.overriddenBy && (
        <p className='mt-1 text-center text-[10px] text-tickets-text'>
          <Shield size={10} className='mr-0.5 inline' />
          Override
        </p>
      )}

      {isActive && activeMatchId && (
        <Link
          href={`${cfg.arcadeMatchPath}/${activeMatchId}`}
          className={`mt-1.5 block rounded-key border border-ink ${cfg.accent.ctaBg} px-2 py-1 text-center text-[11px] font-bold ${cfg.accent.ctaText} shadow-chip transition-[filter] duration-[140ms] ${cfg.accent.ctaHover}`}
        >
          Watch
        </Link>
      )}

      {isAdmin && isActive && onOverride && (
        <ArcadeButton
          tone='tickets'
          size='xs'
          className='mt-1 w-full'
          onClick={() => onOverride(match)}
        >
          Override
        </ArcadeButton>
      )}

      {wagerPool && wagerPool.totalPool > 0 && (
        <div className='arcade-num mt-1.5 flex items-center justify-between text-[10px] text-tickets-text'>
          <span>{wagerPool.player1Total}c</span>
          <span className='text-faint'>pool: {wagerPool.totalPool}c</span>
          <span>{wagerPool.player2Total}c</span>
        </div>
      )}

      {bettingOpen && (
        <div className='mt-1.5 space-y-1'>
          <div className='flex gap-1'>
            <button
              type='button'
              onClick={() => setBetPlayerId(match.player1Id!)}
              className={`flex-1 rounded px-1 py-0.5 text-[10px] font-medium transition ${
                betPlayerId === match.player1Id
                  ? 'border border-ink bg-tickets text-tickets-on'
                  : 'border border-soft bg-raised text-faint hover:text-strong'
              }`}
            >
              {match.player1Name ?? 'P1'}
            </button>
            <button
              type='button'
              onClick={() => setBetPlayerId(match.player2Id!)}
              className={`flex-1 rounded px-1 py-0.5 text-[10px] font-medium transition ${
                betPlayerId === match.player2Id
                  ? 'border border-ink bg-tickets text-tickets-on'
                  : 'border border-soft bg-raised text-faint hover:text-strong'
              }`}
            >
              {match.player2Name ?? 'P2'}
            </button>
          </div>
          {betPlayerId && (
            <div className='flex gap-1'>
              <input
                type='number'
                min={minBet}
                max={maxBet}
                step={cfg.wagerIncrement}
                value={betAmount}
                onChange={(e) => setBetAmount(Math.max(minBet, Math.min(maxBet, Math.trunc(Number(e.target.value) || minBet))))}
                className='arcade-input arcade-num w-16 px-1.5 py-0.5 text-[10px]'
              />
              <ArcadeButton
                tone='tickets'
                size='xs'
                disabled={betting}
                onClick={async () => {
                  setBetting(true);
                  setBetError(null);
                  try {
                    const res = await fetch(`${cfg.apiBasePath}/${tournamentId}/wager`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        tournamentMatchId: match.id,
                        backedPlayerId: betPlayerId,
                        amount: betAmount,
                      }),
                    });
                    const data = await res.json();
                    if (!res.ok) throw new Error(data.error || 'Failed');
                    setBetPlayerId('');
                    onBetPlaced?.();
                  } catch (err) {
                    setBetError((err as Error).message);
                  } finally {
                    setBetting(false);
                  }
                }}
              >
                {betting ? '…' : 'Bet'}
              </ArcadeButton>
            </div>
          )}
          {betError && <p className='text-[9px] text-danger-text'>{betError}</p>}
        </div>
      )}
    </div>
  );
}

function PlayerRow({
  name,
  wins,
  isWinner,
  isCompleted,
  compact,
}: {
  name: string | null;
  wins: number;
  isWinner: boolean;
  isCompleted: boolean;
  compact?: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between gap-2 ${compact ? 'min-h-[20px]' : 'min-h-[24px]'}`}
    >
      <div className='flex min-w-0 items-center gap-1.5'>
        {isCompleted && isWinner && (
          <Trophy size={10} className='shrink-0 text-tickets-text' />
        )}
        <span
          className={`truncate ${compact ? 'text-[11px]' : 'text-xs'} ${
            isCompleted && isWinner
              ? 'font-semibold text-strong'
              : isCompleted && !isWinner
                ? 'text-faint line-through'
                : name
                  ? 'text-strong'
                  : 'text-faint'
          }`}
        >
          {name ?? 'TBD'}
        </span>
      </div>
      {wins > 0 && (
        <span
          className={`arcade-num shrink-0 ${compact ? 'text-[10px]' : 'text-[11px]'} font-bold ${isWinner ? 'text-prize-text' : 'text-faint'}`}
        >
          {wins}
        </span>
      )}
    </div>
  );
}
