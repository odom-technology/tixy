import type { ReactNode } from 'react';

import { ART } from '@/features/brand/avatars/palette';
import { namecardText } from '@/features/brand/avatars/namecards';
import { FramedAvatar } from '@/features/users/components/framed-avatar';
import { Username } from '@/features/users/components/username';
import type { ProfileFlair } from '@/server/arcade/rewards/profile-flair';

// Everything needed to render a player's cosmetic identity. Matches the
// PlayerCard view-model from @/server/arcade/player-cards (kept as a local
// type so this stays a pure presentational component usable client-side).
export type NamecardCosmetics = {
  name: string;
  avatarUrl?: string | null;
  flair?: ProfileFlair | null;
};

type NamecardSize = 'sm' | 'md' | 'lg';

// Namecard sizes map to a LARGER avatar bucket than their own token so the
// avatar reads clearly on every surface: sm rows (leaderboards, match invites)
// get a 44px avatar, md rows (players directory) 48px, and lg headers
// (profile + /u identity panels) a prominent 96px.
const AVATAR_SIZE: Record<NamecardSize, 'sm' | 'md' | 'lg' | 'xl'> = {
  sm: 'md',
  md: 'lg',
  lg: 'xl',
};

const PAD: Record<NamecardSize, string> = {
  sm: 'px-3 py-2 gap-2.5',
  md: 'px-4 py-3 gap-3',
  lg: 'px-5 py-4 gap-4',
};

const NAME_SIZE: Record<NamecardSize, string> = {
  sm: 'text-sm',
  md: 'text-base',
  lg: 'text-lg',
};

/**
 * The equipped profile background as a CSS background value (image cover or
 * gradient). flair.background is already a ready-to-use value from
 * profile-flair.ts (e.g. `center / cover no-repeat url('…')`).
 */
export function namecardBackground(flair?: ProfileFlair | null): string | undefined {
  return flair?.background ?? undefined;
}

/**
 * A player's full cosmetic namecard: equipped background spanning the card, a
 * frame ring on the avatar, and the name rendered with badge + name color +
 * title. Used on profiles, leaderboard rows, and match player bars so every
 * equipped cosmetic is visible everywhere (encourages collecting them).
 *
 * - `trailing` renders on the right (rank/score/elo).
 * - `meta` renders under the name (status, record, etc.).
 * - `rank` shows a rank index on the left (leaderboard rows).
 */
export function Namecard({
  cosmetics,
  size = 'md',
  href,
  trailing,
  meta,
  rank,
  highlighted = false,
  flush = false,
  className = '',
  avatarRingColor,
}: {
  cosmetics: NamecardCosmetics;
  size?: NamecardSize;
  href?: string;
  trailing?: ReactNode;
  meta?: ReactNode;
  rank?: number;
  highlighted?: boolean;
  /** Full-bleed: no rounding/outer border, for embedding as a card header. */
  flush?: boolean;
  className?: string;
  /** Fallback avatar ring color when no frame cosmetic is equipped (e.g. a
   *  per-user accent in the player directory so plain initials cards differ). */
  avatarRingColor?: string;
}) {
  const flair = cosmetics.flair ?? null;
  /* An art kit namecard is drawn at 4:1 and keeps its pattern in the top
     44%, so the avatar and name sit in the band below it. It only appears in
     the large header, as a card inside the strip. */
  const art = size === 'lg' ? (flair?.namecardArt ?? null) : null;
  const bg = art || flair?.namecardArt ? undefined : namecardBackground(flair);
  const frameArt = flair?.frameArt ?? null;
  const frameColor = frameArt ? null : (flair?.frameColor ?? null);
  const avatarRing = frameArt ? 'transparent' : (frameColor ?? avatarRingColor ?? 'rgba(255,255,255,0.25)');
  const artText = art ? (namecardText(art) === 'paper' ? ART.paper : ART.ink) : null;

  const shape = flush
    ? 'border-0'
    : `rounded-xl border ${highlighted ? 'border-primary' : 'border-soft'}`;

  const card = (
    <div
      className={
        art
          ? 'relative isolate flex h-32 w-full max-w-lg items-end gap-3 overflow-hidden rounded-xl px-5 pb-3 pt-14'
          : `relative isolate flex items-center overflow-hidden ${shape} ${PAD[size]} ${className}`
      }
      style={
        art
          ? { color: artText ?? undefined }
          : frameColor && !flush
            ? { boxShadow: `inset 0 0 0 1.5px ${frameColor}` }
            : undefined
      }
    >
      {art ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/art/namecards/namecard-${art}.svg`}
          alt=''
          aria-hidden
          className='pointer-events-none absolute inset-0 -z-10 h-full w-full object-cover object-left'
        />
      ) : null}
      {/* Equipped background, spanning the whole card, behind a scrim so any
          name/score stays legible over busy art. */}
      {bg ? (
        <>
          <div aria-hidden className='absolute inset-0 -z-10' style={{ background: bg }} />
          <div
            aria-hidden
            className='absolute inset-0 -z-10'
            style={{
              background:
                'linear-gradient(90deg, rgba(8,12,20,0.82) 0%, rgba(8,12,20,0.55) 55%, rgba(8,12,20,0.35) 100%)',
            }}
          />
        </>
      ) : art ? null : (
        <div aria-hidden className='absolute inset-0 -z-10 bg-raised' />
      )}

      {typeof rank === 'number' ? (
        <span
          className={`mr-1 w-7 shrink-0 text-center text-sm font-black tabular-nums ${
            bg ? 'text-white/90' : 'text-faint'
          }`}
        >
          {rank}
        </span>
      ) : null}

      {/* Avatar with frame ring (frame color or a subtle default). inline-flex
          (not a bare inline span) so the wrapper hugs the square avatar exactly
          — otherwise the inline baseline gap makes the ring render as an oval. */}
      <span
        className='inline-flex shrink-0 rounded-full leading-none'
        style={{ boxShadow: `0 0 0 2px ${avatarRing}` }}
      >
        <FramedAvatar
          name={cosmetics.name}
          imageUrl={cosmetics.avatarUrl ?? null}
          frame={frameArt}
          size={art ? 'lg' : AVATAR_SIZE[size]}
          href={href}
        />
      </span>

      <div className='min-w-0 flex-1'>
        <div className={`flex flex-wrap items-center gap-x-2 font-semibold ${NAME_SIZE[size]} ${bg ? 'text-white' : art ? '' : 'text-strong'}`}>
          <Username name={cosmetics.name} flair={flair} />
        </div>
        {meta ? <div className={`mt-0.5 text-xs ${bg ? 'text-white/75' : art ? '' : 'text-faint'}`}>{meta}</div> : null}
      </div>

      {trailing ? <div className='ml-2 shrink-0 text-right'>{trailing}</div> : null}
    </div>
  );

  if (!art) return card;
  return (
    <div className={`bg-raised p-4 ${flush ? '' : 'rounded-xl border border-soft'} ${className}`}>
      {card}
    </div>
  );
}
