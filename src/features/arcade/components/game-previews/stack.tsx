/* Stack: the cabinet (stack/_stacker-cabinet-draw.ts), the floor's default
   mode. Seven columns of fifteen lamps, an amber tower, the red row sweeping
   above it, and the prize marks at rows 11 and 15 with their 15 and 75
   stubs. The move: the red row steps across, comes back and stops; the lamp
   over the tower lights amber and the overhang falls. */
import { C, EASE, Num, Part, PreviewScreen, move, type PreviewProps } from './kit';

const UNLIT = '#3A3029';
const PITCH = 6;
const X0 = 59;
/** Rows count from the bottom, 1 to 15. */
const cellAt = (c: number, row: number) => ({ x: X0 + c * PITCH, y: 4 + (15 - row) * PITCH });
// The tower: row, first column, last column.
const TOWER: Record<number, [number, number]> = { 1: [2, 4], 2: [2, 4], 3: [2, 4], 4: [3, 5], 5: [3, 5], 6: [3, 4] };
const lit = (c: number, row: number) => {
  const span = TOWER[row];
  return !!span && c >= span[0] && c <= span[1];
};
const ROW = 7;
// The red row's left column at each step: out to the wall, back, and it
// stops on 2 to 3 over a top of 3 to 4, so column 2 falls.
const STEPS = [0, 1, 2, 3, 4, 5, 4, 3, 2];
const STEP_MS = 60;
const STOP = STEPS.length * STEP_MS;
const css = `@keyframes gp-stk{${STEPS.map((c, i) => `${((i / (STEPS.length - 1)) * 100).toFixed(1)}%{transform:translateX(${c * PITCH}px)}`).join('')}}`;

function Lamp({ c, row, fill }: { c: number; row: number; fill: string }) {
  const { x, y } = cellAt(c, row);
  return <rect x={x} y={y} width='5' height='5' rx='.8' fill={fill} />;
}

/** A prize stub: a ticket with a half-circle notch on each short end. */
function Stub({ y, value }: { y: number; value: string }) {
  const x = 108;
  const w = 13;
  return (
    <g>
      <path
        d={`M${x + 1.5},${y}h${w - 3}a1.5,1.5 0 0 1 1.5,1.5v1a1,1 0 0 0 0,2v1a1.5,1.5 0 0 1 -1.5,1.5h-${w - 3}a1.5,1.5 0 0 1 -1.5,-1.5v-1a1,1 0 0 0 0,-2v-1a1.5,1.5 0 0 1 1.5,-1.5z`}
        fill={C.amber}
      />
      <Num x={x + w / 2} y={y + 5.6} size={6} fill={C.ink}>
        {value}
      </Num>
    </g>
  );
}

export default function StackPreview({ still }: PreviewProps) {
  return (
    <PreviewScreen css={css} still={still} rest={4 * STEP_MS + 20}>
      {Array.from({ length: 105 }, (_, i) => {
        const c = i % 7;
        const row = 15 - Math.floor(i / 7);
        return <Lamp key={i} c={c} row={row} fill={lit(c, row) ? C.amber : UNLIT} />;
      })}
      {[11, 15].map((row) => {
        const y = cellAt(0, row).y + 2.5;
        return (
          <g key={row}>
            <path d={`M${X0 - 5},${y} H${X0 - 2} M${X0 + 7 * PITCH + 1},${y} H${X0 + 7 * PITCH + 4}`} stroke={C.lit} strokeOpacity='.7' strokeWidth='1' />
            <Stub y={y - 3.5} value={row === 15 ? '75' : '15'} />
          </g>
        );
      })}
      <g style={move('gp-stk', STOP, { ease: 'steps(1, end)' })}>
        <Lamp c={1} row={ROW} fill={C.red} />
        <Part style={move('to', 320, { delay: STOP, y: 40, r: 50, o: 0, ease: EASE.fall })}>
          <Lamp c={0} row={ROW} fill={C.red} />
        </Part>
      </g>
      <Part style={move('on', 80, { delay: STOP })}>
        <Lamp c={3} row={ROW} fill={C.amber} />
      </Part>
    </PreviewScreen>
  );
}
