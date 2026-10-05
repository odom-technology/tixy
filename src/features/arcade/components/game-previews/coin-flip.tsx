/* Hover preview: the Midway enamel token tumbles on its horizontal axis
 * (rotateX, exactly like the real coin in _coin-flip-client.tsx) — lifts,
 * spins, and settles to a face. Heads is the lacquered amber/gold token
 * (#f7d35e → #c47c1f, ink #2a1b06), tails the prize-teal token
 * (#46cdbb → #1d8579, ink #07211d), with the same glossy-top / shaded-bottom
 * enamel bevel and a hard amber rim (#9a621a). No glow (Midway never glows).
 * transform/opacity only. */
export default function CoinFlipPreview() {
  return (
    <div className="absolute inset-0 overflow-hidden gp-coinflip">
      <div className="gp-coinflip-stage">
        <div className="gp-coinflip-coin">
          <span className="gp-coinflip-face gp-coinflip-heads">H</span>
          <span className="gp-coinflip-face gp-coinflip-tails">T</span>
        </div>
        <div className="gp-coinflip-shadow" />
      </div>

      <style jsx>{`
        .gp-coinflip {
          background: var(--screen-well);
          display: grid;
          place-items: center;
        }
        .gp-coinflip-stage {
          position: relative;
          width: 44%;
          aspect-ratio: 1 / 1;
          perspective: 800px;
          display: grid;
          place-items: center;
        }
        .gp-coinflip-coin {
          position: relative;
          width: 100%;
          height: 100%;
          transform-style: preserve-3d;
          animation: gp-coinflip-spin 3.4s cubic-bezier(0.16, 1, 0.3, 1) infinite;
          will-change: transform;
        }
        .gp-coinflip-face {
          position: absolute;
          inset: 0;
          border-radius: 50%;
          display: grid;
          place-items: center;
          font-family: var(--font-mono-arcade);
          font-weight: 900;
          font-size: clamp(20px, 6vw, 38px);
          backface-visibility: hidden;
          border: 4px solid #9a621ab3;
        }
        /* heads — amber/gold enamel token */
        .gp-coinflip-heads {
          transform: translateZ(2px);
          color: #2a1b06;
          background: radial-gradient(ellipse at 35% 30%, #f7d35e 0%, #c47c1f 60%);
          box-shadow:
            inset 0 4px 8px #f7d35e88,
            inset 0 -7px 14px #c47c1f99,
            inset 0 0 0 1px #ffffff30,
            0 4px 0 #9a621a,
            0 6px 12px #00000055;
          text-shadow: 0 1px 2px rgba(255, 255, 255, 0.2);
        }
        /* tails — prize-teal enamel token, on the back face */
        .gp-coinflip-tails {
          transform: rotateX(180deg) translateZ(2px);
          color: #07211d;
          background: radial-gradient(ellipse at 35% 30%, #46cdbb 0%, #1d8579 60%);
          box-shadow:
            inset 0 4px 8px #46cdbb88,
            inset 0 -7px 14px #1d857999,
            inset 0 0 0 1px #ffffff30,
            0 4px 0 #9a621a,
            0 6px 12px #00000055;
          text-shadow: 0 1px 2px rgba(255, 255, 255, 0.2);
        }
        .gp-coinflip-shadow {
          position: absolute;
          bottom: -14%;
          width: 60%;
          height: 11%;
          border-radius: 50%;
          background: rgba(0, 0, 0, 0.55);
          filter: blur(5px);
          animation: gp-coinflip-shadow 3.4s cubic-bezier(0.16, 1, 0.3, 1) infinite;
        }
        /* lift + multi-turn tumble on rotateX (vertical flip), settle on a
           face and hold — the real coin's 1.4s ease, looped. */
        @keyframes gp-coinflip-spin {
          0% {
            transform: rotateX(0deg) translateY(0);
          }
          14% {
            transform: rotateX(360deg) translateY(-16%);
          }
          40% {
            transform: rotateX(1260deg) translateY(0);
          }
          52%,
          92% {
            transform: rotateX(1260deg) translateY(0);
          }
          100% {
            transform: rotateX(1260deg) translateY(0);
          }
        }
        @keyframes gp-coinflip-shadow {
          0%,
          40%,
          52%,
          100% {
            transform: scale(1);
            opacity: 0.55;
          }
          14% {
            transform: scale(0.66);
            opacity: 0.26;
          }
        }
      `}</style>
    </div>
  );
}
