'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { TournamentMatchCard } from './match-card';
import type { BracketData, TournamentMatch, WagerPool } from './types';
import type { TournamentGameKey } from './config';

type Props = {
  bracket: BracketData;
  gameType: TournamentGameKey;
  /** Map of bracket-match-id → in-progress match id ({} when no matches are live). */
  activeMatches: Record<string, string | null>;
  isAdmin: boolean;
  onOverride: (match: TournamentMatch) => void;
  wagerPools?: Record<string, WagerPool> | null;
  userId?: string | null;
  tournamentId?: string;
  bettingEnabled?: boolean;
  minBet?: number;
  maxBet?: number;
  onBetPlaced?: () => void;
};

/**
 * Winners → Grand Final → Losers visualization. The losers pane collapses by
 * default so single-elim tournaments stay compact. Shared across chess and
 * pool — all per-game styling + routing is pulled from the config lookup in
 * <TournamentMatchCard>.
 */
export function TournamentBracket({
  bracket,
  gameType,
  activeMatches,
  isAdmin,
  onOverride,
  wagerPools,
  userId,
  tournamentId,
  bettingEnabled,
  minBet,
  maxBet,
  onBetPlaced,
}: Props) {
  const [showLosers, setShowLosers] = useState(false);
  const hasLosers = bracket.losers.length > 0;
  const hasGrandFinal = bracket.grandFinal.length > 0;

  return (
    <div className='space-y-4'>
      <div>
        <h3 className='mb-2 text-xs font-semibold uppercase tracking-widest text-faint'>
          {hasLosers ? 'Winners bracket' : 'Bracket'}
        </h3>
        <BracketRounds
          rounds={bracket.winners}
          gameType={gameType}
          activeMatches={activeMatches}
          isAdmin={isAdmin}
          onOverride={onOverride}
          wagerPools={wagerPools}
          userId={userId}
          tournamentId={tournamentId}
          bettingEnabled={bettingEnabled}
          minBet={minBet}
          maxBet={maxBet}
          onBetPlaced={onBetPlaced}
        />
      </div>

      {hasGrandFinal && (
        <div>
          <h3 className='mb-2 text-xs font-bold tracking-[0.16em] text-tickets-text uppercase'>
            Grand final
          </h3>
          <div className='flex flex-wrap gap-3'>
            {bracket.grandFinal.map((m) => {
              const canBet =
                bettingEnabled
                && !!userId
                && userId !== m.player1Id
                && userId !== m.player2Id;
              return (
                <div key={m.id} className='w-full max-w-[200px]'>
                  <TournamentMatchCard
                    match={m}
                    gameType={gameType}
                    activeMatchId={activeMatches[m.id]}
                    isAdmin={isAdmin}
                    onOverride={onOverride}
                    wagerPool={wagerPools?.[m.id]}
                    canBet={canBet}
                    tournamentId={tournamentId}
                    onBetPlaced={onBetPlaced}
                    minBet={minBet}
                    maxBet={maxBet}
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}

      {hasLosers && (
        <div>
          <button
            type='button'
            onClick={() => setShowLosers(!showLosers)}
            className='mb-2 flex items-center gap-1.5 text-xs font-bold tracking-[0.16em] text-faint uppercase transition-colors duration-[140ms] hover:text-danger-text'
          >
            Losers bracket
            {showLosers ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>
          {showLosers && (
            <BracketRounds
              rounds={bracket.losers}
              gameType={gameType}
              activeMatches={activeMatches}
              isAdmin={isAdmin}
              onOverride={onOverride}
              wagerPools={wagerPools}
              userId={userId}
              tournamentId={tournamentId}
              bettingEnabled={bettingEnabled}
              minBet={minBet}
              maxBet={maxBet}
              onBetPlaced={onBetPlaced}
            />
          )}
        </div>
      )}
    </div>
  );
}

function BracketRounds({
  rounds,
  gameType,
  activeMatches,
  isAdmin,
  onOverride,
  wagerPools,
  userId,
  tournamentId,
  bettingEnabled,
  minBet,
  maxBet,
  onBetPlaced,
}: {
  rounds: TournamentMatch[][];
  gameType: TournamentGameKey;
  activeMatches: Record<string, string | null>;
  isAdmin: boolean;
  onOverride: (match: TournamentMatch) => void;
  wagerPools?: Record<string, WagerPool> | null;
  userId?: string | null;
  tournamentId?: string;
  bettingEnabled?: boolean;
  minBet?: number;
  maxBet?: number;
  onBetPlaced?: () => void;
}) {
  if (rounds.length === 0) {
    return <p className='text-xs text-faint'>No matches yet.</p>;
  }

  return (
    <div className='overflow-x-auto'>
      <div className='flex gap-4' style={{ minWidth: `${rounds.length * 180}px` }}>
        {rounds.map((roundMatches, roundIdx) => (
          <div key={roundIdx} className='flex min-w-[160px] flex-col gap-3'>
            <p className='text-center text-[10px] font-medium uppercase tracking-wider text-faint'>
              {getRoundLabel(roundIdx + 1, rounds.length)}
            </p>
            <div
              className='flex flex-col justify-around gap-2'
              style={{ minHeight: `${roundMatches.length * 80}px` }}
            >
              {roundMatches.map((match) => {
                const canBet =
                  bettingEnabled
                  && !!userId
                  && userId !== match.player1Id
                  && userId !== match.player2Id;
                return (
                  <TournamentMatchCard
                    key={match.id}
                    match={match}
                    gameType={gameType}
                    activeMatchId={activeMatches[match.id]}
                    isAdmin={isAdmin}
                    onOverride={onOverride}
                    compact
                    wagerPool={wagerPools?.[match.id]}
                    canBet={canBet}
                    tournamentId={tournamentId}
                    onBetPlaced={onBetPlaced}
                    minBet={minBet}
                    maxBet={maxBet}
                  />
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function getRoundLabel(round: number, totalRounds: number): string {
  if (round === totalRounds) return 'Final';
  if (round === totalRounds - 1) return 'Semi-final';
  if (round === totalRounds - 2) return 'Quarter-final';
  return `Round ${round}`;
}
