/* The stub-family avatar, built from parts.

   The construction is PROGRESSION.md's: a 96 unit square shown in a circle,
   and one of each layer at most, stacked in this order.

     ground  one flat fill, edge to edge
     body    the mark's own outline at 0.63 scale, tilted -7 degrees, with the
             host's two legs running off the bottom edge
     face    the mark's face: two dots and the smile
     hat     sits on the body's top edge
     prop    lower right, small

   Hats are drawn in stub space (the mark's 120 x 72 box, top edge at y = 4),
   so a hat always sits on the outline. Every colour comes from palette.ts. */

import type { ReactNode } from 'react';

import { MARK_FACE, MARK_PERF, STUB_PATH } from '../tixy-brand-geometry';
import { ART, TONES, type ArtColor, type ToneName } from './palette';

export const AVATAR_SIZE = 96;

export const GROUNDS = {
  paper2: ART.paper2,
  paper3: ART.paper3,
  blue: ART.blue,
  green: ART.green,
  red: ART.red,
  rail: ART.rail,
} as const;
export type GroundName = keyof typeof GROUNDS;

export type FaceId = 'smile' | 'grin' | 'calm' | 'wink';
export type HatId =
  | 'bowler'
  | 'propeller'
  | 'crown'
  | 'top-hat'
  | 'party'
  | 'cap'
  | 'toque'
  | 'cowboy'
  | 'wizard'
  | 'beret'
  | 'headphones'
  | 'sprout'
  | 'antenna'
  | 'bow'
  | 'paper-hat';
export type PropId = 'ticket' | 'coin' | 'gumball' | 'pennant';

export type StubAvatarSpec = {
  ground: GroundName;
  stock: ToneName;
  face?: FaceId;
  hat?: HatId;
  /* Overrides the hat's main colour. */
  hatTone?: ToneName;
  prop?: PropId;
};

const BODY_TRANSFORM = 'translate(49 59) rotate(-7) scale(0.63) translate(-60 -36)';

/* The face colour that reads on each stock: paper on ink, ink on
   everything else. Limbs turn paper on the night ground. */
const faceColor = (stock: ToneName): ArtColor => (stock === 'ink' ? 'paper' : 'ink');

const [LEFT_EYE, RIGHT_EYE] = MARK_FACE.eyes;

function Face({ id, color }: { id: FaceId; color: string }) {
  const r = MARK_FACE.eyeRadius;
  const smile = (d: string, width = MARK_FACE.smileWidth) => (
    <path d={d} fill='none' stroke={color} strokeWidth={width} strokeLinecap='round' />
  );
  return (
    <g data-avatar-part='face'>
      <g data-avatar-part='eyes'>
        {id === 'wink' ? (
          <path d='M28,33 Q34,25 40,33' fill='none' stroke={color} strokeWidth={4.6} strokeLinecap='round' />
        ) : (
          <circle cx={LEFT_EYE[0]} cy={LEFT_EYE[1]} r={r} fill={color} />
        )}
        <circle cx={RIGHT_EYE[0]} cy={RIGHT_EYE[1]} r={r} fill={color} />
      </g>
      {id === 'grin' ? (
        <path d='M30,41 Q46,63 62,41 Z' fill={color} stroke={color} strokeWidth={3} strokeLinejoin='round' />
      ) : id === 'calm' ? (
        smile('M36,45 Q46,51 56,45')
      ) : (
        smile(MARK_FACE.smile)
      )}
    </g>
  );
}

/* Hats take the colour they wear and its darker step. */
type Tone = { main: string; dark: string };
const HATS: Record<HatId, { tone: ToneName; draw: (t: Tone) => ReactNode }> = {
  bowler: {
    tone: 'ink',
    draw: (t) => (
      <>
        <ellipse cx={46} cy={5} rx={31} ry={6} fill={t.main} />
        <path d='M27,5 C27,-27 65,-27 65,5 Z' fill={t.main} />
        <rect x={27.5} y={-5} width={37} height={6} fill={ART.red} />
      </>
    ),
  },
  propeller: {
    tone: 'blue',
    draw: (t) => (
      <>
        <path d='M23,6 A23,23 0 0 1 69,6 Z' fill={t.main} />
        <rect x={21} y={1} width={50} height={7} rx={3.5} fill={t.dark} />
        <path d='M46,-17 V-25' stroke={ART.ink} strokeWidth={4} />
        <ellipse cx={35} cy={-26} rx={11} ry={4} fill={ART.amber} />
        <ellipse cx={57} cy={-26} rx={11} ry={4} fill={ART.red} />
        <circle cx={46} cy={-26} r={3.5} fill={ART.ink} />
      </>
    ),
  },
  /* A crown cut from a ticket strip: five points, a perforated line, three
     paper dots. The last tier of a season card. */
  crown: {
    tone: 'amber',
    draw: (t) => (
      <>
        <path d='M21,6 V-16 L33,-4 L46,-22 L59,-4 L71,-16 V6 Z' fill={t.main} />
        <path d='M24,0 H68' stroke={ART.ink} strokeWidth={2.5} strokeDasharray='3 3.5' />
        <circle cx={21} cy={-17} r={3} fill={ART.paper} />
        <circle cx={46} cy={-23} r={3} fill={ART.paper} />
        <circle cx={71} cy={-17} r={3} fill={ART.paper} />
      </>
    ),
  },
  'top-hat': {
    tone: 'ink',
    draw: (t) => (
      <>
        <ellipse cx={46} cy={5} rx={31} ry={5} fill={t.main} />
        <rect x={28} y={-27} width={36} height={32} rx={2} fill={t.main} />
        <rect x={28} y={-8} width={36} height={8} fill={ART.brass} />
      </>
    ),
  },
  party: {
    tone: 'red',
    draw: (t) => (
      <>
        <path d='M23,5 L46,-42 L69,5 Z' fill={t.main} />
        <path d='M32,-10 H60' stroke={ART.lit} strokeWidth={4} strokeDasharray='4 4' />
        <circle cx={46} cy={-43} r={6.5} fill={ART.amber} />
      </>
    ),
  },
  /* The season's hat: a ticket taker's peaked cap with a brass badge. */
  cap: {
    tone: 'ink',
    draw: (t) => (
      <>
        <path d='M22,6 C22,-28 70,-28 70,6 Z' fill={t.main} />
        <path d='M20,6 C20,-2 32,-4 48,-4 H86 C86,3 79,7 71,7 Z' fill={t.dark} />
        <circle cx={46} cy={-11} r={6.5} fill={ART.amber} />
      </>
    ),
  },
  toque: {
    tone: 'lit',
    draw: (t) => (
      <>
        <circle cx={30} cy={-12} r={14} fill={t.main} />
        <circle cx={46} cy={-22} r={16} fill={t.main} />
        <circle cx={62} cy={-12} r={14} fill={t.main} />
        <rect x={26} y={-8} width={40} height={14} rx={2} fill={t.dark} />
      </>
    ),
  },
  cowboy: {
    tone: 'brass',
    draw: (t) => (
      <>
        <path d='M6,3 Q16,-4 28,-2 H64 Q76,-4 86,3 Q66,9 46,9 Q26,9 6,3 Z' fill={t.main} />
        <path d='M28,2 C26,-18 30,-25 38,-23 Q46,-18 54,-23 C62,-25 66,-18 64,2 Z' fill={t.main} />
        <rect x={28} y={-7} width={36} height={7} fill={t.dark} />
      </>
    ),
  },
  wizard: {
    tone: 'blue',
    draw: (t) => (
      <>
        <path d='M27,5 L52,-42 L65,5 Z' fill={t.main} />
        <ellipse cx={46} cy={5} rx={32} ry={5} fill={t.dark} />
        <path d='M29,-6 H63 L61,1 H28 Z' fill={ART.amber} />
      </>
    ),
  },
  beret: {
    tone: 'red',
    draw: (t) => (
      <g transform='rotate(-8 46 4)'>
        <ellipse cx={48} cy={-3} rx={29} ry={11} fill={t.main} />
        <rect x={20} y={0} width={54} height={6} rx={3} fill={t.dark} />
        <path d='M50,-14 V-20' stroke={ART.ink} strokeWidth={4} strokeLinecap='round' />
      </g>
    ),
  },
  headphones: {
    tone: 'ink',
    draw: (t) => (
      <>
        <path d='M12,24 C12,-28 108,-28 108,24' fill='none' stroke={t.main} strokeWidth={6} />
        <rect x={3} y={14} width={14} height={28} rx={6} fill={t.dark} />
        <rect x={103} y={14} width={14} height={28} rx={6} fill={t.dark} />
      </>
    ),
  },
  sprout: {
    tone: 'green',
    draw: (t) => (
      <>
        <path d='M46,5 V-12' stroke={t.main} strokeWidth={4} strokeLinecap='round' />
        <path d='M46,-10 Q30,-12 28,-27 Q44,-28 46,-10 Z' fill={t.main} />
        <path d='M46,-10 Q62,-12 64,-27 Q48,-28 46,-10 Z' fill={t.dark} />
      </>
    ),
  },
  antenna: {
    tone: 'red',
    draw: (t) => (
      <>
        <path d='M46,5 V-22' stroke={ART.ink} strokeWidth={4} strokeLinecap='round' />
        <circle cx={46} cy={-26} r={7} fill={t.main} />
      </>
    ),
  },
  bow: {
    tone: 'red',
    draw: (t) => (
      <>
        <path d='M32,-4 L10,-16 V8 Z' fill={t.main} />
        <path d='M32,-4 L54,-16 V8 Z' fill={t.main} />
        <circle cx={32} cy={-4} r={5.5} fill={t.dark} />
      </>
    ),
  },
  'paper-hat': {
    tone: 'lit',
    draw: (t) => (
      <>
        <path d='M12,6 L28,-24 H64 L80,6 Z' fill={t.main} />
        <path d='M46,-24 V6' stroke={t.dark} strokeWidth={3} />
        <path d='M28,-24 L12,6 H80 L64,-24' fill='none' stroke={t.dark} strokeWidth={2.5} strokeLinejoin='round' />
      </>
    ),
  },
};

/* Props sit in the lower right, inside the circle, drawn in avatar units. */
const PROPS: Record<PropId, ReactNode> = {
  ticket: (
    <g transform='rotate(-14 71 77)'>
      <rect x={58} y={70} width={26} height={15} rx={2.5} fill={ART.amber} />
      <circle cx={58} cy={77.5} r={3} fill={ART.paper3} />
      <circle cx={84} cy={77.5} r={3} fill={ART.paper3} />
      <path d='M71,71.5 V83.5' stroke={ART.ink} strokeWidth={1.6} strokeDasharray='2.4 2.4' />
    </g>
  ),
  coin: (
    <>
      <circle cx={71} cy={77} r={9} fill={ART.brass} />
      <circle cx={71} cy={77} r={6} fill={ART.brassDark} />
      <rect x={70} y={73} width={2.4} height={8} fill={ART.ink} />
    </>
  ),
  gumball: (
    <>
      <circle cx={71} cy={77} r={8.5} fill={ART.red} />
      <circle cx={68} cy={74} r={2.2} fill={ART.redDark} />
    </>
  ),
  pennant: (
    <>
      <path d='M64,88 V62' stroke={ART.ink} strokeWidth={2.4} strokeLinecap='round' />
      <path d='M65.2,62 L84,69.5 L65.2,77 Z' fill={ART.red} />
    </>
  ),
};

export type StubAvatarProps = StubAvatarSpec & {
  /* px; the avatar is square. */
  size?: number;
  className?: string;
  /* Accessible name. Leave it out when the avatar is decoration. */
  label?: string;
};

/* The 96 unit drawing as a group, for callers that compose it into a larger
   scene. */
export function StubAvatarArt({ ground, stock, face = 'smile', hat, hatTone, prop }: StubAvatarSpec) {
  const tone = TONES[stock];
  const ink = ART[faceColor(stock)];
  const limb = ground === 'rail' ? ART.lit : ART.ink;
  const hatSpec = hat ? HATS[hat] : null;
  return (
    <>
      <rect width={AVATAR_SIZE} height={AVATAR_SIZE} fill={GROUNDS[ground]} data-avatar-part='ground' />
      <g transform={BODY_TRANSFORM} data-avatar-part='body'>
        <g stroke={limb} strokeWidth={6} strokeLinecap='round' data-avatar-part='legs'>
          <path d='M44,66 L40,120' />
          <path d='M76,66 L80,120' />
        </g>
        <path d={STUB_PATH} fill={tone.main} />
        <path d={MARK_PERF.d} stroke={ink} strokeWidth={MARK_PERF.width} strokeDasharray={MARK_PERF.dash} strokeLinecap='round' />
        <Face id={face} color={ink} />
        {hatSpec ? <g data-avatar-part='hat'>{hatSpec.draw(TONES[hatTone ?? hatSpec.tone])}</g> : null}
      </g>
      {prop ? <g data-avatar-part='prop'>{PROPS[prop]}</g> : null}
    </>
  );
}

export function StubAvatar({ size = AVATAR_SIZE, className, label, ...spec }: StubAvatarProps) {
  return (
    <svg
      xmlns='http://www.w3.org/2000/svg'
      viewBox={`0 0 ${AVATAR_SIZE} ${AVATAR_SIZE}`}
      width={size}
      height={size}
      className={className}
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true, focusable: 'false' })}
    >
      <StubAvatarArt {...spec} />
    </svg>
  );
}
