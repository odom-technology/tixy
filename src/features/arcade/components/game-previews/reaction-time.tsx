/* Hover preview for Reaction Time. Mirrors the real game flow exactly: the
 * beveled enamel stage panel holds on the "wait" red (#dc2626), flips to the
 * "go" green (#16a34a), a tap ripple fires, then the mono split-millisecond
 * readout settles to a value (formatMs style: 2 decimals + "ms", tickets-color).
 * Five attempt pips fill across the loop (TRIALS = 5). Pure CSS, loops. */
export default function ReactionTimePreview() {
  return (
    <div className="absolute inset-0 overflow-hidden">
      <div className="gp-reaction-stage">
        <div className="gp-reaction-panel">
          <div className="gp-reaction-ripple" />
          <div className="gp-reaction-readout">
            <span className="gp-reaction-ms-num">214.30</span>
            <span className="gp-reaction-ms-unit">ms</span>
          </div>
        </div>

        <div className="gp-reaction-pips">
          <span className="gp-reaction-pip gp-reaction-pip-1" />
          <span className="gp-reaction-pip gp-reaction-pip-2" />
          <span className="gp-reaction-pip gp-reaction-pip-3" />
          <span className="gp-reaction-pip gp-reaction-pip-4" />
          <span className="gp-reaction-pip gp-reaction-pip-5" />
        </div>
      </div>

      <style jsx>{`
        .gp-reaction-stage {
          position: absolute;
          inset: 12% 10%;
          border-radius: var(--radius-well, 10px);
        }

        /* the beveled enamel lit surface — backgroundColor is animated between
         * the real ready/red and go/green; bevels match the real .rt-stage. */
        .gp-reaction-panel {
          position: absolute;
          inset: 0;
          border-radius: var(--radius-well, 10px);
          background: #dc2626;
          box-shadow: inset 0 3px 0 rgba(255, 255, 255, 0.18),
            inset 0 -5px 10px rgba(0, 0, 0, 0.33),
            inset 0 0 0 1px rgba(0, 0, 0, 0.31), 0 2px 0 var(--bevel-hi, #ffffff22);
          animation: gp-reaction-flip 3.4s ease-in-out infinite;
        }

        .gp-reaction-ripple {
          position: absolute;
          left: 50%;
          top: 50%;
          width: 32%;
          aspect-ratio: 1;
          border-radius: 999px;
          border: 2px solid rgba(255, 255, 255, 0.9);
          opacity: 0;
          transform: translate(-50%, -50%) scale(0.4);
          animation: gp-reaction-tap 3.4s ease-out infinite;
        }

        .gp-reaction-readout {
          position: absolute;
          left: 50%;
          top: 50%;
          transform: translate(-50%, -50%);
          display: flex;
          align-items: baseline;
          gap: 0.16em;
          font-family: var(--font-mono-arcade), monospace;
          font-variant-numeric: tabular-nums;
          letter-spacing: -0.01em;
          color: var(--enamel-tickets, #f2a33c);
          text-shadow: 0 2px 0 rgba(0, 0, 0, 0.33);
          opacity: 0;
          animation: gp-reaction-readout 3.4s ease-out infinite;
        }
        .gp-reaction-ms-num {
          font-size: 1.05rem;
          font-weight: 700;
        }
        .gp-reaction-ms-unit {
          font-size: 0.6rem;
          opacity: 0.75;
        }

        /* attempt pips: inset round seats that fill across the loop */
        .gp-reaction-pips {
          position: absolute;
          top: -9%;
          right: 0;
          display: flex;
          gap: 5px;
        }
        .gp-reaction-pip {
          width: 11px;
          height: 11px;
          border-radius: var(--radius-round, 999px);
          border: 1px solid var(--border-ink, #00000080);
          background: rgba(0, 0, 0, 0.4);
          box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.56);
        }
        .gp-reaction-pip-1 {
          animation: gp-reaction-pip 3.4s steps(1, end) infinite;
          animation-delay: 0s;
        }
        .gp-reaction-pip-2 {
          animation: gp-reaction-pip 3.4s steps(1, end) infinite;
          animation-delay: 0.1s;
        }
        .gp-reaction-pip-3 {
          animation: gp-reaction-pip 3.4s steps(1, end) infinite;
          animation-delay: 0.2s;
        }
        .gp-reaction-pip-4 {
          animation: gp-reaction-pip 3.4s steps(1, end) infinite;
          animation-delay: 0.3s;
        }
        .gp-reaction-pip-5 {
          animation: gp-reaction-pip 3.4s steps(1, end) infinite;
          animation-delay: 0.4s;
        }

        @keyframes gp-reaction-flip {
          /* hold on the real WAIT red */
          0%,
          52% {
            background: #dc2626;
          }
          /* flip to the real GO green */
          56%,
          92% {
            background: #16a34a;
          }
          /* back to red, reset for next loop */
          96%,
          100% {
            background: #dc2626;
          }
        }

        @keyframes gp-reaction-tap {
          0%,
          56% {
            opacity: 0;
            transform: translate(-50%, -50%) scale(0.4);
          }
          60% {
            opacity: 0.9;
            transform: translate(-50%, -50%) scale(0.55);
          }
          78%,
          100% {
            opacity: 0;
            transform: translate(-50%, -50%) scale(1.1);
          }
        }

        @keyframes gp-reaction-readout {
          0%,
          60% {
            opacity: 0;
            transform: translate(-50%, calc(-50% + 3px));
          }
          66% {
            opacity: 1;
            transform: translate(-50%, calc(-50% - 1px));
          }
          74%,
          92% {
            opacity: 1;
            transform: translate(-50%, -50%);
          }
          100% {
            opacity: 0;
            transform: translate(-50%, -50%);
          }
        }

        /* each pip lights at a staggered moment, then all reset together */
        @keyframes gp-reaction-pip {
          0%,
          59% {
            background: rgba(0, 0, 0, 0.4);
            box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.56);
          }
          60%,
          100% {
            background: var(--enamel-tickets, #f2a33c);
            box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.33),
              0 1px 2px rgba(0, 0, 0, 0.38);
          }
        }
      `}</style>
    </div>
  );
}
