'use client';

/* The row under the strip: the day and its difficulty, then the try in
   hand, the day's best and the streak, on the left; the balls still to pot
   on the right. A potted ball drops out of the row, as in 8-ball's. */

import { useEffect, useRef, useState } from 'react';

import { Num } from '@/features/arcade/components/ui/num';
import { BALL_COLORS } from '@/features/arcade/lib/pool-physics';
import { useFeelReducedMotion } from '@/features/arcade/lib/use-game-feedback';

const DROP_MS = 420;

export function TrickShotHud({
  weekday,
  difficulty,
  remaining,
  tryNumber,
  best,
  streak,
}: {
  weekday: string | null;
  difficulty: string | null;
  remaining: number[];
  /** The try in hand, or the one just taken. Null before the table loads. */
  tryNumber: number | null;
  /** The day's best try so far. */
  best: { pots: number; ballCount: number; clear: boolean } | null;
  /** Days in a row cleared; hidden at 0. */
  streak: number;
}) {
  return (
    <div className='trick-hud' data-surface='ink'>
      <div className='trick-day'>
        <span className='trick-day-name'>
          {weekday ? (difficulty ? `${weekday}, ${difficulty}` : weekday) : ''}
        </span>
        {tryNumber !== null ? (
          <span className='trick-day-note'>
            <span className='trick-day-fact'>
              try <Num value={tryNumber} />
            </span>
            {best ? (
              <span className='trick-day-fact' data-clear={best.clear || undefined}>
                best{' '}
                <Num
                  value={`${best.pots}/${best.ballCount}`}
                  label={`${best.pots} of ${best.ballCount}${best.clear ? ', cleared' : ''}`}
                />
              </span>
            ) : null}
            {streak > 0 ? (
              <span className='trick-day-fact'>
                streak <Num value={streak} />
              </span>
            ) : null}
          </span>
        ) : null}
      </div>
      <BallRow ids={remaining} />
    </div>
  );
}

function BallRow({ ids }: { ids: number[] }) {
  const reduced = useFeelReducedMotion();
  const key = ids.join(',');
  const [shown, setShown] = useState<Array<{ id: number; dropping: boolean }>>(() =>
    ids.map((id) => ({ id, dropping: false })),
  );
  const timers = useRef<number[]>([]);

  useEffect(() => {
    const next = new Set(ids);
    setShown((prev) => {
      const kept = prev.map((entry) => (next.has(entry.id) ? entry : { ...entry, dropping: true }));
      for (const id of ids) {
        if (!kept.some((entry) => entry.id === id)) kept.push({ id, dropping: false });
      }
      return kept;
    });
    const timer = window.setTimeout(
      () => setShown((prev) => prev.filter((entry) => next.has(entry.id))),
      reduced ? 0 : DROP_MS,
    );
    timers.current.push(timer);
    // A newer list supersedes this one's cleanup: a stale timer would
    // clear the balls the newer list just added.
    return () => window.clearTimeout(timer);
    // `key` stands for `ids`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, reduced]);

  useEffect(
    () => () => {
      for (const timer of timers.current) window.clearTimeout(timer);
    },
    [],
  );

  return (
    <span className='pool-row trick-balls' role='img' aria-label={`${ids.length} to pot`}>
      {shown.map(({ id, dropping }) => {
        const info = BALL_COLORS[id] ?? { fill: '#888', stripe: false };
        return (
          <span
            key={id}
            className='pool-ball'
            data-dropping={dropping || undefined}
            style={{
              background: info.stripe
                ? `linear-gradient(180deg, #fff 22%, ${info.fill} 22%, ${info.fill} 78%, #fff 78%)`
                : info.fill,
            }}
          >
            <span>{id}</span>
          </span>
        );
      })}
    </span>
  );
}
