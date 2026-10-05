/* The tixy mark, wordmark and lockup as inline SVG. No font is needed: the
   letters are outlines from scripts/brand/outline-wordmark.py.

   Every component is decorative (aria-hidden) unless you pass `label`, which
   makes it an image with that name. Server and client safe: no hooks. */

import type { CSSProperties, SVGProps } from 'react';

import {
  APP_ICON,
  LOCKUP,
  MARK_FACE,
  MARK_HEIGHT,
  MARK_PERF,
  MARK_WIDTH,
  SMALL_FACE,
  SMALL_GRID,
  SMALL_GROUND_RADIUS,
  SMALL_STUB_PATH,
  STUB_PATH,
  TIXY_COLORS,
  WORDMARK,
} from './tixy-brand-geometry';
import { TIXY_WORDMARK_OUTLINE } from './tixy-wordmark-outline';

type BrandSvgProps = {
  className?: string;
  style?: CSSProperties;
  /* Accessible name. Leave it out when the parent already names the link. */
  label?: string;
};

function a11y(label?: string): SVGProps<SVGSVGElement> {
  return label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true, focusable: 'false' };
}

/* The mark's drawing in its own 120 x 72 units: stub, perforation, face.
   `eyes` wraps the two eyes in a <g> with those attributes, so the host can
   tag them for a blink without redrawing the mark. */
export function TixyMarkArt({
  perforation = true,
  eyes,
}: {
  perforation?: boolean;
  eyes?: SVGProps<SVGGElement> & Record<`data-${string}`, string>;
}) {
  const eyeDots = MARK_FACE.eyes.map(([cx, cy]) => (
    <circle key={cx} cx={cx} cy={cy} r={MARK_FACE.eyeRadius} fill={TIXY_COLORS.ink} />
  ));
  return (
    <>
      <path d={STUB_PATH} fill={TIXY_COLORS.ticket} />
      {perforation ? (
        <path
          d={MARK_PERF.d}
          stroke={TIXY_COLORS.ink}
          strokeWidth={MARK_PERF.width}
          strokeDasharray={MARK_PERF.dash}
          strokeLinecap='round'
        />
      ) : null}
      {eyes ? <g {...eyes}>{eyeDots}</g> : eyeDots}
      <path
        d={MARK_FACE.smile}
        fill='none'
        stroke={TIXY_COLORS.ink}
        strokeWidth={MARK_FACE.smileWidth}
        strokeLinecap='round'
      />
    </>
  );
}

/* The 16 px drawing's stub and face, in its 16 x 16 grid. */
function TixySmallMarkArt() {
  return (
    <>
      <path d={SMALL_STUB_PATH} fill={TIXY_COLORS.ticket} />
      {SMALL_FACE.eyes.map(([x, y]) => (
        <rect
          key={x}
          x={x}
          y={y}
          width={SMALL_FACE.eyeSize}
          height={SMALL_FACE.eyeSize}
          fill={TIXY_COLORS.ink}
        />
      ))}
      <path d={SMALL_FACE.smile} fill={TIXY_COLORS.ink} />
    </>
  );
}

/* The smiling stub on its own. `width` is in px; height follows (0.6). */
export function TixyMark({
  width = 40,
  perforation = true,
  className,
  style,
  label,
}: BrandSvgProps & { width?: number; perforation?: boolean }) {
  return (
    <svg
      xmlns='http://www.w3.org/2000/svg'
      viewBox={`0 0 ${MARK_WIDTH} ${MARK_HEIGHT}`}
      width={width}
      height={Math.round(((width * MARK_HEIGHT) / MARK_WIDTH) * 100) / 100}
      className={className}
      style={style}
      {...a11y(label)}
    >
      <TixyMarkArt perforation={perforation} />
    </svg>
  );
}

/* "tixy.lol" with the red full stop. The letters take `color`, which
   defaults to currentColor, so they follow the text colour: ink on paper,
   paper on a dark ground. `height` is in px; width follows. */
export function TixyWordmark({
  height = 24,
  color = 'currentColor',
  dotColor = TIXY_COLORS.red,
  className,
  style,
  label,
}: BrandSvgProps & { height?: number; color?: string; dotColor?: string }) {
  return (
    <svg
      xmlns='http://www.w3.org/2000/svg'
      viewBox={WORDMARK.viewBox}
      width={Math.round(((height * WORDMARK.width) / WORDMARK.height) * 100) / 100}
      height={height}
      className={className}
      style={style}
      {...a11y(label)}
    >
      <path d={TIXY_WORDMARK_OUTLINE.ink} fill={color} />
      <path d={TIXY_WORDMARK_OUTLINE.dot} fill={dotColor} />
    </svg>
  );
}

/* The lockup: the stub at -8 degrees, then "tixy.lol". One SVG, so it
   scales as a unit. `height` is in px; width follows. */
export function TixyLogo({
  height = 32,
  color = 'currentColor',
  dotColor = TIXY_COLORS.red,
  className,
  style,
  label,
}: BrandSvgProps & { height?: number; color?: string; dotColor?: string }) {
  return (
    <svg
      xmlns='http://www.w3.org/2000/svg'
      viewBox={LOCKUP.viewBox}
      width={Math.round(((height * LOCKUP.width) / LOCKUP.height) * 100) / 100}
      height={height}
      className={className}
      style={style}
      {...a11y(label)}
    >
      <g transform={LOCKUP.markTransform}>
        <TixyMarkArt />
      </g>
      <g transform={LOCKUP.textTransform}>
        <path d={TIXY_WORDMARK_OUTLINE.ink} fill={color} />
        <path d={TIXY_WORDMARK_OUTLINE.dot} fill={dotColor} />
      </g>
    </svg>
  );
}

/* The app icon: the stub, straight, on ink.
   shape: 'rounded' has transparent corners (favicons, manifest "any"),
   'square' is full bleed (apple-touch, iOS rounds it), 'maskable' is full
   bleed with the stub inside the safe circle.
   detail: 'small' is the 16 px drawing; 'full' keeps the perforation. */
export function TixyAppIcon({
  size = 512,
  shape = 'rounded',
  detail = 'full',
  className,
  style,
  label,
}: BrandSvgProps & {
  size?: number;
  shape?: 'rounded' | 'square' | 'maskable';
  detail?: 'full' | 'small';
}) {
  if (detail === 'small') {
    return (
      <svg
        xmlns='http://www.w3.org/2000/svg'
        viewBox={`0 0 ${SMALL_GRID} ${SMALL_GRID}`}
        width={size}
        height={size}
        className={className}
        style={style}
        {...a11y(label)}
      >
        <rect
          width={SMALL_GRID}
          height={SMALL_GRID}
          rx={shape === 'rounded' ? SMALL_GROUND_RADIUS : 0}
          fill={TIXY_COLORS.ink}
        />
        <TixySmallMarkArt />
      </svg>
    );
  }

  const box = 100;
  const markWidth = box * (shape === 'maskable' ? APP_ICON.maskableMarkScale : APP_ICON.markScale);
  const scale = markWidth / MARK_WIDTH;
  const markHeight = MARK_HEIGHT * scale;
  return (
    <svg
      xmlns='http://www.w3.org/2000/svg'
      viewBox={`0 0 ${box} ${box}`}
      width={size}
      height={size}
      className={className}
      style={style}
      {...a11y(label)}
    >
      <rect
        width={box}
        height={box}
        rx={shape === 'rounded' ? box * APP_ICON.roundedRadius : 0}
        fill={TIXY_COLORS.ink}
      />
      <g transform={`translate(${(box - markWidth) / 2} ${(box - markHeight) / 2}) scale(${scale})`}>
        <TixyMarkArt />
      </g>
    </svg>
  );
}
