'use client';

import { BALL_COLORS, type Ball, type BallGroup } from '@/features/arcade/lib/pool-physics';
import type { ProfileFlair } from '@/server/arcade/rewards/profile-flair';
import { PlayerCard, type PlayercardTheme } from './_player-card';

type PlayerInfo = {
  id: string;
  name: string;
  avatarUrl?: string | null;
  eloRating?: number | null;
  eloRank?: number | null;
  eloTier?: string | null;
  eloTierColor?: string | null;
  playercardTheme?: PlayercardTheme;
  flair?: ProfileFlair | null;
};

type BallTrayProps = {
  balls: Ball[];
  player1Group: BallGroup | null;
  player2Group: BallGroup | null;
  player1: PlayerInfo;
  player2: PlayerInfo;
  currentTurn: string;
  isGameOver?: boolean;
};

function MiniPocketedBall({ id }: { id: number }) {
  const info = BALL_COLORS[id] ?? { fill: '#888', stripe: false };
  return (
    <div
      className='flex shrink-0 items-center justify-center rounded-full text-[9px] font-bold shadow-sm'
      style={{
        width: 22,
        height: 22,
        background: info.stripe
          ? `linear-gradient(180deg, #f0f0f0 30%, ${info.fill} 30%, ${info.fill} 70%, #f0f0f0 70%)`
          : info.fill,
        color: id === 8 || (!info.stripe && id !== 0) ? '#fff' : '#111',
        border: '1px solid rgba(255,255,255,0.15)',
      }}
    >
      {id > 0 ? id : ''}
    </div>
  );
}

export function BallTray({
  balls,
  player1Group,
  player2Group,
  player1,
  player2,
  currentTurn,
  isGameOver,
}: BallTrayProps) {
  const pocketed = balls.filter((b) => b.pocketed && b.id !== 0 && b.id !== 8);
  const groupsAssigned = player1Group !== null && player2Group !== null;
  const ungroupedPocketed = !groupsAssigned ? pocketed : [];

  const isP1Turn = currentTurn === player1.id && !isGameOver;
  const isP2Turn = currentTurn !== player1.id && !isGameOver;

  return (
    <div className='space-y-1.5'>
      <div className='grid grid-cols-2 gap-2.5'>
        <PlayerCard
          name={player1.name}
          avatarUrl={player1.avatarUrl}
          eloRating={player1.eloRating}
          eloRank={player1.eloRank}
          eloTier={player1.eloTier}
          eloTierColor={player1.eloTierColor}
          group={player1Group}
          isCurrentTurn={isP1Turn}
          balls={balls}
          theme={player1.playercardTheme}
          flair={player1.flair}
          side='left'
        />
        <PlayerCard
          name={player2.name}
          avatarUrl={player2.avatarUrl}
          eloRating={player2.eloRating}
          eloRank={player2.eloRank}
          eloTier={player2.eloTier}
          eloTierColor={player2.eloTierColor}
          group={player2Group}
          isCurrentTurn={isP2Turn}
          balls={balls}
          theme={player2.playercardTheme}
          flair={player2.flair}
          side='right'
        />
      </div>

      {/* Ungrouped pocketed balls (during open table) */}
      {ungroupedPocketed.length > 0 && (
        <div className='flex items-center gap-2 rounded-well border border-soft bg-panel px-3 py-2'>
          <span className='text-xs text-faint'>Pocketed:</span>
          <div className='flex gap-1'>
            {ungroupedPocketed.map((b) => (
              <MiniPocketedBall key={b.id} id={b.id} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
