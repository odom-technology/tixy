/* The floor's game screens.
 *
 * Every floor game's art is one 160 x 100 SVG screen, the same size and
 * colours as the mockup's cabinets (docs/design/tixy-rebrand/build-mockup.mjs),
 * drawn flat in the palette. It has two modes. At rest (`still`) it holds one
 * chosen frame of its move: the floor, the ? sheet and the no-WebGL pictures
 * show that. On a pointer or focus the floor mounts it without `still`, and
 * it plays its one move once, 300 to 900 ms, and holds the last frame.
 * Nothing loops.
 *
 * A game's file draws its screen and puts `move()` on the parts that move.
 * Moves are shared keyframes (kit.css) steered by CSS variables, so a game
 * file holds geometry and timing only. A still is the same markup with every
 * move paused `rest` ms in, so there is one drawing per game and no raster.
 */

import type { CSSProperties, ReactNode } from 'react';

import './kit.css';

/** The mockup's screen palette. The six brand colours plus the screen tones
 *  game art uses (PLAN.md: game art can use any colour). */
export const C = {
  paper: '#F4EBDC',
  ink: '#1F1A16',
  amber: '#F2A33C',
  red: '#B83627',
  felt: '#2E7566',
  cushion: '#245E52',
  rail: '#2B2119',
  screen: '#2A231D',
  screen2: '#3A3029',
  dim: '#4A3D33',
  lit: '#F7E7C6',
  tan: '#E0C08A',
  brass: '#C9A25A',
  green: '#7FB069',
  blue: '#4F7FC0',
  hole: '#100C09',
} as const;

export const EASE = {
  /** Springs overshoot a little (PLAN.md, Motion). */
  spring: 'cubic-bezier(.2,1.5,.4,1)',
  /** Anything that slows to a stop. */
  out: 'cubic-bezier(.15,.8,.25,1)',
  /** Falls under gravity and bounces once. */
  drop: 'cubic-bezier(.5,0,.6,1.6)',
  /** Accelerates, for a fall that ends off the screen. */
  fall: 'cubic-bezier(.5,0,1,.6)',
  linear: 'linear',
} as const;

/** The longest a move may end, delay included (PLAN.md: 300 to 900 ms). */
export const MOVE_BUDGET_MS = 900;

const FONT_NUM = "var(--font-big-shoulders, 'Big Shoulders'), var(--font-gabarito, 'Gabarito'), sans-serif";
const FONT_TEXT = "var(--font-gabarito, 'Gabarito'), system-ui, sans-serif";


/** Props of a floor game's screen. */
export type PreviewProps = { still?: boolean };

export type MoveName =
  | 'from'
  | 'to'
  | 'hop'
  | 'pop'
  | 'on'
  | 'off'
  | 'flip-out'
  | 'flip-in'
  | 'turn'
  | 'thunk'
  | 'shake'
  | 'dash';

type MoveOptions = {
  delay?: number;
  ease?: string;
  /** Offsets in screen units (the 160 x 100 viewBox): --x, --y, --lift. */
  x?: number;
  y?: number;
  lift?: number;
  /** Scale at the far end (from/to) or the peak (pop). */
  s?: number;
  /** Degrees, for from/to/turn. */
  r?: number;
  /** Starting opacity (from/on) or ending opacity (to). */
  o?: number;
  /** stroke-dashoffset start and end, for dash. */
  dash?: [number, number];
  /** Rotate or scale around this viewBox point instead of the element's centre. */
  origin?: [number, number];
  /** Extra CSS variables a game's own keyframes read. */
  vars?: Record<string, string | number>;
};

/**
 * Style for one moving part. Use a custom keyframe name for a move the
 * shared set can't express (the plinko ball's path); pass its CSS to
 * <PreviewScreen css>.
 */
export function move(name: MoveName | (string & {}), ms: number, opts: MoveOptions = {}): CSSProperties {
  const { delay = 0, ease = EASE.out } = opts;
  if (process.env.NODE_ENV !== 'production' && delay + ms > MOVE_BUDGET_MS) {
    console.warn(`game preview move "${name}" ends at ${delay + ms} ms, past ${MOVE_BUDGET_MS} ms`);
  }
  const vars: Record<string, string | number> = { ...opts.vars };
  if (opts.x != null) vars['--x'] = `${opts.x}px`;
  if (opts.y != null) vars['--y'] = `${opts.y}px`;
  if (opts.lift != null) vars['--lift'] = `${opts.lift}px`;
  if (opts.s != null) vars['--s'] = opts.s;
  if (opts.r != null) vars['--r'] = `${opts.r}deg`;
  if (opts.o != null) vars['--o'] = opts.o;
  if (opts.dash) {
    vars['--from'] = opts.dash[0];
    vars['--to'] = opts.dash[1];
  }
  const keyframes = name.startsWith('gp-') ? name : `gpk-${name}`;
  // A still shifts every delay back by --rest (set on the screen), so a
  // paused move shows the frame `rest` ms in. Playing, --rest is unset: 0.
  return {
    ...(vars as CSSProperties),
    animationName: keyframes,
    animationDuration: `${ms}ms`,
    animationTimingFunction: ease,
    animationDelay: `calc(${delay}ms - var(--rest, 0ms))`,
    animationIterationCount: 1,
    animationFillMode: 'both',
    ...(opts.origin
      ? { transformBox: 'view-box', transformOrigin: `${opts.origin[0]}px ${opts.origin[1]}px` }
      : null),
  };
}

/** The screen: a 160 x 100 SVG on the ink screen tone. The tile's ink bezel
 *  and the flicker-on come from the floor (tixy-home.css). With `still`, the
 *  screen holds the frame `rest` ms into the move (0 is the first frame). */
export function PreviewScreen({
  children,
  css,
  still,
  rest = 0,
}: {
  children: ReactNode;
  css?: string;
  still?: boolean;
  rest?: number;
}) {
  return (
    <div className='absolute inset-0 overflow-hidden' style={{ background: C.screen }} data-game-screen={still ? 'still' : 'live'}>
      <svg
        className={still ? 'gpk gpk-still block size-full' : 'gpk block size-full'}
        style={still ? ({ '--rest': `${rest}ms` } as CSSProperties) : undefined}
        viewBox='0 0 160 100'
        preserveAspectRatio='xMidYMid slice'
        aria-hidden='true'
      >
        {css ? <style>{css}</style> : null}
        <rect width='160' height='100' fill={C.screen} />
        {children}
      </svg>
    </div>
  );
}

/** A moving group. `className` gpk-m centres scale and rotate on the group. */
export function Part({ style, children }: { style: CSSProperties; children: ReactNode }) {
  return (
    <g className='gpk-m' style={style}>
      {children}
    </g>
  );
}

type TextProps = {
  x: number;
  y: number;
  size: number;
  fill: string;
  anchor?: 'start' | 'middle' | 'end';
  weight?: number;
  children: ReactNode;
};

/** A number, in Big Shoulders. */
export function Num({ x, y, size, fill, anchor = 'middle', weight = 800, children }: TextProps) {
  return (
    <text x={x} y={y} fontSize={size} fill={fill} textAnchor={anchor} fontWeight={weight} style={{ fontFamily: FONT_NUM }}>
      {children}
    </text>
  );
}

/** A word or a card face, in Gabarito. */
export function Word({ x, y, size, fill, anchor = 'middle', weight = 800, children }: TextProps) {
  return (
    <text x={x} y={y} fontSize={size} fill={fill} textAnchor={anchor} fontWeight={weight} style={{ fontFamily: FONT_TEXT }}>
      {children}
    </text>
  );
}

/** Points on a circle, for rings of bulbs and drums. Angle 0 is 12 o'clock. */
export function ring(count: number, cx: number, cy: number, r: number) {
  return Array.from({ length: count }, (_, i) => {
    const a = (i / count) * Math.PI * 2 - Math.PI / 2;
    return { x: +(cx + Math.cos(a) * r).toFixed(2), y: +(cy + Math.sin(a) * r).toFixed(2) };
  });
}
