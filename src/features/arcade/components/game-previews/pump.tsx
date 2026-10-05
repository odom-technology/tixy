/* Hover preview for Pump (Balloon): an amber-enamel balloon inflates in a few
 * discrete steps — each pump bumps a mono multiplier readout — then bursts in a
 * sharp shard-and-flash pop and resets. Flat matte paints on dark ink, NO glow
 * / bloom (Midway cabinet). Pure CSS. Loops. Reduced-motion-safe. */
export default function PumpPreview() {
  return (
    <div className="absolute inset-0 overflow-hidden gp-pump-root">
      <div className="gp-pump-stage">
        {/* the balloon — scales up through the inflate steps, then pops */}
        <div className="gp-pump-balloon">
          <span className="gp-pump-gloss" />
          <span className="gp-pump-knot" />
          <span className="gp-pump-string" />
        </div>

        {/* burst: hard flash + enamel shards firing straight out */}
        <div className="gp-pump-burst" aria-hidden>
          <span className="gp-pump-flash" />
          {Array.from({ length: 10 }).map((_, i) => (
            <span
              key={i}
              className="gp-pump-shard"
              style={{ ['--gp-shard-rot' as string]: `${(i / 10) * 360}deg` }}
            />
          ))}
        </div>
      </div>

      {/* rising multiplier readout — one tick per pump, mono amber */}
      <div className="gp-pump-mult">
        <span className="gp-pump-mult-n gp-pump-mult-n0">1.05x</span>
        <span className="gp-pump-mult-n gp-pump-mult-n1">1.33x</span>
        <span className="gp-pump-mult-n gp-pump-mult-n2">1.84x</span>
        <span className="gp-pump-mult-n gp-pump-mult-n3">2.80x</span>
      </div>

      <style jsx>{`
        .gp-pump-root {
          background:
            radial-gradient(
              120% 90% at 50% 18%,
              color-mix(in srgb, var(--enamel-tickets) 8%, transparent),
              transparent 60%
            ),
            var(--screen-well, #120c07);
        }
        .gp-pump-stage {
          position: absolute;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        /* teardrop balloon: amber enamel body on dark ink, bevel via inset
           shadow (flat, no outer glow). Inflates in discrete steps. */
        .gp-pump-balloon {
          position: relative;
          width: 34%;
          aspect-ratio: 0.86 / 1;
          border-radius: 50% 50% 48% 48% / 56% 56% 44% 44%;
          background: radial-gradient(
            68% 60% at 36% 30%,
            color-mix(in srgb, #f2a33c 60%, #ffffff) 0%,
            #f2a33c 40%,
            #9a621a 100%
          );
          border: 2.5px solid #2a1b06;
          box-shadow:
            inset 5px -7px 12px rgba(122, 79, 23, 0.7),
            inset -3px 3px 9px rgba(255, 255, 255, 0.22);
          transform-origin: 50% 92%;
          animation: gp-pump-inflate 3.6s cubic-bezier(0.34, 1.56, 0.64, 1) infinite;
        }
        .gp-pump-gloss {
          position: absolute;
          top: 14%;
          left: 20%;
          width: 26%;
          height: 30%;
          border-radius: 50%;
          background: color-mix(in srgb, #fdf7ea 70%, transparent);
          opacity: 0.55;
        }
        .gp-pump-knot {
          position: absolute;
          left: 50%;
          bottom: -8px;
          transform: translateX(-50%);
          width: 0;
          height: 0;
          border-left: 6px solid transparent;
          border-right: 6px solid transparent;
          border-top: 9px solid #9a621a;
        }
        .gp-pump-string {
          position: absolute;
          left: 50%;
          bottom: -30%;
          transform: translateX(-50%);
          width: 2px;
          height: 26%;
          background: color-mix(in srgb, #f6eddc 50%, transparent);
        }

        .gp-pump-burst {
          position: absolute;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          pointer-events: none;
        }
        .gp-pump-flash {
          position: absolute;
          width: 34%;
          aspect-ratio: 1;
          border-radius: 50%;
          background: color-mix(in srgb, #fdf7ea 80%, transparent);
          opacity: 0;
          animation: gp-pump-flash 3.6s ease-out infinite;
        }
        .gp-pump-shard {
          position: absolute;
          width: 0;
          height: 0;
          border-left: 5px solid transparent;
          border-right: 5px solid transparent;
          border-bottom: 12px solid #f2a33c;
          opacity: 0;
          transform: rotate(var(--gp-shard-rot)) translateY(0) scale(0.6);
          animation: gp-pump-shard 3.6s cubic-bezier(0.2, 0.7, 0.4, 1) infinite;
        }

        .gp-pump-mult {
          position: absolute;
          right: 7%;
          bottom: 9%;
          font-family: var(--font-mono-arcade), monospace;
        }
        .gp-pump-mult-n {
          position: absolute;
          right: 0;
          bottom: 0;
          font-size: clamp(11px, 3.4vw, 20px);
          font-weight: 700;
          line-height: 1;
          color: #f2a33c;
          text-shadow: 0 1px 0 rgba(10, 7, 4, 0.85);
          opacity: 0;
          animation: gp-pump-tick 3.6s steps(1, end) infinite;
        }
        .gp-pump-mult-n0 {
          animation-name: gp-pump-tick0;
        }
        .gp-pump-mult-n1 {
          animation-name: gp-pump-tick1;
        }
        .gp-pump-mult-n2 {
          animation-name: gp-pump-tick2;
        }
        .gp-pump-mult-n3 {
          animation-name: gp-pump-tick3;
        }

        /* inflate: four discrete growth steps (each a tiny spring), hold near
           full, then the balloon vanishes at the pop and resets small. */
        @keyframes gp-pump-inflate {
          0%,
          4% {
            transform: scale(0.5);
            opacity: 1;
          }
          18%,
          22% {
            transform: scale(0.66);
          }
          40%,
          44% {
            transform: scale(0.84);
          }
          62%,
          78% {
            transform: scale(1.04);
            opacity: 1;
          }
          /* pop: gone in one frame, the burst takes over */
          79% {
            transform: scale(1.12);
            opacity: 0;
          }
          100% {
            transform: scale(0.5);
            opacity: 0;
          }
        }
        @keyframes gp-pump-flash {
          0%,
          78% {
            opacity: 0;
            transform: scale(0.5);
          }
          80% {
            opacity: 0.85;
            transform: scale(0.7);
          }
          90%,
          100% {
            opacity: 0;
            transform: scale(1.5);
          }
        }
        @keyframes gp-pump-shard {
          0%,
          78% {
            opacity: 0;
            transform: rotate(var(--gp-shard-rot)) translateY(0) scale(0.6);
          }
          80% {
            opacity: 1;
          }
          94%,
          100% {
            opacity: 0;
            transform: rotate(var(--gp-shard-rot)) translateY(-46px) scale(1)
              rotate(120deg);
          }
        }

        /* multiplier ticks: each value shows during its inflate step. */
        @keyframes gp-pump-tick0 {
          0%,
          18% {
            opacity: 1;
          }
          19%,
          100% {
            opacity: 0;
          }
        }
        @keyframes gp-pump-tick1 {
          0%,
          18% {
            opacity: 0;
          }
          19%,
          40% {
            opacity: 1;
          }
          41%,
          100% {
            opacity: 0;
          }
        }
        @keyframes gp-pump-tick2 {
          0%,
          40% {
            opacity: 0;
          }
          41%,
          62% {
            opacity: 1;
          }
          63%,
          100% {
            opacity: 0;
          }
        }
        @keyframes gp-pump-tick3 {
          0%,
          62% {
            opacity: 0;
          }
          63%,
          78% {
            opacity: 1;
          }
          79%,
          100% {
            opacity: 0;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .gp-pump-balloon,
          .gp-pump-flash,
          .gp-pump-shard,
          .gp-pump-mult-n {
            animation: none;
          }
          /* settle on a static mid-inflate balloon with the top readout */
          .gp-pump-balloon {
            transform: scale(0.9);
          }
          .gp-pump-mult-n3 {
            opacity: 1;
          }
        }
      `}</style>
    </div>
  );
}
