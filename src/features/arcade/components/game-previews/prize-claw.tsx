/* Prize claw: the curio case, the default cabinet (prize-claw/_prize-claw-
   theme.ts). A walnut cabinet with brass trim and an ink marquee; behind the
   glass, green felt with the prizes on it, each with its tag (paper frames
   at 1.6x, amber frames at 3x, the red bear at 8x), the brass chute ring at
   the front right, and the brass claw on its gantry. The move: the claw
   drops on the bear, closes, and lifts it. */
import { C, Num, PreviewScreen, Word, move, type PreviewProps } from './kit';

const WOOD = { body: '#5A3A1C', trim: '#6E4A26', dark: '#3A2412' };
const BRASS = { hi: '#F0D79A', mid: '#C79A4C', lo: '#78581F' };
const FELT = { top: '#2E7566', shadow: '#245E52' };
const GLASS = '#1A2421';

/** A framed picture prize standing on (x, base). */
function Frame({ x, base, s, fill, inner }: { x: number; base: number; s: number; fill: string; inner: string }) {
  const w = 10 * s;
  return (
    <>
      <rect x={x - w / 2} y={base - w * 1.1} width={w} height={w} rx='.8' fill={fill} />
      <rect x={x - w * 0.27} y={base - w * 0.87} width={w * 0.54} height={w * 0.54} fill={inner} />
    </>
  );
}

/** The tag under a prize: an ink plate with its pay in paper. */
function Tag({ x, base, value }: { x: number; base: number; value: string }) {
  return (
    <>
      <rect x={x - 4.4} y={base - 0.6} width='8.8' height='5' rx='.8' fill={C.ink} />
      <Num x={x} y={base + 3.4} size={4.6} fill={C.paper}>
        {value}
      </Num>
    </>
  );
}

/** The bear: a red plush with paper ears and the house face. */
function Bear({ x, base }: { x: number; base: number }) {
  return (
    <>
      <ellipse cx={x} cy={base - 4.4} rx='5.4' ry='4.6' fill={C.red} />
      <circle cx={x - 4} cy={base - 13.4} r='2' fill={C.red} />
      <circle cx={x + 4} cy={base - 13.4} r='2' fill={C.red} />
      <circle cx={x - 4} cy={base - 13.4} r='.9' fill={C.paper} />
      <circle cx={x + 4} cy={base - 13.4} r='.9' fill={C.paper} />
      <circle cx={x} cy={base - 10.4} r='4.6' fill={C.red} />
      <circle cx={x - 1.6} cy={base - 11} r='.65' fill={C.ink} />
      <circle cx={x + 1.6} cy={base - 11} r='.65' fill={C.ink} />
      <path d={`M${x - 1.3},${base - 9.2} q1.3,1.2 2.6,0`} fill='none' stroke={C.ink} strokeWidth='.55' strokeLinecap='round' />
    </>
  );
}

const BEAR = { x: 80, base: 60 };
/** The claw's hub at rest, and how far it drops to close round the bear. */
const HUB = { x: BEAR.x, y: 33 };
const DROP = 17;
const CABLE_TOP = 21;
const MS = 860;
const EASE_CLAW = 'cubic-bezier(.45,0,.35,1)';
const css = [
  `@keyframes gp-claw{0%{transform:none}42%,58%{transform:translateY(${DROP}px)}100%{transform:translateY(1px)}}`,
  `@keyframes gp-claw-cable{0%{transform:none}42%,58%{transform:scaleY(${((HUB.y - CABLE_TOP + DROP) / (HUB.y - CABLE_TOP)).toFixed(3)})}100%{transform:scaleY(${((HUB.y - CABLE_TOP + 1) / (HUB.y - CABLE_TOP)).toFixed(3)})}}`,
  `@keyframes gp-claw-prize{0%,58%{transform:none}100%{transform:translateY(${1 - DROP}px)}}`,
  `@keyframes gp-claw-l{0%,40%{transform:rotate(-14deg)}52%,100%{transform:rotate(6deg)}}`,
  `@keyframes gp-claw-r{0%,40%{transform:rotate(14deg)}52%,100%{transform:rotate(-6deg)}}`,
].join('');

function Finger({ dir }: { dir: 1 | -1 }) {
  return (
    <path
      d={`M${HUB.x},${HUB.y + 1} l${dir * 5},4 l${-dir * 1.2},7`}
      fill='none'
      stroke={BRASS.mid}
      strokeWidth='1.8'
      strokeLinecap='round'
      strokeLinejoin='round'
    />
  );
}

export default function PrizeClawPreview({ still }: PreviewProps) {
  return (
    <PreviewScreen css={css} still={still} rest={MS}>
      <rect width='160' height='100' fill={C.ink} />
      {/* The marquee. */}
      <rect x='34' y='2' width='92' height='12' rx='1' fill={WOOD.body} />
      <rect x='40' y='3.6' width='80' height='8.8' rx='.8' fill={C.ink} stroke={BRASS.hi} strokeWidth='.6' />
      <Word x={80} y={10.4} size={6.4} fill={C.paper}>
        prize claw
      </Word>
      {/* The glass case: the back wall, the felt bed, the brass posts. */}
      <rect x='36' y='14' width='88' height='62' fill={GLASS} />
      <path d='M44,50 H116 L122,76 H38 Z' fill={FELT.top} />
      <path d='M44,50 H116 L117,53 H43 Z' fill={FELT.shadow} />
      {[[56, 70], [100, 58], [68, 56]].map(([x, y]) => (
        <path key={`${x}-${y}`} d={`M${x - 2},${y} h4 M${x},${y - 1.4} v2.8`} stroke={C.paper} strokeOpacity='.35' strokeWidth='.6' />
      ))}
      {/* The chute: a brass ring in the felt, front right. */}
      <ellipse cx='110' cy='70.5' rx='8.5' ry='3.6' fill={BRASS.mid} />
      <ellipse cx='110' cy='70.5' rx='6.6' ry='2.5' fill={C.hole} />
      {/* The prizes, back row first. */}
      <Frame x={58} base={58} s={0.9} fill={C.paper} inner={C.red} />
      <Tag x={58} base={58} value='1.6×' />
      <Frame x={102} base={58} s={0.9} fill={C.amber} inner={C.ink} />
      <Tag x={102} base={58} value='3×' />
      <Tag x={BEAR.x} base={BEAR.base} value='8×' />
      <Frame x={49} base={71} s={1.05} fill={C.amber} inner={C.ink} />
      <Tag x={49} base={71} value='3×' />
      <Frame x={66} base={72} s={1.05} fill={C.paper} inner={C.red} />
      <Tag x={66} base={72} value='1.6×' />
      <Frame x={93} base={72} s={1.05} fill={C.paper} inner={C.red} />
      <Tag x={93} base={72} value='1.6×' />
      {/* The bear rides up in the claw. */}
      <g style={move('gp-claw-prize', MS, { ease: EASE_CLAW })}>
        <Bear x={BEAR.x} base={BEAR.base} />
      </g>
      {/* The claw on its cable. */}
      <g style={move('gp-claw-cable', MS, { ease: EASE_CLAW, origin: [HUB.x, CABLE_TOP] })}>
        <path d={`M${HUB.x},${CABLE_TOP} V${HUB.y}`} stroke={BRASS.lo} strokeWidth='.8' />
      </g>
      <g style={move('gp-claw', MS, { ease: EASE_CLAW })}>
        <g style={move('gp-claw-l', MS, { origin: [HUB.x, HUB.y + 1], ease: EASE_CLAW })}>
          <Finger dir={-1} />
        </g>
        <g style={move('gp-claw-r', MS, { origin: [HUB.x, HUB.y + 1], ease: EASE_CLAW })}>
          <Finger dir={1} />
        </g>
        <path d={`M${HUB.x},${HUB.y + 1} v10`} stroke={BRASS.lo} strokeWidth='1.6' strokeLinecap='round' />
        <rect x={HUB.x - 3.4} y={HUB.y - 3} width='6.8' height='4.4' rx='1.4' fill={BRASS.mid} />
      </g>
      {/* The gantry rail and its trolley. */}
      <rect x='36' y='17' width='88' height='2.4' rx='1' fill={BRASS.mid} />
      <rect x={HUB.x - 4} y='16' width='8' height='5' rx='1' fill={BRASS.lo} />
      {/* The case's brass posts and the walnut base with its nameplate. */}
      <rect x='34' y='14' width='3' height='64' fill={BRASS.mid} />
      <rect x='123' y='14' width='3' height='64' fill={BRASS.mid} />
      <rect x='30' y='76' width='100' height='24' fill={WOOD.body} />
      <rect x='30' y='76' width='100' height='2.4' fill={BRASS.mid} />
      <rect x='30' y='81' width='100' height='.6' fill={BRASS.hi} fillOpacity='.6' />
      <rect x='64' y='86' width='32' height='7' rx='1' fill={C.ink} stroke={BRASS.hi} strokeWidth='.5' />
      <Word x={80} y={91.2} size={4.4} fill={C.paper} weight={700}>
        curio case
      </Word>
    </PreviewScreen>
  );
}
