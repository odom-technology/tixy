/* Achievement badges: the medal, extended.

   A badge is the medal's construction (an ink disc, a paper 2 face, one glyph
   from the floor) with a tier rim and a number.

     series   the rim is five arcs; a tier fills that many in amber, and the top
              tier fills all five in red. A pill at the bottom carries the tier's
              number, set by the app in Big Shoulders. The art itself has no
              digits (check-art-kit.ts forbids text), so the pill is only drawn
              when `chip` is on.
     feat     one achievement with no tiers: a solid brass rim with four rivets.
     secret   a rail face with an amber perforated rim, and a lit glyph on it.

   Locked badges are the same drawing at 40%. Every colour is a token from
   palette.ts. Glyphs are drawn inside a circle of radius 26 around the centre and
   scaled 1.1 (series) or 1.16 (feats, secrets) onto the face; a series badge
   lifts its glyph 4 units, clear of the pill. */

import type { ReactNode } from 'react';

import { MARK_FACE, STUB_PATH } from '../tixy-brand-geometry';
import { MEDAL_GLYPHS } from './medals';
import { ART } from './palette';
import { AVATAR_SIZE } from './stub-avatar';

export const BADGE_TIERS = 5;

const C = AVATAR_SIZE / 2;
const A = ART;

const rad = (deg: number) => (deg * Math.PI) / 180;
const polar = (cx: number, cy: number, r: number, deg: number): [number, number] => [
  Math.round((cx + r * Math.cos(rad(deg))) * 100) / 100,
  Math.round((cy + r * Math.sin(rad(deg))) * 100) / 100,
];

/* The stub at a small size, centred on (48 48). */
const Stub = ({ scale = 0.42, fill = A.amber, rotate = 0, face = true, dx = 0, dy = 0 }: { scale?: number; fill?: string; rotate?: number; face?: boolean; dx?: number; dy?: number }) => (
  <g transform={`translate(${48 + dx} ${48 + dy}) rotate(${rotate}) scale(${scale}) translate(-60 -36)`}>
    <path d={STUB_PATH} fill={fill} />
    {face ? (
      <>
        <circle cx={MARK_FACE.eyes[0][0]} cy={MARK_FACE.eyes[0][1]} r={5} fill={A.ink} />
        <circle cx={MARK_FACE.eyes[1][0]} cy={MARK_FACE.eyes[1][1]} r={5} fill={A.ink} />
        <path d={MARK_FACE.smile} fill='none' stroke={A.ink} strokeWidth={5.5} strokeLinecap='round' />
      </>
    ) : (
      <path d='M88,13 V59' stroke={A.ink} strokeWidth={3.5} strokeDasharray='4.5 5.5' />
    )}
  </g>
);

const Leaf = ({ x, y, angle, fill }: { x: number; y: number; angle: number; fill: string }) => (
  <ellipse cx={x} cy={y} rx={2.6} ry={5.6} transform={`rotate(${angle} ${x} ${y})`} fill={fill} />
);

const stroke = (color: string, width = 3) => ({
  fill: 'none' as const,
  stroke: color,
  strokeWidth: width,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
});

/* A point on a quadratic curve, for the bunting. */
const along = (t: number, [x0, y0]: number[], [x1, y1]: number[], [x2, y2]: number[]): [number, number] => [
  (1 - t) ** 2 * x0! + 2 * (1 - t) * t * x1! + t ** 2 * x2!,
  (1 - t) ** 2 * y0! + 2 * (1 - t) * t * y1! + t ** 2 * y2!,
];

const GLYPHS = {
  /* Floor games. */
  snake: () => (
    <>
      <path d='M30,64 H56 Q64,64 64,56 Q64,48 56,48 H40 Q32,48 32,40 Q32,32 40,32 H52' {...stroke(A.greenDark, 11)} />
      <path d='M30,64 H56 Q64,64 64,56 Q64,48 56,48 H40 Q32,48 32,40 Q32,32 40,32 H52' {...stroke(A.green, 8.4)} />
      <path d='M30,64 H56 Q64,64 64,56 Q64,48 56,48 H40 Q32,48 32,40 Q32,32 40,32 H52' {...stroke(A.lit, 1.6)} strokeDasharray='0.1 6' />
      <circle cx={54} cy={32} r={7.5} fill={A.green} />
      <circle cx={56} cy={29.5} r={2.2} fill={A.ink} />
      <path d='M61,33 H68 M68,33 L71,31 M68,33 L71,35' {...stroke(A.red, 1.8)} />
    </>
  ),
  /* Ricochet: a wall with teeth each side and the bird between. */
  ricochet: () => (
    <>
      <rect x={22} y={22} width={6} height={52} rx={1.5} fill={A.red} />
      <rect x={68} y={22} width={6} height={52} rx={1.5} fill={A.red} />
      {[28, 36, 62, 70].map((y) => (
        <path key={`l${y}`} d={`M28,${y - 4} L35,${y} L28,${y + 4} Z`} fill={A.lit} />
      ))}
      {[28, 36, 44, 70].map((y) => (
        <path key={`r${y}`} d={`M68,${y - 4} L61,${y} L68,${y + 4} Z`} fill={A.lit} />
      ))}
      <ellipse cx={46} cy={52} rx={9.5} ry={8.5} fill={A.amber} />
      <path d='M40,52 Q45,60 51,52 Q46,47 40,52 Z' fill={A.amberDark} />
      <path d='M54,50 L60,52 L54,55 Z' fill={A.red} />
      <circle cx={50} cy={48.5} r={1.7} fill={A.ink} />
    </>
  ),
  tile2048: () => (
    <>
      {[
        [30, 30, A.lit, A.litDark, 1],
        [50, 30, A.amber, A.amberDark, 2],
        [30, 50, A.brass, A.brassDark, 3],
        [50, 50, A.red, A.redDark, 4],
      ].map(([x, y, fill, dark, pips]) => (
        <g key={`${x}${y}`}>
          <rect x={x as number} y={(y as number) + 2.5} width={17} height={17} rx={3.5} fill={dark as string} />
          <rect x={x as number} y={y as number} width={17} height={17} rx={3.5} fill={fill as string} />
          {[
            [[8.5, 8.5]],
            [[5.5, 8.5], [11.5, 8.5]],
            [[8.5, 5], [5.2, 11.2], [11.8, 11.2]],
            [[5.5, 5.5], [11.5, 5.5], [5.5, 11.5], [11.5, 11.5]],
          ][(pips as number) - 1]!.map(([dx, dy]) => (
            <circle key={`${dx}${dy}`} cx={(x as number) + dx!} cy={(y as number) + dy!} r={1.7} fill={A.ink} />
          ))}
        </g>
      ))}
    </>
  ),
  stack: () => (
    <>
      {[
        [29, 60, 38, A.blue, A.blueDark],
        [35, 50, 30, A.green, A.greenDark],
        [32, 40, 28, A.amber, A.amberDark],
        [37, 30, 20, A.red, A.redDark],
      ].map(([x, y, w, fill, dark]) => (
        <g key={`${y}`}>
          <rect x={x as number} y={(y as number) + 3} width={w as number} height={8} rx={2} fill={dark as string} />
          <rect x={x as number} y={y as number} width={w as number} height={8} rx={2} fill={fill as string} />
        </g>
      ))}
      <rect x={62} y={22} width={9} height={6} rx={1.5} fill={A.red} transform='rotate(18 66 25)' />
    </>
  ),
  duck: () => (
    <>
      <path d='M24,62 H70' {...stroke(A.ink, 3)} />
      <path d='M40,60 L40,68 M56,60 L56,68' {...stroke(A.ink, 3)} />
      <path d='M24,50 L31,54 L31,62 L24,60 Z' fill={A.amberDark} />
      <ellipse cx={44} cy={52} rx={17} ry={10.5} fill={A.amber} />
      <path d='M32,54 Q44,63 56,54' fill={A.amberDark} />
      <circle cx={57} cy={37} r={9} fill={A.amber} />
      <path d='M64,36 H73 L65,41 Z' fill={A.red} />
      <circle cx={59} cy={35} r={1.9} fill={A.ink} />
      <circle cx={43} cy={51} r={5.6} fill={A.lit} />
      <circle cx={43} cy={51} r={2.4} fill={A.red} />
    </>
  ),
  connect: () => (
    <>
      <rect x={28} y={33} width={40} height={34} rx={5} fill={A.blueDark} />
      <rect x={28} y={30} width={40} height={34} rx={5} fill={A.blue} />
      {[0, 1, 2, 3].flatMap((col) =>
        [0, 1, 2].map((row) => {
          const x = 35 + col * 8.7;
          const y = 38 + row * 9;
          const fill = row === 2 ? A.red : row === 1 && (col === 1 || col === 2) ? A.amber : A.paper2;
          return <circle key={`${col}${row}`} cx={x} cy={y} r={3.5} fill={fill} />;
        }),
      )}
    </>
  ),
  /* High striker's endless run: the mallet, head up, banded in brass. */
  mallet: () => (
    <>
      <path d='M35,67 L54,41' {...stroke(A.brassDark, 6.4)} />
      <path d='M35,67 L54,41' {...stroke(A.brass, 3.4)} />
      <g transform='rotate(36 57 37)'>
        <rect x={45} y={30} width={24} height={14} rx={3.5} fill={A.redDark} />
        <rect x={46.6} y={31.6} width={20.8} height={10.8} rx={2.6} fill={A.red} />
        <rect x={49.5} y={30} width={2.6} height={14} fill={A.brass} />
        <rect x={61.9} y={30} width={2.6} height={14} fill={A.brass} />
      </g>
    </>
  ),
  /* Ring toss: a bottle with a ring dropped over its neck. */
  ring: () => (
    <>
      <path d='M35,46 A13,4.6 0 0 1 61,46' {...stroke(A.redDark, 4.2)} />
      <path d='M44.5,22 H51.5 V25 H51 V37 Q51,42 56,46 Q59,49 59,53 V72 Q59,74 57,74 H39 Q37,74 37,72 V53 Q37,49 40,46 Q45,42 45,37 V25 H44.5 Z' fill={A.greenDark} />
      <path d='M45,25 H51 V37 Q51,42 55.5,46 Q58,49 58,53 V71 H38 V53 Q38,49 40.5,46 Q45,42 45,37 Z' fill={A.green} />
      <path d='M41.5,54 V67' {...stroke(A.lit, 2.4)} />
      <path d='M35,46 A13,4.6 0 0 0 61,46' {...stroke(A.red, 4.2)} />
    </>
  ),
  /* Derby: a horseshoe, open end up, its nail holes picked out. */
  horseshoe: () => (
    <>
      <path d='M33,28 V48 A15,15 0 0 0 63,48 V28' {...stroke(A.brassDark, 11)} />
      <path d='M33,28 V48 A15,15 0 0 0 63,48 V28' {...stroke(A.brass, 7)} />
      {[
        [33, 36],
        [33, 47],
        [63, 36],
        [63, 47],
        [40, 59],
        [56, 59],
      ].map(([x, y]) => (
        <circle key={`${x}-${y}`} cx={x} cy={y} r={1.6} fill={A.ink} />
      ))}
    </>
  ),
  lock: () => (
    <>
      <circle cx={48} cy={47} r={19} fill='none' stroke={A.paper3} strokeWidth={7} />
      <path d={`M${polar(48, 47, 19, -75).join(',')} A19,19 0 0 1 ${polar(48, 47, 19, -15).join(',')}`} fill='none' stroke={A.amber} strokeWidth={7} />
      <path d='M48,47 L60,60' {...stroke(A.ink, 3)} />
      <circle cx={48} cy={47} r={3.6} fill={A.ink} />
      <circle cx={polar(48, 47, 19, 45)[0]} cy={polar(48, 47, 19, 45)[1]} r={4.4} fill={A.red} />
      <path d='M48,22 L52.5,29 H43.5 Z' fill={A.ink} />
    </>
  ),

  /* Trick shot: the cue ball's line through the red to the pocket. */
  'trick-shot': () => (
    <>
      <circle cx={64} cy={30} r={9} fill={A.ink} />
      <path d='M30,66 L46,48 L62,32' fill='none' stroke={A.lit} strokeWidth={2.4} strokeDasharray='3.5 3.5' strokeLinecap='round' />
      <circle cx={49} cy={45} r={7.5} fill={A.red} />
      <circle cx={49} cy={45} r={3} fill={A.lit} />
      <circle cx={30} cy={66} r={7} fill={A.lit} />
    </>
  ),

  /* Trick shot streak: the red ball in front of a flame, a clear a day. */
  'trick-streak': () => (
    <>
      <path d='M48,20 C50,29 62,33 61,49 C60.4,58 55,64 48,64 C41,64 35.6,58 35,49 C34.6,41 40,38 41.6,30 C44.4,35 46.6,28 48,20 Z' fill={A.amber} />
      <path d='M48,34 C49.6,40 55,42 54.4,49 C54,54 51.4,57 48,57 C44.6,57 42,54 41.6,49.6 C41.4,44 46,42 48,34 Z' fill={A.lit} />
      <circle cx={48} cy={60} r={12} fill={A.redDark} />
      <circle cx={48} cy={58.5} r={12} fill={A.red} />
      <circle cx={48} cy={58.5} r={4.6} fill={A.lit} />
    </>
  ),

  /* Trick shot on the first try: one solid line from the cue ball, the red
     ball dropping into the pocket. */
  'trick-first': () => (
    <>
      <circle cx={64} cy={31} r={10} fill={A.ink} />
      <path d='M32,66 L58,37' {...stroke(A.amber, 3.4)} />
      <circle cx={60.5} cy={34.5} r={7.5} fill={A.red} />
      <circle cx={60.5} cy={34.5} r={3} fill={A.lit} />
      <circle cx={32} cy={66} r={7.5} fill={A.lit} />
    </>
  ),

  /* Mini golf: the flag in the cup, the ball rolling up to it. */
  'mini-golf': () => (
    <>
      <ellipse cx={52} cy={68} rx={17} ry={6} fill={A.ink} />
      <rect x={50.6} y={20} width={2.8} height={48} rx={1.4} fill={A.lit} />
      <path d='M53.4,21 L74,28.5 L53.4,36 Z' fill={A.red} />
      <circle cx={28} cy={66} r={6.5} fill={A.lit} />
    </>
  ),

  /* Bumper cars: two dodgems meet nose to nose, a spark between them. */
  'bumper-cars': () => (
    <>
      {[
        { x: 33, fill: A.red, turn: 90 },
        { x: 63, fill: A.amber, turn: -90 },
      ].map((car) => (
        <g key={car.x} transform={`rotate(${car.turn} ${car.x} 52)`}>
          <rect x={car.x - 11} y={39} width={22} height={26} rx={9} fill={A.ink} />
          <rect x={car.x - 8.6} y={41.4} width={17.2} height={21.2} rx={7} fill={car.fill} />
          <rect x={car.x - 1.4} y={42} width={2.8} height={7} fill={A.lit} />
        </g>
      ))}
      <path d='M48,30 L50.4,37.6 L58,38.4 L50.4,40.8 L48,48 L45.6,40.8 L38,38.4 L45.6,37.6 Z' fill={A.lit} />
    </>
  ),

  /* Together. */
  duel: () => (
    <>
      {[40, -40].map((turn) => (
        <g key={turn} transform={`rotate(${turn} 48 48)`}>
          <rect x={44.2} y={22} width={7.6} height={42} rx={3.8} fill={A.ink} />
          <rect x={46} y={23.8} width={4} height={36} rx={2} fill={A.lit} />
          <rect x={37} y={57} width={22} height={5.6} rx={2.8} fill={A.brass} />
          <rect x={46.6} y={61} width={2.8} height={8} fill={A.ink} />
          <circle cx={48} cy={71} r={3.2} fill={A.red} />
        </g>
      ))}
    </>
  ),
  chevrons: () => (
    <>
      {[
        [66, A.brass],
        [54, A.amber],
        [42, A.red],
      ].map(([y, color]) => (
        <path key={y as number} d={`M30,${y} L48,${(y as number) - 15} L66,${y}`} {...stroke(color as string, 7)} />
      ))}
    </>
  ),
  robot: () => (
    <>
      <path d='M48,34 V26' {...stroke(A.ink, 3)} />
      <circle cx={48} cy={25} r={3.6} fill={A.red} />
      <rect x={25} y={44} width={6} height={13} rx={2} fill={A.brass} />
      <rect x={65} y={44} width={6} height={13} rx={2} fill={A.brass} />
      <rect x={29} y={37.5} width={38} height={30} rx={7} fill={A.blueDark} />
      <rect x={29} y={34} width={38} height={30} rx={7} fill={A.blue} />
      <path d='M37,43 L44,50 M44,43 L37,50 M52,43 L59,50 M59,43 L52,50' {...stroke(A.ink, 2.8)} />
      <path d='M38,57 H58' {...stroke(A.ink, 2.8)} />
    </>
  ),
  joystick: () => (
    <>
      <rect x={28} y={58} width={40} height={11} rx={4} fill={A.ink} />
      <circle cx={61} cy={63.5} r={2.6} fill={A.amber} />
      <circle cx={54} cy={63.5} r={2.6} fill={A.blue} />
      <path d='M45,56 L38,48 M45,56 V42' {...stroke(A.ink, 4)} />
      <circle cx={45} cy={36} r={10} fill={A.redDark} />
      <circle cx={45} cy={34} r={10} fill={A.red} />
    </>
  ),
  calendar: () => (
    <>
      <rect x={29} y={34.5} width={38} height={34} rx={5} fill={A.litDark} />
      <rect x={29} y={31} width={38} height={34} rx={5} fill={A.lit} />
      <path d='M29,36 Q29,31 34,31 H62 Q67,31 67,36 V41 H29 Z' fill={A.red} />
      <path d='M39,27 V35 M57,27 V35' {...stroke(A.ink, 3.4)} />
      {[
        [38, 49],
        [48, 49],
        [58, 49],
        [38, 57],
        [48, 57],
      ].map(([x, y]) => (
        <circle key={`${x}${y}`} cx={x} cy={y} r={2} fill={A.ink} />
      ))}
      <circle cx={58} cy={57} r={5} fill={A.amber} />
      <path d='M55.4,57.2 L57.4,59.2 L60.8,55' {...stroke(A.ink, 1.8)} />
    </>
  ),
  flame: () => (
    <>
      <path d='M48,22 C50,32 64,36 63,54 C62,64 55,71 48,71 C41,71 34,64 34,54 C34,45 40,42 42,33 C45,38 47,30 48,22 Z' fill={A.red} />
      <path d='M48,41 C50,48 57,50 56,58 C55,64 52,67 48,67 C44,67 41,64 41,59 C41,53 46,50 48,41 Z' fill={A.amber} />
      <path d='M48,54 C49,58 52,59 51.5,62 C51,65 49.5,66 48,66 C46.5,66 45,65 45,62.5 C45,59 47.5,58 48,54 Z' fill={A.lit} />
    </>
  ),
  puzzle: () => (
    <>
      <path d='M31,38 H44 A6,6 0 1 1 52,38 H65 V51 A6,6 0 1 1 65,59 V69 H31 V59 A6,6 0 1 0 31,51 Z' fill={A.greenDark} transform='translate(0 2)' />
      <path d='M31,38 H44 A6,6 0 1 1 52,38 H65 V51 A6,6 0 1 1 65,59 V69 H31 V59 A6,6 0 1 0 31,51 Z' fill={A.green} />
    </>
  ),
  hourglass: () => (
    <>
      <path d='M36,31 H60 Q60,44 51,48 Q60,52 60,65 H36 Q36,52 45,48 Q36,44 36,31 Z' fill={A.lit} />
      <path d='M40,33 H56 Q55,41 48,46 Q41,41 40,33 Z' fill={A.amber} />
      <path d='M38,65 Q40,56 48,55 Q56,56 58,65 Z' fill={A.amber} />
      <path d='M48,46 V56' {...stroke(A.amber, 1.6)} />
      <rect x={31} y={25} width={34} height={6} rx={3} fill={A.brass} />
      <rect x={31} y={65} width={34} height={6} rx={3} fill={A.brass} />
    </>
  ),
  tickets: () => (
    <>
      <Stub scale={0.4} fill={A.brass} face={false} rotate={-9} dx={-3} dy={-9} />
      <Stub scale={0.4} fill={A.lit} face={false} rotate={4} dx={2} dy={-1} />
      <Stub scale={0.4} fill={A.amber} face={false} rotate={-3} dx={0} dy={9} />
    </>
  ),
  gumball: () => (
    <>
      <circle cx={48} cy={42} r={18.5} fill={A.litDark} />
      <circle cx={48} cy={40.5} r={18.5} fill={A.lit} stroke={A.brassDark} strokeWidth={1.6} />
      {[
        [40, 46, A.red],
        [50, 48, A.blue],
        [58, 42, A.amber],
        [44, 37, A.green],
        [54, 34, A.red],
        [36, 38, A.brass],
      ].map(([x, y, fill]) => (
        <circle key={`${x}${y}`} cx={x as number} cy={y as number} r={4.8} fill={fill as string} />
      ))}
      <rect x={33} y={56} width={30} height={5} rx={2} fill={A.brass} />
      <rect x={36} y={61} width={24} height={9} rx={2.5} fill={A.red} />
      <rect x={44} y={64} width={8} height={3} rx={1.5} fill={A.ink} />
    </>
  ),
  trophy: () => (
    <>
      <path d='M37,32 Q27,32 28,41 Q29,47 38,48 M59,32 Q69,32 68,41 Q67,47 58,48' {...stroke(A.brass, 4)} />
      <path d='M36,26 H60 V41 Q60,54 48,56 Q36,54 36,41 Z' fill={A.brass} />
      <path d='M50,26 H60 V41 Q60,54 48,56 Q54,48 50,40 Z' fill={A.brassDark} />
      <rect x={45} y={55} width={6} height={8} fill={A.brassDark} />
      <rect x={36} y={62} width={24} height={7} rx={2.5} fill={A.ink} />
      <path d='M48,30 L50.2,35 L55.4,35.4 L51.4,38.6 L52.8,43.8 L48,41 L43.2,43.8 L44.6,38.6 L40.6,35.4 L45.8,35 Z' fill={A.lit} />
    </>
  ),

  /* Feats. */
  fan: () => (
    <>
      {[
        [-26, A.blue, A.lit],
        [26, A.green, A.lit],
      ].map(([turn, fill, pip]) => (
        <g key={turn as number} transform={`rotate(${turn} 48 70)`}>
          <rect x={37} y={26} width={22} height={32} rx={3.5} fill={fill as string} />
          <rect x={44.6} y={38.6} width={6.8} height={6.8} fill={pip as string} transform='rotate(45 48 42)' />
        </g>
      ))}
      <rect x={37} y={28} width={22} height={32} rx={3.5} fill={A.lit} stroke={A.ink} strokeWidth={2} />
      <rect x={44.6} y={39.6} width={6.8} height={6.8} fill={A.red} transform='rotate(45 48 43)' />
    </>
  ),
  beyond: () => (
    <>
      <path d='M34,38 L38.5,28 L44,34 L48,25 L52,34 L57.5,28 L62,38 Z' fill={A.brass} />
      <rect x={32} y={45.5} width={32} height={25} rx={5} fill={A.redDark} />
      <rect x={32} y={43} width={32} height={25} rx={5} fill={A.red} />
      <path d='M39,63 L48,54 L57,63 M39,56 L48,47 L57,56' {...stroke(A.lit, 3.6)} />
    </>
  ),
  shield: () => (
    <>
      <path d='M48,25 L67,31 V47 Q67,61 48,70 Q29,61 29,47 V31 Z' fill={A.blueDark} />
      <path d='M48,25 L67,31 V47 Q67,61 48,70 V25 Z' fill={A.blueDark} />
      <path d='M48,25 L29,31 V47 Q29,61 48,70 Z' fill={A.blue} />
      <circle cx={40} cy={42} r={2.6} fill={A.lit} />
      <circle cx={56} cy={42} r={2.6} fill={A.lit} />
      <path d='M39,52 Q48,60 57,52' {...stroke(A.lit, 3)} />
    </>
  ),
  laurel: () => (
    <>
      {[0, 1, 2, 3, 4].map((i) => {
        const deg = 130 + i * 22;
        const [lx, ly] = polar(48, 50, 22, deg);
        const [rx, ry] = polar(48, 50, 22, 180 - deg);
        return (
          <g key={i}>
            <Leaf x={lx} y={ly} angle={deg + 90 + 20} fill={i % 2 ? A.greenDark : A.green} />
            <Leaf x={rx} y={ry} angle={-(deg + 90 + 20) + 0} fill={i % 2 ? A.greenDark : A.green} />
          </g>
        );
      })}
      <circle cx={48} cy={50} r={11} fill={A.brassDark} />
      <circle cx={48} cy={48.5} r={11} fill={A.brass} />
      <circle cx={48} cy={48.5} r={6.6} fill='none' stroke={A.brassDark} strokeWidth={1.8} strokeDasharray='3 2.4' />
    </>
  ),
  /* The five floor groups. */
  'group-with-friends': () => (
    <>
      <Stub scale={0.34} fill={A.blue} rotate={-8} dx={-10} dy={-5} />
      <Stub scale={0.34} fill={A.amber} rotate={8} dx={10} dy={7} />
    </>
  ),
  'group-boardwalk': () => (
    <>
      <path d='M24,34 Q48,60 72,34' {...stroke(A.ink, 2.4)} />
      {[
        [0.1, A.red],
        [0.37, A.amber],
        [0.63, A.blue],
        [0.9, A.green],
      ].map(([t, fill]) => {
        const [x, y] = along(t as number, [24, 34], [48, 60], [72, 34]);
        return <path key={t as number} d={`M${x - 6},${y} H${x + 6} L${x},${y + 14} Z`} fill={fill as string} />;
      })}
    </>
  ),
  'group-quick-play': () => (
    <>
      <path d='M55,26 L34,53 H46 L42,72 L64,43 H51 Z' fill={A.amberDark} transform='translate(1.5 2)' />
      <path d='M55,26 L34,53 H46 L42,72 L64,43 H51 Z' fill={A.amber} />
    </>
  ),
  'group-ticket-machines': () => (
    <>
      <rect x={28} y={34} width={40} height={34} rx={5} fill={A.redDark} />
      <rect x={28} y={31} width={40} height={34} rx={5} fill={A.red} />
      <rect x={33} y={37} width={30} height={19} rx={2.5} fill={A.lit} />
      <path d='M43,37 V56 M53,37 V56' stroke={A.litDark} strokeWidth={1.6} />
      <circle cx={38} cy={46.5} r={3.4} fill={A.red} />
      <circle cx={48} cy={46.5} r={3.4} fill={A.amber} />
      <circle cx={58} cy={46.5} r={3.4} fill={A.blue} />
      <path d='M72,40 V52' {...stroke(A.ink, 2.6)} />
      <circle cx={72} cy={38} r={3.4} fill={A.red} />
      <rect x={38} y={59} width={20} height={3} rx={1.5} fill={A.ink} />
    </>
  ),
  'group-daily': () => (
    <>
      {[
        [A.lit, A.ink, A.lit],
        [A.ink, A.amber, A.lit],
        [A.lit, A.lit, A.ink],
      ].flatMap((row, r) =>
        row.map((fill, c) => (
          <rect key={`${r}${c}`} x={30 + c * 12} y={30 + r * 12} width={10.5} height={10.5} rx={2} fill={fill} />
        )),
      )}
    </>
  ),
} satisfies Record<string, () => ReactNode>;

/* Secrets: drawn in lit and colour, never ink, because the face is rail. */
const SECRET_GLYPHS = {
  unknown: () => (
    <>
      <path d='M37,40 Q37,27 49,27 Q61,27 61,38 Q61,46 50,50 Q48,51 48,55' {...stroke(A.lit, 7.5)} />
      <circle cx={48} cy={66} r={4.4} fill={A.lit} />
    </>
  ),
  dpad: () => <Dpad body={A.lit} center={A.red} />,
  'dpad-master': () => <Dpad body={A.amber} center={A.red} />,
  poke: () => (
    <>
      <Stub scale={0.4} rotate={-8} face={false} dx={1} />
      <g transform='rotate(-8 48 48)'>
        <path d='M38,41 L44,45 L38,49 M58,41 L52,45 L58,49' {...stroke(A.ink, 2.8)} />
        <path d='M40,56 Q43,53 46,56 Q49,59 52,56 Q55,53 58,56' {...stroke(A.ink, 2.8)} />
      </g>
      <path d='M23,38 L28,41 M21,48 H27 M23,58 L28,55 M73,38 L68,41 M75,48 H69 M73,58 L68,55' {...stroke(A.lit, 2.4)} />
    </>
  ),
  moon: () => (
    <>
      <path d='M52,24 A24,24 0 1 0 71,57 A19,19 0 1 1 52,24 Z' fill={A.lit} />
      <path d='M62,29 l1.8,4.2 4.2,1.8 -4.2,1.8 -1.8,4.2 -1.8,-4.2 -4.2,-1.8 4.2,-1.8 Z' fill={A.amber} />
      <path d='M70,45 l1.2,2.8 2.8,1.2 -2.8,1.2 -1.2,2.8 -1.2,-2.8 -2.8,-1.2 2.8,-1.2 Z' fill={A.amber} />
    </>
  ),
  sun: () => (
    <>
      <path d='M28,60 A20,20 0 0 1 68,60 Z' fill={A.amber} />
      <path d='M24,60 H72' {...stroke(A.lit, 3)} />
      <path d='M34,66 H62' {...stroke(A.litDark, 3)} />
      {[-150, -120, -90, -60, -30].map((deg) => {
        const [x1, y1] = polar(48, 60, 25, deg);
        const [x2, y2] = polar(48, 60, 31, deg);
        return <path key={deg} d={`M${x1},${y1} L${x2},${y2}`} {...stroke(A.amber, 3)} />;
      })}
    </>
  ),
  map: () => (
    <>
      <path d='M27,35 L41,30 L55,35 L69,30 V61 L55,66 L41,61 L27,66 Z' fill={A.litDark} />
      <path d='M27,35 L41,30 V61 L27,66 Z M55,35 L69,30 V61 L55,66 Z' fill={A.lit} />
      <path d='M33,57 Q40,44 48,50 T62,41' {...stroke(A.red, 2.4)} strokeDasharray='3.4 3.4' />
      <path d='M60,38 L65,44 M65,38 L60,44' {...stroke(A.red, 3)} />
    </>
  ),
  sprout: () => (
    <>
      <path d='M30,68 Q48,56 66,68 Z' fill={A.brassDark} />
      <path d='M48,64 V46' {...stroke(A.green, 4)} />
      <path d='M48,50 C40,50 33,45 32,36 C41,36 47,40 48,50 Z' fill={A.green} />
      <path d='M48,46 C48,36 54,30 64,30 C64,40 58,46 48,46 Z' fill={A.greenDark} />
    </>
  ),
  window: () => (
    <>
      <rect x={31} y={45} width={34} height={23} rx={2} fill={A.blue} />
      <rect x={31} y={45} width={34} height={4} fill={A.blueDark} />
      <path d='M48,49 V68' stroke={A.lit} strokeWidth={2} />
      <path d='M28,32 H68 L65,45 H31 Z' fill={A.red} />
      {[0, 1, 2, 3].map((i) => (
        <path key={i} d={`M${28 + i * 10 + 5},32 H${28 + i * 10 + 10} L${31 + i * 8.5 + 8.5},45 H${31 + i * 8.5 + 4.25} Z`} fill={A.lit} />
      ))}
      <rect x={52} y={54} width={9} height={9} rx={1.5} fill={A.amber} />
    </>
  ),
  hat: () => (
    <>
      <ellipse cx={48} cy={64} rx={22} ry={5.6} fill={A.blueDark} />
      <rect x={35} y={28} width={26} height={35} rx={3.5} fill={A.blue} />
      <rect x={35} y={50} width={26} height={7} fill={A.red} />
      <ellipse cx={48} cy={28} rx={13} ry={3.4} fill={A.blueDark} />
    </>
  ),
  mirror: () => (
    <>
      {[
        [0, 10, A.amber],
        [1, 20, A.brass],
        [2, 31, A.red],
        [3, 20, A.brass],
        [4, 10, A.amber],
      ].map(([i, h, fill]) => (
        <rect key={i as number} x={25 + (i as number) * 10.2} y={66 - (h as number)} width={8} height={h as number} rx={2} fill={fill as string} />
      ))}
      <path d='M48,24 V70' {...stroke(A.lit, 2)} strokeDasharray='3 3' />
    </>
  ),
  gem: () => (
    <>
      <path d='M36,31 H60 L69,45 H27 Z' fill={A.blue} />
      <path d='M27,45 H69 L48,70 Z' fill={A.blueDark} />
      <path d='M36,31 L41,45 L48,31 Z M60,31 L55,45 L48,31 Z' fill={A.lit} />
      <path d='M41,45 H55 L48,70 Z' fill={A.blue} />
    </>
  ),
  replay: () => (
    <>
      <path d={`M${polar(48, 48, 21, -50).join(',')} A21,21 0 1 0 ${polar(48, 48, 21, 40).join(',')}`} {...stroke(A.amber, 5.5)} />
      <path d='M62,22 L70,36 L54,36 Z' fill={A.amber} transform='rotate(18 62 33)' />
      <path d='M42,38 L58,48 L42,58 Z' fill={A.lit} />
    </>
  ),
  cake: () => (
    <>
      <rect x={30} y={55} width={36} height={13} rx={3} fill={A.litDark} />
      <rect x={30} y={44} width={36} height={14} rx={3} fill={A.lit} />
      <path d='M30,47 Q30,44 33,44 H63 Q66,44 66,47 V49 Q63,53 60,49 Q57,53 54,49 Q51,53 48,49 Q45,53 42,49 Q39,53 36,49 Q33,53 30,49 Z' fill={A.red} />
      <rect x={46} y={32} width={4} height={12} rx={1.5} fill={A.blue} />
      <path d='M48,21 C51,26 52.5,28 48,31.5 C43.5,28 45,26 48,21 Z' fill={A.amber} />
    </>
  ),
  burst: () => (
    <>
      {[0, 45, 90, 135, 180, 225, 270, 315].map((deg, i) => {
        const [x1, y1] = polar(48, 48, 9, deg);
        const [x2, y2] = polar(48, 48, i % 2 ? 16 : 21, deg);
        const [x3, y3] = polar(48, 48, i % 2 ? 22 : 27, deg);
        return (
          <g key={deg}>
            <path d={`M${x1},${y1} L${x2},${y2}`} {...stroke(i % 2 ? A.red : A.amber, 3.4)} />
            <circle cx={x3} cy={y3} r={2.2} fill={A.lit} />
          </g>
        );
      })}
      <circle cx={48} cy={48} r={4.4} fill={A.lit} />
    </>
  ),
  pie: () => (
    <>
      <path d='M45,52 L66,52 A21,21 0 1 1 63.2,41.5 Z' fill={A.brassDark} />
      <path d='M45,49.5 L66,49.5 A21,21 0 1 1 63.2,39 Z' fill={A.brass} />
      <path d='M45,49.5 L62,49.5 A17,17 0 1 1 59.8,40.6 Z' fill='none' stroke={A.brassDark} strokeWidth={1.8} strokeDasharray='2.6 2.4' />
      {[
        [38, 42],
        [50, 57],
        [36, 56],
      ].map(([x, y]) => (
        <circle key={`${x}${y}`} cx={x} cy={y} r={3.4} fill={A.red} />
      ))}
      <path d='M60,34 L70,28 L72,38 Z' fill={A.brass} />
    </>
  ),
  grass: () => (
    <>
      <path d='M24,67 H72' {...stroke(A.brass, 3.4)} />
      {[
        ['M34,66 Q34,52 27,44', A.green],
        ['M42,66 Q42,46 38,32', A.greenDark],
        ['M50,66 Q50,44 52,28', A.green],
        ['M58,66 Q58,50 65,40', A.greenDark],
        ['M66,66 Q64,56 70,52', A.green],
      ].map(([d, color]) => (
        <path key={d} d={d} {...stroke(color as string, 4.4)} />
      ))}
    </>
  ),
  eye: () => (
    <>
      <path d='M24,48 Q48,24 72,48 Q48,72 24,48 Z' fill={A.lit} />
      <circle cx={48} cy={48} r={11.5} fill={A.blue} />
      <circle cx={48} cy={48} r={5.6} fill={A.ink} />
      <circle cx={52.4} cy={43.6} r={2.4} fill={A.lit} />
    </>
  ),
} satisfies Record<string, () => ReactNode>;

function Dpad({ body, center }: { body: string; center: string }) {
  return (
    <>
      <path d='M41,29 H55 V41 H67 V55 H55 V67 H41 V55 H29 V41 H41 Z' fill={body} stroke={A.ink} strokeWidth={2.2} strokeLinejoin='round' />
      <path d='M48,33 L52.2,39 H43.8 Z M48,63 L52.2,57 H43.8 Z M33,48 L39,43.8 V52.2 Z M63,48 L57,43.8 V52.2 Z' fill={A.ink} />
      <circle cx={48} cy={48} r={4.2} fill={center} />
    </>
  );
}

export type BadgeGlyphId =
  | keyof typeof GLYPHS
  | keyof typeof SECRET_GLYPHS
  | keyof typeof MEDAL_GLYPHS;

const SECRET_IDS = new Set<string>(Object.keys(SECRET_GLYPHS));

/* Medal glyphs the badges reuse: the floor games and the stub. */
const REUSED = new Set<string>(['ticket', 'eight-ball', 'target', 'bell', 'pawn', 'claw', 'drop', 'cabinet', 'crown']);

export const BADGE_GLYPH_IDS: BadgeGlyphId[] = [
  ...(Object.keys(MEDAL_GLYPHS) as BadgeGlyphId[]),
  ...(Object.keys(GLYPHS) as BadgeGlyphId[]),
  ...(Object.keys(SECRET_GLYPHS) as BadgeGlyphId[]),
];

export const isSecretGlyph = (id: string) => SECRET_IDS.has(id);
export const isBadgeGlyph = (id: string): id is BadgeGlyphId =>
  id in GLYPHS || id in SECRET_GLYPHS || REUSED.has(id);

function drawGlyph(id: BadgeGlyphId): ReactNode {
  if (id in SECRET_GLYPHS) return SECRET_GLYPHS[id as keyof typeof SECRET_GLYPHS]();
  if (id in GLYPHS) return GLYPHS[id as keyof typeof GLYPHS]();
  return MEDAL_GLYPHS[id as keyof typeof MEDAL_GLYPHS]();
}

/* The rim: 5 arcs of 72 degrees with a 9 degree gap, the gap at the bottom
   centre where the pill sits. Tier n fills the first n arcs, going clockwise
   from the bottom. */
const RIM_R = 40.4;
const arc = (index: number) => {
  const gap = 9;
  const start = 90 + gap / 2 + index * 72;
  const end = start + 72 - gap;
  const [x1, y1] = polar(C, C, RIM_R, start);
  const [x2, y2] = polar(C, C, RIM_R, end);
  return `M${x1},${y1} A${RIM_R},${RIM_R} 0 0 1 ${x2},${y2}`;
};

function Rim({ tier, secret }: { tier: number; secret: boolean }) {
  if (secret) {
    return <circle cx={C} cy={C} r={RIM_R} fill='none' stroke={A.amber} strokeWidth={6} strokeDasharray='6.2 3.4' />;
  }
  if (tier <= 0) {
    return (
      <>
        <circle cx={C} cy={C} r={RIM_R} fill='none' stroke={A.brass} strokeWidth={6} />
        {[45, 135, 225, 315].map((deg) => {
          const [x, y] = polar(C, C, RIM_R, deg);
          return <circle key={deg} cx={x} cy={y} r={1.5} fill={A.ink} />;
        })}
      </>
    );
  }
  const fill = tier >= BADGE_TIERS ? A.red : A.amber;
  return (
    <>
      {Array.from({ length: BADGE_TIERS }, (_, i) => (
        <path key={i} d={arc(i)} fill='none' stroke={i < tier ? fill : A.ink2} strokeWidth={6} />
      ))}
    </>
  );
}

/* The number sits in a pill over the rim's gap. Big Shoulders, set by the app. */
function Chip({ tier }: { tier: number }) {
  return (
    <>
      <rect x={34} y={75.5} width={28} height={19} rx={9.5} fill={tier >= BADGE_TIERS ? A.red : A.ink} stroke={A.paper2} strokeWidth={2} />
      <text
        x={C}
        y={90.3}
        textAnchor='middle'
        fontSize={16}
        fontWeight={800}
        fill={A.lit}
        style={{ fontFamily: "var(--tixy-font-num, 'Big Shoulders'), system-ui, sans-serif" }}
      >
        {tier}
      </text>
    </>
  );
}

export function BadgeArt({
  glyph,
  tier = 0,
  locked = false,
  chip = true,
}: {
  glyph: BadgeGlyphId;
  /** 0 for a feat or a secret; 1 to 5 for a tier. */
  tier?: number;
  locked?: boolean;
  /** The number pill. Off for the exported art, which carries no digits. */
  chip?: boolean;
}) {
  const secret = isSecretGlyph(glyph);
  const series = !secret && tier > 0;
  const showChip = chip && series;
  return (
    <g opacity={locked ? 0.4 : undefined}>
      <circle cx={C} cy={C} r={44} fill={A.ink} />
      <Rim tier={tier} secret={secret} />
      <circle cx={C} cy={C} r={37.4} fill={secret ? A.rail : A.paper2} />
      <g transform={series ? 'translate(48 44) scale(1.1) translate(-48 -48)' : 'translate(48 48) scale(1.16) translate(-48 -48)'}>{drawGlyph(glyph)}</g>
      {showChip ? <Chip tier={tier} /> : null}
    </g>
  );
}

export function Badge({
  glyph,
  tier = 0,
  size = 48,
  locked = false,
  chip = true,
  className,
  title,
}: {
  glyph: BadgeGlyphId;
  tier?: number;
  size?: number;
  locked?: boolean;
  chip?: boolean;
  className?: string;
  /** Read by assistive tech. Omit for a decorative badge. */
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
      <BadgeArt glyph={glyph} tier={tier} locked={locked} chip={chip} />
    </svg>
  );
}

/* An achievement's `icon` field: "badge:<glyph>:<tier>". */
export const badgeRef = (glyph: BadgeGlyphId, tier: number) => `badge:${glyph}:${tier}`;

export function parseBadgeRef(ref: string): { glyph: BadgeGlyphId; tier: number } | null {
  const [scheme, glyph, tier] = ref.split(':');
  if (scheme !== 'badge' || !glyph || !isBadgeGlyph(glyph)) return null;
  const n = Number(tier ?? 0);
  return { glyph, tier: Number.isInteger(n) && n >= 0 && n <= BADGE_TIERS ? n : 0 };
}
