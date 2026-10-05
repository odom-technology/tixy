/* Hover preview: emulates the real CS:GO-style cases reel. A horizontal strip
 * of TALL enamel item cards — each a flat lacquer gradient (hi→base→deep) with
 * a hard edge, top gloss, a mono multiplier and a rarity label — scrolls past a
 * fixed center AMBER ticker rail (#f2a33c, triangle arrows top+bottom), then
 * eases (easeOutQuint-style deceleration) to land a high tier under the ticker.
 * Enamel ladder mirrors CASE_ENAMELS: common slate, uncommon teal (#2fb8a6),
 * rare blue (#3a86c4), mythic violet (#8a52c4), legendary amber (#e0a23a),
 * covert red (#c73538). Dark wood well + shelf rails + side fades. Loop
 * re-spins. transform/opacity only. */

type Cell = { tier: string; mult: string; label: string };

// The card landing dead-center under the ticker (index 6) is a covert red.
const CELLS: Cell[] = [
  { tier: 'common', mult: '0.5x', label: 'COMMON' },
  { tier: 'uncommon', mult: '2x', label: 'UNCOMMON' },
  { tier: 'common', mult: '1x', label: 'COMMON' },
  { tier: 'rare', mult: '5x', label: 'RARE' },
  { tier: 'mythic', mult: '25x', label: 'MYTHIC' },
  { tier: 'legendary', mult: '100x', label: 'LEGENDARY' },
  { tier: 'covert', mult: '1000x', label: 'COVERT' },
  { tier: 'uncommon', mult: '1.5x', label: 'UNCOMMON' },
  { tier: 'rare', mult: '3x', label: 'RARE' },
  { tier: 'common', mult: '1x', label: 'COMMON' },
  { tier: 'mythic', mult: '10x', label: 'MYTHIC' },
  { tier: 'common', mult: '0.5x', label: 'COMMON' },
];

export default function CasesPreview() {
  return (
    <div className="absolute inset-0 overflow-hidden gp-cases">
      <div className="gp-cases-shelf">
        <div className="gp-cases-track">
          {CELLS.map((c, i) => (
            <span key={i} className={`gp-cases-cell gp-cases-${c.tier}`}>
              <span className="gp-cases-mult">{c.mult}</span>
              <span className="gp-cases-label">{c.label}</span>
            </span>
          ))}
        </div>
      </div>

      {/* fixed center amber ticker rail */}
      <span className="gp-cases-rail" />
      <span className="gp-cases-arrow gp-cases-arrow-top" />
      <span className="gp-cases-arrow gp-cases-arrow-bot" />

      {/* side fades */}
      <span className="gp-cases-fade gp-cases-fade-l" />
      <span className="gp-cases-fade gp-cases-fade-r" />

      <style jsx>{`
        .gp-cases {
          background: linear-gradient(180deg, #15110d, #0c0907);
          display: grid;
          place-items: center;
        }
        /* recessed shelf rails (top/bottom) inside the wood well */
        .gp-cases-shelf {
          position: relative;
          width: 100%;
          height: 64%;
          display: flex;
          align-items: center;
          overflow: hidden;
          background: #1a130b;
          border-top: 1px solid rgba(255, 255, 255, 0.05);
          border-bottom: 1px solid rgba(0, 0, 0, 0.45);
          box-shadow: inset 0 6px 12px rgba(0, 0, 0, 0.5);
        }
        .gp-cases-track {
          display: flex;
          gap: 6px;
          align-items: center;
          height: 80%;
          padding-left: 50%;
          animation: gp-cases-spin 3.6s cubic-bezier(0.12, 0.7, 0.16, 1) infinite;
          will-change: transform;
        }
        .gp-cases-cell {
          flex: 0 0 auto;
          width: clamp(30px, 8.6vw, 46px);
          height: 100%;
          border-radius: 6px;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 6%;
          border: 1.5px solid var(--cell-edge);
          background: linear-gradient(
            180deg,
            var(--cell-hi) 0%,
            var(--cell-base) 52%,
            var(--cell-deep) 100%
          );
          box-shadow:
            inset 0 2px 4px rgba(255, 255, 255, 0.3),
            0 3px 6px rgba(0, 0, 0, 0.45);
        }
        .gp-cases-mult {
          font-family: var(--font-mono-arcade);
          font-weight: 800;
          font-size: clamp(8px, 2.3vw, 13px);
          line-height: 1;
          color: var(--cell-on);
          text-shadow: 0 1px 0 rgba(0, 0, 0, 0.45);
        }
        .gp-cases-label {
          font-size: clamp(4px, 1.2vw, 6px);
          font-weight: 700;
          letter-spacing: 0.08em;
          color: var(--cell-on);
          opacity: 0.82;
          line-height: 1;
        }
        /* CASE_ENAMELS ladder */
        .gp-cases-common {
          --cell-hi: #5a6772;
          --cell-base: #46525c;
          --cell-deep: #2a333a;
          --cell-edge: #202a31;
          --cell-on: #e7eef2;
        }
        .gp-cases-uncommon {
          --cell-hi: #46cdbb;
          --cell-base: #2fb8a6;
          --cell-deep: #1b7466;
          --cell-edge: #145a51;
          --cell-on: #04231e;
        }
        .gp-cases-rare {
          --cell-hi: #5aa0db;
          --cell-base: #3a86c4;
          --cell-deep: #1f547e;
          --cell-edge: #163e5e;
          --cell-on: #04161f;
        }
        .gp-cases-mythic {
          --cell-hi: #a268d6;
          --cell-base: #8a52c4;
          --cell-deep: #5a2e94;
          --cell-edge: #3a1d66;
          --cell-on: #f3e9ff;
        }
        .gp-cases-legendary {
          --cell-hi: #f4c057;
          --cell-base: #e0a23a;
          --cell-deep: #9a621a;
          --cell-edge: #7a4e16;
          --cell-on: #2a1b06;
        }
        .gp-cases-covert {
          --cell-hi: #d34b4e;
          --cell-base: #c73538;
          --cell-deep: #7e2225;
          --cell-edge: #5a181b;
          --cell-on: #ffefe4;
        }
        /* amber ticker — thin rail with a dark seat */
        .gp-cases-rail {
          position: absolute;
          left: 50%;
          top: 8%;
          bottom: 8%;
          width: 3px;
          transform: translateX(-50%);
          background: #f2a33c;
          box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.55);
          z-index: 3;
        }
        .gp-cases-arrow {
          position: absolute;
          left: 50%;
          transform: translateX(-50%);
          width: 0;
          height: 0;
          border-left: 7px solid transparent;
          border-right: 7px solid transparent;
          z-index: 4;
        }
        .gp-cases-arrow-top {
          top: 4%;
          border-top: 9px solid #f2a33c;
        }
        .gp-cases-arrow-bot {
          bottom: 4%;
          border-bottom: 9px solid #f2a33c;
        }
        .gp-cases-fade {
          position: absolute;
          top: 0;
          bottom: 0;
          width: 24%;
          z-index: 2;
          pointer-events: none;
        }
        .gp-cases-fade-l {
          left: 0;
          background: linear-gradient(90deg, #0c0907, transparent);
        }
        .gp-cases-fade-r {
          right: 0;
          background: linear-gradient(270deg, #0c0907, transparent);
        }
        /* fast scroll that decelerates hard (easeOutQuint feel) and lands the
           covert card (index 6) centered under the ticker. Cell pitch ~ card
           width + 6px gap; the strip is offset so cell 6's center hits 50%. */
        @keyframes gp-cases-spin {
          0% {
            transform: translateX(0);
          }
          78%,
          94% {
            transform: translateX(-228px);
          }
          100% {
            transform: translateX(0);
          }
        }
      `}</style>
    </div>
  );
}
