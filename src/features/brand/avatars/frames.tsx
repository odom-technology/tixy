/* Frames: rings drawn over the avatar's edge, in the same 96 unit square, so
   a frame lays over any avatar and the app clips both to a circle. */

import { ART } from './palette';
import { AVATAR_SIZE } from './stub-avatar';

export type FrameId = 'ticket' | 'bulbs' | 'brass';

const C = AVATAR_SIZE / 2;
const R = 44.5;
const ring = (angle: number) => [
  Math.round((C + R * Math.cos(angle)) * 100) / 100,
  Math.round((C + R * Math.sin(angle)) * 100) / 100,
];

const FRAMES: Record<FrameId, () => React.ReactNode> = {
  /* Amber and perforated, the prize in the mockup. */
  ticket: () => (
    <circle cx={C} cy={C} r={R} fill='none' stroke={ART.amber} strokeWidth={7} strokeDasharray='9.5 4.5' />
  ),
  /* An ink ring with 16 lit bulbs. */
  bulbs: () => (
    <>
      <circle cx={C} cy={C} r={R} fill='none' stroke={ART.ink} strokeWidth={7} />
      {Array.from({ length: 16 }, (_, i) => {
        const [x, y] = ring((i / 16) * Math.PI * 2);
        return <circle key={i} cx={x} cy={y} r={2.5} fill={ART.lit} />;
      })}
    </>
  ),
  /* Brass with four rivets, for the 8-ball shelf. */
  brass: () => (
    <>
      <circle cx={C} cy={C} r={R} fill='none' stroke={ART.brass} strokeWidth={7} />
      {[0, 1, 2, 3].map((i) => {
        const [x, y] = ring(Math.PI / 4 + (i * Math.PI) / 2);
        return <circle key={i} cx={x} cy={y} r={2.4} fill={ART.ink} />;
      })}
    </>
  ),
};

export function FrameArt({ id }: { id: FrameId }) {
  return <>{FRAMES[id]()}</>;
}

export function Frame({ id, size = AVATAR_SIZE, className }: { id: FrameId; size?: number; className?: string }) {
  return (
    <svg
      xmlns='http://www.w3.org/2000/svg'
      viewBox={`0 0 ${AVATAR_SIZE} ${AVATAR_SIZE}`}
      width={size}
      height={size}
      className={className}
      aria-hidden
      focusable='false'
    >
      <FrameArt id={id} />
    </svg>
  );
}
