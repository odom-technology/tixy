/* Hover preview: emulates the real Hi-Lo loop. A physical playing card
 * (cream face #f6eddc, classic red pips #c0322f — matching the shared
 * PlayingCardFace primitive) deals up next to the espresso "fuchsia" deck
 * back (amber #f2a33c diamond lattice + medallion). The HIGHER call lights
 * (prize-teal #46cdbb / #2fb8a6 with an up arrow), the card flips to reveal
 * a higher rank, and the multiplier ladder ticks up (×1.00 → ×1.94, amber
 * enamel #f2a33c). Then it re-deals. transform/opacity only. */
export default function HiLoPreview() {
  return (
    <div className="absolute inset-0 overflow-hidden gp-hilo">
      <div className="gp-hilo-stage">
        {/* espresso deck back (fuchsia theme: amber lattice + medallion) */}
        <div className="gp-hilo-deck">
          <span className="gp-hilo-medallion">♦</span>
        </div>

        {/* the call: HIGHER lit (prize-teal up), LOWER dim (danger down) */}
        <div className="gp-hilo-calls">
          <span className="gp-hilo-call gp-hilo-higher">▲</span>
          <span className="gp-hilo-call gp-hilo-lower">▼</span>
        </div>

        {/* the dealt card flips from back to a cream face */}
        <div className="gp-hilo-card">
          <div className="gp-hilo-inner">
            <span className="gp-hilo-back">
              <span className="gp-hilo-back-medallion">♦</span>
            </span>
            <span className="gp-hilo-front">
              <span className="gp-hilo-rank gp-hilo-tl">9</span>
              <span className="gp-hilo-pip">♥</span>
              <span className="gp-hilo-rank gp-hilo-br">9</span>
            </span>
          </div>
        </div>

        {/* multiplier ladder — lit amber enamel rung */}
        <span className="gp-hilo-mult">×1.94</span>
      </div>

      <style jsx>{`
        .gp-hilo {
          background: var(--screen-well);
          display: grid;
          place-items: center;
        }
        .gp-hilo-stage {
          position: relative;
          display: flex;
          align-items: center;
          gap: 8%;
        }
        /* espresso deck back — diamond lattice + amber medallion */
        .gp-hilo-deck {
          position: relative;
          width: clamp(34px, 11vw, 56px);
          aspect-ratio: 5 / 7;
          border-radius: 9%;
          background:
            repeating-linear-gradient(45deg, rgba(242, 163, 60, 0.16) 0 1px, transparent 1px 8px),
            repeating-linear-gradient(-45deg, rgba(242, 163, 60, 0.16) 0 1px, transparent 1px 8px),
            linear-gradient(135deg, #2c2013, #1f1710 55%, #16100a);
          border: 1px solid #3c2c1a;
          box-shadow: 0 5px 12px rgba(0, 0, 0, 0.5), 4px -4px 0 -1px #1f1710;
          display: grid;
          place-items: center;
        }
        .gp-hilo-medallion {
          font-size: clamp(13px, 3.5vw, 22px);
          line-height: 1;
          color: #f2a33c;
          opacity: 0.85;
        }
        .gp-hilo-calls {
          display: flex;
          flex-direction: column;
          gap: 18%;
          font-size: clamp(11px, 3vw, 18px);
          line-height: 1;
        }
        .gp-hilo-higher {
          color: #46cdbb;
          animation: gp-hilo-higher 3.4s ease-in-out infinite;
        }
        .gp-hilo-lower {
          color: #c0322f;
          opacity: 0.22;
        }
        .gp-hilo-card {
          width: clamp(40px, 13vw, 66px);
          aspect-ratio: 5 / 7;
          perspective: 600px;
        }
        .gp-hilo-inner {
          position: relative;
          width: 100%;
          height: 100%;
          transform-style: preserve-3d;
          animation: gp-hilo-flip 3.4s cubic-bezier(0.5, 0, 0.2, 1) infinite;
          will-change: transform;
        }
        .gp-hilo-back,
        .gp-hilo-front {
          position: absolute;
          inset: 0;
          border-radius: 8%;
          backface-visibility: hidden;
          box-shadow: 0 5px 12px rgba(0, 0, 0, 0.5);
          display: grid;
          place-items: center;
        }
        /* card back matches the espresso deck */
        .gp-hilo-back {
          background:
            repeating-linear-gradient(45deg, rgba(242, 163, 60, 0.16) 0 1px, transparent 1px 8px),
            repeating-linear-gradient(-45deg, rgba(242, 163, 60, 0.16) 0 1px, transparent 1px 8px),
            linear-gradient(135deg, #2c2013, #1f1710 55%, #16100a);
          border: 1px solid #3c2c1a;
        }
        .gp-hilo-back-medallion {
          font-size: clamp(14px, 4vw, 24px);
          color: #f2a33c;
          opacity: 0.85;
        }
        /* cream paper face with classic red ink */
        .gp-hilo-front {
          transform: rotateY(180deg);
          background: linear-gradient(135deg, #fbf4e3, #f6eddc);
          border: 1px solid #d8c9a8;
        }
        .gp-hilo-rank {
          position: absolute;
          font-family: var(--font-mono-arcade);
          font-weight: 900;
          font-size: clamp(10px, 2.8vw, 17px);
          color: #c0322f;
          line-height: 1;
        }
        .gp-hilo-tl {
          top: 6%;
          left: 9%;
        }
        .gp-hilo-br {
          bottom: 6%;
          right: 9%;
          transform: rotate(180deg);
        }
        .gp-hilo-pip {
          font-size: clamp(20px, 5.6vw, 34px);
          color: #c0322f;
          line-height: 1;
          filter: drop-shadow(0 1px 1px rgba(40, 28, 12, 0.25));
        }
        /* amber enamel multiplier badge that pops on reveal */
        .gp-hilo-mult {
          position: absolute;
          bottom: -34%;
          left: 50%;
          transform: translateX(-50%);
          font-family: var(--font-mono-arcade);
          font-weight: 800;
          font-size: clamp(10px, 2.8vw, 15px);
          letter-spacing: 0.04em;
          color: #2a1b06;
          padding: 2px 8px;
          border-radius: 6px;
          background: linear-gradient(180deg, #f4c057, #e0a23a);
          border: 1px solid #7a4e16;
          box-shadow: inset 0 1px 0 #fff7e0, 0 2px 0 #00000055;
          opacity: 0;
          animation: gp-hilo-mult 3.4s ease-in-out infinite;
        }
        /* deck back held; the dealt card flips up to reveal, holds, then a
           quick deal-out resets it for the next round */
        @keyframes gp-hilo-flip {
          0% {
            transform: rotateY(0deg) translateY(0);
          }
          26%,
          82% {
            transform: rotateY(180deg) translateY(0);
          }
          92% {
            transform: rotateY(180deg) translateY(-90%) scale(0.92);
            opacity: 0;
          }
          93% {
            transform: rotateY(0deg) translateY(55%) scale(0.92);
            opacity: 0;
          }
          100% {
            transform: rotateY(0deg) translateY(0) scale(1);
            opacity: 1;
          }
        }
        @keyframes gp-hilo-higher {
          0%,
          18% {
            opacity: 0.4;
            transform: translateY(0);
          }
          36%,
          78% {
            opacity: 1;
            transform: translateY(-12%);
          }
          88%,
          100% {
            opacity: 0.4;
            transform: translateY(0);
          }
        }
        @keyframes gp-hilo-mult {
          0%,
          40% {
            opacity: 0;
            transform: translateX(-50%) translateY(4px);
          }
          54%,
          82% {
            opacity: 1;
            transform: translateX(-50%) translateY(0);
          }
          90%,
          100% {
            opacity: 0;
            transform: translateX(-50%) translateY(4px);
          }
        }
      `}</style>
    </div>
  );
}
