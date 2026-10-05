'use client';

/* The end of a match: the kit's ticket strip, rematch first. The strip
   prints what the server paid; a refresh after the end shows the result
   with no strip, because the payout was delivered once. */

import type { ReactNode } from 'react';

import { ArcadeButton } from '@/features/arcade/components/ui/arcade-ui';
import { Num } from '@/features/arcade/components/ui/num';
import {
  ArcadeRematchButton,
  ArcadeRunResult,
  type ArcadeRunStat,
} from '@/features/arcade/components/results/arcade-run-result';
import { isSolid, isStripe } from '@/features/arcade/lib/pool-physics';
import type { ArcadeRunResultSnapshot } from '@/features/arcade/lib/run-result';
import type { AccountXpReward } from '@/server/arcade/rewards/types';
import type { PoolMatch } from '@/server/arcade/pool-match';

type EloSide = { before: number; after: number; change: number; tier: string; tierColor: string };

export type PoolResultProps = {
  match: PoolMatch;
  userId: string;
  isSpectator: boolean;
  guest: boolean;
  eloChange: { winner: EloSide; loser: EloSide } | null;
  botRecord: { humanTurns: number; previousBest: number | null; isNewRecord: boolean; isWorldRecord: boolean } | null;
  matchReward: { awardedCredits: number; earnedTodayTotal: number; capRemaining: number } | null;
  accountXp: AccountXpReward | null;
  runResult: ArcadeRunResultSnapshot | null;
  /** The opponent already asked for a rematch, with their stake. */
  rematchFrom: { name: string; wager: number } | null;
  /** A staked rematch was pressed once: the next press stakes. */
  stakeConfirm: boolean;
  /** The viewer's own shots, once the server has counted them. */
  myShots: number | null;
  /** What the first button does: rematch, ask to be friends (a player rematch
   *  goes to friends only), or wait while that is checked. */
  rematch: 'rematch' | 'add-friend' | 'unknown';
  friendRequest: 'idle' | 'sending' | 'sent';
  onAddFriend: () => void;
  rematchBusy: boolean;
  rematchError: string | null;
  onRematch: () => void;
  onLobby: () => void;
  onReplay?: () => void;
  replayBusy?: boolean;
  replayError?: string | null;
};

const REASON: Record<string, (won: boolean, them: string) => string> = {
  cleared_8ball: (won, them) => (won ? 'You sank the 8.' : `${them} sank the 8.`),
  opponent_early_8ball: (won, them) => (won ? `${them} sank the 8 early.` : 'You sank the 8 early.'),
  opponent_foul_8ball: (won, them) => (won ? `${them} fouled on the 8.` : 'You fouled on the 8.'),
  opponent_wrong_pocket_8ball: (won, them) =>
    won ? `${them} sank the 8 in the wrong pocket.` : 'You sank the 8 in the wrong pocket.',
  forfeit: (won, them) => (won ? `${them} forfeited.` : 'You forfeited.'),
};

function pocketedFor(match: PoolMatch, group: 'solids' | 'stripes' | null) {
  if (!group) return 0;
  return match.balls.filter((b) => b.pocketed && (group === 'solids' ? isSolid(b.id) : isStripe(b.id))).length;
}

export function PoolResult({
  match,
  userId,
  isSpectator,
  guest,
  eloChange,
  botRecord,
  matchReward,
  accountXp,
  runResult,
  rematchFrom,
  stakeConfirm,
  myShots,
  rematch,
  friendRequest,
  onAddFriend,
  rematchBusy,
  rematchError,
  onRematch,
  onLobby,
  onReplay,
  replayBusy = false,
  replayError = null,
}: PoolResultProps) {
  const viewerId = isSpectator ? match.player1Id : userId;
  const meIsP1 = match.player1Id === viewerId;
  const myName = meIsP1 ? match.player1Name : (match.player2Name ?? 'player 2');
  const them = (meIsP1 ? match.player2Name : match.player1Name)?.replace(/ \(bot\)$/i, '') ?? 'your opponent';
  const won = match.winnerId === viewerId;
  const myGroup = meIsP1 ? match.player1Group : match.player2Group;
  const theirGroup = meIsP1 ? match.player2Group : match.player1Group;

  const title = isSpectator
    ? `${match.winnerId === match.player1Id ? match.player1Name : (match.player2Name ?? 'Player 2')} won`
    : won
      ? 'You won'
      : 'You lost';

  const shots = isSpectator ? match.moveCount : myShots;
  // Each label says what it counts: the balls of your group you sank, the
  // balls of theirs they sank, your shots. A spectator sees both players'.
  const stats: ArcadeRunStat[] = [
    { label: isSpectator ? `${myName} sank` : 'you sank', value: `${pocketedFor(match, myGroup)}/7` },
    { label: isSpectator ? `${them} sank` : 'they sank', value: `${pocketedFor(match, theirGroup)}/7` },
    ...(shots != null ? [{ label: isSpectator ? 'shots' : 'your shots', value: shots }] : []),
  ];

  const reason = match.winReason ? REASON[match.winReason]?.(won, them) : null;
  const mins = match.completedAt ? Math.max(1, Math.round((match.completedAt - match.createdAt) / 60_000)) : null;

  const lines: ReactNode[] = [];
  if (reason) {
    lines.push(
      <p key='reason' className='text-sm text-body'>
        {reason}
        {mins ? <> <Num value={mins} /> {mins === 1 ? 'minute' : 'minutes'}.</> : null}
      </p>,
    );
  }
  if (!isSpectator && eloChange) {
    const mine = won ? eloChange.winner : eloChange.loser;
    lines.push(
      <p key='rating' className='flex items-baseline justify-between gap-3 text-sm text-body'>
        <span>pool rating</span>
        <span className='flex items-baseline gap-2'>
          <b className='text-xl text-strong'><Num value={mine.after} /></b>
          <Num value={mine.change} signed className={mine.change > 0 ? 'text-tixy-red' : undefined} />
        </span>
      </p>,
    );
  }
  if (!isSpectator && match.wagerAmount) {
    const refunded = match.wagerStatus === 'refunded';
    lines.push(
      <p key='wager' className='flex items-baseline justify-between gap-3 text-sm text-body'>
        <span>{refunded ? 'wager refunded' : 'wager'}</span>
        <Num value={refunded ? 0 : won ? match.wagerAmount : -match.wagerAmount} signed labelSuffix='tickets' />
      </p>,
    );
  }
  if (!isSpectator && botRecord) {
    lines.push(
      <p key='record' className='text-sm text-body'>
        <Num value={botRecord.humanTurns} /> turns.{' '}
        {botRecord.isWorldRecord
          ? 'The best on the board.'
          : botRecord.isNewRecord
            ? 'Your new best.'
            : botRecord.previousBest
              ? <>Your best is <Num value={botRecord.previousBest} />.</>
              : null}
      </p>,
    );
  }
  if (!isSpectator && rematchFrom) {
    lines.push(
      <p key='asked' className='text-sm font-bold text-strong'>
        {rematchFrom.name} wants a rematch
        {rematchFrom.wager > 0 ? <> for <Num value={rematchFrom.wager} /> tickets each</> : null}.
      </p>,
    );
    if (rematchFrom.wager > 0 && stakeConfirm) {
      lines.push(
        <p key='stake' className='text-sm text-body'>
          Accepting holds <Num value={rematchFrom.wager} /> of your tickets until the game ends.
        </p>,
      );
    }
  } else if (!isSpectator && rematch === 'rematch' && match.wagerAmount && match.player2Id && !match.player2Id.startsWith('bot:')) {
    lines.push(<p key='nostake' className='text-sm text-body'>A rematch has no wager.</p>);
  }
  if (!isSpectator && rematch === 'add-friend') {
    lines.push(
      <p key='friend' className='text-sm text-body'>
        {friendRequest === 'sent'
          ? `Rematch opens once ${them} accepts your friend request.`
          : `Add ${them} as a friend to ask for a rematch.`}
      </p>,
    );
  }
  if (rematchError) {
    lines.push(<p key='rerr' className='text-sm text-body'>{rematchError}</p>);
  }
  if (replayError) {
    lines.push(<p key='perr' className='text-sm text-body'>{replayError}</p>);
  }

  const reward = isSpectator
    ? null
    : (runResult?.reward ??
      (matchReward
        ? {
            awardedCredits: matchReward.awardedCredits,
            earnedTodayTotal: matchReward.earnedTodayTotal,
            capRemaining: matchReward.capRemaining,
            account: accountXp ?? undefined,
          }
        : null));

  return (
    <ArcadeRunResult
      title={title}
      tone={isSpectator ? 'neutral' : won ? 'win' : 'loss'}
      stats={stats}
      reward={reward}
      achievements={isSpectator ? [] : (runResult?.achievements ?? [])}
      guest={guest}
      back={{ label: 'lobby', onClick: onLobby }}
      actions={
        <>
          {isSpectator ? null : rematch === 'add-friend' ? (
            <ArcadeRematchButton onClick={onAddFriend} disabled={friendRequest !== 'idle'}>
              {friendRequest === 'sent' ? 'request sent' : 'add friend'}
            </ArcadeRematchButton>
          ) : (
            <ArcadeRematchButton onClick={onRematch} disabled={rematchBusy || rematch === 'unknown'}>
              {rematchFrom ? (rematchFrom.wager > 0 && stakeConfirm ? 'stake it' : 'accept') : 'rematch'}
            </ArcadeRematchButton>
          )}
          {onReplay ? (
            <ArcadeButton size='lg' onClick={onReplay} disabled={replayBusy}>
              replay
            </ArcadeButton>
          ) : null}
        </>
      }
    >
      {lines.length > 0 ? <div className='grid gap-1.5'>{lines}</div> : null}
    </ArcadeRunResult>
  );
}
