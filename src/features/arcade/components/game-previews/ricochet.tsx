/* Ricochet: the bird crosses the field, meets the right wall inside the safe
   slot, squashes against it and throws off a few chips. The score ticks over. */
import { C, EASE, Num, Part, PreviewScreen, move, type PreviewProps } from './kit';

const LEFT_FACE = 44;
const RIGHT_FACE = 116;
const BIRD_END = { x: 108, y: 62 };

/** Teeth down a wall, none at the safe slot and longer the further they
 *  are from it (_ricochet-draw.ts): one triangle each, pitch 9. */
function Teeth({ face, dir, gap }: { face: number; dir: 1 | -1; gap: [number, number] }) {
  const teeth: [number, number][] = [];
  for (let y = 5; y < 100; y += 9) {
    const away = y < gap[0] ? gap[0] - y : y - gap[1];
    if (away > 3) teeth.push([y, Math.min(8, 3 + away * 0.16)]);
  }
  return (
    <>
      {teeth.map(([y, len]) => (
        <path key={y} d={`M${face},${y - 4} L${face + dir * len},${y} L${face},${y + 4} Z`} fill={C.lit} />
      ))}
    </>
  );
}

function Bird() {
  return (
    <g>
      <path d='M-6,-3 L-13,0 L-6,3 Z' fill='#C98524' />
      <ellipse cx='0' cy='0' rx='8' ry='7.4' fill={C.amber} />
      <ellipse cx='1.4' cy='2.6' rx='4.6' ry='3.4' fill={C.lit} />
      <ellipse cx='-2.4' cy='-0.4' rx='4.6' ry='2.6' fill='#C98524' transform='rotate(-14 -2.4 -0.4)' />
      <path d='M6.4,-1.4 L11.6,0.2 L6.4,2.2 Z' fill='#C98524' />
      <circle cx='3.6' cy='-2.6' r='1.3' fill={C.ink} />
    </g>
  );
}

export default function RicochetPreview({ still }: PreviewProps) {
  return (
    <PreviewScreen still={still} rest={700}>
      <rect x={LEFT_FACE + 20} width='32' height='100' fill='#322B24' />
      <rect x={LEFT_FACE - 10} width='10' height='100' fill={C.red} />
      <rect x={RIGHT_FACE} width='10' height='100' fill={C.red} />
      <rect x={LEFT_FACE - 6} y='33' width='6' height='24' rx='3' fill={C.paper} />
      <rect x={RIGHT_FACE} y='50' width='6' height='24' rx='3' fill={C.paper} />
      <Teeth face={LEFT_FACE} dir={1} gap={[33, 57]} />
      <Teeth face={RIGHT_FACE} dir={-1} gap={[50, 74]} />

      <Part style={move('pop', 200, { delay: 430, s: 1.35 })}>
        <Num x={80} y={30} size={20} fill={C.paper}>
          12
        </Num>
      </Part>

      {[-8, -3, 3, 8].map((dy) => (
        <Part key={dy} style={move('to', 280, { delay: 420, x: -9 - Math.abs(dy) * 0.4, y: dy * 1.6, o: 0, ease: EASE.out })}>
          <rect x={RIGHT_FACE - 4} y={BIRD_END.y + dy - 1.5} width='3' height='3' fill={C.lit} />
        </Part>
      ))}

      <Part style={move('from', 420, { x: -48, y: -18, ease: EASE.out })}>
        <Part style={move('thunk', 260, { delay: 420, origin: [RIGHT_FACE, BIRD_END.y] })}>
          <g transform={`translate(${BIRD_END.x} ${BIRD_END.y})`}>
            <Bird />
          </g>
        </Part>
      </Part>
    </PreviewScreen>
  );
}
