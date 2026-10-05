/* Snake: the board as the game draws it (snake/_snake-theme.ts), a checker
   of dark browns, the amber snake with its eyes on the apple, and the paper
   apple with its leaf. The move: the snake slides three cells, eats the
   apple and grows, and the next apple pops up. */
import { C, EASE, Part, PreviewScreen, move, type PreviewProps } from './kit';

const CELL = 10;
// The route the body lies on; the snake is a dash sliding along it. The
// last leg runs right to the apple: head at length 100 (x 95) before, 130
// (x 125) after; the tail goes 20 to 40, so it grows one cell.
const ROUTE = 'M25,75 H55 V45 H125';
const HEAD = { x: 95, y: 45 };
const APPLE = { x: 125, y: 45 };
const NEXT = { x: 45, y: 15 };
const SLIDE = 450;
const css = `@keyframes gp-snake{from{stroke-dasharray:80 400;stroke-dashoffset:-20}to{stroke-dasharray:90 400;stroke-dashoffset:-40}}`;

function Apple({ x, y }: { x: number; y: number }) {
  return (
    <>
      <circle cx={x} cy={y + 0.6} r='3.9' fill={C.paper} />
      <path d={`M${x},${y - 3} l.8,-2.2`} stroke='#B8A98F' strokeWidth='1' strokeLinecap='round' />
      <ellipse cx={x + 2.6} cy={y - 4} rx='2.2' ry='1' fill={C.green} transform={`rotate(-20 ${x + 2.6} ${y - 4})`} />
    </>
  );
}

export default function SnakePreview({ still }: PreviewProps) {
  return (
    <PreviewScreen css={css} still={still} rest={0}>
      <rect width='160' height='100' fill={C.ink} />
      {Array.from({ length: 80 }, (_, i) => {
        const c = (i % 8) * 2 + (Math.floor(i / 8) % 2);
        const r = Math.floor(i / 8);
        return <rect key={i} x={c * CELL} y={r * CELL} width={CELL} height={CELL} fill='#272019' />;
      })}
      <Part style={move('to', 100, { delay: SLIDE - 60, s: 0, o: 0 })}>
        <Apple {...APPLE} />
      </Part>
      <path
        d={ROUTE}
        fill='none'
        stroke={C.amber}
        strokeWidth='7'
        strokeLinejoin='round'
        strokeLinecap='round'
        style={move('gp-snake', SLIDE, { ease: EASE.linear })}
      />
      {/* The head: two side lobes with the eyes, looking at the apple. */}
      <Part style={move('to', SLIDE, { x: APPLE.x - HEAD.x, ease: EASE.linear })}>
        <circle cx={HEAD.x + 1} cy={HEAD.y} r='4.2' fill={C.amber} />
        {[-2.8, 2.8].map((dy) => (
          <g key={dy}>
            <circle cx={HEAD.x + 1.6} cy={HEAD.y + dy} r='2.5' fill={C.amber} />
            <circle cx={HEAD.x + 1.6} cy={HEAD.y + dy} r='1.9' fill='#FFFFFF' />
            <circle cx={HEAD.x + 2.4} cy={HEAD.y + dy} r='1' fill={C.ink} />
          </g>
        ))}
      </Part>
      <Part style={move('pop', 220, { delay: SLIDE + 80 })}>
        <Apple {...NEXT} />
      </Part>
    </PreviewScreen>
  );
}
