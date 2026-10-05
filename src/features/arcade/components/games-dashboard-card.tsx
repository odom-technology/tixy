'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Star, type LucideIcon } from 'lucide-react';
import { useCallback, useEffect, useRef } from 'react';

import { GamePreview } from '@/features/arcade/components/game-preview';
import {
  ArcadeMarquee,
  type ArcadeEnamel,
} from '@/features/arcade/components/ui/arcade-ui';

type GamesDashboardCardProps = {
  id: string;
  title: string;
  description: string;
  icon: LucideIcon;
  href: string;
  /** Enamel paint owned by the cabinet's floor section. */
  tone?: ArcadeEnamel;
  metaLabel?: string;
  /** Denser cards used by the homepage overview; category pages stay roomy. */
  compact?: boolean;
  canFavorite?: boolean;
  favorite?: boolean;
  favoriteBusy?: boolean;
  onToggleFavorite?: () => void;
  unavailable?: boolean;
  unavailableMessage?: string;
};

// A brief dwell avoids downloading a route when the pointer is only crossing a
// crowded aisle. Keyboard focus is unambiguous intent, so it prefetches at once.
const PREFETCH_DWELL_MS = 120;

/* A cabinet front: enamel marquee with the game name and icon, recessed art
   well, description, and one mono meta line. Hover lifts the cabinet 2px;
   press sinks it. (No dashed strip + foot pseudo-keycap stack — one meta line,
   per the home audit.) */
export function GamesDashboardCard({
  id,
  title,
  description,
  icon: Icon,
  href,
  tone = 'primary',
  metaLabel,
  compact = false,
  canFavorite = false,
  favorite = false,
  favoriteBusy = false,
  onToggleFavorite,
  unavailable = false,
  unavailableMessage,
}: GamesDashboardCardProps) {
  const router = useRouter();
  const prefetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const didPrefetch = useRef(false);

  const cancelPendingPrefetch = useCallback(() => {
    if (prefetchTimer.current === null) return;
    clearTimeout(prefetchTimer.current);
    prefetchTimer.current = null;
  }, []);

  const prefetch = useCallback(() => {
    cancelPendingPrefetch();
    if (didPrefetch.current) return;
    didPrefetch.current = true;
    router.prefetch(href);
  }, [cancelPendingPrefetch, href, router]);

  const schedulePrefetch = useCallback(() => {
    if (didPrefetch.current || prefetchTimer.current !== null) return;
    prefetchTimer.current = setTimeout(prefetch, PREFETCH_DWELL_MS);
  }, [prefetch]);

  useEffect(() => cancelPendingPrefetch, [cancelPendingPrefetch]);

  const cardContent = (
    <>
        <ArcadeMarquee
          tone={tone}
          size='sm'
          trailing={<Icon size={16} aria-hidden />}
        >
          {title}
        </ArcadeMarquee>
        <div className='p-2.5 pb-0'>
          {/* sizes mirrors the dashboard grid: 2-col below lg (~45vw per card),
              3–4 capped columns above (existing 22rem behavior). Without it
              phones fetched 90vw posters for 45vw slots. */}
          <GamePreview
            slug={id}
            title={title}
            tone={tone}
            sizes='(max-width: 359px) 88vw, (max-width: 1024px) 45vw, 22rem'
          />
        </div>
        <div className='arc-gamecard-body'>
          <p className='arc-gamecard-desc'>{description}</p>
          {metaLabel ? (
            <div className='arc-gamecard-stat mt-auto'>
              <span className='uppercase'>{metaLabel}</span>
              <b>{unavailable ? 'Unavailable' : 'Play'}</b>
            </div>
          ) : null}
          {unavailable && unavailableMessage ? (
            <p className='mt-2 text-xs text-faint'>{unavailableMessage}</p>
          ) : null}
        </div>
    </>
  );

  return (
    <div className='arc-gamecard-shell'>
      {unavailable ? (
        <div
          className='arc-gamecard group opacity-70'
          data-compact={compact || undefined}
          aria-label={`${title} unavailable`}
        >
          {cardContent}
        </div>
      ) : (
        <Link
          key={id}
          href={href}
          prefetch={false}
          className='arc-gamecard group'
          data-compact={compact || undefined}
          onPointerEnter={schedulePrefetch}
          onPointerLeave={cancelPendingPrefetch}
          onFocus={prefetch}
        >
          {cardContent}
        </Link>
      )}
      {canFavorite && onToggleFavorite ? (
        <button
          type='button'
          className='arc-gamecard-favorite'
          data-active={favorite || undefined}
          aria-label={`${favorite ? 'Remove' : 'Add'} ${title} ${favorite ? 'from' : 'to'} favorites`}
          aria-pressed={favorite}
          disabled={favoriteBusy}
          onClick={onToggleFavorite}
        >
          <Star aria-hidden size={16} fill={favorite ? 'currentColor' : 'none'} />
        </button>
      ) : null}
    </div>
  );
}
