/* The account level badge: the medal's construction (an ink disc, a rim, a
   face) with the level set big on the face. One design for every level; the
   band a level sits in (every 20 levels, as the server's tiers) changes the
   rim and the face, never the shape and never a word:

     1 to 19     amber dark rim, paper 2 face
     20 to 39    paper 3 rim, paper face
     40 to 59    amber rim, lit face
     60 to 79    green rim, paper 2 face, a lit inner ring
     80 to 99    blue rim, lit face, a dashed lit outer ring
     100 and up  amber rim, ink face, amber number, a dashed amber outer ring

   Every colour is a token from palette.ts. The number is set by the app in
   Big Shoulders, like the achievement badge's tier pill, so this drawing is
   not part of the exported art kit (which carries no digits). */

import { ART } from './palette';
import { AVATAR_SIZE } from './stub-avatar';

const C = AVATAR_SIZE / 2;

export type LevelBand = {
  /** The first level in the band. */
  from: number;
  rim: string;
  face: string;
  number: string;
  /** A second ring: solid inside the rim, or dashed outside it. */
  ring?: { color: string; dashed: boolean };
};

export const LEVEL_BANDS: readonly LevelBand[] = [
  { from: 1, rim: ART.amberDark, face: ART.paper2, number: ART.ink },
  { from: 20, rim: ART.paper3, face: ART.paper, number: ART.ink },
  { from: 40, rim: ART.amber, face: ART.lit, number: ART.ink },
  { from: 60, rim: ART.green, face: ART.paper2, number: ART.ink, ring: { color: ART.lit, dashed: false } },
  { from: 80, rim: ART.blue, face: ART.lit, number: ART.ink, ring: { color: ART.lit, dashed: true } },
  { from: 100, rim: ART.amber, face: ART.ink, number: ART.amber, ring: { color: ART.amber, dashed: true } },
];

/** The band a level sits in. */
export function levelBand(level: number): LevelBand {
  const lvl = Math.max(1, Math.floor(Number.isFinite(level) ? level : 1));
  for (let i = LEVEL_BANDS.length - 1; i >= 0; i -= 1) {
    if (lvl >= LEVEL_BANDS[i]!.from) return LEVEL_BANDS[i]!;
  }
  return LEVEL_BANDS[0]!;
}

/* The face holds two digits at 44; longer numbers step down to fit. */
function numberSize(digits: number) {
  if (digits <= 1) return 48;
  if (digits === 2) return 44;
  if (digits === 3) return 34;
  return 26;
}

export function LevelBadgeArt({ level }: { level: number }) {
  const band = levelBand(level);
  const text = String(Math.max(1, Math.floor(level)));
  const size = numberSize(text.length);
  return (
    <>
      <circle cx={C} cy={C} r={44} fill={ART.ink} />
      {band.ring?.dashed ? (
        <circle cx={C} cy={C} r={42.6} fill='none' stroke={band.ring.color} strokeWidth={1.8} strokeDasharray='4 3.4' />
      ) : null}
      <circle cx={C} cy={C} r={38.6} fill='none' stroke={band.rim} strokeWidth={5.4} />
      <circle cx={C} cy={C} r={35.9} fill={band.face} />
      {band.ring && !band.ring.dashed ? (
        <circle cx={C} cy={C} r={33} fill='none' stroke={band.ring.color} strokeWidth={1.8} />
      ) : null}
      <text
        x={C}
        y={C + size * 0.36}
        textAnchor='middle'
        fontSize={size}
        fontWeight={800}
        fill={band.number}
        style={{ fontFamily: "var(--tixy-font-num, 'Big Shoulders'), system-ui, sans-serif" }}
      >
        {text}
      </text>
    </>
  );
}

/**
 * The level as a badge. `title` is read by assistive tech ("Level 6"); leave
 * it out when the level is said next to the badge.
 */
export function LevelBadge({
  level,
  size = 48,
  className,
  title,
}: {
  level: number;
  size?: number;
  className?: string;
  title?: string;
}) {
  return (
    <svg
      xmlns='http://www.w3.org/2000/svg'
      viewBox={`0 0 ${AVATAR_SIZE} ${AVATAR_SIZE}`}
      width={size}
      height={size}
      className={className}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable='false'
    >
      <LevelBadgeArt level={level} />
    </svg>
  );
}
