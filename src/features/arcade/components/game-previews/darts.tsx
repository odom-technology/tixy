/* Hover preview for Darts: the real Midway dartboard rendered as concentric
 * enamel rings on a lacquered-wood cabinet, using the game's exact ZONES colors
 * and RING_RADII proportions (see _darts-client.tsx). A steel dart throws in
 * from the bottom, lands near the bullseye, an impact ripple pops, and a "+100"
 * score readout flashes in the game's mono font. Loop re-throws.
 *
 * Real ring colors (outer -> inner), matched 1:1 to the game's ZONES array:
 *   Outer #5fc06a, Outer-single #2fb8a6, Single #3b6fd4, Treble/double #9a52d6,
 *   ... inner-bull #f2a33c, bullseye #c73538. RING_RADII ratios reused exactly.
 * No JS logic, no state, no hooks — pure CSS/SVG. */
export default function DartsPreview() {
  return (
    <div className="absolute inset-0 overflow-hidden">
      <div className="gp-darts-stage">
        <svg viewBox="0 0 200 200" className="gp-darts-svg" aria-hidden>
          {/* Lacquered-wood cabinet surround */}
          <circle cx={100} cy={100} r={99} fill="#1b140c" />
          <circle cx={100} cy={100} r={96} fill="#261d13" stroke="#0a0704" strokeWidth={1.5} />
          {/* Brass rim ring (warm enamel-cabinet rim) */}
          <circle cx={100} cy={100} r={92} fill="none" stroke="#b78a48" strokeWidth={3} />
          <circle cx={100} cy={100} r={89.5} fill="none" stroke="rgba(0,0,0,0.5)" strokeWidth={0.8} />

          {/* Rings outer -> inner, exact ZONES colors + RING_RADII (x90) */}
          <circle cx={100} cy={100} r={90} fill="#4a3722" stroke="#0a0704" strokeWidth={0.9} />
          <circle cx={100} cy={100} r={77.4} fill="#5fc06a" stroke="#0a0704" strokeWidth={0.9} />
          <circle cx={100} cy={100} r={61.2} fill="#2fb8a6" stroke="#0a0704" strokeWidth={0.9} />
          <circle cx={100} cy={100} r={46.8} fill="#3b6fd4" stroke="#0a0704" strokeWidth={0.9} />
          <circle cx={100} cy={100} r={34.2} fill="#9a52d6" stroke="#0a0704" strokeWidth={0.9} />
          <circle cx={100} cy={100} r={23.4} fill="#e8a23a" stroke="#0a0704" strokeWidth={0.9} />
          <circle cx={100} cy={100} r={14.4} fill="#f2a33c" stroke="#0a0704" strokeWidth={0.9} />
          {/* Bullseye */}
          <circle cx={100} cy={100} r={7.2} fill="#c73538" stroke="#0a0704" strokeWidth={0.9} />

          {/* Spider wires between rings — warm brass frets */}
          <g fill="none" stroke="rgba(243,220,174,0.26)" strokeWidth={0.5}>
            <circle cx={100} cy={100} r={77.4} />
            <circle cx={100} cy={100} r={61.2} />
            <circle cx={100} cy={100} r={46.8} />
            <circle cx={100} cy={100} r={34.2} />
            <circle cx={100} cy={100} r={23.4} />
            <circle cx={100} cy={100} r={14.4} />
          </g>
          {/* Radial spider spokes */}
          <g stroke="rgba(10,7,4,0.4)" strokeWidth={0.5}>
            <line x1={100} y1={10} x2={100} y2={190} />
            <line x1={10} y1={100} x2={190} y2={100} />
            <line x1={36.3} y1={36.3} x2={163.7} y2={163.7} />
            <line x1={163.7} y1={36.3} x2={36.3} y2={163.7} />
          </g>

          {/* Overhead lighting sheen */}
          <radialGradient id="gpDartsSheen" cx="36%" cy="30%" r="85%">
            <stop offset="0%" stopColor="rgba(255,247,234,0.16)" />
            <stop offset="45%" stopColor="rgba(255,247,234,0.04)" />
            <stop offset="100%" stopColor="rgba(0,0,0,0.3)" />
          </radialGradient>
          <circle cx={100} cy={100} r={90} fill="url(#gpDartsSheen)" />
        </svg>

        {/* Impact ripple at the landing spot (near the bullseye) */}
        <span className="gp-darts-ripple" />

        {/* The dart: steel needle tip, knurled barrel, red enamel flights */}
        <div className="gp-darts-dart">
          <span className="gp-darts-tip" />
          <span className="gp-darts-barrel" />
          <span className="gp-darts-flight" />
        </div>

        {/* Score readout pop, mono font + enamel red accent */}
        <div className="gp-darts-score">+100</div>
      </div>

      <style jsx>{`
        .gp-darts-stage {
          position: absolute;
          top: 50%;
          left: 50%;
          width: 78%;
          aspect-ratio: 1;
          transform: translate(-50%, -50%);
        }
        .gp-darts-svg {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          overflow: visible;
        }

        /* Landing spot: just above + left of dead center, near the bullseye. */
        .gp-darts-ripple {
          position: absolute;
          top: 44%;
          left: 46%;
          width: 14%;
          aspect-ratio: 1;
          transform: translate(-50%, -50%) scale(0.3);
          border-radius: 999px;
          border: 2px solid #c73538;
          opacity: 0;
          animation: gp-darts-ripple 2.8s ease-out infinite;
        }

        .gp-darts-dart {
          position: absolute;
          top: 44%;
          left: 46%;
          width: 9%;
          height: 36%;
          transform: translate(-50%, -100%);
          transform-origin: 50% 100%;
          /* fly in from below, drive into the board, stick, then reset */
          animation: gp-darts-throw 2.8s cubic-bezier(0.45, 0, 0.2, 1) infinite;
        }
        /* Needle tip (cream gloss -> steel) pointing up into the board */
        .gp-darts-tip {
          position: absolute;
          top: 0;
          left: 50%;
          transform: translateX(-50%);
          width: 0;
          height: 0;
          border-left: 3px solid transparent;
          border-right: 3px solid transparent;
          border-bottom: 12px solid #fdf7ea;
        }
        /* Knurled steel barrel */
        .gp-darts-barrel {
          position: absolute;
          top: 11px;
          left: 50%;
          transform: translateX(-50%);
          width: 22%;
          height: 38%;
          border-radius: 2px;
          background: linear-gradient(90deg, #8a7c63, #f3dcae 45%, #4a3722);
        }
        /* Red enamel flights (twin fins) */
        .gp-darts-flight {
          position: absolute;
          bottom: 0;
          left: 50%;
          transform: translateX(-50%);
          width: 70%;
          height: 46%;
          clip-path: polygon(50% 0, 100% 22%, 60% 100%, 50% 70%, 40% 100%, 0 22%);
          background: linear-gradient(180deg, #d34b4e, #98262a);
        }

        .gp-darts-score {
          position: absolute;
          top: 18%;
          left: 70%;
          font-family: var(--font-mono-arcade), monospace;
          font-size: 0.95rem;
          font-weight: 700;
          color: var(--text-strong, #fdf7ea);
          text-shadow: 0 1px 0 #0a0704, 0 0 8px rgba(199, 53, 56, 0.55);
          opacity: 0;
          transform-origin: center;
          animation: gp-darts-score 2.8s ease-out infinite;
        }

        @keyframes gp-darts-throw {
          0% {
            transform: translate(-50%, 60%) scale(1.25);
            opacity: 0;
          }
          10% {
            opacity: 1;
          }
          /* drive into the board near the bullseye */
          40% {
            transform: translate(-50%, -100%) scale(1);
            opacity: 1;
          }
          /* tiny recoil bounce, then stick */
          45% {
            transform: translate(-50%, -94%) scale(1);
          }
          50%,
          84% {
            transform: translate(-50%, -100%) scale(1);
            opacity: 1;
          }
          94%,
          100% {
            transform: translate(-50%, -100%) scale(1);
            opacity: 0;
          }
        }

        @keyframes gp-darts-ripple {
          0%,
          40% {
            opacity: 0;
            transform: translate(-50%, -50%) scale(0.3);
          }
          44% {
            opacity: 0.9;
            transform: translate(-50%, -50%) scale(0.5);
          }
          60% {
            opacity: 0;
            transform: translate(-50%, -50%) scale(1.8);
          }
          100% {
            opacity: 0;
            transform: translate(-50%, -50%) scale(1.8);
          }
        }

        @keyframes gp-darts-score {
          0%,
          42% {
            opacity: 0;
            transform: translateY(5px) scale(0.8);
          }
          50% {
            opacity: 1;
            transform: translateY(-2px) scale(1.12);
          }
          64% {
            opacity: 1;
            transform: translateY(-5px) scale(1);
          }
          82%,
          100% {
            opacity: 0;
            transform: translateY(-9px) scale(1);
          }
        }
      `}</style>
    </div>
  );
}
