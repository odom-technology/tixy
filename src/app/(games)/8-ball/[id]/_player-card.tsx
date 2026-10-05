'use client';

import { FramedAvatar } from '@/features/users/components/framed-avatar';
import { Username } from '@/features/users/components/username';
import { namecardBackground } from '@/features/users/components/namecard';
import type { ProfileFlair } from '@/server/arcade/rewards/profile-flair';
import {
  BALL_COLORS,
  isSolid,
  isStripe,
  type Ball,
  type BallGroup,
} from '@/features/arcade/lib/pool-physics';
import { TURN_INDICATOR_TRANSITION_MS } from './_pool-ui-constants';
import {
  DEFAULT_PLAYERCARD_THEME,
  getPlayercardAnimationStyle,
  getPlayercardAnimationStylesheet,
  type PlayercardTheme,
} from '@/features/arcade/lib/pool-playercard-theme';

export type { PlayercardTheme } from '@/features/arcade/lib/pool-playercard-theme';
export { BOT_PLAYERCARD_THEMES } from '@/features/arcade/lib/pool-playercard-theme';

// ── Mini pocketed ball ──────────────────────────────────────────
function MiniPocketedBall({ id }: { id: number }) {
  const info = BALL_COLORS[id] ?? { fill: '#888', stripe: false };
  return (
    <div
      className='shrink-0 rounded-full'
      style={{
        width: 16,
        height: 16,
        background: info.stripe
          ? `linear-gradient(180deg, #f0f0f0 30%, ${info.fill} 30%, ${info.fill} 70%, #f0f0f0 70%)`
          : info.fill,
        border: '1px solid rgba(255,255,255,0.15)',
      }}
    />
  );
}

type PlayerCardProps = {
  name: string;
  avatarUrl?: string | null;
  eloRating?: number | null;
  eloRank?: number | null;
  eloTier?: string | null;
  eloTierColor?: string | null;
  group: BallGroup | null;
  isCurrentTurn: boolean;
  balls: Ball[];
  theme?: PlayercardTheme;
  /** Equipped profile cosmetics (background/frame/badge/name color/title). */
  flair?: ProfileFlair | null;
  side: 'left' | 'right';
};

export function PlayerCard({
  name,
  avatarUrl,
  eloRating,
  eloRank,
  eloTier,
  eloTierColor,
  group,
  isCurrentTurn,
  balls,
  theme: themeInput,
  flair,
  side,
}: PlayerCardProps) {
  const theme = themeInput ?? DEFAULT_PLAYERCARD_THEME;
  const animName = theme.cardAnimation !== 'none' ? theme.cardAnimation : null;
  const flairBg = namecardBackground(flair);
  const frameColor = flair?.frameColor ?? null;

  const pocketed = balls.filter(
    (b) =>
      b.pocketed &&
      b.id !== 0 &&
      b.id !== 8 &&
      group &&
      ((group === 'solids' && isSolid(b.id)) ||
        (group === 'stripes' && isStripe(b.id))),
  );
  const remaining = group
    ? balls.filter(
        (b) =>
          !b.pocketed &&
          ((group === 'solids' && isSolid(b.id)) ||
            (group === 'stripes' && isStripe(b.id))),
      ).length
    : 0;

  return (
    <>
      {animName && (
        <style
          dangerouslySetInnerHTML={{
            __html: getPlayercardAnimationStylesheet('pc'),
          }}
        />
      )}
      <div
        className={`relative flex items-center gap-2.5 rounded-panel px-3 py-2.5 overflow-hidden shadow-chip transition-colors ease-out ${
          side === 'right' ? 'flex-row-reverse text-right' : ''
        }`}
        style={{
          background: theme.cardBg,
          border: `2px solid ${isCurrentTurn ? 'var(--enamel-prize)' : (frameColor ?? 'var(--border-ink)')}`,
          transitionDuration: `${TURN_INDICATOR_TRANSITION_MS}ms`,
          ...getPlayercardAnimationStyle(theme, { prefix: 'pc' }),
        }}
      >
        {/* Equipped profile background spans the card, behind a dark scrim so
            the name/elo stay legible over busy art. Sits under the z-10
            content but over the card's theme background. */}
        {flairBg && (
          <>
            <div aria-hidden className='absolute inset-0 z-0' style={{ background: flairBg }} />
            <div
              aria-hidden
              className='absolute inset-0 z-0'
              style={{
                background:
                  'linear-gradient(90deg, rgba(8,12,20,0.82) 0%, rgba(8,12,20,0.55) 55%, rgba(8,12,20,0.4) 100%)',
              }}
            />
          </>
        )}

        {/* Avatar */}
        <div className='relative z-10 shrink-0'>
          <span
            className='block rounded-full'
            style={frameColor ? { boxShadow: `0 0 0 2px ${frameColor}` } : undefined}
          >
            <FramedAvatar name={name} imageUrl={avatarUrl} frame={flair?.frameArt ?? null} size='md' />
          </span>
          {isCurrentTurn && (
            <span className='absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border border-ink bg-prize' />
          )}
        </div>

        {/* Info */}
        <div className='relative z-10 flex-1 min-w-0'>
          <div
            className={`flex items-center gap-1.5 ${side === 'right' ? 'justify-end' : ''}`}
          >
            <span
              className='font-semibold text-sm truncate'
              style={{ color: flair?.nameColor ?? theme.nameColor }}
            >
              <Username name={name} flair={flair} />
            </span>
            {eloRating != null && (
              <span
                className='arcade-num text-[11px] font-medium shrink-0'
                style={{ color: eloTierColor ?? theme.eloColor }}
              >
                {eloRating}
              </span>
            )}
          </div>
          <div
            className={`flex items-center gap-1.5 mt-0.5 ${side === 'right' ? 'justify-end' : ''}`}
          >
            {eloRank != null && (
              <span
                className='arcade-num text-[10px] font-bold shrink-0'
                style={{ color: eloTierColor ?? theme.eloColor }}
              >
                #{eloRank}
              </span>
            )}
            {eloTier && (
              <span
                className='text-[10px] font-medium opacity-70'
                style={{ color: eloTierColor ?? theme.eloColor }}
              >
                {eloTier}
              </span>
            )}
            {group && (
              <span
                className='text-xs font-bold tracking-wide'
                style={{
                  color: '#ffffff',
                  textShadow:
                    '-1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000',
                }}
              >
                {group === 'solids' ? 'Solids' : 'Stripes'}
                {remaining === 0 ? ' · on 8' : ` · ${remaining} left`}
              </span>
            )}
          </div>

          {/* Pocketed balls */}
          {pocketed.length > 0 && (
            <div
              className={`flex gap-0.5 mt-1 ${side === 'right' ? 'justify-end' : ''}`}
            >
              {pocketed.map((b) => (
                <MiniPocketedBall key={b.id} id={b.id} />
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
