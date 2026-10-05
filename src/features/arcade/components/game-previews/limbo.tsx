'use client';

/* Limbo hover preview — emulates the real Limbo screen
   (src/app/(games)/limbo/_limbo-client.tsx). The player sets a target
   multiplier; a big mono multiplier readout climbs from ×1.00 like a rocket
   while a beveled rocket token rides a recessed horizontal gauge left→right
   (log-scaled altitude). An amber target line sits at ×2.00; when the rolled
   crash-point clears it the fill + readout paint prize-teal and the rocket
   parks past the line. This loop launches against ×2.00 and lands a winning
   ×3.42. Flat enamel, nothing glows. */

const TARGET = 2; // amber target line
const PEAK = 3.42; // a winning crash-point past the target
const MAX = 1000; // gauge ceiling (matches LIMBO_MAX_TARGET)

// Log-scaled gauge position (matches gaugePct in the real client).
function gaugePct(m: number): number {
  const clamped = Math.min(MAX, Math.max(1, m));
  return Math.min(100, Math.max(0, (Math.log10(clamped) / Math.log10(MAX)) * 100));
}

const TARGET_X = gaugePct(TARGET);
const PEAK_X = gaugePct(PEAK);

export default function LimboPreview() {
  return (
    <div className='absolute inset-0 overflow-hidden gp-limbo-root'>
      {/* target chip + big mono multiplier readout */}
      <div className='gp-limbo-readout'>
        <span className='gp-limbo-target-label'>TARGET ×2.00</span>
        <span className='gp-limbo-num' />
        <span className='gp-limbo-tag' />
      </div>

      {/* the launch gauge */}
      <div className='gp-limbo-gauge'>
        <div className='gp-limbo-rail' />
        <div className='gp-limbo-fill' style={{ ['--peak-x' as string]: `${PEAK_X}%` }} />
        <div className='gp-limbo-target' style={{ left: `${TARGET_X}%` }} />
        <div className='gp-limbo-rocket' style={{ ['--peak-x' as string]: `${PEAK_X}%` }}>
          {/* lucide-style rocket glyph, hand-drawn so the preview stays pure CSS/SVG */}
          <svg viewBox='0 0 24 24' aria-hidden='true'>
            <path d='M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z' />
            <path d='m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z' />
            <path d='M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0' />
            <path d='M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5' />
          </svg>
        </div>
      </div>

      <style jsx>{`
        .gp-limbo-root {
          background:
            repeating-linear-gradient(
              0deg,
              transparent 0 calc(12.5% - 1px),
              #ffffff0a calc(12.5% - 1px) 12.5%
            ),
            var(--screen-well);
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 9%;
          padding: 0 8%;
        }
        .gp-limbo-readout {
          display: flex;
          flex-direction: column;
          align-items: center;
          line-height: 1;
        }
        .gp-limbo-target-label {
          font-family: var(--font-mono-arcade);
          font-weight: 600;
          font-size: clamp(7px, 2.2vw, 10px);
          letter-spacing: 0.06em;
          color: var(--text-faint);
          margin-bottom: 6px;
        }
        .gp-limbo-num {
          font-family: var(--font-mono-arcade);
          font-weight: 700;
          font-size: clamp(28px, 10vw, 52px);
          line-height: 1;
          color: var(--enamel-prize-text);
          text-shadow: 0 1px 8px rgba(0, 0, 0, 0.6);
          animation: gp-limbo-ink 3.2s steps(1, end) infinite;
        }
        .gp-limbo-num::after {
          content: '×1.00';
          animation: gp-limbo-vals 3.2s steps(1, end) infinite;
        }
        .gp-limbo-tag {
          margin-top: 5px;
          font-family: var(--font-mono-arcade);
          font-weight: 600;
          font-size: clamp(7px, 2.4vw, 11px);
          letter-spacing: 0.04em;
          color: var(--enamel-prize-text);
          opacity: 0;
          animation: gp-limbo-tag-show 3.2s steps(1, end) infinite;
        }
        .gp-limbo-tag::after {
          content: 'CLEARED ×2.00';
        }
        .gp-limbo-gauge {
          position: relative;
          width: 100%;
          max-width: 86%;
          height: clamp(16px, 5vw, 26px);
          border: 1.5px solid var(--border-ink);
          border-radius: var(--radius-well, 6px);
          background: var(--surface-well);
          box-shadow: inset 0 2px 5px #000000aa, inset 0 0 0 1px #ffffff10;
          overflow: hidden;
        }
        .gp-limbo-rail {
          position: absolute;
          inset: 0;
          background: repeating-linear-gradient(
            90deg,
            transparent 0 calc(10% - 1px),
            #ffffff0c calc(10% - 1px) 10%
          );
        }
        .gp-limbo-fill {
          position: absolute;
          left: 0;
          top: 0;
          bottom: 0;
          width: 0;
          background: var(--enamel-prize);
          opacity: 0.9;
          border-right: 2px solid var(--enamel-prize-edge, var(--border-ink));
          animation: gp-limbo-climb 3.2s cubic-bezier(0.33, 0, 0.3, 1) infinite;
        }
        .gp-limbo-target {
          position: absolute;
          top: 0;
          bottom: 0;
          width: 3px;
          transform: translateX(-50%);
          background: var(--enamel-tickets);
          border-left: 1px solid var(--border-ink);
          border-right: 1px solid var(--border-ink);
          z-index: 3;
        }
        .gp-limbo-rocket {
          position: absolute;
          top: 50%;
          left: 0;
          width: clamp(14px, 4.5vw, 22px);
          height: clamp(14px, 4.5vw, 22px);
          transform: translate(-50%, -50%) rotate(90deg);
          z-index: 4;
          filter: drop-shadow(0 1px 2px #00000080);
          animation: gp-limbo-fly 3.2s cubic-bezier(0.33, 0, 0.3, 1) infinite;
        }
        .gp-limbo-rocket svg {
          width: 100%;
          height: 100%;
          fill: none;
          stroke: var(--enamel-prize-text);
          stroke-width: 2;
          stroke-linecap: round;
          stroke-linejoin: round;
        }

        /* readout climbs through the same values the gauge sweeps, then holds */
        @keyframes gp-limbo-vals {
          0% { content: '×1.00'; }
          14% { content: '×1.21'; }
          28% { content: '×1.58'; }
          42% { content: '×2.04'; }
          56% { content: '×2.61'; }
          68% { content: '×3.08'; }
          76%, 100% { content: '×3.42'; }
        }
        /* readout stays prize-teal throughout — this loop is a win */
        @keyframes gp-limbo-ink {
          0%, 100% { color: var(--enamel-prize-text); }
        }
        @keyframes gp-limbo-tag-show {
          0%, 75% { opacity: 0; }
          76%, 100% { opacity: 1; }
        }
        /* fill sweeps left→right to the peak altitude, then holds */
        @keyframes gp-limbo-climb {
          0% { width: 0; }
          76%, 100% { width: var(--peak-x); }
        }
        @keyframes gp-limbo-fly {
          0% { left: 0; }
          76%, 100% { left: var(--peak-x); }
        }

        @media (prefers-reduced-motion: reduce) {
          .gp-limbo-num,
          .gp-limbo-num::after,
          .gp-limbo-tag,
          .gp-limbo-fill,
          .gp-limbo-rocket {
            animation: none;
          }
          /* park the scene on the settled winning frame */
          .gp-limbo-num::after { content: '×3.42'; }
          .gp-limbo-tag { opacity: 1; }
          .gp-limbo-fill { width: ${PEAK_X}%; }
          .gp-limbo-rocket { left: ${PEAK_X}%; }
        }
      `}</style>
    </div>
  );
}
