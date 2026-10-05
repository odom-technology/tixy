'use client';

/* Crash hover preview — emulates the real crash screen
   (src/app/(games)/crash/_crash-client.tsx):
   a log-scaled exponential multiplier curve climbs left→right across a
   recessed grid well, painted flat enamel that shifts with the real readout
   thresholds — teal (--enamel-prize) under ×2, amber (--enamel-tickets) past
   ×2, danger red (--enamel-danger) past ×10 — while the big mono multiplier
   rises through those same values, then a hard red wash + cabinet shake marks
   the crash. The curve path mirrors the game's buildCurvePath()
   (y = H − t^1.7 · top · H, top = log(m)/log(25)) over a 100×100 viewBox with
   preserveAspectRatio='none'. Nothing glows. */

/* Curve geometry copied from the real client so the shape matches exactly. */
const CURVE_W = 100;
const CURVE_H = 100;

function climb01(m: number): number {
  return Math.min(1, Math.log(Math.max(1, m)) / Math.log(25));
}

function buildCurvePath(current: number): string {
  const top = climb01(current);
  if (top <= 0) return `M 0 ${CURVE_H} L 2 ${CURVE_H}`;
  const steps = 28;
  let d = `M 0 ${CURVE_H}`;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const x = (t * CURVE_W).toFixed(2);
    const y = (CURVE_H - Math.pow(t, 1.7) * top * CURVE_H).toFixed(2);
    d += ` L ${x} ${y}`;
  }
  return d;
}

function curveHead(current: number): { x: number; y: number } {
  return { x: CURVE_W, y: CURVE_H - climb01(current) * CURVE_H };
}

// The crash point the preview climbs to (red zone, past ×10).
const PEAK = 12.4;
const PEAK_PATH = buildCurvePath(PEAK);
const PEAK_HEAD = curveHead(PEAK);
// Full-area fill path (curve closed down to the floor) for the enamel wash.
const PEAK_FILL = `${PEAK_PATH} L ${CURVE_W} ${CURVE_H} Z`;

export default function CrashPreview() {
  return (
    <div className='absolute inset-0 overflow-hidden gp-crash-root'>
      <div className='gp-crash-grid' aria-hidden>
        <svg
          className='gp-crash-svg'
          viewBox={`0 0 ${CURVE_W} ${CURVE_H}`}
          preserveAspectRatio='none'
          role='presentation'
        >
          {/* enamel wash under the curve */}
          <path className='gp-crash-fill' d={PEAK_FILL} />
          {/* the painted curve line — drawn on via dash offset */}
          <path
            className='gp-crash-curve'
            d={PEAK_PATH}
            fill='none'
            vectorEffect='non-scaling-stroke'
            strokeLinecap='round'
            strokeLinejoin='round'
          />
          {/* head rivet riding the curve tip */}
          <circle
            className='gp-crash-head'
            cx={PEAK_HEAD.x}
            cy={PEAK_HEAD.y}
            r={2.6}
            vectorEffect='non-scaling-stroke'
          />
        </svg>
      </div>

      <div className='gp-crash-num'>
        <span className='gp-crash-mult' />
      </div>

      <div className='gp-crash-flash' aria-hidden />

      <style jsx>{`
        .gp-crash-root {
          background:
            repeating-linear-gradient(
              0deg,
              transparent 0 calc(12.5% - 1px),
              #ffffff0a calc(12.5% - 1px) 12.5%
            ),
            repeating-linear-gradient(
              90deg,
              transparent 0 calc(10% - 1px),
              #ffffff0a calc(10% - 1px) 10%
            ),
            var(--screen-well);
          animation: gp-crash-shake 3.4s ease-in-out infinite;
        }
        .gp-crash-grid {
          position: absolute;
          inset: 8px;
          border: 1px solid #00000060;
          border-radius: 4px;
          box-shadow: inset 0 2px 10px #000000aa, inset 0 0 0 1px #ffffff08;
          overflow: hidden;
        }
        .gp-crash-svg {
          width: 100%;
          height: 100%;
          display: block;
        }
        /* curve + fill recolor on the real thresholds via keyframed CSS vars */
        .gp-crash-fill,
        .gp-crash-curve,
        .gp-crash-head {
          --paint: var(--enamel-prize);
          animation: gp-crash-paint 3.4s steps(1, end) infinite;
        }
        .gp-crash-fill {
          fill: var(--paint);
          fill-opacity: 0.14;
          clip-path: inset(0 100% 0 0);
          animation:
            gp-crash-paint 3.4s steps(1, end) infinite,
            gp-crash-reveal 3.4s cubic-bezier(0.55, 0, 0.85, 0.4) infinite;
        }
        .gp-crash-curve {
          stroke: var(--paint);
          stroke-width: 2.4;
          stroke-dasharray: 260;
          stroke-dashoffset: 260;
          animation:
            gp-crash-paint 3.4s steps(1, end) infinite,
            gp-crash-draw 3.4s cubic-bezier(0.55, 0, 0.85, 0.4) infinite;
        }
        .gp-crash-head {
          fill: var(--paint);
          stroke: var(--border-ink);
          stroke-width: 0.8;
          animation:
            gp-crash-paint 3.4s steps(1, end) infinite,
            gp-crash-head 3.4s cubic-bezier(0.55, 0, 0.85, 0.4) infinite;
        }
        .gp-crash-num {
          position: absolute;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 2;
        }
        .gp-crash-mult {
          font-family: var(--font-mono-arcade);
          font-weight: 700;
          letter-spacing: 0.01em;
          line-height: 1;
          color: var(--enamel-prize-text);
          text-shadow: 0 1px 8px rgba(0, 0, 0, 0.65);
          animation:
            gp-crash-vals 3.4s steps(1, end) infinite,
            gp-crash-ink 3.4s steps(1, end) infinite,
            gp-crash-grow 3.4s steps(1, end) infinite;
        }
        .gp-crash-mult::after {
          content: '×1.00';
          animation: gp-crash-vals 3.4s steps(1, end) infinite;
        }
        .gp-crash-flash {
          position: absolute;
          inset: 0;
          z-index: 3;
          background: var(--enamel-danger);
          mix-blend-mode: screen;
          opacity: 0;
          animation: gp-crash-flash 3.4s ease-out infinite;
        }

        /* draw the curve as the number climbs (0 → ~82% of the loop) */
        @keyframes gp-crash-draw {
          0% {
            stroke-dashoffset: 260;
          }
          82%,
          100% {
            stroke-dashoffset: 0;
          }
        }
        @keyframes gp-crash-reveal {
          0% {
            clip-path: inset(0 100% 0 0);
          }
          82%,
          100% {
            clip-path: inset(0 0 0 0);
          }
        }
        @keyframes gp-crash-head {
          0% {
            opacity: 0;
            transform: translate(-100px, 96px);
          }
          8% {
            opacity: 1;
          }
          82% {
            opacity: 1;
            transform: translate(0, 0);
          }
          84%,
          100% {
            opacity: 0;
          }
        }
        /* paint recolors the curve on the real ×2 / ×10 thresholds */
        @keyframes gp-crash-paint {
          0% {
            --paint: var(--enamel-prize);
          }
          36% {
            --paint: var(--enamel-tickets);
          }
          66%,
          100% {
            --paint: var(--enamel-danger);
          }
        }
        @keyframes gp-crash-ink {
          0% {
            color: var(--enamel-prize-text);
          }
          36% {
            color: var(--enamel-tickets-text);
          }
          66%,
          84% {
            color: var(--enamel-danger-text);
          }
          84.01%,
          100% {
            color: var(--enamel-danger-on, #fff);
          }
        }
        /* the number "grows" as the rocket climbs, like multiplierSize() */
        @keyframes gp-crash-grow {
          0% {
            font-size: clamp(20px, 7vw, 34px);
          }
          50% {
            font-size: clamp(24px, 8.5vw, 42px);
          }
          66%,
          82% {
            font-size: clamp(30px, 11vw, 54px);
          }
          84%,
          100% {
            font-size: clamp(30px, 11vw, 54px);
          }
        }
        @keyframes gp-crash-vals {
          0% {
            content: '×1.00';
          }
          12% {
            content: '×1.32';
          }
          24% {
            content: '×1.71';
          }
          36% {
            content: '×2.24';
          }
          48% {
            content: '×3.10';
          }
          58% {
            content: '×4.65';
          }
          66% {
            content: '×8.90';
          }
          74% {
            content: '×11.4';
          }
          80%,
          82% {
            content: '×12.40';
          }
          84%,
          100% {
            content: 'CRASH';
          }
        }
        @keyframes gp-crash-flash {
          0%,
          82% {
            opacity: 0;
          }
          84% {
            opacity: 0.5;
          }
          92%,
          100% {
            opacity: 0;
          }
        }
        /* cabinet shake fires on the crash, like .crash-screen--crashed */
        @keyframes gp-crash-shake {
          0%,
          82%,
          100% {
            transform: translateX(0);
          }
          84% {
            transform: translateX(-4px);
          }
          86% {
            transform: translateX(4px);
          }
          88% {
            transform: translateX(-3px);
          }
          90% {
            transform: translateX(2px);
          }
          92% {
            transform: translateX(0);
          }
        }
      `}</style>
    </div>
  );
}
