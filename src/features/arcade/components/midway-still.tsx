'use client';

import Image from 'next/image';
import { useState, type CSSProperties, type ReactNode } from 'react';

import { GameStill } from '@/features/arcade/components/game-previews/game-still';
import { hasGameStill } from '@/features/arcade/components/game-previews/still-slugs';
import { cx } from '@/features/arcade/components/ui/arcade-ui';

export const MIDWAY_STILL_LINE =
  "This machine needs WebGL, which this browser can't run.";

/**
 * The still picture a 3D game shows when WebGL is missing or its context is
 * gone for good: the game's screen (its floor tile's SVG, resting frame) in the
 * ink cabinet, with one line underneath. It fills its parent, so put it where
 * the canvas was. `children` sit over the picture, for games that stay
 * playable without WebGL (lucky cage's chip board, prize claw's bed grid).
 */
export function MidwayStill({
  game,
  alt,
  line = MIDWAY_STILL_LINE,
  children,
  className,
  style,
}: {
  /** The registry slug, which is also the folder under public/games/. */
  game: string;
  /** What the picture shows, for screen readers. */
  alt: string;
  /** One sentence in the copy voice. Defaults to MIDWAY_STILL_LINE. */
  line?: string;
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  const [missing, setMissing] = useState(false);
  return (
    <figure
      className={cx(
        'm-0 flex h-full w-full flex-col overflow-hidden rounded-tixy-panel border-tixy-bezel border-tixy-ink bg-tixy-ink',
        className,
      )}
      style={style}
      data-midway-still={game}
    >
      <div className='relative min-h-0 flex-1'>
        {hasGameStill(game) ? (
          <div role='img' aria-label={alt} className='absolute inset-0'>
            <GameStill slug={game} />
          </div>
        ) : missing ? null : (
          <Image
            src={`/games/${game}/poster.webp`}
            alt={alt}
            fill
            sizes='(max-width: 640px) 100vw, 640px'
            quality={72}
            className='object-cover'
            onError={() => setMissing(true)}
          />
        )}
        {children ? (
          <div className='absolute inset-0 flex items-center justify-center bg-tixy-ink/70 p-3'>
            {children}
          </div>
        ) : null}
      </div>
      <figcaption className='bg-tixy-ink px-4 py-3 text-center font-tixy text-base text-tixy-paper'>
        {line}
      </figcaption>
    </figure>
  );
}
