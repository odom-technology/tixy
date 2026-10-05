/* Plinko: one machine of the bank (plinko/_plinko-board.tsx), the 8-row
   medium board. Flat metal pegs, two in the top row and one more each row
   down, the flat red ball, and brass slots printed with their pays. The
   move: the ball drops through the pegs, one row at a time, and the 3 it
   lands in dips and lights red (it pays more than the drop). */
import { C, EASE, Num, Part, PreviewScreen, move, type PreviewProps } from './kit';

const ROWS = 8;
const SLOTS = ['13', '3', '1.3', '0.7', '0.4', '0.7', '1.3', '3', '13'];
const X0 = 26;
const PITCH = 12;
const TOP = 6;
const ROW_H = 8.6;
const PEG = { fill: '#B9BEC0', edge: '#4B5154' };
const BRASS = { fill: '#C9A25A', edge: '#9C7835' };
const slotX = (k: number) => X0 + k * PITCH;
const pegY = (row: number) => TOP + row * ROW_H;
const LAND = 1;
const START = { x: 80, y: 1 };
// The ball's offset from START after each row: half a pitch left or right
// (L L R L L L L L), then down into slot 1.
const SIDES = [-1, -1, 1, -1, -1, -1, -1, -1];
const PATH: [number, number][] = [[0, 0]];
SIDES.forEach((side, row) => PATH.push([PATH[row][0] + (side * PITCH) / 2, pegY(row) + 4.4 - START.y]));
PATH.push([slotX(LAND) + PITCH / 2 - START.x, 78.6 - START.y]);
const css = [
  `@keyframes gp-plk{${PATH.map(([x, y], i) => `${((i / (PATH.length - 1)) * 100).toFixed(1)}%{transform:translate(${x.toFixed(1)}px,${y.toFixed(1)}px)}`).join('')}}`,
  // The slot dips as the ball lands.
  `@keyframes gp-plk-dip{0%{transform:none}35%{transform:translateY(1.6px)}100%{transform:none}}`,
].join('');
const FALL = 640;

function Slot({ k, fill, ink }: { k: number; fill: string; ink: string }) {
  const x = slotX(k) + 0.6;
  return (
    <>
      <rect x={x} y='82' width={PITCH - 1.2} height='13' rx='1.6' fill={BRASS.edge} />
      <rect x={x} y='82' width={PITCH - 1.2} height='11.4' rx='1.6' fill={fill} />
      <Num x={x + (PITCH - 1.2) / 2} y={91} size={SLOTS[k].length > 2 ? 6.4 : 7.6} fill={ink}>
        {SLOTS[k]}
      </Num>
    </>
  );
}

export default function PlinkoPreview({ still }: PreviewProps) {
  return (
    <PreviewScreen css={css} still={still} rest={300}>
      {Array.from({ length: ROWS }, (_, row) =>
        Array.from({ length: row + 2 }, (_, p) => {
          const x = 80 + (p - (row + 1) / 2) * PITCH;
          const y = pegY(row);
          return (
            <g key={`${row}-${p}`}>
              <circle cx={x} cy={y + 0.4} r='1.3' fill={PEG.edge} />
              <circle cx={x} cy={y} r='1.3' fill={PEG.fill} />
            </g>
          );
        }),
      )}
      {SLOTS.map((_, k) => (
        <Slot key={k} k={k} fill={BRASS.fill} ink={C.ink} />
      ))}
      <Part style={move('on', 90, { delay: FALL })}>
        <Part style={move('gp-plk-dip', 240, { delay: FALL, ease: EASE.spring })}>
          <Slot k={LAND} fill={C.red} ink={C.paper} />
        </Part>
      </Part>
      <g style={move('gp-plk', FALL, { ease: 'cubic-bezier(.4,.1,.7,1)' })}>
        <circle cx={START.x + 0.6} cy={START.y + 0.8} r='2.6' fill={C.hole} fillOpacity='.5' />
        <circle cx={START.x} cy={START.y} r='2.6' fill={C.red} />
      </g>
    </PreviewScreen>
  );
}
