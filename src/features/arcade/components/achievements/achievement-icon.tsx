'use client';

import Image from 'next/image';
import { useState } from 'react';

import { Badge, parseBadgeRef } from '@/features/brand/avatars/badges';
import { preferCosmeticsWebp } from '@/features/arcade/components/store-item-preview/helpers';

const FALLBACK = '/cosmetics/achievements/default.webp';
const FALLBACK_PNG = '/cosmetics/achievements/default.png';

/**
 * An achievement's badge. Every achievement's `icon` is a badge reference
 * ("badge:snake:3"), drawn here as SVG on the art kit's medal: the glyph, the
 * tier rim and the tier number. `grayscale` is the locked look (the same badge
 * at 40%). Anything else in `src` is an old image path, which still loads, with
 * the shared default if it is missing; no achievement uses one any more.
 */
export function AchievementIcon({
  src,
  alt,
  size = 64,
  className,
  grayscale = false,
}: {
  src: string;
  alt: string;
  size?: number;
  className?: string;
  grayscale?: boolean;
}) {
  const badge = parseBadgeRef(src);
  if (badge) {
    return (
      <Badge
        glyph={badge.glyph}
        tier={badge.tier}
        size={size}
        locked={grayscale}
        className={className}
        title={alt || undefined}
      />
    );
  }
  return <ImageIcon src={src} alt={alt} size={size} className={className} grayscale={grayscale} />;
}

function ImageIcon({
  src,
  alt,
  size,
  className,
  grayscale,
}: {
  src: string;
  alt: string;
  size: number;
  className?: string;
  grayscale: boolean;
}) {
  const [resolved, setResolved] = useState(() => preferCosmeticsWebp(src));
  return (
    <Image
      src={resolved}
      alt={alt}
      width={size}
      height={size}
      className={className}
      style={grayscale ? { opacity: 0.4 } : undefined}
      onError={() => {
        // WebP miss → original path → shared default webp → default png.
        if (resolved.endsWith('.webp') && src !== resolved) {
          setResolved(src);
          return;
        }
        if (resolved !== FALLBACK && resolved !== FALLBACK_PNG) {
          setResolved(FALLBACK);
          return;
        }
        if (resolved !== FALLBACK_PNG) setResolved(FALLBACK_PNG);
      }}
    />
  );
}
