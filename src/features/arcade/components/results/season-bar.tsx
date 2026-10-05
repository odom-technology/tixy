'use client';

import { useEffect, useState } from 'react';

import { Num } from '@/features/arcade/components/ui/num';
import type { AccountXpReward } from '@/server/arcade/rewards/types';

/**
 * The season row under the level on a result: "Season tier 7", "420 of
 * 800", and a thin bar filling from where the run found it to where it left
 * it. A tier gained on this run fills from empty. Renders nothing when the
 * reward has no season (a guest, or an older route).
 *
 * `fill` false holds the bar where the run found it; turning it true fills
 * it (the CSS transition does the motion). `instant` shows the end at once.
 */
export function SeasonBar({
  season,
  xpGained = 0,
  fill = true,
  instant = false,
  className,
}: {
  season?: AccountXpReward['season'];
  /** The XP this run added, to know where the bar started. */
  xpGained?: number;
  fill?: boolean;
  instant?: boolean;
  className?: string;
}) {
  const need = Math.max(1, season?.need ?? 1);
  const up = season ? season.tier > season.tierBefore : false;
  const end = season ? (season.atMax ? 100 : (Math.min(need, season.into) / need) * 100) : 0;
  const start = !season || up || season.atMax ? 0 : (Math.max(0, season.into - xpGained) / need) * 100;
  const target = instant || fill ? end : start;
  // One frame at the start, so the fill transitions from it.
  const [pct, setPct] = useState(instant ? end : start);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setPct(target));
    return () => cancelAnimationFrame(frame);
  }, [target]);

  if (!season) return null;
  return (
    <div className={['arc-season', className].filter(Boolean).join(' ')} data-instant={instant || undefined}>
      <div className='arc-season-line'>
        <span>
          Season tier <Num value={season.tier} />
          {up ? (
            <>
              , up from <Num value={season.tierBefore} />
            </>
          ) : null}
        </span>
        {season.atMax ? null : (
          <span className='arc-season-count'>
            <Num value={season.into} /> of <Num value={season.need} />
          </span>
        )}
      </div>
      <div className='arc-season-bar' aria-hidden>
        <div style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
      </div>
    </div>
  );
}
