import type { ConnectFourChipShape } from './_connect-four-theme';

/* A skin set's chip (SKINS.md), drawn flat in a 100 box: the same disc the
   house chip fills, so the hole, the drop and the hit area don't change.

   Colour is never the only mark. `you` carries a round pip, or two holes on
   the button; `them` carries a diamond pip, or four holes. The two read apart
   in greyscale and for colour-blind players. The colours come from the CSS
   vars `--chip`, `--chip-ink` and `--chip-edge` that `_connect-four.css` sets
   from the skin on each chip's side. */

export type ChipSide = 'you' | 'them';

const body = { fill: 'var(--chip)', stroke: 'var(--chip-edge)', strokeWidth: 3 } as const;
const line = { fill: 'none', stroke: 'var(--chip-edge)', strokeWidth: 2.5 } as const;
const ink = { fill: 'var(--chip-ink)' } as const;

/* The pip in the middle: a circle for you, a diamond for them. */
function Pip({ side, size, fill }: { side: ChipSide; size: number; fill: string }) {
  return side === 'you' ? (
    <circle cx='50' cy='50' r={size} fill={fill} />
  ) : (
    <path d={`M50 ${50 - size * 1.3}L${50 + size * 1.3} 50L50 ${50 + size * 1.3}L${50 - size * 1.3} 50Z`} fill={fill} />
  );
}

export function ChipArt({ shape, side }: { shape: ConnectFourChipShape; side: ChipSide }) {
  let art: React.ReactNode;
  if (shape === 'coin') {
    // a milled edge, an inner ring and the pip stamped in the middle
    art = (
      <>
        <circle cx='50' cy='50' r='47' {...body} />
        <circle cx='50' cy='50' r='42' fill='none' stroke='var(--chip-edge)' strokeWidth='7' strokeDasharray='3.6 3.74' />
        <circle cx='50' cy='50' r='33' {...line} />
        <Pip side={side} size={11} fill='var(--chip-ink)' />
      </>
    );
  } else if (shape === 'button') {
    // a rim, and two holes for you or four for them
    const holes =
      side === 'you'
        ? [[39, 50], [61, 50]]
        : [[40, 40], [60, 40], [40, 60], [60, 60]];
    art = (
      <>
        <circle cx='50' cy='50' r='47' {...body} />
        <circle cx='50' cy='50' r='37' {...line} />
        {holes.map(([x, y]) => (
          <circle key={`${x}-${y}`} cx={x} cy={y} r={side === 'you' ? 7 : 5.5} {...ink} />
        ))}
      </>
    );
  } else if (shape === 'ring') {
    // a hollow ring: the hole shows through, the pip floats in the middle
    art = (
      <>
        <circle cx='50' cy='50' r='38' fill='none' stroke='var(--chip)' strokeWidth='16' />
        <circle cx='50' cy='50' r='46' fill='none' stroke='var(--chip-edge)' strokeWidth='2' />
        <circle cx='50' cy='50' r='30' fill='none' stroke='var(--chip-edge)' strokeWidth='2' />
        <Pip side={side} size={9} fill='var(--chip)' />
      </>
    );
  } else {
    // disc: a flat chip with the pip
    art = (
      <>
        <circle cx='50' cy='50' r='47' {...body} />
        <Pip side={side} size={12} fill='var(--chip-ink)' />
      </>
    );
  }
  return (
    <svg className='c4-chip-art' viewBox='0 0 100 100' aria-hidden='true' focusable='false'>
      {art}
    </svg>
  );
}
