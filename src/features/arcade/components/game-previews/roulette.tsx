'use client';

/* Hover preview for Roulette: the real single-zero wheel rendered as 37
 * alternating enamel segments (red / black / green-0) in the European pocket
 * order, sitting in a lacquered-wood bezel with a domed hub. The wheel spins
 * clockwise while a cream ball orbits counter-clockwise on the outer track,
 * decelerates, and settles into a pocket; the landing pocket number flashes in
 * the game's mono font. Flat enamel — nothing glows. Pure CSS, no JS/hooks.
 *
 * Colors match the felt/wheel in _roulette-client.tsx: red = --enamel-danger,
 * black = #15100b, zero = --enamel-prize, ball = cream key-face. */

const POCKETS = 37;
const WHEEL_ORDER = [
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5,
  24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26,
];
const RED = new Set([
  1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36,
]);

function seg(i: number): string {
  const n = WHEEL_ORDER[i]!;
  const color =
    n === 0 ? 'var(--enamel-prize)' : RED.has(n) ? 'var(--enamel-danger)' : '#15100b';
  const a = ((i / POCKETS) * 360).toFixed(2);
  const b = (((i + 1) / POCKETS) * 360).toFixed(2);
  return `${color} ${a}deg ${b}deg`;
}

const RING = `conic-gradient(${Array.from({ length: POCKETS }, (_, i) => seg(i)).join(', ')})`;

export default function RoulettePreview() {
  return (
    <div className='absolute inset-0 overflow-hidden gp-rl-root'>
      <div className='gp-rl-stage'>
        {/* lacquered bezel */}
        <div className='gp-rl-bezel'>
          {/* spinning enamel wheel */}
          <div className='gp-rl-wheel' style={{ background: RING }}>
            <div className='gp-rl-hub'>
              <span className='gp-rl-hub-num' />
            </div>
          </div>
          {/* ball track + orbiting ball */}
          <div className='gp-rl-balltrack'>
            <span className='gp-rl-ball' />
          </div>
        </div>
      </div>

      <style jsx>{`
        .gp-rl-root {
          display: flex;
          align-items: center;
          justify-content: center;
          background:
            radial-gradient(90% 70% at 50% 0%, #ffffff0a, transparent 60%),
            var(--screen-well);
        }
        .gp-rl-stage {
          position: relative;
          width: 74%;
          aspect-ratio: 1;
        }
        .gp-rl-bezel {
          position: absolute;
          inset: 0;
          border-radius: 50%;
          background: radial-gradient(circle at 35% 28%, #2c2113, #160f08 72%);
          border: 3px solid var(--border-ink, #0f0a06);
          box-shadow:
            inset 0 2px 10px #000000aa,
            0 6px 16px #00000070;
        }
        .gp-rl-wheel {
          position: absolute;
          inset: 9%;
          border-radius: 50%;
          border: 2px solid var(--border-ink, #0f0a06);
          animation: gp-rl-spin 3.4s cubic-bezier(0.2, 0.7, 0.25, 1) infinite;
        }
        .gp-rl-hub {
          position: absolute;
          inset: 30%;
          border-radius: 50%;
          background: radial-gradient(circle at 35% 30%, #3a2a1a, #1d140d 70%);
          border: 2px solid var(--border-ink, #0f0a06);
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: inset 0 1px 3px #ffffff20, inset 0 -2px 6px #000000aa;
        }
        .gp-rl-hub-num {
          font-family: var(--font-mono-arcade), monospace;
          font-weight: 700;
          font-size: clamp(14px, 7vw, 30px);
          color: var(--key-face, #f6eddc);
          opacity: 0;
          animation: gp-rl-num 3.4s steps(1, end) infinite;
        }
        .gp-rl-hub-num::after {
          content: '0';
          animation: gp-rl-num-text 3.4s steps(1, end) infinite;
        }
        .gp-rl-balltrack {
          position: absolute;
          inset: 9%;
          border-radius: 50%;
          animation: gp-rl-orbit 3.4s cubic-bezier(0.15, 0.7, 0.25, 1) infinite;
        }
        .gp-rl-ball {
          position: absolute;
          top: 3%;
          left: 50%;
          width: clamp(6px, 3.5vw, 11px);
          aspect-ratio: 1;
          transform: translateX(-50%);
          border-radius: 50%;
          background: radial-gradient(circle at 35% 30%, #fffef8, #cdbf9e 75%);
          border: 1px solid var(--border-ink, #0f0a06);
          box-shadow: 0 1px 2px #000000aa;
        }

        /* wheel spins clockwise, eases to a stop */
        @keyframes gp-rl-spin {
          0% {
            transform: rotate(0deg);
          }
          70%,
          100% {
            transform: rotate(900deg);
          }
        }
        /* ball orbits the other way, settles opposite the 0 pocket */
        @keyframes gp-rl-orbit {
          0% {
            transform: rotate(0deg);
          }
          70%,
          100% {
            transform: rotate(-1280deg);
          }
        }
        /* hub number reveals the winning pocket once the ball settles */
        @keyframes gp-rl-num {
          0%,
          70% {
            opacity: 0;
          }
          74%,
          100% {
            opacity: 1;
          }
        }
        @keyframes gp-rl-num-text {
          0%,
          100% {
            content: '0';
          }
        }
      `}</style>
    </div>
  );
}
