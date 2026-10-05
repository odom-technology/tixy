/* Hover preview for Pangram: a Midway honeycomb — six cream "key" hexes ringing
 * an amber-enamel center hex. Each loop, a few hexes depress in sequence as a
 * word is "typed", the center pulses, then they reset. Pure CSS, no JS/state.
 * Matches the real game's enamel mapping (center = amber, outer = cream/wood).
 * No glow; reduced-motion-safe (animations disabled under prefers-reduced-motion). */
export default function PangramPreview() {
  // Outer ring letters + their depress-order (1..6); center is required.
  const outer = [
    { ch: 'R', x: 50, y: 8, order: 2 },
    { ch: 'T', x: 86, y: 30, order: 4 },
    { ch: 'P', x: 86, y: 70, order: 0 },
    { ch: 'L', x: 50, y: 92, order: 3 },
    { ch: 'N', x: 14, y: 70, order: 0 },
    { ch: 'E', x: 14, y: 30, order: 1 },
  ];

  return (
    <div className="absolute inset-0 overflow-hidden">
      <div className="gp-pg-comb">
        {/* center enamel hex */}
        <span className="gp-pg-hex gp-pg-center">
          <span className="gp-pg-face">A</span>
        </span>
        {outer.map((o, i) => (
          <span
            key={i}
            className={`gp-pg-hex gp-pg-outer${o.order > 0 ? ` gp-pg-o${o.order}` : ''}`}
            style={{ left: `${o.x}%`, top: `${o.y}%` }}
          >
            <span className="gp-pg-face">{o.ch}</span>
          </span>
        ))}
      </div>

      <style jsx>{`
        .gp-pg-comb {
          position: absolute;
          inset: 8%;
          margin: auto;
        }
        .gp-pg-hex {
          position: absolute;
          width: 30%;
          aspect-ratio: 1 / 1.1547;
          transform: translate(-50%, -50%);
        }
        .gp-pg-center {
          left: 50%;
          top: 50%;
          animation: gp-pg-pulse 3.2s ease-in-out infinite;
        }
        .gp-pg-face {
          display: grid;
          place-items: center;
          width: 100%;
          height: 100%;
          clip-path: polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%);
          font-family: var(--font-display, 'Bungee', system-ui, sans-serif);
          font-size: clamp(7px, 3vw, 15px);
          text-transform: uppercase;
        }
        .gp-pg-outer .gp-pg-face {
          color: #1b140d;
          background: linear-gradient(180deg, #fdf7ea, #f6eddc);
          box-shadow: inset 0 2px 0 #fffaf0, inset 0 -4px 6px #c9b791,
            0 4px 0 #6b5631;
        }
        .gp-pg-center .gp-pg-face {
          color: #2a1b06;
          background: linear-gradient(180deg, #f7bd5e, #f2a33c);
          box-shadow: inset 0 2px 0 rgba(255, 255, 255, 0.33),
            inset 0 -4px 6px rgba(0, 0, 0, 0.25), 0 4px 0 #9a621a;
        }

        /* Each "typed" outer hex depresses in sequence, then releases. */
        .gp-pg-o1 .gp-pg-face { animation: gp-pg-press 3.2s ease-in-out infinite; animation-delay: 0.2s; }
        .gp-pg-o2 .gp-pg-face { animation: gp-pg-press 3.2s ease-in-out infinite; animation-delay: 0.6s; }
        .gp-pg-o3 .gp-pg-face { animation: gp-pg-press 3.2s ease-in-out infinite; animation-delay: 1s; }
        .gp-pg-o4 .gp-pg-face { animation: gp-pg-press 3.2s ease-in-out infinite; animation-delay: 1.4s; }

        @keyframes gp-pg-press {
          0%, 8% { transform: translateY(0); filter: brightness(1); }
          14%, 22% { transform: translateY(3px); filter: brightness(1.08); }
          30%, 100% { transform: translateY(0); filter: brightness(1); }
        }
        @keyframes gp-pg-pulse {
          0%, 45% { transform: translate(-50%, -50%) scale(1); }
          60% { transform: translate(-50%, -50%) scale(1.07); }
          75%, 100% { transform: translate(-50%, -50%) scale(1); }
        }

        @media (prefers-reduced-motion: reduce) {
          .gp-pg-center,
          .gp-pg-o1 .gp-pg-face,
          .gp-pg-o2 .gp-pg-face,
          .gp-pg-o3 .gp-pg-face,
          .gp-pg-o4 .gp-pg-face {
            animation: none;
          }
        }
      `}</style>
    </div>
  );
}
