'use client';

import { FramedAvatar } from '@/features/users/components/framed-avatar';
import { Username } from '@/features/users/components/username';
import { namecardBackground } from '@/features/users/components/namecard';
import type { ProfileFlair } from '@/server/arcade/rewards/profile-flair';
import type { Color } from '@/features/arcade/lib/connect-four/types';
import { ChipArt, type ChipSide } from './_chip-art';
import type { ConnectFourSkin } from './_connect-four-theme';
import './_connect-four.css';

type Props = {
  name: string;
  avatarUrl?: string | null;
  color: Color;
  /** True when it's this player's turn (live game). */
  isActive: boolean;
  /** Whether this row is the viewer's own seat. */
  isMe?: boolean;
  eloRating?: number;
  eloTier?: string;
  /** Equipped profile cosmetics (background/frame/badge/name color/title). */
  flair?: ProfileFlair | null;
  /** Bot difficulty if this seat is a bot, else null. */
  botTier?: 'easy' | 'medium' | 'hard' | null;
  /** Games this player has won in the current best-of-three, if one is on. */
  seriesWins?: number | null;
  /** An equipped skin set: the seat's chip is drawn in it, so the card
   *  matches the rack. */
  skin?: ConnectFourSkin | null;
  /** Whether this seat is the viewer's chip (`you`) or the other's. */
  chipSide?: ChipSide;
};

/**
 * Connect Four player row: avatar with the seat's chip, name and rating, and
 * a turn dot. Plain on the ink screen; an equipped profile background still
 * paints behind it. Your turn is a red dot, the other seat's a quiet paper
 * one. The series score, when a best of three is on, sits at the end.
 */
export function ConnectFourPlayerCard({
  name,
  avatarUrl,
  color,
  isActive,
  isMe = false,
  eloRating,
  eloTier,
  flair,
  botTier,
  seriesWins = null,
  skin = null,
  chipSide = 'you',
}: Props) {
  const flairBg = namecardBackground(flair);
  const frameColor = flair?.frameColor ?? null;

  return (
    <div
      className='connect-four-arcade relative flex h-full min-w-0 items-center gap-2.5 overflow-hidden rounded-panel px-2 py-1.5'
      data-active={isActive || undefined}
      style={{
        ...(flairBg ? { background: flairBg } : {}),
        ...(frameColor ? { boxShadow: `inset 0 0 0 2px ${frameColor}` } : {}),
      }}
    >
      {/* Dark scrim over the equipped background for legibility. */}
      {flairBg && (
        <div
          aria-hidden
          className='absolute inset-0 z-0'
          style={{
            background:
              'linear-gradient(90deg, rgba(31,26,22,0.82) 0%, rgba(31,26,22,0.55) 55%, rgba(31,26,22,0.4) 100%)',
          }}
        />
      )}

      {/* Avatar with frame ring + the seat's chip. */}
      <div className='relative z-[1] shrink-0'>
        <span
          className='block rounded-full'
          style={frameColor ? { boxShadow: `0 0 0 2px ${frameColor}` } : undefined}
        >
          <FramedAvatar name={name} imageUrl={avatarUrl} frame={flair?.frameArt ?? null} size='md' />
        </span>
        {skin ? (
          <span
            className='c4-disc-chip absolute -bottom-1 -right-1 inline-block h-4 w-4 rounded-full bg-[#1f1a16]'
            style={
              {
                boxShadow: '0 0 0 1.5px #f4ebdc',
                '--chip': skin[chipSide].fill,
                '--chip-ink': skin[chipSide].ink,
                '--chip-edge': skin[chipSide].edge,
              } as React.CSSProperties
            }
            role='img'
            aria-label={`${color} chips`}
          >
            <ChipArt shape={skin.shape} side={chipSide} />
          </span>
        ) : (
        <span
          className={[
            'c4-disc-chip absolute -bottom-1 -right-1 inline-block h-4 w-4 rounded-full',
            color === 'red' ? 'c4-disc-red' : 'c4-disc-yellow',
          ].join(' ')}
          style={{
            boxShadow:
              '0 0 0 1.5px #f4ebdc, inset 0 -2px 3px rgba(0,0,0,0.3)',
          }}
          role='img'
          aria-label={`${color} chips`}
        />

        )}      </div>

      <div className='relative z-[1] min-w-0 flex-1'>
        <div className='flex items-center gap-1.5'>
          {isActive && (
            <span
              role='img'
              aria-label={isMe ? 'your turn' : 'their turn'}
              className='h-2.5 w-2.5 shrink-0 rounded-full'
              style={{ background: isMe ? 'var(--tixy-on-ink-red, #dd9484)' : 'var(--tixy-on-ink-2, #c9c1b4)' }}
            />
          )}
          <span
            className='truncate text-sm font-bold'
            style={{ color: flair?.nameColor ?? 'var(--tixy-paper, #f4ebdc)' }}
          >
            <Username name={name} flair={flair} />
          </span>
          {botTier && (
            <span className='shrink-0 text-[0.9375rem] text-[var(--tixy-on-ink-2,#c9c1b4)]'>
              {botTier} bot
            </span>
          )}
          {typeof eloRating === 'number' && (
            <span
              className='arcade-num shrink-0 text-base font-bold leading-none text-[var(--tixy-on-ink-2,#c9c1b4)]'
              title={eloTier}
            >
              {eloRating}
            </span>
          )}
        </div>
      </div>

      {seriesWins != null && (
        <span
          className='arcade-num relative z-[1] shrink-0 pr-1 text-2xl font-extrabold leading-none text-[var(--tixy-paper,#f4ebdc)]'
          aria-label={`${seriesWins} ${seriesWins === 1 ? 'win' : 'wins'} in the series`}
        >
          {seriesWins}
        </span>
      )}
    </div>
  );
}
