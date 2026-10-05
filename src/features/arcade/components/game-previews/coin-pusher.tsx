/* Coin pusher: a coin drops from the chute, the lower shelf pushes forward,
   and the coin hanging over the lip tips into the tray. */
import { C, Part, PreviewScreen, move, EASE, type PreviewProps } from './kit';

const COIN = '#F2A33C';
const RIM = '#C47A1E';

function Coin({ x, y, rx }: { x: number; y: number; rx: number }) {
  return <ellipse cx={x} cy={y} rx={rx} ry={rx * 0.5} fill={COIN} stroke={RIM} strokeWidth='1' />;
}

// The upper tier's coins, then the lower tier's, back row first.
const UPPER: [number, number][] = [
  [52, 21], [64, 22], [77, 21], [90, 22], [103, 21],
  [46, 32], [58, 34], [71, 33], [84, 34], [97, 33], [110, 32],
  [52, 40], [66, 41], [80, 40], [94, 41], [108, 40],
];
const LOWER: [number, number][] = [
  [40, 61], [55, 62], [70, 61], [86, 62], [101, 61], [117, 62],
  [34, 71], [50, 72], [66, 71], [82, 72], [98, 71], [114, 72], [127, 70],
  [42, 81], [59, 82], [75, 81], [108, 82], [124, 81],
];
const TIP = { x: 91, y: 82 };

export default function CoinPusherPreview({ still }: PreviewProps) {
  return (
    <PreviewScreen still={still} rest={0}>
      {/* The back wall, the chute's rail and its carriage. */}
      <rect x='30' y='0' width='100' height='14' fill={C.rail} />
      <rect x='28' y='4' width='104' height='2' fill={C.lit} opacity='.6' />
      <rect x='72' y='3' width='14' height='7' rx='1' fill={C.paper} />
      <rect x='74' y='9' width='10' height='2' fill={C.red} />
      {/* Tier 1: shelf A over its playfield. */}
      <rect x='36' y='14' width='88' height='12' fill={C.paper} />
      <rect x='36' y='25' width='88' height='1.6' fill={C.red} />
      <rect x='32' y='26.6' width='96' height='18' fill={C.screen2} />
      {/* Tier 2: shelf B over the front playfield, out to the lip. */}
      <rect x='28' y='44.6' width='104' height='3' fill={C.lit} />
      <rect x='24' y='47.6' width='112' height='40' fill={C.screen2} />
      {UPPER.map(([x, y]) => (
        <Coin key={`u${x}-${y}`} x={x} y={y} rx={5} />
      ))}
      <Part style={move('from', 620, { y: -4, ease: EASE.out })}>
        <rect x='28' y='47.6' width='104' height='9' fill={C.paper} />
        <rect x='28' y='55.6' width='104' height='1.8' fill={C.red} />
        {LOWER.map(([x, y]) => (
          <Coin key={`l${x}-${y}`} x={x} y={y} rx={6.2} />
        ))}
      </Part>
      {/* The lip, and the tray under it. */}
      <rect x='20' y='87.6' width='120' height='2.4' fill={C.paper} />
      <rect x='20' y='90' width='120' height='10' fill={C.hole} />
      {/* The coin at the lip tips over and drops into the tray. */}
      <Part style={move('to', 380, { delay: 420, y: 14, r: 70, o: 0, ease: EASE.fall })}>
        <Coin x={TIP.x} y={TIP.y + 4} rx={6.4} />
      </Part>
      {/* A coin leaves the chute and lands on shelf A. */}
      <Part style={move('from', 300, { y: -10, o: 0, ease: EASE.drop })}>
        <Coin x={79} y={23} rx={5} />
      </Part>
    </PreviewScreen>
  );
}
