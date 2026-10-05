'use client';

import { ArrowRight, CalendarDays, Trophy } from 'lucide-react';
import { useEffect, useState } from 'react';

import {
  ArcadeChip,
  ArcadeLinkButton,
  ArcadeMarquee,
  ArcadePanel,
} from '@/features/arcade/components/ui/arcade-ui';
import type { ArcadeTourState } from '@/server/arcade/arcade-tour';

export function ArcadeTourSpotlight() {
  const [tour, setTour] = useState<ArcadeTourState | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/games/arcade-tour', { cache: 'no-store', signal: controller.signal })
      .then((response) => response.ok ? response.json() : null)
      .then((data) => setTour(data?.games ? data as ArcadeTourState : null))
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  if (!tour) return null;

  return (
    <ArcadePanel variant='cabinet' className='overflow-hidden p-0'>
      <ArcadeMarquee tone='tickets' trailing={<Trophy size={16} aria-hidden />}>
        This week’s tixy Tour
      </ArcadeMarquee>
      <div className='grid gap-4 p-4 sm:p-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center'>
        <div className='min-w-0'>
          <p className='arcade-display text-lg uppercase text-strong'>Three cabinets. One standing.</p>
          <p className='mt-1 text-sm text-faint'>
            Play {tour.games.map((game) => game.title).join(', ')}. Your rank in each game becomes tour points.
          </p>
          <div className='mt-3 flex flex-wrap gap-2'>
            {tour.games.map((game) => <ArcadeChip key={game.slug}>{game.title}</ArcadeChip>)}
            <ArcadeChip tone='info'><CalendarDays size={12} aria-hidden /> Resets Monday</ArcadeChip>
            {tour.viewer ? <ArcadeChip tone='prize'>You’re #{tour.viewer.rank}</ArcadeChip> : null}
          </div>
        </div>
        <ArcadeLinkButton href='/tour' tone='tickets' size='md'>
          Enter the tour <ArrowRight size={15} aria-hidden />
        </ArcadeLinkButton>
      </div>
    </ArcadePanel>
  );
}
