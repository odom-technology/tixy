/* Skee-ball: the cabinet from the player's end (skee-ball/_skee-ball-
   theme.ts). The walnut lane runs up between brass rails to the board: the
   rings in their enamel (20 cream, 30 amber, 40 red, the 50 cup in the
   middle), a cup at the foot of each ring, the two 100 pockets in the top
   corners. The move: the ball rolls up the lane, hops the lip and drops
   into the 50; the ring flashes and +50 rises. */
import { C, EASE, Num, Part, PreviewScreen, move, type PreviewProps } from './kit';

const WOOD = { lane: '#5A3A1C', cabinet: '#3A2412', trim: '#6E4A26', board: '#2B2119', brass: '#C79A4C' };
const RING = { r20: '#E8DCC0', r30: '#E3A52E', r40: '#C33A2B', r50: '#F2E5C8', hole: '#0D0603' };
const BOARD = { x: 80, y: 31 };
const BALL = { x: 80, y: 90 };
const ROLL = 520;
const css = [
  // Up the lane, shrinking with distance, a hop off the lip, into the cup.
  `@keyframes gp-skee-ball{0%{transform:none}70%{transform:translate(0px,-50px) scale(.42)}85%{transform:translate(0px,-64px) scale(.36)}100%{transform:translate(0px,${BOARD.y + 3 - BALL.y}px) scale(.3)}}`,
  `@keyframes gp-skee-flash{0%{opacity:0}1%,60%{opacity:1}100%{opacity:0}}`,
].join('');

export default function SkeeBallPreview({ still }: PreviewProps) {
  const { x, y } = BOARD;
  return (
    <PreviewScreen css={css} still={still} rest={0}>
      {/* The cabinet's sides and the lane between its rails. */}
      <path d='M14,100 L50,4 H110 L146,100 Z' fill={WOOD.cabinet} />
      <path d='M36,100 L62,56 H98 L124,100 Z' fill={WOOD.lane} />
      <path d='M36,100 L62,56 M124,100 L98,56' stroke={WOOD.brass} strokeWidth='1.6' />
      <path d='M58,100 L68,56 M102,100 L92,56' stroke={WOOD.trim} strokeOpacity='.5' strokeWidth='.8' />
      {/* The board in its brass frame. */}
      <rect x='52' y='6' width='56' height='50' rx='2' fill={WOOD.board} stroke={WOOD.brass} strokeWidth='1.4' />
      <circle cx={x} cy={y} r='19' fill={RING.r20} />
      <circle cx={x} cy={y} r='13.6' fill={RING.r30} />
      <circle cx={x} cy={y} r='8.6' fill={RING.r40} />
      <circle cx={x} cy={y} r='4' fill={RING.r50} />
      {/* A cup at the foot of each ring, and the 100 pockets. */}
      {[16.3, 11.1, 6.3].map((d) => (
        <ellipse key={d} cx={x} cy={y + d} rx='2.4' ry='1.5' fill={RING.hole} />
      ))}
      <ellipse cx={x} cy={y + 1.4} rx='2.2' ry='1.4' fill={RING.hole} />
      {[60, 100].map((px) => (
        <g key={px}>
          <circle cx={px} cy='13' r='4' fill={WOOD.brass} />
          <circle cx={px} cy='13' r='2.6' fill={RING.hole} />
        </g>
      ))}
      {/* The 50 ring flashes as the ball drops in. */}
      <Part style={move('gp-skee-flash', 360, { delay: ROLL, ease: EASE.linear })}>
        <circle cx={x} cy={y} r='4.6' fill='none' stroke={C.amber} strokeWidth='2' />
        <circle cx={x} cy={y} r='8.6' fill='none' stroke={C.paper} strokeWidth='1.2' />
      </Part>
      <Part style={move('gp-skee-ball', ROLL, { ease: 'cubic-bezier(.3,.55,.45,1)', origin: [BALL.x, BALL.y] })}>
        <circle cx={BALL.x} cy={BALL.y} r='6' fill={RING.r50} />
        <circle cx={BALL.x - 1.8} cy={BALL.y - 1.8} r='1.6' fill='#FFFFFF' fillOpacity='.5' />
      </Part>
      <Part style={move('from', 300, { delay: ROLL + 40, y: 6, o: 0, ease: EASE.spring })}>
        <Num x={123} y={30} size={13} fill={C.amber}>
          +50
        </Num>
      </Part>
    </PreviewScreen>
  );
}
