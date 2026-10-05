/* Flappy bird: the pier at night. The posts slide in, the bird flaps once,
   rises through the gap with its nose up and tips into the glide; the score
   ticks to 13 as it clears the post. The house look of the game
   (_flappy-theme.ts): red posts with paper caps, a ticket amber bird. */
import { C, EASE, Num, Part, PreviewScreen, move, type PreviewProps } from './kit';

const POST = '#C4432E';
const POST_LIGHT = '#D4573F';
const GROUND_Y = 88;
const BIRD = { x: 46, y: 50 };
const SLIDE = 760;

// Each post pair: x, the gap's top, the gap's height.
const PAIRS: [number, number, number][] = [
  [64, 30, 36],
  [126, 20, 36],
];

function Pair({ x, top, gap }: { x: number; top: number; gap: number }) {
  const w = 16;
  const cap = 6;
  return (
    <g>
      <rect x={x} y={0} width={w} height={top - cap} fill={POST} />
      <rect x={x + 2} y={0} width={3} height={top - cap} fill={POST_LIGHT} />
      <rect x={x - 1.5} y={top - cap} width={w + 3} height={cap} rx='1.2' fill={C.paper} />
      <rect x={x - 1.5} y={top - cap / 2 - 0.6} width={w + 3} height={1.2} fill={POST} />
      <rect x={x} y={top + gap + cap} width={w} height={GROUND_Y - top - gap - cap} fill={POST} />
      <rect x={x + 2} y={top + gap + cap} width={3} height={GROUND_Y - top - gap - cap} fill={POST_LIGHT} />
      <rect x={x - 1.5} y={top + gap} width={w + 3} height={cap} rx='1.2' fill={C.paper} />
      <rect x={x - 1.5} y={top + gap + cap / 2 - 0.6} width={w + 3} height={1.2} fill={POST} />
    </g>
  );
}

// The bird's flap: a quick rise nose-up, then the tip into the glide.
const css = [
  `@keyframes gp-flp-bird{0%{transform:translateY(5px) rotate(16deg)}28%{transform:translateY(-9px) rotate(-22deg)}100%{transform:translateY(-3px) rotate(6deg)}}`,
  `@keyframes gp-flp-wing{0%{transform:rotate(-34deg)}22%{transform:rotate(38deg)}55%,100%{transform:rotate(-6deg)}}`,
].join('');

export default function FlappyBirdPreview({ still }: PreviewProps) {
  return (
    <PreviewScreen css={css} still={still} rest={900}>
      {/* The far boardwalk: the wheel and a tent, flat. */}
      <g fill='none' stroke={C.screen2} strokeWidth='2'>
        <circle cx='108' cy='56' r='22' />
        <path d='M108 34V78M86 56H130M92.4 40.4L123.6 71.6M123.6 40.4L92.4 71.6M98 88L108 56L118 88' />
      </g>
      <path d='M136 88L148 70L160 88Z' fill={C.screen2} />
      {/* The rail and its lights. */}
      <rect x='0' y='77' width='160' height='1.6' fill='#453930' />
      {[8, 30, 52, 74, 96, 118, 140].map((x) => (
        <g key={x}>
          <rect x={x} y='72' width='2' height='16' fill='#453930' />
          <circle cx={x + 11} cy='72.5' r='1' fill='#C98524' />
        </g>
      ))}
      <g style={move('to', SLIDE, { x: -18, ease: EASE.linear })}>
        {PAIRS.map(([x, top, gap]) => (
          <Pair key={x} x={x} top={top} gap={gap} />
        ))}
      </g>
      {/* The pier's boards. */}
      <rect x='0' y={GROUND_Y} width='160' height={100 - GROUND_Y} fill={C.dim} />
      <rect x='0' y={GROUND_Y} width='160' height='1.2' fill={C.screen} />
      {Array.from({ length: 14 }, (_, i) => (
        <rect key={i} x={i * 12 + 6} y={GROUND_Y + 3} width='1' height='9' fill={C.screen} />
      ))}
      {/* The bird. */}
      <g style={move('gp-flp-bird', SLIDE, { ease: EASE.linear, origin: [BIRD.x, BIRD.y] })}>
        <ellipse cx={BIRD.x} cy={BIRD.y} rx='7.5' ry='6' fill={C.amber} />
        <path d={`M${BIRD.x + 6} ${BIRD.y - 0.5}L${BIRD.x + 12} ${BIRD.y + 1.2}L${BIRD.x + 6} ${BIRD.y + 3}Z`} fill={C.red} />
        <g style={move('gp-flp-wing', 420, { ease: EASE.out, origin: [BIRD.x + 1.5, BIRD.y + 1] })}>
          <ellipse cx={BIRD.x - 2.5} cy={BIRD.y + 1} rx='5' ry='3.2' fill='#C98524' />
        </g>
        <circle cx={BIRD.x + 3.5} cy={BIRD.y - 2.2} r='2.8' fill={C.paper} />
        <circle cx={BIRD.x + 4.5} cy={BIRD.y - 2.2} r='1.4' fill={C.ink} />
      </g>
      {/* The score: 12, then 13 as the bird clears the first post. */}
      <Part style={move('off', 1, { delay: 520 })}>
        <Num x={80} y={20} size={17} fill={C.paper}>
          12
        </Num>
      </Part>
      <Part style={move('pop', 180, { delay: 520, s: 1.3 })}>
        <Num x={80} y={20} size={17} fill={C.paper}>
          13
        </Num>
      </Part>
    </PreviewScreen>
  );
}
