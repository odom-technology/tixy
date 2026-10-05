'use client';

/* A profile prize on the player's own identity: the profile header (the
   namecard across the top, the framed avatar, the name, the title and the
   level) and a row as it shows in a leaderboard or a friends list.

   The equipped look is read from the counter's `equipped` list the way
   profile-flair.ts reads it on the server, then the prize is laid over it.
   Shared with nothing yet: the profile page draws its own header
   (player-profile.tsx), and this should follow it when that changes. */

import type { CSSProperties } from 'react';

import type { FrameId } from '@/features/brand/avatars/frames';
import { LevelBadge } from '@/features/brand/avatars/level-badge';
import type { NamecardId } from '@/features/brand/avatars/namecards';
import { Num } from '@/features/arcade/components/ui/num';
import { FramedAvatar } from '@/features/users/components/framed-avatar';

const FRAME_IDS = new Set<string>(['ticket', 'bulbs', 'brass']);
const NAMECARD_IDS = new Set<string>(['awning', 'lights', 'planks', 'bezel', 'rail']);

export type ProfileLook = {
  frame: FrameId | null;
  frameColor: string | null;
  namecard: NamecardId | null;
  background: string | null;
  title: string | null;
  nameColor: string | null;
  badge: string | null;
  badgeImage: string | null;
  avatarUrl: string | null;
};

export type ProfileItemLike = { name: string; slots: string[]; assetRef: Record<string, unknown> | null };

const imageOf = (ref: Record<string, unknown>) => {
  for (const key of ['imageUrl', 'image', 'src', 'url']) {
    const value = ref[key];
    if (typeof value === 'string' && (value.startsWith('/') || value.startsWith('https://'))) return value;
  }
  return null;
};

/** The parts of a look one profile item sets. Empty for anything else. */
export function profilePatch(item: ProfileItemLike): Partial<ProfileLook> {
  const ref = item.assetRef ?? {};
  const slot = item.slots[0];
  if (slot === 'frame') {
    if (typeof ref.frame === 'string' && FRAME_IDS.has(ref.frame)) return { frame: ref.frame as FrameId, frameColor: null };
    if (typeof ref.color === 'string') return { frame: null, frameColor: ref.color };
  }
  if (slot === 'background') {
    if (typeof ref.namecard === 'string' && NAMECARD_IDS.has(ref.namecard)) {
      return { namecard: ref.namecard as NamecardId, background: null };
    }
    const img = imageOf(ref);
    if (img) return { namecard: null, background: `center / cover no-repeat url('${img}')` };
    if (typeof ref.bgStart === 'string') {
      return { namecard: null, background: `linear-gradient(135deg, ${ref.bgStart}, ${typeof ref.bgEnd === 'string' ? ref.bgEnd : ref.bgStart})` };
    }
  }
  if (slot === 'title') return { title: typeof ref.text === 'string' ? ref.text : item.name };
  if (slot === 'nameColor' && typeof ref.color === 'string') return { nameColor: ref.color };
  if (slot === 'badge') return { badge: typeof ref.emoji === 'string' ? ref.emoji : null, badgeImage: imageOf(ref) };
  if (slot === 'avatar') {
    const img = imageOf(ref);
    if (img) return { avatarUrl: img };
  }
  return {};
}

/** Whether the counter can put this item on your identity. */
export const isIdentityItem = (item: ProfileItemLike) => Object.keys(profilePatch(item)).length > 0;

/** The look you have on now, from the counter's equipped list. */
export function profileLookFrom(
  equipped: ReadonlyArray<{ slot: string; item: ProfileItemLike & { gameType: string } }>,
  avatarUrl: string | null,
): ProfileLook {
  const look: ProfileLook = {
    frame: null,
    frameColor: null,
    namecard: null,
    background: null,
    title: null,
    nameColor: null,
    badge: null,
    badgeImage: null,
    avatarUrl,
  };
  for (const entry of equipped) {
    if (entry.item.gameType !== 'profile' || entry.item.slots[0] === 'avatar') continue;
    Object.assign(look, profilePatch({ ...entry.item, slots: [entry.slot] }));
  }
  return look;
}

export type Me = { name: string; avatarUrl: string | null; level: number | null };

function Name({ me, look }: { me: Me; look: ProfileLook }) {
  return (
    <span className='pp-id-name' style={look.nameColor ? ({ color: look.nameColor } as CSSProperties) : undefined}>
      {look.badgeImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={look.badgeImage} alt='' aria-hidden className='pp-id-badge' />
      ) : look.badge ? (
        <span aria-hidden>{look.badge}</span>
      ) : null}
      {me.name}
    </span>
  );
}

function Avatar({ me, look, size }: { me: Me; look: ProfileLook; size: 'lg' | 'xl' }) {
  return (
    <span className='pp-id-avatar' style={look.frameColor && !look.frame ? { boxShadow: `0 0 0 3px ${look.frameColor}` } : undefined}>
      <FramedAvatar name={me.name} imageUrl={look.avatarUrl} frame={look.frame} size={size} />
    </span>
  );
}

/** Your profile header and a list row, wearing `look`. `compact` draws the
 *  header only, for a card. */
export function IdentityPreview({ me, look, compact = false }: { me: Me; look: ProfileLook; compact?: boolean }) {
  return (
    <div className='pp-id' data-compact={compact || undefined}>
      <div className='pp-id-head' data-art={look.background ? true : undefined}>
        {look.namecard ? (
          <div className='pp-id-banner' aria-hidden>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/art/namecards/namecard-${look.namecard}.svg`} alt='' />
          </div>
        ) : look.background ? (
          <div className='pp-id-banner' aria-hidden>
            <span style={{ background: look.background }} />
          </div>
        ) : null}
        <div className='pp-id-who'>
          <Avatar me={me} look={look} size={compact && (look.namecard || look.background) ? 'lg' : 'xl'} />
          <span className='pp-id-text'>
            <Name me={me} look={look} />
            {look.title ? <span className='pp-id-title'>{look.title}</span> : null}
          </span>
          {me.level ? <LevelBadge level={me.level} size={compact ? 34 : 48} className='pp-id-level' title={`level ${me.level}`} /> : null}
        </div>
      </div>
      {compact ? null : (
        <div className='pp-id-row'>
          <span className='pp-id-rank'>
            <Num value={4} />
          </span>
          <Avatar me={me} look={look} size='lg' />
          <span className='pp-id-text'>
            <Name me={me} look={look} />
            {look.title ? <span className='pp-id-title'>{look.title}</span> : null}
          </span>
          <span className='pp-id-score'>
            <Num value={12480} />
          </span>
        </div>
      )}
    </div>
  );
}
