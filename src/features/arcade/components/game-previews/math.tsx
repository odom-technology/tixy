/* Hover preview for Mental Math Sprint — emulates the real game's Midway look
 * from _math-client.tsx: a recessed dark cabinet readout showing a problem
 * (operands around an amber enamel operator keycap) with a draining amber
 * time-bar and a teal streak chip, above a cream KEYCAP numeric keypad. Hard
 * bevels + offset drop shadows; NOTHING GLOWS.
 *
 * Motion: the time-bar drains left; one cream key (the "7") depresses on its own
 * beat (a real key-travel: translateY onto its shorter offset shadow, no glow),
 * the enter key (teal enamel) pulses its brightness as an answer "lands", and a
 * teal "+1" floats off the readout right after. transform/opacity/filter/width
 * only; loops cheaply. Reduced-motion → static. */
export default function MathPreview() {
  return (
    <div className="absolute inset-0 overflow-hidden gp-mx">
      <div className="gp-mx-frame">
        {/* problem readout */}
        <div className="gp-mx-readout">
          <div className="gp-mx-timebar">
            <i className="gp-mx-timefill" />
          </div>
          <span className="gp-mx-combo">5</span>
          <span className="gp-mx-problem">
            12 <i className="gp-mx-op">×</i> 7
          </span>
          <span className="gp-mx-float">+1</span>
        </div>

        {/* compact 3-col keycap pad */}
        <div className="gp-mx-pad">
          <i className="gp-mx-key" />
          <i className="gp-mx-key" />
          <i className="gp-mx-key" />
          <i className="gp-mx-key" />
          <i className="gp-mx-key" />
          <i className="gp-mx-key" />
          <i className="gp-mx-key gp-mx-key-press" />
          <i className="gp-mx-key" />
          <i className="gp-mx-key" />
          <i className="gp-mx-key gp-mx-key-clear" />
          <i className="gp-mx-key" />
          <i className="gp-mx-key gp-mx-key-enter" />
        </div>
      </div>

      <style jsx>{`
        .gp-mx {
          background: radial-gradient(120% 100% at 50% 30%, #2a2114 0%, #14100a 100%);
          display: grid;
          place-items: center;
        }
        .gp-mx-frame {
          position: absolute;
          inset: 7% 14%;
          display: flex;
          flex-direction: column;
          gap: 7%;
        }

        /* recessed dark readout with ink frame */
        .gp-mx-readout {
          position: relative;
          flex: 0 0 30%;
          border-radius: 8px;
          padding: 7% 8% 0;
          background: radial-gradient(120% 140% at 50% 16%, #1f2a22 0%, #0f1512 100%);
          box-shadow:
            inset 0 0 0 2px #0f0a06,
            inset 0 3px 8px rgba(0, 0, 0, 0.6),
            0 2px 0 #00000040,
            0 5px 10px #00000055;
          display: flex;
          flex-direction: column;
          gap: 9%;
          justify-content: center;
        }
        .gp-mx-timebar {
          height: 11%;
          min-height: 5px;
          border-radius: 999px;
          background: #120d08;
          box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.7), inset 0 0 0 1.5px #0f0a06;
          overflow: hidden;
        }
        .gp-mx-timefill {
          display: block;
          height: 100%;
          width: 78%;
          transform-origin: left center;
          border-radius: 999px;
          background: linear-gradient(180deg, #f7bd5e 0%, #f2a33c 55%, #c47c1f 100%);
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.3), inset 0 -2px 0 rgba(0, 0, 0, 0.3);
          animation: gp-mx-drain 3.6s linear infinite;
        }
        .gp-mx-problem {
          font-family: ui-monospace, monospace;
          font-weight: 800;
          font-size: clamp(13px, 6cqw, 26px);
          line-height: 1;
          text-align: center;
          color: #f6eddc;
          text-shadow: 0 2px 0 rgba(0, 0, 0, 0.5);
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 0.3em;
        }
        /* amber enamel operator keycap between the operands */
        .gp-mx-op {
          font-style: normal;
          display: inline-grid;
          place-items: center;
          font-size: 0.6em;
          width: 1.5em;
          height: 1.5em;
          border-radius: 0.28em;
          color: #2a1a06;
          text-shadow: none;
          background: radial-gradient(ellipse at 38% 28%, #f7bd5e 0%, #f2a33c 55%, #9a621a 100%);
          box-shadow:
            inset 0 1.5px 1px rgba(255, 255, 255, 0.45),
            inset 0 -2px 3px rgba(0, 0, 0, 0.35),
            inset 0 0 0 1px rgba(0, 0, 0, 0.3),
            0 1.5px 0 rgba(0, 0, 0, 0.4);
        }
        /* teal streak chip pinned to the readout corner */
        .gp-mx-combo {
          position: absolute;
          top: 9%;
          right: 5%;
          padding: 1px 7px 2px;
          border-radius: 999px;
          font-family: ui-monospace, monospace;
          font-weight: 800;
          font-size: clamp(8px, 2.6cqw, 12px);
          color: #062a23;
          background: radial-gradient(ellipse at 38% 28%, #46cdbb 0%, #2fb8a6 55%, #1b7466 100%);
          box-shadow:
            inset 0 1.5px 1px rgba(255, 255, 255, 0.5),
            inset 0 -2px 3px rgba(0, 0, 0, 0.4),
            inset 0 0 0 1px rgba(0, 0, 0, 0.3),
            0 1.5px 0 rgba(0, 0, 0, 0.4);
          animation: gp-mx-combo-pulse 3.6s ease-in-out infinite;
        }
        /* "+1" float rising off the readout as the answer lands */
        .gp-mx-float {
          position: absolute;
          left: 50%;
          bottom: 12%;
          font-family: ui-monospace, monospace;
          font-weight: 800;
          font-size: clamp(9px, 3cqw, 14px);
          color: #2fb8a6;
          text-shadow: 0 1.5px 0 rgba(0, 0, 0, 0.5);
          opacity: 0;
          animation: gp-mx-float 3.6s ease-out infinite;
        }

        /* cream keypad bezel */
        .gp-mx-pad {
          flex: 1 1 auto;
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          grid-auto-rows: 1fr;
          gap: 6%;
          padding: 6%;
          border-radius: 8px;
          background: linear-gradient(180deg, #f6eddc 0%, #e4d6bb 100%);
          box-shadow:
            inset 0 2px 0 #fffdf6,
            inset 0 -3px 0 #c9b89966,
            inset 0 0 0 2px #1c160d,
            0 2px 0 #00000040,
            0 5px 10px #00000055;
        }

        /* cream keycap with hard bevel + offset drop (no blur halo) */
        .gp-mx-key {
          border-radius: 4px;
          background: linear-gradient(180deg, #fdf6e7 0%, #ecdcbd 100%);
          box-shadow:
            inset 0 2px 0 rgba(255, 255, 255, 0.7),
            inset 0 -3px 4px rgba(120, 92, 46, 0.3),
            inset 0 0 0 1.5px rgba(0, 0, 0, 0.16),
            0 3px 0 #b89b6a,
            0 4px 5px rgba(0, 0, 0, 0.3);
        }
        .gp-mx-key-clear {
          background: radial-gradient(ellipse at 42% 26%, #d34b4e 0%, #c73538 56%, #7e2225 100%);
          box-shadow:
            inset 0 2px 0 rgba(255, 255, 255, 0.3),
            inset 0 -3px 4px rgba(0, 0, 0, 0.4),
            inset 0 0 0 1.5px rgba(0, 0, 0, 0.26),
            0 3px 0 #5e1a1c,
            0 4px 5px rgba(0, 0, 0, 0.3);
        }
        .gp-mx-key-enter {
          background: radial-gradient(ellipse at 42% 26%, #46cdbb 0%, #2fb8a6 56%, #1b7466 100%);
          box-shadow:
            inset 0 2px 0 rgba(255, 255, 255, 0.32),
            inset 0 -3px 4px rgba(0, 0, 0, 0.4),
            inset 0 0 0 1.5px rgba(0, 0, 0, 0.26),
            0 3px 0 #14564c,
            0 4px 5px rgba(0, 0, 0, 0.3);
          animation: gp-mx-enter-pulse 3.6s ease-in-out infinite;
        }

        /* the "7" key presses down on its own beat: sinks onto a shorter shadow */
        .gp-mx-key-press {
          animation: gp-mx-press 3.6s ease-in-out infinite;
        }

        @keyframes gp-mx-drain {
          0% { width: 86%; }
          100% { width: 8%; }
        }
        @keyframes gp-mx-press {
          0%, 40% {
            transform: translateY(0);
            box-shadow:
              inset 0 2px 0 rgba(255, 255, 255, 0.7),
              inset 0 -3px 4px rgba(120, 92, 46, 0.3),
              inset 0 0 0 1.5px rgba(0, 0, 0, 0.16),
              0 3px 0 #b89b6a,
              0 4px 5px rgba(0, 0, 0, 0.3);
          }
          50%, 60% {
            transform: translateY(2px);
            box-shadow:
              inset 0 2px 0 rgba(255, 255, 255, 0.6),
              inset 0 -2px 3px rgba(120, 92, 46, 0.28),
              inset 0 0 0 1.5px rgba(0, 0, 0, 0.16),
              0 1px 0 #b89b6a,
              0 2px 3px rgba(0, 0, 0, 0.28);
          }
          100% {
            transform: translateY(0);
            box-shadow:
              inset 0 2px 0 rgba(255, 255, 255, 0.7),
              inset 0 -3px 4px rgba(120, 92, 46, 0.3),
              inset 0 0 0 1.5px rgba(0, 0, 0, 0.16),
              0 3px 0 #b89b6a,
              0 4px 5px rgba(0, 0, 0, 0.3);
          }
        }
        /* enter key brightens (no glow) as the answer "lands", just after the press */
        @keyframes gp-mx-enter-pulse {
          0%, 55% { filter: brightness(0.92); }
          64% { filter: brightness(1.32); }
          80%, 100% { filter: brightness(0.92); }
        }
        /* streak chip pulses its enamel brightness on the same landing beat */
        @keyframes gp-mx-combo-pulse {
          0%, 60% { filter: brightness(0.8); transform: scale(1); }
          68% { filter: brightness(1.4); transform: scale(1.12); }
          84%, 100% { filter: brightness(0.9); transform: scale(1); }
        }
        /* "+1" lifts and fades right after the enter pulse */
        @keyframes gp-mx-float {
          0%, 60% { opacity: 0; transform: translate(-50%, 4px) scale(0.8); }
          66% { opacity: 1; transform: translate(-50%, 0) scale(1.05); }
          88%, 100% { opacity: 0; transform: translate(-50%, -14px) scale(1); }
        }

        @media (prefers-reduced-motion: reduce) {
          .gp-mx-timefill,
          .gp-mx-key-press,
          .gp-mx-key-enter,
          .gp-mx-combo,
          .gp-mx-float {
            animation: none !important;
          }
          .gp-mx-timefill {
            width: 64%;
          }
          .gp-mx-float {
            display: none;
          }
        }
      `}</style>
    </div>
  );
}
