'use client';

import { Bot, Anchor, Crosshair } from 'lucide-react';
import { FramedAvatar } from '@/features/users/components/framed-avatar';
import { Username } from '@/features/users/components/username';
import { namecardBackground } from '@/features/users/components/namecard';
import type { ProfileFlair } from '@/server/arcade/rewards/profile-flair';
import './_battleship.css';

type Props = {
  name: string;
  avatarUrl?: string | null;
  /** True when it's this player's turn (live battle). */
  isActive: boolean;
  /** Seat label shown under the name. */
  sideLabel: string;
  /** Ship cells still afloat (own fleet), if known. */
  fleetRemaining?: number;
  /** Shot accuracy 0-100, if known. */
  accuracy?: number;
  eloRating?: number;
  eloTier?: string;
  eloTierColor?: string;
  flair?: ProfileFlair | null;
  botTier?: 'easy' | 'medium' | 'hard' | null;
  /** Ready badge during the placement phase. */
  ready?: boolean;
  placementPhase?: boolean;
};

/**
 * Battleship player card: profile namecard (avatar, equipped background/frame/
 * badge/name color/title) plus the seat's fleet-remaining + accuracy + Elo and
 * a bot badge. Active-turn state is a hard amber ring (no glow), Midway look.
 */
export function BattleshipPlayerCard({
  name,
  avatarUrl,
  isActive,
  sideLabel,
  fleetRemaining,
  accuracy,
  eloRating,
  eloTier,
  eloTierColor,
  flair,
  botTier,
  ready,
  placementPhase,
}: Props) {
  const flairBg = namecardBackground(flair);
  const frameColor = flair?.frameColor ?? null;

  return (
    <div
      className="battleship-arcade arcade-card-inset relative flex items-center gap-3 overflow-hidden px-3 py-2.5"
      style={{
        ...(flairBg ? { background: flairBg } : {}),
        ...(isActive
          ? { boxShadow: 'inset 0 0 0 2px rgba(242,193,78,0.9)' }
          : frameColor
            ? { boxShadow: `inset 0 0 0 2px ${frameColor}` }
            : {}),
      }}
    >
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

      <div className="relative z-10 shrink-0">
        <span
          className="block rounded-full"
          style={frameColor ? { boxShadow: `0 0 0 2px ${frameColor}` } : undefined}
        >
          <FramedAvatar name={name} imageUrl={avatarUrl} frame={flair?.frameArt ?? null} size="md" />
        </span>
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
          <span>{sideLabel}</span>
          {typeof fleetRemaining === 'number' && (
            <>
              <span aria-hidden>•</span>
              <span className="inline-flex items-center gap-1 text-body">
                <Anchor size={10} />
                <span className="arcade-num font-semibold">{fleetRemaining}</span>
              </span>
            </>
          )}
          {typeof accuracy === 'number' && (
            <>
              <span aria-hidden>•</span>
              <span className="inline-flex items-center gap-1">
                <Crosshair size={10} />
                <span className="arcade-num">{accuracy}%</span>
              </span>
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
          {placementPhase && (
            <span className={`ml-auto inline-flex items-center gap-1 ${ready ? 'text-tickets-text' : 'text-faint'}`}>
              <span className={`inline-block h-1.5 w-1.5 rounded-full ${ready ? 'bg-tickets' : 'bg-soft'}`} />
              {ready ? 'Ready' : 'Placing…'}
            </span>
          )}
          {!placementPhase && isActive && (
            <span className="ml-auto inline-flex items-center gap-1 text-tickets-text">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-tickets" />
              To fire
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
