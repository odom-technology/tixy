'use client';

import { Bot } from 'lucide-react';
import { FramedAvatar } from '@/features/users/components/framed-avatar';
import { Username } from '@/features/users/components/username';
import { namecardBackground } from '@/features/users/components/namecard';
import type { ProfileFlair } from '@/server/arcade/rewards/profile-flair';
import type { Color } from '@/features/arcade/lib/reversi/types';
import './_reversi.css';

type Props = {
  name: string;
  avatarUrl?: string | null;
  color: Color;
  /** True when it's this player's turn (live game). */
  isActive: boolean;
  /** Live disc count for this player's color. */
  discCount?: number;
  eloRating?: number;
  eloTier?: string;
  eloTierColor?: string;
  /** Equipped profile cosmetics (background/frame/badge/name color/title). */
  flair?: ProfileFlair | null;
  /** Bot difficulty if this seat is a bot, else null. */
  botTier?: 'easy' | 'medium' | 'hard' | null;
};

const DISC_LABEL: Record<Color, string> = { black: 'Black', white: 'White' };

/**
 * Reversi player card: the player's profile namecard (avatar, equipped
 * background, frame, badge, name color, title) plus the seat's enamel disc
 * swatch, optional disc count + Elo + tier, and a bot badge. Active-turn state
 * is a hard amber ring (no glow), matching the Midway look.
 */
export function ReversiPlayerCard({
  name,
  avatarUrl,
  color,
  isActive,
  discCount,
  eloRating,
  eloTier,
  eloTierColor,
  flair,
  botTier,
}: Props) {
  const flairBg = namecardBackground(flair);
  const frameColor = flair?.frameColor ?? null;

  return (
    <div
      className="reversi-arcade arcade-card-inset relative flex items-center gap-3 overflow-hidden px-3 py-2.5"
      style={{
        ...(flairBg ? { background: flairBg } : {}),
        ...(isActive
          ? { boxShadow: 'inset 0 0 0 2px rgba(242,193,78,0.9)' }
          : frameColor
            ? { boxShadow: `inset 0 0 0 2px ${frameColor}` }
            : {}),
      }}
    >
      {/* Dark scrim over the equipped background for legibility. */}
      {flairBg && (
        <div
          aria-hidden
          className="absolute inset-0 z-0"
          style={{
            background:
              'linear-gradient(90deg, rgba(8,12,20,0.82) 0%, rgba(8,12,20,0.55) 55%, rgba(8,12,20,0.4) 100%)',
          }}
        />
      )}

      {/* Avatar with frame ring + seat-color disc badge. */}
      <div className="relative z-10 shrink-0">
        <span
          className="block rounded-full"
          style={frameColor ? { boxShadow: `0 0 0 2px ${frameColor}` } : undefined}
        >
          <FramedAvatar name={name} imageUrl={avatarUrl} frame={flair?.frameArt ?? null} size="md" />
        </span>
        <span
          className={[
            'rv-disc-chip absolute -bottom-1 -right-1 inline-block h-4 w-4 rounded-full border border-ink',
            color === 'black' ? 'rv-disc-black' : 'rv-disc-white',
          ].join(' ')}
          style={{
            boxShadow:
              'inset 0 1px 0 rgba(255,255,255,0.32), inset 0 -2px 3px rgba(0,0,0,0.42), 0 1px 2px rgba(0,0,0,0.45)',
          }}
          aria-hidden
        />
      </div>

      <div className="relative z-10 min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span
            className="truncate text-sm font-semibold text-strong"
            style={flair?.nameColor ? { color: flair.nameColor } : undefined}
          >
            <Username name={name} flair={flair} />
          </span>
          {botTier && (
            <span className="inline-flex items-center gap-1 rounded-full border border-soft bg-raised px-1.5 py-0.5 text-[10px] text-faint">
              <Bot size={10} /> {botTier}
            </span>
          )}
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-[11px] text-faint">
          <span>{DISC_LABEL[color]}</span>
          {typeof discCount === 'number' && (
            <>
              <span aria-hidden>•</span>
              <span className="arcade-num font-semibold text-body">{discCount}</span>
            </>
          )}
          {typeof eloRating === 'number' && (
            <>
              <span aria-hidden>•</span>
              <span className="arcade-num" style={eloTierColor ? { color: eloTierColor } : undefined}>
                {eloRating}
              </span>
              {eloTier && <span>{eloTier}</span>}
            </>
          )}
          {isActive && (
            <span className="ml-auto inline-flex items-center gap-1 text-tickets-text">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-tickets" />
              To move
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
