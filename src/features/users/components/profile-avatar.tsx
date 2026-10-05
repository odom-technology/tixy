'use client';

import Image from 'next/image';
import { useEffect, useState, type CSSProperties } from 'react';

import { preferCosmeticsWebp } from '@/features/arcade/components/store-item-preview/helpers';
import { displayAvatarUrl } from '@/features/users/avatars';

type AvatarSize = '2xs' | 'xs' | 'sm' | 'md' | 'lg' | 'xl';

type ProfileAvatarProps = {
  name?: string | null;
  imageUrl?: string | null;
  size?: AvatarSize;
  href?: string;
  /** A ring drawn on the circle itself, never on a wrapper: a ring on a
   *  wrapper that is not round draws a square around the avatar. */
  ring?: string;
  className?: string;
};

// Compressed cosmetics masters (≤512) + next/image sizing keep these sharp
// without shipping multi‑MB PNGs to every feed row.
const sizePx: Record<AvatarSize, number> = {
  '2xs': 20,
  xs: 28,
  sm: 36,
  md: 44,
  lg: 48,
  xl: 96,
};

const sizeClass: Record<AvatarSize, string> = {
  '2xs': 'h-5 w-5 text-[10px]',
  xs: 'h-7 w-7 text-xs',
  sm: 'h-9 w-9 text-sm',
  md: 'h-11 w-11 text-base',
  lg: 'h-12 w-12 text-lg',
  xl: 'h-24 w-24 text-4xl',
};

/* One letter, lowercase, like the mockup's avatars. */
function getInitial(name?: string | null) {
  const first = Array.from((name ?? '').trim())[0];
  return first ? first.toLowerCase() : 'p';
}

/** A player's avatar. Always a circle: the image is clipped to it, and the
 *  initial sits on paper 3 when there is no image. */
export function ProfileAvatar({ name, imageUrl, size = 'md', href, ring, className = '' }: ProfileAvatarProps) {
  const classes = `arc-avatar ${sizeClass[size]} shrink-0 overflow-hidden rounded-full bg-raised text-strong ${className}`;
  const style: CSSProperties | undefined = ring ? { boxShadow: `0 0 0 2px ${ring}` } : undefined;
  const px = sizePx[size];
  /* The old free defaults draw as their stub. The stored path doesn't change. */
  const shownUrl = displayAvatarUrl(imageUrl);
  const [src, setSrc] = useState<string | null>(
    shownUrl ? preferCosmeticsWebp(shownUrl) : null,
  );

  useEffect(() => {
    setSrc(shownUrl ? preferCosmeticsWebp(shownUrl) : null);
  }, [shownUrl]);

  const avatar =
    shownUrl && src && src.startsWith('/art/') ? (
      <span className={`${classes} relative inline-block`} style={style}>
        {/* The kit's SVGs are flat and under 2 KB: no resize pass needed. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          alt={name ? `${name} avatar` : 'Player avatar'}
          className='h-full w-full object-cover'
          src={src}
          width={px}
          height={px}
        />
      </span>
    ) : shownUrl && src ? (
      <span className={`${classes} relative inline-block`} style={style}>
        <Image
          alt={name ? `${name} avatar` : 'Player avatar'}
          className='h-full w-full object-cover'
          src={src}
          width={px}
          height={px}
          sizes={`${px}px`}
          onError={() => {
            // WebP miss → original path (still the compressed PNG master).
            if (src.endsWith('.webp') && shownUrl !== src) {
              setSrc(shownUrl);
            }
          }}
        />
      </span>
    ) : (
      <span
        className={`${classes} inline-flex items-center justify-center font-extrabold leading-none`}
        style={style}
        aria-hidden={name ? undefined : true}
      >
        {getInitial(name)}
      </span>
    );

  if (!href) return avatar;

  return (
    <a
      href={href}
      className='inline-flex shrink-0 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary'
    >
      {avatar}
    </a>
  );
}
