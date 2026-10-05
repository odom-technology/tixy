'use client';

/* Prize Wheel hover preview — emulates the real carnival wheel
   (src/app/(games)/prize-wheel/_prize-wheel-client.tsx). The real game draws an
   <svg> wheel of N equal segments painted from the Midway enamel ladder by
   multiplier size (0× slate, small teal, base green, mid blue, big violet, huge
   amber, jackpot red), a fixed amber pointer at 12 o'clock, and a bolted hub.
   This standalone preview shows a 12-segment medium-style wheel that spins 5
   full turns and eases to rest with the red jackpot segment under the pointer.
   Flat enamel, nothing glows. No game imports. */

type Seg = { label: string; color: string; on: string };

// A representative 12-segment medium wheel (colors verbatim from the theme
// ladder; the single red segment is the jackpot).
const SEGMENTS: Seg[] = [
  { label: '0', color: '#3a444c', on: '#c9d3da' },
  { label: '1', color: '#3fae54', on: '#04210c' },
  { label: '0', color: '#3a444c', on: '#c9d3da' },
  { label: '2', color: '#3a86c4', on: '#04161f' },
  { label: '0', color: '#3a444c', on: '#c9d3da' },
  { label: '0.5', color: '#2fb8a6', on: '#04231e' },
  { label: '5', color: '#8a52c4', on: '#f3e9ff' },
  { label: '0', color: '#3a444c', on: '#c9d3da' },
  { label: '1', color: '#3fae54', on: '#04210c' },
  { label: '0', color: '#3a444c', on: '#c9d3da' },
  { label: '2', color: '#3a86c4', on: '#04161f' },
  { label: '24', color: '#c73538', on: '#ffefe4' }, // jackpot
];

const N = SEGMENTS.length;
const SEG = 360 / N;

// conic-gradient of equal enamel segments from 0deg, clockwise.
const CONIC = (() => {
  const stops: string[] = [];
  for (let i = 0; i < N; i++) {
    stops.push(`${SEGMENTS[i]!.color} ${(i / N) * 100}% ${((i + 1) / N) * 100}%`);
  }
  return `conic-gradient(from 0deg, ${stops.join(', ')})`;
})();

// Land on the jackpot (last segment). Rotate so its midpoint sits under the top
// pointer → 360 - mid, plus 5 full turns.
const JACKPOT_MID = (N - 1) * SEG + SEG / 2;
const FINAL_ROT = 5 * 360 + ((360 - JACKPOT_MID) % 360);

export default function PrizeWheelPreview() {
  return (
    <div className='absolute inset-0 overflow-hidden gp-pw-root'>
      <div className='gp-pw-wrap'>
        {/* fixed amber pointer at the top */}
        <span className='gp-pw-pointer' aria-hidden />

        {/* rim ring around the enamel wheel */}
        <div className='gp-pw-ring'>
          <div className='gp-pw-wheel' style={{ background: CONIC }}>
            {/* seam pegs at each boundary */}
            {SEGMENTS.map((_, i) => (
              <span
                className='gp-pw-spoke'
                key={`s-${i}`}
                style={{ transform: `translateX(-50%) rotate(${i * SEG + 180}deg)` }}
              />
            ))}
            {/* mono multiplier labels */}
            {SEGMENTS.map((seg, i) => {
              const mid = i * SEG + SEG / 2;
              return (
                <div
                  className='gp-pw-label-pos'
                  key={`l-${i}`}
                  style={{ transform: `rotate(${mid}deg) translateY(-34%)` }}
                >
                  <span className='gp-pw-label' style={{ color: seg.on }}>
                    {seg.label}
                  </span>
                </div>
              );
            })}
            {/* hub cap */}
            <div className='gp-pw-hub'>
              <span className='gp-pw-hub-label'>SPIN</span>
            </div>
          </div>
        </div>
      </div>

      <style jsx>{`
        .gp-pw-root {
          background: var(--screen-well);
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .gp-pw-wrap {
          position: relative;
          height: 92%;
          aspect-ratio: 1;
          padding-top: 8px;
        }
        .gp-pw-pointer {
          position: absolute;
          left: 50%;
          top: 1px;
          z-index: 20;
          width: 0;
          height: 0;
          transform: translateX(-50%);
          border-left: 9px solid transparent;
          border-right: 9px solid transparent;
          border-top: 18px solid #f2c14e;
          filter: drop-shadow(0 2px 2px #00000090);
        }
        .gp-pw-ring {
          position: absolute;
          inset: 8px 0 0;
          border-radius: 50%;
          background: radial-gradient(circle at 50% 32%, #34271a, #1d150d 70%);
          border: 1px solid var(--border-ink);
          box-shadow: inset 0 0 0 4px #14100b, inset 0 0 0 5px #00000080,
            0 5px 0 var(--shadow-color), 0 8px 18px #00000055;
        }
        .gp-pw-wheel {
          position: absolute;
          inset: 5px;
          border-radius: 50%;
          box-shadow: inset 0 0 0 2px #00000070, inset 0 2px 10px #00000066;
          animation: gp-pw-spin 3.6s cubic-bezier(0.17, 0.72, 0.14, 1) infinite;
        }
        .gp-pw-spoke {
          position: absolute;
          left: 50%;
          top: 50%;
          width: 1px;
          height: 50%;
          transform-origin: top center;
          background: linear-gradient(to bottom, #00000000, #00000040 30%, #11080380);
        }
        .gp-pw-label-pos {
          position: absolute;
          left: 50%;
          top: 50%;
          transform-origin: 0 0;
        }
        .gp-pw-label {
          display: block;
          transform: translate(-50%, -50%);
          font-family: var(--font-mono-arcade);
          font-weight: 700;
          font-size: clamp(5px, 1.7vw, 9px);
          text-shadow: 0 1px 0 #00000070;
        }
        .gp-pw-hub {
          position: absolute;
          left: 50%;
          top: 50%;
          width: 30%;
          height: 30%;
          transform: translate(-50%, -50%);
          border-radius: 50%;
          display: grid;
          place-items: center;
          background: linear-gradient(180deg, #34271a, #1d150d);
          border: 1px solid var(--border-ink);
          box-shadow: inset 0 1px 0 #ffffff20, 0 2px 0 var(--shadow-color),
            0 4px 9px #00000055;
        }
        .gp-pw-hub-label {
          font-family: var(--font-mono-arcade);
          font-weight: 700;
          font-size: clamp(4px, 1.7vw, 9px);
          letter-spacing: 0.06em;
          color: #f6e4bd;
        }
        @keyframes gp-pw-spin {
          0% {
            transform: rotate(0deg);
          }
          78%,
          100% {
            transform: rotate(${FINAL_ROT}deg);
          }
        }
      `}</style>
    </div>
  );
}
