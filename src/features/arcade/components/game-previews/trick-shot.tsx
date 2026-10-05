/* Trick shot: the day's line is drawn on the felt; the cue ball cuts the red
   into the corner, comes off it onto the blue and sends that into the other
   corner. One stroke, two balls down. */
import { C, EASE, Part, PreviewScreen, move, type PreviewProps } from './kit';
import { PoolBall } from './pool-ball';

const R = 4.2;
const CUE = { x: 100, y: 30 };
const RED = { x: 40, y: 30 };
/** Where the cue ball meets the red: a ball's width short of it, on the line to the corner. */
const GHOST_RED = { x: 47, y: 34.6 };
const BLUE = { x: 25, y: 68 };
const GHOST_BLUE = { x: 29.7, y: 61 };
const POCKETS = [[11, 11], [80, 9], [149, 11], [11, 89], [80, 91], [149, 89]];
const CORNER_TL = { x: 11, y: 11 };
const CORNER_BL = { x: 11, y: 89 };

const css = `@keyframes gp-ts-cue{0%{transform:none}50%{transform:translateX(7px)}80%{transform:translateX(-2px)}100%{transform:translateX(-1px)}}`;

export default function TrickShotPreview({ still }: PreviewProps) {
  return (
    <PreviewScreen css={css} still={still} rest={0}>
      <rect width='160' height='100' rx='6' fill={C.rail} />
      <rect x='7' y='7' width='146' height='86' rx='2' fill={C.cushion} />
      <rect x='10' y='10' width='140' height='80' rx='3' fill={C.felt} />
      {POCKETS.map(([x, y]) => (
        <circle key={`${x}-${y}`} cx={x} cy={y} r='6' fill='#0C0907' />
      ))}
      {/* The line: cue ball to the red, off it to the blue. */}
      <Part style={move('off', 160, { delay: 120 })}>
        <path
          d={`M${CUE.x} ${CUE.y} L${GHOST_RED.x} ${GHOST_RED.y} L${GHOST_BLUE.x} ${GHOST_BLUE.y}`}
          fill='none'
          stroke={C.paper}
          strokeOpacity='0.5'
          strokeWidth='.8'
        />
        <circle cx={GHOST_RED.x} cy={GHOST_RED.y} r={R} fill='none' stroke={C.paper} strokeOpacity='0.6' strokeWidth='0.8' />
      </Part>
      <Part style={move('to', 220, { delay: 380, x: CORNER_TL.x - RED.x, y: CORNER_TL.y - RED.y, s: 0.5, o: 0 })}>
        <PoolBall x={RED.x} y={RED.y} n={3} r={R} />
      </Part>
      <Part style={move('to', 220, { delay: 640, x: CORNER_BL.x - BLUE.x, y: CORNER_BL.y - BLUE.y, s: 0.5, o: 0 })}>
        <PoolBall x={BLUE.x} y={BLUE.y} n={10} r={R} />
      </Part>
      <Part style={move('to', 260, { delay: 120, x: GHOST_RED.x - CUE.x, y: GHOST_RED.y - CUE.y, ease: EASE.linear })}>
        <Part style={move('to', 260, { delay: 380, x: GHOST_BLUE.x - GHOST_RED.x, y: GHOST_BLUE.y - GHOST_RED.y })}>
          <circle cx={CUE.x} cy={CUE.y} r={R} fill='#F7F2E8' />
        </Part>
      </Part>
      <Part style={move('gp-ts-cue', 160, { ease: EASE.linear })}>
        <path d={`M${CUE.x + R + 4} ${CUE.y} H164`} stroke='#F0E2C2' strokeWidth='2.6' strokeLinecap='round' />
        <path d={`M${CUE.x + R + 4} ${CUE.y} h2`} stroke='#6B5631' strokeWidth='2.6' strokeLinecap='round' />
      </Part>
    </PreviewScreen>
  );
}
