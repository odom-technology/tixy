/* Connect four: the dark rack (_connect-four.css) with red and amber chips,
   each a casino chip with nine paper notches. A chip drops down its column,
   bounces once, and the four it completes light one after another. */
import { C, EASE, Part, PreviewScreen, move, type PreviewProps } from './kit';

const hole = (c: number, r: number) => ({ x: 44 + c * 12, y: 20 + r * 12.4 });
// [row, column]: colour. Rows count from the top, 0 to 5.
const DISCS: Record<string, string> = {
  '5,1': C.amber,
  '5,2': C.red,
  '4,2': C.amber,
  '5,3': C.amber,
  '4,3': C.red,
  '3,3': C.amber,
  '5,4': C.red,
  '4,4': C.amber,
  '3,4': C.red,
  '5,5': C.red,
};
const DROP = { r: 2, c: 4 };
const FOUR = [[5, 1], [4, 2], [3, 3], [2, 4]];
const LAND = 80 + 440;
const RIM = 2 * Math.PI * 3.6;

/** A chip: the body, nine paper notches round the rim, an inner ring. */
function Chip({ x, y, fill }: { x: number; y: number; fill: string }) {
  return (
    <>
      <circle cx={x} cy={y} r='4.5' fill={fill} />
      <circle cx={x} cy={y} r='3.6' fill='none' stroke={C.paper} strokeOpacity='.92' strokeWidth='1.1' strokeDasharray={`${(RIM / 9) * 0.225} ${(RIM / 9) * 0.775}`} />
      <circle cx={x} cy={y} r='2.1' fill='none' stroke={C.paper} strokeOpacity='.55' strokeWidth='.6' />
    </>
  );
}

export default function ConnectFourPreview({ still }: PreviewProps) {
  const target = hole(DROP.c, DROP.r);
  return (
    <PreviewScreen still={still} rest={900}>
      {/* The rack: an ink frame with a hard lip under it, the face inside. */}
      <rect x='31' y='12' width='98' height='84' rx='7' fill={C.ink} />
      <rect x='31' y='10' width='98' height='82' rx='7' fill={C.rail} />
      <rect x='35' y='14' width='90' height='74' rx='4' fill='#54453A' />
      {Array.from({ length: 42 }, (_, i) => {
        const c = i % 7;
        const r = Math.floor(i / 7);
        const { x, y } = hole(c, r);
        const disc = DISCS[`${r},${c}`];
        return disc ? <Chip key={i} x={x} y={y} fill={disc} /> : <circle key={i} cx={x} cy={y} r='4.8' fill={C.hole} />;
      })}
      <Part style={move('from', 440, { delay: 80, y: -(target.y + 6), ease: EASE.drop })}>
        <Chip x={target.x} y={target.y} fill={C.amber} />
      </Part>
      {FOUR.map(([r, c], i) => {
        const { x, y } = hole(c, r);
        return (
          <Part key={i} style={move('pop', 120, { delay: LAND + 20 + i * 80, s: 1.5 })}>
            <circle cx={x} cy={y} r='5.6' fill='none' stroke={C.amber} strokeWidth='1.6' />
          </Part>
        );
      })}
    </PreviewScreen>
  );
}
