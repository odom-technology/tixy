/* Blitz Tactics hover preview — the Midway chess board delivering a mate.
 *
 * Reuses the real game look (chess _midway-theme.ts palette + _piece-svg.tsx
 * sculpted silhouettes): cream/cocoa squares, espresso frame, cream vs espresso
 * pieces. Scene: a cornered black king; a cream queen slides in one square to
 * deliver checkmate; a red enamel "mate" ring pulses on the king and the amber
 * last-move wash lights the queen's origin + destination. Then the loop re-racks
 * — evoking the puzzle-rush "spot the mate" beat.
 *
 * Pure CSS/SVG/Tailwind, no JS/canvas. Mounted only on hover.
 */

import { createElement, useId } from 'react';

const VB = '0 0 45 45';
const strokeStyle = {
  strokeWidth: 1.5,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

type PieceProps = { fill: string; stroke: string };

function PieceShell({
  fill,
  stroke,
  draw,
}: PieceProps & { draw: (stroke: string) => React.ReactNode }) {
  const rawId = useId();
  const id = rawId.replace(/[^a-zA-Z0-9_-]/g, '');
  const sheenId = `gp-blitz-sheen-${id}`;
  return (
    <svg
      viewBox={VB}
      width="100%"
      height="100%"
      xmlns="http://www.w3.org/2000/svg"
      style={{ display: 'block', pointerEvents: 'none' }}
      aria-hidden
    >
      <defs>
        <linearGradient id={sheenId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.34" />
          <stop offset="16%" stopColor={fill} stopOpacity="1" />
          <stop offset="74%" stopColor={fill} stopOpacity="1" />
          <stop offset="100%" stopColor="#000000" stopOpacity="0.3" />
        </linearGradient>
      </defs>
      <g
        stroke={stroke}
        strokeWidth={strokeStyle.strokeWidth}
        strokeLinecap={strokeStyle.strokeLinecap}
        strokeLinejoin={strokeStyle.strokeLinejoin}
        fill={`url(#${sheenId})`}
      >
        {draw(stroke)}
      </g>
    </svg>
  );
}

function Queen({ fill, stroke }: PieceProps) {
  return (
    <PieceShell
      fill={fill}
      stroke={stroke}
      draw={() => (
        <>
          <path d="M 9 13 A 2 2 0 1 1 5 13 A 2 2 0 1 1 9 13 z" transform="translate(-1,-1)" />
          <path d="M 9 13 A 2 2 0 1 1 5 13 A 2 2 0 1 1 9 13 z" transform="translate(15.5,-5.5)" />
          <path d="M 9 13 A 2 2 0 1 1 5 13 A 2 2 0 1 1 9 13 z" transform="translate(32,-1)" />
          <path d="M 9 13 A 2 2 0 1 1 5 13 A 2 2 0 1 1 9 13 z" transform="translate(7,-4.5)" />
          <path d="M 9 13 A 2 2 0 1 1 5 13 A 2 2 0 1 1 9 13 z" transform="translate(24,-4)" />
          <path d="M 9,26 C 17.5,24.5 30,24.5 36,26 L 38,14 L 31,25 L 31,11 L 25.5,24.5 L 22.5,9.5 L 19.5,24.5 L 14,10.5 L 14,25 L 7,14 L 9,26 z" strokeLinecap="butt" />
          <path d="M 9,26 C 9,28 10.5,28 11.5,30 C 12.5,31.5 12.5,31 12,33.5 C 10.5,34.5 10.5,36 10.5,36 C 9,37.5 11,38.5 11,38.5 C 17.5,39.5 27.5,39.5 34,38.5 C 34,38.5 35.5,37.5 34,36 C 34,36 34.5,34.5 33,33.5 C 32.5,31 32.5,31.5 33.5,30 C 34.5,28 36,28 36,26 C 27.5,24.5 17.5,24.5 9,26 z" strokeLinecap="butt" />
          <path d="M 11.5,30 C 15,29 30,29 33.5,30" fill="none" />
          <path d="M 12,33.5 C 18,32.5 27,32.5 33,33.5" fill="none" />
        </>
      )}
    />
  );
}

function King({ fill, stroke }: PieceProps) {
  return (
    <PieceShell
      fill={fill}
      stroke={stroke}
      draw={() => (
        <>
          <path d="M 22.5,11.63 L 22.5,6" fill="none" strokeLinejoin="miter" />
          <path d="M 20,8 L 25,8" fill="none" strokeLinejoin="miter" />
          <path d="M 22.5,25 C 22.5,25 27,17.5 25.5,14.5 C 25.5,14.5 24.5,12 22.5,12 C 20.5,12 19.5,14.5 19.5,14.5 C 18,17.5 22.5,25 22.5,25" strokeLinecap="butt" strokeLinejoin="miter" />
          <path d="M 12.5,37 C 18,40.5 27,40.5 32.5,37 L 32.5,30 C 32.5,30 41.5,25.5 38.5,19.5 C 34.5,13 25,16 22.5,23.5 L 22.5,27 L 22.5,23.5 C 19,16 9.5,13 6.5,19.5 C 3.5,25.5 12.5,30 12.5,30 L 12.5,37 z" />
          <path d="M 12.5,30 C 18,27 27,27 32.5,30" fill="none" />
          <path d="M 12.5,33.5 C 18,30.5 27,30.5 32.5,33.5" fill="none" />
          <path d="M 12.5,37 C 18,34 27,34 32.5,37" fill="none" />
        </>
      )}
    />
  );
}

const PIECE_MAP = { queen: Queen, king: King } as const;
type PieceName = keyof typeof PIECE_MAP;

function Piece({ name, fill, stroke }: { name: PieceName } & PieceProps) {
  return createElement(PIECE_MAP[name], { fill, stroke });
}

/* Midway default palette (from chess _midway-theme.ts) */
const LIGHT_SQ = '#e9d3a8';
const DARK_SQ = '#a06a3f';
const FRAME = '#1c130a';
const WHITE_FILL = '#f6eddc';
const WHITE_STROKE = '#3a2614';
const BLACK_FILL = '#241a10';
const BLACK_STROKE = '#f3e7cf';

export default function BlitzTacticsPreview() {
  return (
    <div className="absolute inset-0 overflow-hidden gp-blitz-root">
      <div className="gp-blitz-board">
        <div className="gp-blitz-squares" />

        {/* amber last-move wash on the queen's origin (e6) + destination (g6) */}
        <div className="gp-blitz-lastmove gp-blitz-lm-from" />
        <div className="gp-blitz-lastmove gp-blitz-lm-to" />

        {/* red enamel mate ring pulsing on the cornered black king (h8) */}
        <div className="gp-blitz-matering" />

        {/* cornered black king on h8 */}
        <div className="gp-blitz-piece gp-blitz-king">
          <Piece name="king" fill={BLACK_FILL} stroke={BLACK_STROKE} />
        </div>

        {/* cream queen: e6 → g6, delivering mate */}
        <div className="gp-blitz-piece gp-blitz-queen">
          <Piece name="queen" fill={WHITE_FILL} stroke={WHITE_STROKE} />
        </div>
      </div>

      <style jsx>{`
        .gp-blitz-root {
          background: var(--screen-well);
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .gp-blitz-board {
          position: relative;
          width: 78%;
          height: 78%;
          border-radius: 4px;
          background: linear-gradient(150deg, #3a2614, ${FRAME});
          padding: 4.2%;
          box-shadow: inset 0 1px 0 rgba(74, 56, 34, 0.55),
            inset 0 -2px 5px rgba(0, 0, 0, 0.6), 0 5px 14px rgba(0, 0, 0, 0.5);
        }
        .gp-blitz-squares {
          position: absolute;
          inset: 4.2%;
          border-radius: 1px;
          overflow: hidden;
          background-color: ${LIGHT_SQ};
          background-image: conic-gradient(
            ${DARK_SQ} 90deg,
            transparent 90deg 180deg,
            ${DARK_SQ} 180deg 270deg,
            transparent 270deg
          );
          background-size: 25% 25%;
          background-position: 0 0;
          box-shadow: inset 0 0 10px rgba(28, 19, 10, 0.55);
        }
        /* one square = 11.45% of the board; center (file f, rank r from top,
           0-indexed) at left = 4.2% + (f+0.5)*11.45%, top = 4.2% + (r+0.5)*11.45%.
           h8 = file 7, rank 0. e6 = file 4, rank 2. g6 = file 6, rank 2. */
        .gp-blitz-lastmove {
          position: absolute;
          width: 11.45%;
          height: 11.45%;
          border-radius: 1px;
          background: rgba(242, 163, 60, 0.42);
          box-shadow: inset 0 0 0 1px rgba(242, 163, 60, 0.3);
          z-index: 2;
          opacity: 0;
          animation: gp-blitz-lm 4.2s ease-in-out infinite;
        }
        .gp-blitz-lm-from {
          left: 55.6%;
          top: 32.85%;
        }
        .gp-blitz-lm-to {
          left: 78.5%;
          top: 32.85%;
        }
        .gp-blitz-matering {
          position: absolute;
          width: 11.45%;
          height: 11.45%;
          left: 89.95%;
          top: 9.95%;
          border-radius: 50%;
          box-shadow: inset 0 0 0 2px rgba(199, 53, 56, 0.9),
            0 0 8px rgba(199, 53, 56, 0.6);
          z-index: 2;
          opacity: 0;
          animation: gp-blitz-mate 4.2s ease-in-out infinite;
        }
        .gp-blitz-piece {
          position: absolute;
          width: 11.45%;
          height: 11.45%;
          left: 0;
          top: 0;
          display: flex;
          align-items: flex-end;
          justify-content: center;
          filter: drop-shadow(0 1.5px 1.5px rgba(0, 0, 0, 0.5));
          z-index: 3;
        }
        .gp-blitz-piece :global(svg) {
          width: 112%;
          height: 112%;
          transform: translateY(6%);
        }
        /* black king cornered on h8 */
        .gp-blitz-king {
          left: 89.95%;
          top: 9.95%;
          z-index: 4;
        }
        /* cream queen slides e6 → g6 to give mate */
        .gp-blitz-queen {
          left: 55.6%;
          top: 32.85%;
          z-index: 5;
          animation: gp-blitz-queen 4.2s cubic-bezier(0.35, 0, 0.25, 1) infinite;
        }
        @keyframes gp-blitz-queen {
          0%,
          14% {
            left: 55.6%;
            transform: translateY(0) scale(1);
          }
          34% {
            left: 78.5%;
            transform: translateY(-6%) scale(1.05);
          }
          40% {
            left: 78.5%;
            transform: translateY(2%) scale(0.96);
          }
          46%,
          90% {
            left: 78.5%;
            transform: translateY(0) scale(1);
          }
          100% {
            left: 55.6%;
            transform: translateY(0) scale(1);
          }
        }
        @keyframes gp-blitz-lm {
          0%,
          30% {
            opacity: 0;
          }
          42%,
          88% {
            opacity: 1;
          }
          96%,
          100% {
            opacity: 0;
          }
        }
        @keyframes gp-blitz-mate {
          0%,
          38% {
            opacity: 0;
            transform: scale(0.8);
          }
          46% {
            opacity: 1;
            transform: scale(1.1);
          }
          54%,
          86% {
            opacity: 0.85;
            transform: scale(1);
          }
          94%,
          100% {
            opacity: 0;
            transform: scale(0.8);
          }
        }
      `}</style>
    </div>
  );
}
