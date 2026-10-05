/* Hover preview for Connections: a recessed 4x4 grid of cream "key" tiles.
 * Each loop, four tiles light up as a selection, then snap into a solved
 * enamel band that drops in at the top in the group's color. The band color
 * cycles through the real four group tones over the loop:
 *   amber (tickets) -> teal (prize) -> info (blue) -> red (primary).
 * Pure CSS — no JS logic, no state. Matches the real game's enamel mapping
 * (yellow->tickets, green->prize, blue->info, purple->primary). */
export default function ConnectionsPreview() {
  // 16 short word-like labels for a real 4x4 board.
  const words = [
    'JAZZ', 'NOVA', 'PIXEL', 'FROST',
    'EMBER', 'TIDAL', 'QUARTZ', 'LUMEN',
    'RIVET', 'MAPLE', 'ONYX', 'VERSE',
    'CRANE', 'GLYPH', 'DRIFT', 'ZEPHYR',
  ];

  return (
    <div className="absolute inset-0 overflow-hidden">
      {/* solved band: drops in at the top, recolors each loop */}
      <span className="gp-conn-band" />

      <div className="gp-conn-bezel">
        {words.map((word, i) => (
          <span key={i} className={`gp-conn-tile gp-conn-t${i}`}>
            {word}
          </span>
        ))}
      </div>

      <style jsx>{`
        /* recessed board well that holds the tile grid */
        .gp-conn-bezel {
          position: absolute;
          inset: 30% 12% 12%;
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          grid-template-rows: repeat(4, 1fr);
          gap: 5%;
          padding: 4%;
          border-radius: 7px;
          background: linear-gradient(180deg, #17110a, #060505);
          box-shadow: inset 0 2px 8px rgba(0, 0, 0, 0.73),
            inset 0 0 0 1px rgba(255, 255, 255, 0.03);
        }

        /* cream beveled "key" chip — matches the real cn-tile */
        .gp-conn-tile {
          display: grid;
          place-items: center;
          border-radius: 5px;
          font-family: var(--font-mono-arcade);
          font-size: clamp(4px, 1.7vw, 8px);
          font-weight: 700;
          letter-spacing: 0.02em;
          color: #1b140d;
          overflow: hidden;
          background: linear-gradient(180deg, #fdf7ea, #f6eddc);
          box-shadow: inset 0 1px 0 #fffaf0,
            inset 0 -2px 3px #c9b791, 0 2px 0 #6b5631;
        }

        /* the four "selected" tiles depress into amber enamel, then dim out
         * as the consolidated band takes over. Scattered group positions. */
        .gp-conn-t2,
        .gp-conn-t5,
        .gp-conn-t11,
        .gp-conn-t12 {
          animation: gp-conn-pick 4s ease-in-out infinite;
        }

        .gp-conn-band {
          position: absolute;
          left: 12%;
          right: 12%;
          top: 12%;
          height: 14%;
          border-radius: 6px;
          background: var(--enamel-tickets);
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.32),
            inset 0 -3px 5px rgba(0, 0, 0, 0.32), 0 3px 0 rgba(0, 0, 0, 0.45);
          opacity: 0;
          transform-origin: top;
          transform: translateY(8%) scaleY(0.7);
          animation: gp-conn-band 4s ease-in-out infinite,
            gp-conn-band-color 16s step-end infinite;
        }

        /* selected pulse → amber enamel depress, then fade under the band */
        @keyframes gp-conn-pick {
          0%,
          24% {
            background: linear-gradient(180deg, #fdf7ea, #f6eddc);
            color: #1b140d;
            transform: translateY(0);
          }
          36%,
          54% {
            background: linear-gradient(180deg, #f7bd5e, #f2a33c);
            color: #2a1b06;
            transform: translateY(1px);
          }
          /* dim out as the consolidated band snaps over them */
          64%,
          100% {
            opacity: 0.12;
            background: linear-gradient(180deg, #fdf7ea, #f6eddc);
            color: #1b140d;
            transform: translateY(0);
          }
        }

        @keyframes gp-conn-band {
          0%,
          54% {
            opacity: 0;
            transform: translateY(8%) scaleY(0.7);
          }
          /* snap in with a gentle squash */
          62% {
            opacity: 1;
            transform: translateY(0) scaleY(1.06);
          }
          70%,
          90% {
            opacity: 1;
            transform: translateY(0) scaleY(1);
          }
          100% {
            opacity: 0;
            transform: translateY(0) scaleY(1);
          }
        }

        /* cycle through the real four group colors, one per loop */
        @keyframes gp-conn-band-color {
          0% {
            background: var(--enamel-tickets);
          }
          25% {
            background: var(--enamel-prize);
          }
          50% {
            background: var(--enamel-info);
          }
          75% {
            background: var(--enamel-primary);
          }
        }
      `}</style>
    </div>
  );
}
