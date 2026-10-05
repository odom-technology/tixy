'use client';

import { FramedAvatar } from '@/features/users/components/framed-avatar';
import { Username } from '@/features/users/components/username';
import { namecardBackground } from '@/features/users/components/namecard';
import type { ProfileFlair } from '@/server/arcade/rewards/profile-flair';
import type { CheckersColor } from '@/features/arcade/lib/checkers/types';

type Props = {
  name: string;
  avatarUrl?: string | null;
  color: CheckersColor;
  eloRating?: number | null;
  eloTier?: string | null;
  eloTierColor?: string | null;
  /** Whether it is this player's turn. */
  isActive: boolean;
  /** Number of pieces this player currently has on the board. */
  pieceCount?: number;
  /** Number of kings this player currently has. */
  kingCount?: number;
  /** Equipped profile cosmetics (background/frame/badge/name color/title). */
  flair?: ProfileFlair | null;
  side: 'left' | 'right';
  /** Bot difficulty tier — renders a difficulty chip next to the name. */
  botTier?: 'easy' | 'medium' | 'hard' | null;
};

/** Checkers player card. Renders each player's equipped profile namecard. */
export function CheckersPlayerCard({
  name,
  avatarUrl,
  color,
  eloRating,
  eloTier,
  eloTierColor,
  isActive,
  pieceCount,
  kingCount,
  flair,
  side,
  botTier,
}: Props) {
  const flairBg = namecardBackground(flair);
  const frameColor = flair?.frameColor ?? null;
  return (
    <div
      className={`relative flex items-center gap-2.5 rounded-panel px-3 py-2.5 overflow-hidden shadow-chip transition-colors ease-out ${
        side === 'right' ? 'flex-row-reverse text-right' : ''
      }`}
      style={{
        background: flairBg ?? 'var(--surface-panel)',
        border: `2px solid ${isActive ? 'var(--enamel-prize)' : (frameColor ?? 'var(--border-ink)')}`,
        transitionDuration: '200ms',
      }}
    >
      {/* Dark scrim over the equipped background for name/elo legibility. */}
      {flairBg && (
        <div
          aria-hidden
          className='absolute inset-0 z-0'
          style={{
            background:
              'linear-gradient(90deg, rgba(8,12,20,0.82) 0%, rgba(8,12,20,0.55) 55%, rgba(8,12,20,0.4) 100%)',
          }}
        />
      )}

      <div className='relative z-10 shrink-0'>
        <span
          className='block rounded-full'
          style={frameColor ? { boxShadow: `0 0 0 2px ${frameColor}` } : undefined}
        >
          <FramedAvatar name={name} imageUrl={avatarUrl} frame={flair?.frameArt ?? null} size='md' />
        </span>
        <span
          className='absolute -bottom-1 -right-1 inline-flex h-4 w-4 items-center justify-center rounded-full border border-ink'
          style={{
            background: color === 'red' ? '#c43a36' : '#f3e7cf',
          }}
          aria-label={color}
        />
        {isActive && (
          <span className='absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-prize' />
        )}
      </div>

      <div className='relative z-10 flex-1 min-w-0'>
        <div className={`flex items-center gap-1.5 ${side === 'right' ? 'justify-end' : ''}`}>
          <span className='truncate text-sm font-semibold text-strong' style={flair?.nameColor ? { color: flair.nameColor } : undefined}>
            <Username name={name} flair={flair} />
          </span>
          {botTier && <BotTierBadge tier={botTier} />}
          {eloRating != null && (
            <span
              className='arcade-num shrink-0 text-[11px] font-medium'
              style={{ color: eloTierColor ?? 'var(--text-info)' }}
            >
              {eloRating}
            </span>
          )}
          {isActive && (
            <span className='inline-flex shrink-0 items-center rounded-full border border-ink bg-prize px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-prize-on'>
              To move
            </span>
          )}
        </div>
        <div className={`mt-0.5 flex items-center gap-1.5 ${side === 'right' ? 'justify-end' : ''}`}>
          {eloTier && (
            <span
              className='text-[10px] font-medium opacity-70'
              style={{ color: eloTierColor ?? 'var(--text-info)' }}
            >
              {eloTier}
            </span>
          )}
          {pieceCount != null && (
            <span className='arcade-num rounded-full border border-ink bg-raised px-2 py-0.5 text-[10px] font-bold text-body'>
              {pieceCount} {pieceCount === 1 ? 'piece' : 'pieces'}
              {kingCount ? ` · ${kingCount}♔` : ''}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

const BOT_TIER_STYLE: Record<'easy' | 'medium' | 'hard', { label: string; classes: string }> = {
  easy:   { label: 'Easy',   classes: 'bg-prize text-prize-on' },
  medium: { label: 'Medium', classes: 'bg-tickets text-tickets-on' },
  hard:   { label: 'Hard',   classes: 'bg-danger text-danger-on' },
};

function BotTierBadge({ tier }: { tier: 'easy' | 'medium' | 'hard' }) {
  const style = BOT_TIER_STYLE[tier];
  return (
    <span className={`shrink-0 rounded-full border border-ink px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ${style.classes}`}>
      {style.label} bot
    </span>
  );
}

/** Count pieces + kings for a colour from a board string. */
export function countPiecesForColor(board: string, color: CheckersColor): { pieces: number; kings: number } {
  let pieces = 0, kings = 0;
  for (const ch of board) {
    if (color === 'red' && (ch === 'r' || ch === 'R')) { pieces++; if (ch === 'R') kings++; }
    if (color === 'white' && (ch === 'w' || ch === 'W')) { pieces++; if (ch === 'W') kings++; }
  }
  return { pieces, kings };
}
