/* Hover preview: emulates the real pack open. NOT a physical card fan — the
 * pack reveals as a row of 5 slots that flip (rotateY back→front) one after
 * another, exactly like _packs-client.tsx. Each face is a rarity ENAMEL chip
 * (PACK_ENAMELS: hi→base→deep lacquer gradient, hard edge, top gloss) — not a
 * cream playing card. One card is HOLO: an iridescent MATTE multi-hue wash
 * (pink→gold→teal→blue→violet, screen-blended, NO glow). Tiers shown:
 * common blue (#3a6fa8), uncommon violet (#714fb0), legendary amber (#c4841f,
 * holo), rare magenta (#b03a74), common blue. Loop re-rips. transform/opacity. */

type Slot = { tier: string; mult: string; name: string; holo: boolean; delay: string };

const SLOTS: Slot[] = [
  { tier: 'common', mult: '1x', name: 'COMMON', holo: false, delay: '0s' },
  { tier: 'uncommon', mult: '3x', name: 'UNCOMMON', holo: false, delay: '0.18s' },
  { tier: 'legendary', mult: '50x', name: 'LEGENDARY', holo: true, delay: '0.36s' },
  { tier: 'rare', mult: '10x', name: 'RARE', holo: false, delay: '0.54s' },
  { tier: 'common', mult: '1x', name: 'COMMON', holo: false, delay: '0.72s' },
];

export default function PacksPreview() {
  return (
    <div className="absolute inset-0 overflow-hidden gp-packs">
      <div className="gp-packs-row">
        {SLOTS.map((s, i) => (
          <div key={i} className={`gp-packs-slot gp-packs-${s.tier}`}>
            <div className="gp-packs-flip" style={{ animationDelay: s.delay }}>
              {/* back face */}
              <span className="gp-packs-back">
                <span className="gp-packs-back-q">?</span>
              </span>
              {/* enamel front face */}
              <span className="gp-packs-face">
                {s.holo && <span className="gp-packs-holo" aria-hidden />}
                <span className="gp-packs-mult">{s.mult}</span>
                <span className="gp-packs-name">{s.name}</span>
              </span>
            </div>
          </div>
        ))}
      </div>

      <style jsx>{`
        .gp-packs {
          background: var(--screen-well);
          display: grid;
          place-items: center;
        }
        .gp-packs-row {
          display: flex;
          gap: clamp(3px, 1.4vw, 7px);
          align-items: center;
        }
        .gp-packs-slot {
          width: clamp(24px, 7.6vw, 42px);
          aspect-ratio: 2.5 / 3.5;
          perspective: 500px;
        }
        .gp-packs-flip {
          position: relative;
          width: 100%;
          height: 100%;
          transform-style: preserve-3d;
          animation: gp-packs-reveal 3.6s cubic-bezier(0.16, 1, 0.3, 1) infinite;
          will-change: transform;
        }
        .gp-packs-back,
        .gp-packs-face {
          position: absolute;
          inset: 0;
          border-radius: 14%;
          backface-visibility: hidden;
          overflow: hidden;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 6%;
        }
        /* dark hatched card back with a faint ? */
        .gp-packs-back {
          background:
            repeating-linear-gradient(135deg, #00000018 0 6px, transparent 6px 12px),
            linear-gradient(160deg, #2a2118, #15110d);
          border: 1px solid rgba(255, 255, 255, 0.06);
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08), inset 0 -2px 6px #00000060;
        }
        .gp-packs-back-q {
          font-family: var(--font-mono-arcade);
          font-weight: 800;
          font-size: clamp(11px, 3vw, 18px);
          color: rgba(255, 255, 255, 0.18);
        }
        /* enamel front face — rarity lacquer gradient + hard edge + top gloss */
        .gp-packs-face {
          transform: rotateY(180deg);
          border: 1px solid var(--pk-edge);
          background: linear-gradient(
            165deg,
            var(--pk-hi) 0%,
            var(--pk-base) 48%,
            var(--pk-deep) 100%
          );
          box-shadow:
            inset 0 1px 0 #ffffff32,
            inset 0 -3px 6px #00000050,
            0 4px 0 rgba(0, 0, 0, 0.35),
            0 6px 12px #00000045;
        }
        /* top enamel sheen */
        .gp-packs-face::before {
          content: '';
          position: absolute;
          inset: 0 0 auto 0;
          height: 38%;
          background: linear-gradient(180deg, #ffffff22, transparent);
          pointer-events: none;
        }
        .gp-packs-mult {
          position: relative;
          z-index: 1;
          font-family: var(--font-mono-arcade);
          font-weight: 800;
          font-size: clamp(9px, 2.6vw, 15px);
          line-height: 1;
          color: var(--pk-on);
          text-shadow: 0 1px 0 #00000050;
        }
        .gp-packs-name {
          position: relative;
          z-index: 1;
          font-size: clamp(3.5px, 1.1vw, 6px);
          font-weight: 700;
          letter-spacing: 0.08em;
          color: var(--pk-on-muted);
          line-height: 1;
        }
        /* PACK_ENAMELS ladder */
        .gp-packs-common {
          --pk-hi: #4a86c2;
          --pk-base: #3a6fa8;
          --pk-deep: #1f4a78;
          --pk-edge: #163a5e;
          --pk-on: #e8f1fb;
          --pk-on-muted: #a9c8e6;
        }
        .gp-packs-uncommon {
          --pk-hi: #8a64cc;
          --pk-base: #714fb0;
          --pk-deep: #492f86;
          --pk-edge: #32205e;
          --pk-on: #f1e9ff;
          --pk-on-muted: #c6b1ec;
        }
        .gp-packs-rare {
          --pk-hi: #cc4f8e;
          --pk-base: #b03a74;
          --pk-deep: #7e2050;
          --pk-edge: #5a1539;
          --pk-on: #ffe9f4;
          --pk-on-muted: #ecaecb;
        }
        .gp-packs-legendary {
          --pk-hi: #e0a23a;
          --pk-base: #c4841f;
          --pk-deep: #8a5b15;
          --pk-edge: #63420f;
          --pk-on: #fff5dd;
          --pk-on-muted: #ecd09a;
        }
        /* HOLO — iridescent MATTE multi-hue wash, screen-blended, no glow */
        .gp-packs-holo {
          position: absolute;
          inset: 0;
          z-index: 0;
          pointer-events: none;
          background: linear-gradient(
            115deg,
            rgba(255, 120, 180, 0.16) 0%,
            rgba(255, 210, 120, 0.14) 22%,
            rgba(120, 230, 200, 0.16) 44%,
            rgba(120, 170, 255, 0.16) 66%,
            rgba(200, 130, 255, 0.16) 86%,
            rgba(255, 120, 180, 0.14) 100%
          );
          mix-blend-mode: screen;
        }
        .gp-packs-holo::after {
          content: '';
          position: absolute;
          inset: 0;
          background: repeating-linear-gradient(
            115deg,
            #ffffff10 0 2px,
            transparent 2px 5px
          );
          mix-blend-mode: overlay;
        }
        /* each slot holds face-down, flips to its enamel face (staggered via
           animation-delay), holds, then flips back for the loop */
        @keyframes gp-packs-reveal {
          0%,
          12% {
            transform: rotateY(0deg);
          }
          24%,
          82% {
            transform: rotateY(180deg);
          }
          94%,
          100% {
            transform: rotateY(0deg);
          }
        }
      `}</style>
    </div>
  );
}
