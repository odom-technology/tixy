/* Slots: the machine's window (slots/_slots-client.tsx). Three paper reels
   of three rows in an ink window, a notch at each end of the middle row,
   the flat symbols: cherries, lemon, bar, bell, the red 7, the amber star.
   The move: the reels spin and stop left to right with a dip; the middle
   line pays, so it is drawn in red, its 7s pop and the rest dims. */
import { C, EASE, Num, Part, PreviewScreen, Word, move, type PreviewProps } from './kit';

type Kind = 'cherry' | 'lemon' | 'bar' | 'bell' | '7' | 'star';
const REEL_W = 33.4;
const reelX = (i: number) => 27 + i * (REEL_W + 3);
const TOP = 9;
const CELL = 27.3;
const rowY = (k: number) => TOP + CELL / 2 + k * CELL;
// Each reel's strip, top to bottom: the three rows it stops on, then the
// symbols that spin past before them.
const STRIPS: Kind[][] = [
  ['cherry', '7', 'lemon', 'bell', 'star', 'bar', 'cherry'],
  ['bell', '7', 'bar', 'lemon', 'cherry', '7', 'star', 'bell'],
  ['lemon', '7', 'cherry', 'bar', 'bell', 'lemon', 'star', 'cherry', 'bar'],
];
const STOP = [340, 500, 660];
const css = `@keyframes gp-slot-dip{0%{transform:none}40%{transform:translateY(2.4px)}100%{transform:none}}`;

function Glyph({ kind, cx, cy }: { kind: Kind; cx: number; cy: number }) {
  switch (kind) {
    case '7':
      return (
        <Num x={cx} y={cy + 9} size={26} fill={C.red}>
          7
        </Num>
      );
    case 'cherry':
      return (
        <>
          <path d={`M${cx - 3.6},${cy + 1} Q${cx - 1},${cy - 8} ${cx + 2.6},${cy - 9} M${cx + 4},${cy} Q${cx + 3.4},${cy - 6} ${cx + 2.6},${cy - 9}`} stroke={C.ink} strokeWidth='1' fill='none' />
          <ellipse cx={cx + 5} cy={cy - 9} rx='3' ry='1.4' fill='#54483D' transform={`rotate(-20 ${cx + 5} ${cy - 9})`} />
          <circle cx={cx - 3.6} cy={cy + 4} r='4.4' fill={C.red} />
          <circle cx={cx + 4} cy={cy + 3} r='4.4' fill={C.red} />
        </>
      );
    case 'lemon':
      return (
        <>
          <ellipse cx={cx} cy={cy} rx='8.4' ry='5.8' fill='#E6C44C' transform={`rotate(-14 ${cx} ${cy})`} />
          <circle cx={cx - 8} cy={cy + 2} r='1.4' fill='#E6C44C' />
          <circle cx={cx + 8} cy={cy - 2} r='1.4' fill='#E6C44C' />
        </>
      );
    case 'bar':
      return (
        <>
          <rect x={cx - 11} y={cy - 5} width='22' height='10' rx='2' fill={C.ink} />
          <Word x={cx} y={cy + 3} size={8} fill={C.paper} weight={900}>
            bar
          </Word>
        </>
      );
    case 'bell':
      return (
        <>
          <circle cx={cx} cy={cy - 9} r='1.6' fill='#B9832C' />
          <path d={`M${cx},${cy - 8} c6,0 7,6 7,10 l3,4 h-20 l3,-4 c0,-4 1,-10 7,-10z`} fill='#B9832C' />
          <circle cx={cx} cy={cy + 7.4} r='2' fill={C.ink} />
        </>
      );
    case 'star':
      return (
        <path
          d={Array.from({ length: 10 }, (_, i) => {
            const a = (i * Math.PI) / 5 - Math.PI / 2;
            const r = i % 2 ? 4 : 9.6;
            return `${i ? 'L' : 'M'}${(cx + Math.cos(a) * r).toFixed(1)},${(cy + 1 + Math.sin(a) * r).toFixed(1)}`;
          }).join('') + 'Z'}
          fill={C.amber}
        />
      );
  }
}

export default function SlotsPreview({ still }: PreviewProps) {
  return (
    <PreviewScreen css={css} still={still} rest={900}>
      {/* The ink window and the notches on the middle row. */}
      <rect x='22' y='4' width='116' height='92' rx='6' fill={C.ink} />
      {[0, 1, 2].map((i) => {
        const strip = STRIPS[i];
        const x = reelX(i);
        const spin = (strip.length - 3) * CELL;
        return (
          <g key={i} style={move('gp-slot-dip', 200, { delay: STOP[i], ease: EASE.out })}>
            <svg x={x} y={TOP} width={REEL_W} height={CELL * 3} viewBox={`${x} ${TOP} ${REEL_W} ${CELL * 3}`} overflow='hidden'>
              <rect x={x} y={TOP} width={REEL_W} height={CELL * 3} rx='3' fill={C.paper} />
              <rect x={x} y={TOP} width={REEL_W} height='4' fill='#EADFCB' />
              <rect x={x} y={TOP + CELL * 3 - 4} width={REEL_W} height='4' fill='#EADFCB' />
              <g style={move('from', STOP[i] - 40, { delay: 40, y: -spin, ease: EASE.out })}>
                {strip.map((kind, k) => (
                  <Glyph key={k} kind={kind} cx={x + REEL_W / 2} cy={rowY(k)} />
                ))}
              </g>
              {/* The rows off the line dim once the line pays. */}
              <Part style={move('on', 160, { delay: 700, o: 0 })}>
                <rect x={x} y={TOP} width={REEL_W} height={CELL} fill={C.paper} fillOpacity='.65' />
                <rect x={x} y={TOP + CELL * 2} width={REEL_W} height={CELL} fill={C.paper} fillOpacity='.65' />
              </Part>
            </svg>
          </g>
        );
      })}
      {[23, 137].map((x, i) => (
        <path key={x} d={`M${x},${rowY(1) - 3} l${i ? -3.6 : 3.6},3 l${i ? 3.6 : -3.6},3 Z`} fill={C.paper} />
      ))}
      {/* The paid line, drawn left to right. */}
      <path
        d={`M27,${rowY(1)} H133`}
        stroke={C.red}
        strokeWidth='1.6'
        strokeLinecap='round'
        strokeDasharray='106'
        style={move('dash', 200, { delay: 680, dash: [106, 0], ease: EASE.out })}
      />
    </PreviewScreen>
  );
}
