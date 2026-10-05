/* A pool ball as the 8-ball canvas draws it (pool-physics/constants.ts):
   solids 1 to 8 in their colour with a paper number disc, stripes 9 to 15 as
   a band of colour across a paper ball. Shared by 8-ball and trick shot. */
import { C } from './kit';

export const BALL_COLOR: Record<number, string> = {
  1: '#F6C700',
  2: '#003DA5',
  3: '#D32F2F',
  4: '#4A148C',
  5: '#E65100',
  6: '#2E7D32',
  7: '#6D1B1B',
  8: '#111111',
};

export function PoolBall({ x, y, n, r }: { x: number; y: number; n: number; r: number }) {
  if (n > 8) {
    const h = r * 0.55;
    const w = +Math.sqrt(r * r - h * h).toFixed(2);
    return (
      <>
        <circle cx={x} cy={y} r={r} fill={C.paper} />
        <path
          d={`M${x - w},${y - h}H${x + w}A${r},${r} 0 0 1 ${x + w},${y + h}H${x - w}A${r},${r} 0 0 1 ${x - w},${y - h}Z`}
          fill={BALL_COLOR[n - 8]}
        />
        <circle cx={x} cy={y} r={r * 0.4} fill={C.paper} />
      </>
    );
  }
  return (
    <>
      <circle cx={x} cy={y} r={r} fill={BALL_COLOR[n] ?? C.paper} />
      <circle cx={x} cy={y} r={r * 0.4} fill={C.paper} />
    </>
  );
}
