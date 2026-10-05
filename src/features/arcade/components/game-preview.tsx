'use client';

import Image from 'next/image';
import { useEffect, useState, type ComponentType } from 'react';

import { cx, type ArcadeEnamel } from '@/features/arcade/components/ui/arcade-ui';
import { prefersReducedMotion } from '@/features/arcade/components/ui/arcade-interactive';
import { GameStill } from '@/features/arcade/components/game-previews/game-still';
import { hasGameStill } from '@/features/arcade/components/game-previews/still-slugs';
import {
  hasGamePreviewAnim,
  loadGamePreviewAnim,
} from '@/features/arcade/components/game-previews';

/* CoolMathGames-style cabinet thumbnail: a poster (or, for the floor games, the
   game's SVG screen) sits in the recessed card "screen"; on hover/focus a lightweight CSS/Tailwind animation
   of the actual game plays over it (loaded + mounted only while hovering, so
   a grid of these never pulls ~60 preview modules on first paint). Reduced-
   motion users keep the still poster. Per-game animations live in
   ./game-previews/<slug>.tsx. */

export function GamePreview({
  slug,
  title,
  tone,
  sizes = '(max-width: 640px) 90vw, 22rem',
  className,
}: {
  slug: string;
  title: string;
  /** Enamel paint for the placeholder well shown until the poster loads. */
  tone?: ArcadeEnamel;
  sizes?: string;
  className?: string;
}) {
  const canAnimate = hasGamePreviewAnim(slug);
  const [hover, setHover] = useState(false);
  const [Anim, setAnim] = useState<ComponentType | null>(null);
  // A cabinet can reach the floor before its generated poster does. Dropping
  // the broken <img> leaves the painted enamel well behind it, which reads as
  // intentional art rather than a torn thumbnail.
  const [posterMissing, setPosterMissing] = useState(false);
  const playing = hover && Boolean(Anim) && !prefersReducedMotion();

  useEffect(() => {
    if (!hover || !canAnimate || prefersReducedMotion()) return;
    let cancelled = false;
    void loadGamePreviewAnim(slug).then((Comp) => {
      if (!cancelled && Comp) setAnim(() => Comp);
    });
    return () => {
      cancelled = true;
    };
  }, [hover, canAnimate, slug]);

  return (
    <div
      className={cx('arc-gamecard-art', className)}
      data-playing={playing || undefined}
      data-tone={tone}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setHover(true)}
      onBlur={() => setHover(false)}
    >
      {hasGameStill(slug) ? (
        <GameStill slug={slug} />
      ) : posterMissing ? null : (
        <Image
          src={`/games/${slug}/poster.webp`}
          alt={`${title} preview`}
          width={960}
          height={640}
          loading='lazy'
          fetchPriority='low'
          quality={72}
          sizes={sizes}
          className='arc-preview-poster'
          onError={() => setPosterMissing(true)}
        />
      )}
      {playing && Anim ? (
        <div className='arc-preview-anim' aria-hidden>
          <Anim />
        </div>
      ) : null}
    </div>
  );
}
