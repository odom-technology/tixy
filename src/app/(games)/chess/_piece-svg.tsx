'use client';

import { useId } from 'react';
import type { PieceCode } from '@/features/arcade/lib/chess';
import { mixHex, readableOn } from '@/features/arcade/lib/skins/skin-set';

/**
 * Chess piece SVGs loosely modeled on the Cburnett/Merida style used by
 * lichess and chess.com. 45×45 viewBox so the silhouette naturally fills a
 * square. Color props let the cosmetic theme drive both fill and stroke.
 *
 * Midway upgrade: each piece gets a per-instance vertical sheen gradient and
 * a soft inner darkening derived from `fill`, giving the silhouette a
 * sculpted, lacquered look with hard contrast — themeable, never glowing.
 * The base fill is preserved as the gradient's mid-stop so skins read true.
 */

/** The four piece shapes. `staunton` is the house set; the other three are
 *  skin-set shapes (SKINS.md): the same square, the same hit area. */
export type ChessPieceShape = 'staunton' | 'stub' | 'token' | 'block';

type PieceSvgProps = {
  piece: PieceCode;
  /** Body fill color (matches the piece's side). */
  fill: string;
  /** Outline color — typically the opposite side's color for contrast. */
  stroke: string;
  /** Size in px. Caller usually sets width/height based on square size. */
  size?: number;
  /** A skin set's piece shape. Left out, the house staunton set is drawn. */
  shape?: ChessPieceShape;
};

type PieceType = 'k' | 'q' | 'r' | 'b' | 'n' | 'p';

/** Render the correct piece glyph for a piece code. A skin set's shape
 *  other than staunton draws the piece as a flat body with the staunton
 *  silhouette as its glyph, so it reads at the same size. */
export function ChessPieceSvg({ piece, fill, stroke, size, shape }: PieceSvgProps) {
  const type = piece[1] as PieceType;
  if (shape && shape !== 'staunton') {
    return <GlyphPiece type={type} fill={fill} stroke={stroke} size={size} shape={shape} />;
  }
  return (
    <PieceShell fill={fill} stroke={stroke} size={size} flat={shape === 'staunton'} draw={() => ART[type](stroke)} />
  );
}

type ShapeProps = { fill: string; stroke: string; size?: number };

const VB = '0 0 45 45';

/** Reusable stroke props for every piece outline. */
const strokeStyle = (stroke: string, width = 1.5): React.SVGAttributes<SVGElement> => ({
  stroke,
  strokeWidth: width,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
});

/**
 * PieceShell wraps each piece with a per-instance vertical sheen gradient
 * (highlight top → true fill → deepened foot) so the silhouette reads as a
 * sculpted, lacquered face. `fill` stays the gradient's mid-stop so equipped
 * skins render true; `stroke` drives the outline. The gradient id is derived
 * from useId() so multiple boards on one page never collide. A skin set's
 * staunton is `flat`: one fill and the outline, no sheen.
 */
function PieceShell({
  fill,
  stroke,
  size,
  flat = false,
  draw,
}: ShapeProps & {
  flat?: boolean;
  draw: () => React.ReactNode;
}) {
  const rawId = useId();
  const id = rawId.replace(/[^a-zA-Z0-9_-]/g, '');
  const sheenId = `cp-sheen-${id}`;
  return (
    <svg
      viewBox={VB}
      width={size ?? '100%'}
      height={size ?? '100%'}
      xmlns='http://www.w3.org/2000/svg'
      style={{ display: 'block', pointerEvents: 'none' }}
    >
      {flat ? null : (
        <defs>
          <linearGradient id={sheenId} x1='0' y1='0' x2='0' y2='1'>
            <stop offset='0%' stopColor='#ffffff' stopOpacity='0.34' />
            <stop offset='16%' stopColor={fill} stopOpacity='1' />
            <stop offset='74%' stopColor={fill} stopOpacity='1' />
            <stop offset='100%' stopColor='#000000' stopOpacity='0.3' />
          </linearGradient>
        </defs>
      )}
      <g {...strokeStyle(stroke, 1.5)} fill={flat ? fill : `url(#${sheenId})`}>
        {draw()}
      </g>
    </svg>
  );
}

/* ── The staunton silhouettes. Each takes the outline colour, which the
   few detail marks (the knight's eye, the bishop's cross) are drawn in. ─ */

const pawn = () => (
  <path d='M 22.5 9 C 20.29 9 18.5 10.79 18.5 13 C 18.5 13.89 18.79 14.71 19.28 15.38 C 17.33 16.5 16 18.59 16 21 C 16 23.03 16.94 24.84 18.41 26.03 C 15.41 27.09 11 31.58 11 39.5 L 34 39.5 C 34 31.58 29.59 27.09 26.59 26.03 C 28.06 24.84 29 23.03 29 21 C 29 18.59 27.67 16.5 25.72 15.38 C 26.21 14.71 26.5 13.89 26.5 13 C 26.5 10.79 24.71 9 22.5 9 z' />
);

const rook = () => (
  <>
    <path d='M 9 39 L 36 39 L 36 36 L 9 36 L 9 39 z' />
    <path d='M 12 36 L 12 32 L 33 32 L 33 36 L 12 36 z' />
    <path d='M 11 14 L 11 9 L 15 9 L 15 11 L 20 11 L 20 9 L 25 9 L 25 11 L 30 11 L 30 9 L 34 9 L 34 14' />
    <path d='M 34 14 L 31 17 L 14 17 L 11 14' />
    <path d='M 31 17 L 31 29.5 L 14 29.5 L 14 17' />
    <path d='M 31 29.5 L 32.5 32 L 12.5 32 L 14 29.5' />
    <path d='M 11 14 L 34 14' strokeLinecap='butt' />
  </>
);

const bishop = (stroke: string) => (
  <>
    <g>
      <path d='M 9 36 C 12.39 35.03 19.11 36.43 22.5 34 C 25.89 36.43 32.61 35.03 36 36 C 36 36 37.65 36.54 39 38 C 38.32 38.97 37.35 38.99 36 38.5 C 32.61 37.53 25.89 38.96 22.5 37.5 C 19.11 38.96 12.39 37.53 9 38.5 C 7.65 38.99 6.68 38.97 6 38 C 7.35 36.54 9 36 9 36 z' />
      <path d='M 15 32 C 17.5 34.5 27.5 34.5 30 32 C 30.5 30.5 30 30 30 30 C 30 27.5 27.5 26 27.5 26 C 33 24.5 33.5 14.5 22.5 10.5 C 11.5 14.5 12 24.5 17.5 26 C 17.5 26 15 27.5 15 30 C 15 30 14.5 30.5 15 32 z' />
      <path d='M 25 8 A 2.5 2.5 0 1 1 20 8 A 2.5 2.5 0 1 1 25 8 z' />
    </g>
    <path d='M 17.5 26 L 27.5 26 M 15 30 L 30 30 M 22.5 15.5 L 22.5 20.5 M 20 18 L 25 18' stroke={stroke} strokeLinejoin='miter' />
  </>
);

const knight = (stroke: string) => (
  <>
    <path d='M 22,10 C 32.5,11 38.5,18 38,39 L 15,39 C 15,30 25,32.5 23,18' />
    <path d='M 24,18 C 24.38,20.91 18.45,25.37 16,27 C 13,29 13.18,31.34 11,31 C 9.958,30.06 12.41,27.96 11,28 C 10,28 11.19,29.23 10,30 C 9,30 5.997,31 6,26 C 6,24 12,14 12,14 C 12,14 13.89,12.1 14,10.5 C 13.27,9.506 13.5,8.5 13.5,7.5 C 14.5,5.5 16.5,4 16.5,4 C 16.5,4 18.55,2.454 19,2.5 C 20,2.5 19.08,5.25 19,5 C 19,5 24,3 25,5 C 25,5 21.5,7 23,10' />
    <path d='M 9.5 25.5 A 0.5 0.5 0 1 1 8.5 25.5 A 0.5 0.5 0 1 1 9.5 25.5 z' fill={stroke} stroke={stroke} />
    <path d='M 15 15.5 A 0.5 1.5 0 1 1 14 15.5 A 0.5 1.5 0 1 1 15 15.5 z' fill={stroke} stroke={stroke} transform='matrix(0.866,0.5,-0.5,0.866,9.693,-5.173)' />
  </>
);

const queen = () => (
  <>
    <path d='M 9 13 A 2 2 0 1 1 5 13 A 2 2 0 1 1 9 13 z' transform='translate(-1,-1)' />
    <path d='M 9 13 A 2 2 0 1 1 5 13 A 2 2 0 1 1 9 13 z' transform='translate(15.5,-5.5)' />
    <path d='M 9 13 A 2 2 0 1 1 5 13 A 2 2 0 1 1 9 13 z' transform='translate(32,-1)' />
    <path d='M 9 13 A 2 2 0 1 1 5 13 A 2 2 0 1 1 9 13 z' transform='translate(7,-4.5)' />
    <path d='M 9 13 A 2 2 0 1 1 5 13 A 2 2 0 1 1 9 13 z' transform='translate(24,-4)' />
    <path d='M 9,26 C 17.5,24.5 30,24.5 36,26 L 38,14 L 31,25 L 31,11 L 25.5,24.5 L 22.5,9.5 L 19.5,24.5 L 14,10.5 L 14,25 L 7,14 L 9,26 z' strokeLinecap='butt' />
    <path d='M 9,26 C 9,28 10.5,28 11.5,30 C 12.5,31.5 12.5,31 12,33.5 C 10.5,34.5 10.5,36 10.5,36 C 9,37.5 11,38.5 11,38.5 C 17.5,39.5 27.5,39.5 34,38.5 C 34,38.5 35.5,37.5 34,36 C 34,36 34.5,34.5 33,33.5 C 32.5,31 32.5,31.5 33.5,30 C 34.5,28 36,28 36,26 C 27.5,24.5 17.5,24.5 9,26 z' strokeLinecap='butt' />
    <path d='M 11.5,30 C 15,29 30,29 33.5,30' fill='none' />
    <path d='M 12,33.5 C 18,32.5 27,32.5 33,33.5' fill='none' />
  </>
);

const king = () => (
  <>
    <path d='M 22.5,11.63 L 22.5,6' fill='none' strokeLinejoin='miter' />
    <path d='M 20,8 L 25,8' fill='none' strokeLinejoin='miter' />
    <path d='M 22.5,25 C 22.5,25 27,17.5 25.5,14.5 C 25.5,14.5 24.5,12 22.5,12 C 20.5,12 19.5,14.5 19.5,14.5 C 18,17.5 22.5,25 22.5,25' strokeLinecap='butt' strokeLinejoin='miter' />
    <path d='M 12.5,37 C 18,40.5 27,40.5 32.5,37 L 32.5,30 C 32.5,30 41.5,25.5 38.5,19.5 C 34.5,13 25,16 22.5,23.5 L 22.5,27 L 22.5,23.5 C 19,16 9.5,13 6.5,19.5 C 3.5,25.5 12.5,30 12.5,30 L 12.5,37 z' />
    <path d='M 12.5,30 C 18,27 27,27 32.5,30' fill='none' />
    <path d='M 12.5,33.5 C 18,30.5 27,30.5 32.5,33.5' fill='none' />
    <path d='M 12.5,37 C 18,34 27,34 32.5,37' fill='none' />
  </>
);

const ART: Record<PieceType, (stroke: string) => React.ReactNode> = {
  p: pawn,
  r: rook,
  b: bishop,
  n: knight,
  q: queen,
  k: king,
};

/* ── A skin set's stub, token and block (SKINS.md) ──────────────────────
   One flat body in the piece's colour, the staunton silhouette as its
   glyph in ink or paper, whichever reads on the body. The body fills the
   same square as the staunton does, so hit areas and drags don't change. */

const INK = '#1f1a16';
const PAPER = '#f4ebdc';

/** The glyph colour on a body: ink or paper, by contrast. */
const glyphOn = (fill: string) => readableOn(fill, INK, PAPER);

/** A darker step of a body colour, for its lip and its stamped ring. */
const step = (fill: string) => mixHex(fill, glyphOn(fill), 0.28);

/** The staunton, shrunk into a body: filled in the glyph colour, with its
 *  inner marks cut in the body colour. */
function Glyph({ type, ink, body, scale, cx, cy }: { type: PieceType; ink: string; body: string; scale: number; cx: number; cy: number }) {
  return (
    <g
      transform={`translate(${cx} ${cy}) scale(${scale}) translate(-22.5 -21.5)`}
      fill={ink}
      stroke={body}
      strokeWidth={1.1 / scale}
      strokeLinecap='round'
      strokeLinejoin='round'
    >
      {ART[type](ink)}
    </g>
  );
}

function GlyphPiece({
  type,
  fill,
  stroke,
  size,
  shape,
}: {
  type: PieceType;
  fill: string;
  stroke: string;
  size?: number;
  shape: Exclude<ChessPieceShape, 'staunton'>;
}) {
  const ink = glyphOn(fill);
  let body: React.ReactNode;
  if (shape === 'token') {
    body = (
      <>
        <circle cx='22.5' cy='22.5' r='20' fill={fill} stroke={stroke} strokeWidth='1.5' />
        <circle cx='22.5' cy='22.5' r='17.2' fill='none' stroke={step(fill)} strokeWidth='1' />
        <Glyph type={type} ink={ink} body={fill} scale={0.7} cx={22.5} cy={22.5} />
      </>
    );
  } else if (shape === 'block') {
    body = (
      <>
        <rect x='4.5' y='8.5' width='36' height='32' rx='4' fill={step(fill)} stroke={stroke} strokeWidth='1.5' />
        <rect x='4.5' y='4.5' width='36' height='32' rx='4' fill={fill} stroke={stroke} strokeWidth='1.5' />
        <Glyph type={type} ink={ink} body={fill} scale={0.78} cx={22.5} cy={20.5} />
      </>
    );
  } else {
    // stub: a ticket stub with a notch each side and a perforation under
    // its tab, the glyph on the body below.
    const d =
      'M 8 3 H 37 A 2 2 0 0 1 39 5 V 8 A 3 3 0 0 0 39 14 V 40 A 2 2 0 0 1 37 42 H 8 A 2 2 0 0 1 6 40 V 14 A 3 3 0 0 0 6 8 V 5 A 2 2 0 0 1 8 3 Z';
    body = (
      <>
        <path d={d} fill={fill} stroke={stroke} strokeWidth='1.5' strokeLinejoin='round' />
        <path d='M 10 11 H 35' fill='none' stroke={step(fill)} strokeWidth='1.2' strokeDasharray='2 1.8' />
        <Glyph type={type} ink={ink} body={fill} scale={0.72} cx={22.5} cy={26.6} />
      </>
    );
  }
  return (
    <svg
      viewBox={VB}
      width={size ?? '100%'}
      height={size ?? '100%'}
      xmlns='http://www.w3.org/2000/svg'
      style={{ display: 'block', pointerEvents: 'none' }}
    >
      {body}
    </svg>
  );
}
