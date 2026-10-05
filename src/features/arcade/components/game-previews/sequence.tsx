/* Hover preview for Sequence Memory — emulates the real game's tactile Midway
 * panel: four enamel pads (red --enamel-primary #c73538, amber --enamel-tickets
 * #f2a33c, teal --enamel-prize #2fb8a6, blue --enamel-info #6c8fe0) in a 2×2
 * grid on a cream bezel with hard bevels. The pads flash a growing sequence —
 * red, then red→amber, then red→amber→teal — exactly as round N shows the first
 * N pads. On "flash" a pad brightens its enamel FACE (opacity/brightness only);
 * NOTHING GLOWS (Midway rule). transform/opacity/filter only; loops cheaply. */
export default function SequencePreview() {
  return (
    <div className="absolute inset-0 overflow-hidden gp-seq">
      <div className="gp-seq-bezel">
        <div className="gp-seq-pad gp-seq-red" />
        <div className="gp-seq-pad gp-seq-amber" />
        <div className="gp-seq-pad gp-seq-teal" />
        <div className="gp-seq-pad gp-seq-blue" />
      </div>

      <style jsx>{`
        .gp-seq {
          background: var(--screen-well);
          display: grid;
          place-items: center;
        }
        /* cream bezel cabinet face the pads sit in */
        .gp-seq-bezel {
          position: relative;
          width: 66%;
          aspect-ratio: 1 / 1;
          display: grid;
          grid-template-columns: 1fr 1fr;
          grid-template-rows: 1fr 1fr;
          gap: 7%;
          padding: 7%;
          border-radius: 12px;
          background: linear-gradient(180deg, #f6eddc 0%, #e4d6bb 100%);
          box-shadow:
            inset 0 2px 0 #fffdf6,
            inset 0 -3px 0 #c9b89980,
            0 3px 0 #00000040,
            0 8px 16px #00000055;
        }
        .gp-seq-pad {
          border-radius: 8px;
          /* resting enamel face: a beveled paint chip (top hi / bottom shade),
             dimmed so the flash reads as a brighten of the SAME face. */
          box-shadow:
            inset 0 3px 2px rgba(255, 255, 255, 0.4),
            inset 0 -4px 5px rgba(0, 0, 0, 0.4),
            inset 0 0 0 1px rgba(0, 0, 0, 0.25);
          filter: brightness(0.62);
          will-change: filter, transform;
        }
        /* enamel paints (resting), each flashing on its own beat */
        .gp-seq-red {
          background: radial-gradient(ellipse at 38% 30%, #d34b4e 0%, #c73538 55%, #7e2225 100%);
          animation: gp-seq-flash 4.2s ease-in-out infinite;
          animation-delay: 0.3s;
        }
        .gp-seq-amber {
          background: radial-gradient(ellipse at 38% 30%, #f7bd5e 0%, #f2a33c 55%, #9a621a 100%);
          animation: gp-seq-flash 4.2s ease-in-out infinite;
          animation-delay: 1.05s;
        }
        .gp-seq-teal {
          background: radial-gradient(ellipse at 38% 30%, #46cdbb 0%, #2fb8a6 55%, #1b7466 100%);
          animation: gp-seq-flash 4.2s ease-in-out infinite;
          animation-delay: 1.8s;
        }
        .gp-seq-blue {
          background: radial-gradient(ellipse at 38% 30%, #88a6ee 0%, #6c8fe0 55%, #3d5694 100%);
          /* blue is the 4th pad — not in the first 3 of this short demo
             sequence, so it only ever lights faintly to show it's present. */
          animation: gp-seq-rest 4.2s ease-in-out infinite;
        }

        /* flash = brighten the enamel face + a small press-down (no glow) */
        @keyframes gp-seq-flash {
          0%,
          8% {
            filter: brightness(0.62);
            transform: translateY(0) scale(1);
          }
          12% {
            filter: brightness(1.35);
            transform: translateY(1px) scale(0.985);
          }
          20%,
          100% {
            filter: brightness(0.62);
            transform: translateY(0) scale(1);
          }
        }
        /* the unused pad just breathes very subtly so the panel feels live */
        @keyframes gp-seq-rest {
          0%,
          100% {
            filter: brightness(0.6);
          }
          50% {
            filter: brightness(0.7);
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .gp-seq-pad {
            animation: none !important;
            filter: brightness(0.85) !important;
            transform: none !important;
          }
        }
      `}</style>
    </div>
  );
}
