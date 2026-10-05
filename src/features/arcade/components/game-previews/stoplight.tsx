'use client';

/* Stoplight ("Lucky Wheel") hover preview — emulates the real wheel
   (src/app/(games)/stoplight/_stoplight-client.tsx + _stoplight-midway.css):
   the real 8 weighted enamel lanes painted from the exact SEGMENTS table
   (Lose 47.5% #1b130b, 0.5x #c47c1f, 1x #f2a33c, 2x #2fb8a6, 3x #1d8579,
   5x #c73538, 10x #98262a, 25x #f7bd5e) as a conic-gradient from 0°, seamed by
   thin lane pegs and labelled with mono numerals. A cream key-faced pointer
   (flapper + bolt) overhangs the top; a cream "SPIN" hub bolts the center.
   The wheel does the real spin — 5 full turns easing to rest under the pointer
   on the rare 25x lane (cubic-bezier(0.17,0.67,0.12,0.99)). Flat enamel,
   nothing glows. */

type Segment = { label: string; weight: number; color: string };

// The real SEGMENTS (color + weight verbatim; multipliers omitted, cosmetic-only).
const SEGMENTS: Segment[] = [
  { label: 'Lose', weight: 47.5, color: '#1b130b' },
  { label: '0.5x', weight: 20, color: '#c47c1f' },
  { label: '1x', weight: 14.5, color: '#f2a33c' },
  { label: '2x', weight: 9, color: '#2fb8a6' },
  { label: '3x', weight: 4, color: '#1d8579' },
  { label: '5x', weight: 3, color: '#c73538' },
  { label: '10x', weight: 1.5, color: '#98262a' },
  { label: '25x', weight: 0.5, color: '#f7bd5e' },
];

const TOTAL = SEGMENTS.reduce((s, x) => s + x.weight, 0); // 100

// Per-lane start/end angles (deg, 0 = top), exactly like computeSegmentAngles().
const ANGLES = (() => {
  const out: { start: number; end: number; mid: number }[] = [];
  let cum = 0;
  for (const seg of SEGMENTS) {
    const start = (cum / TOTAL) * 360;
    cum += seg.weight;
    const end = (cum / TOTAL) * 360;
    out.push({ start, end, mid: (start + end) / 2 });
  }
  return out;
})();

// conic-gradient from 0deg, clockwise — buildConicGradient() from the client.
const CONIC = (() => {
  const stops: string[] = [];
  let cum = 0;
  for (const seg of SEGMENTS) {
    const pct = (seg.weight / TOTAL) * 100;
    stops.push(`${seg.color} ${cum}% ${cum + pct}%`);
    cum += pct;
  }
  return `conic-gradient(from 0deg, ${stops.join(', ')})`;
})();

// Land on the 25x lane (last segment). computeTargetRotation: rotate so the
// lane midpoint sits under the top pointer → 360 - mid, plus 5 full turns.
const LAND_MID = ANGLES[ANGLES.length - 1].mid;
const FINAL_ROT = 5 * 360 + ((360 - LAND_MID) % 360);

export default function StoplightPreview() {
  return (
    <div className='absolute inset-0 overflow-hidden gp-sl-root'>
      <div className='gp-sl-wrap'>
        {/* cream key-faced pointer (flapper) overhanging the top */}
        <span className='gp-sl-pointer-base' aria-hidden />
        <span className='gp-sl-pointer-blade' aria-hidden />
        <span className='gp-sl-pointer-bolt' aria-hidden />

        {/* wooden cabinet ring around the enamel wheel */}
        <div className='gp-sl-ring'>
          <div className='gp-sl-wheel' style={{ background: CONIC }}>
            {/* lane seam pegs at each boundary */}
            {ANGLES.map(({ start }, i) => (
              <span
                className='gp-sl-spoke'
                key={`s-${i}`}
                style={{ transform: `translateX(-50%) rotate(${start + 180}deg)` }}
              />
            ))}
            {/* mono lane labels */}
            {SEGMENTS.map((seg, i) => (
              <div
                className='gp-sl-label-pos'
                key={`l-${i}`}
                style={{
                  transform: `rotate(${ANGLES[i].mid}deg) translateY(-38%) rotate(${-ANGLES[i].mid}deg)`,
                }}
              >
                <span className='gp-sl-label'>{seg.label}</span>
              </div>
            ))}
            {/* cream SPIN hub with bolt */}
            <div className='gp-sl-hub'>
              <span className='gp-sl-hub-bolt' aria-hidden />
              <span className='gp-sl-hub-label'>SPIN</span>
            </div>
          </div>
        </div>
      </div>

      <style jsx>{`
        .gp-sl-root {
          background: var(--screen-well);
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .gp-sl-wrap {
          position: relative;
          height: 92%;
          aspect-ratio: 1;
          padding-top: 9px;
        }
        /* ── pointer (flapper) ── */
        .gp-sl-pointer-base {
          position: absolute;
          left: 50%;
          top: 0;
          z-index: 20;
          width: 0;
          height: 0;
          transform: translateX(-50%);
          border-left: 11px solid transparent;
          border-right: 11px solid transparent;
          border-top: 22px solid #2c1d0e;
          filter: drop-shadow(0 2px 3px #00000080);
        }
        .gp-sl-pointer-blade {
          position: absolute;
          left: 50%;
          top: 0;
          z-index: 21;
          width: 0;
          height: 0;
          transform: translateX(-50%);
          border-left: 8px solid transparent;
          border-right: 8px solid transparent;
          border-top: 18px solid var(--key-face);
        }
        .gp-sl-pointer-bolt {
          position: absolute;
          left: 50%;
          top: -2px;
          z-index: 22;
          width: 9px;
          height: 9px;
          border-radius: 50%;
          transform: translateX(-50%);
          background: radial-gradient(circle at 35% 30%, #fdf7ea, #b7a784 70%);
          border: 1px solid var(--key-face-edge);
          box-shadow: inset 0 1px 0 #fffaf0, 0 1px 0 var(--shadow-color);
        }
        /* ── cabinet ring ── */
        .gp-sl-ring {
          position: absolute;
          inset: 9px 0 0;
          border-radius: 50%;
          background:
            radial-gradient(circle at 50% 32%, #34271a, #1d150d 70%),
            var(--surface-raised);
          border: 1px solid var(--border-ink);
          box-shadow: inset 0 2px 0 var(--bevel-hi), inset 0 0 0 5px #14100b,
            inset 0 0 0 6px #00000080, 0 5px 0 var(--shadow-color),
            0 8px 18px #00000055;
        }
        /* ── enamel wheel ── */
        .gp-sl-wheel {
          position: absolute;
          inset: 5px;
          border-radius: 50%;
          box-shadow: inset 0 0 0 2px #00000070, inset 0 2px 10px #00000066;
          animation: gp-sl-spin 3.6s cubic-bezier(0.17, 0.67, 0.12, 0.99)
            infinite;
        }
        .gp-sl-spoke {
          position: absolute;
          left: 50%;
          top: 50%;
          width: 1px;
          height: 50%;
          transform-origin: top center;
          background: linear-gradient(to bottom, #00000000, #00000040 30%, #1108037a);
          box-shadow: 1px 0 0 #ffffff12;
        }
        .gp-sl-label-pos {
          position: absolute;
          left: 50%;
          top: 50%;
          transform-origin: 0 0;
        }
        .gp-sl-label {
          display: block;
          transform: translate(-50%, -50%);
          font-family: var(--font-mono-arcade);
          font-weight: 700;
          font-size: clamp(5px, 1.9vw, 10px);
          letter-spacing: -0.01em;
          color: #fbf4e3;
          text-shadow: 0 1px 0 #00000099, 0 0 1px #00000080;
        }
        .gp-sl-hub {
          position: absolute;
          left: 50%;
          top: 50%;
          width: 34%;
          height: 34%;
          transform: translate(-50%, -50%);
          border-radius: 50%;
          display: grid;
          place-items: center;
          background: linear-gradient(180deg, #fbf4e3, #e6d9bd);
          border: 1px solid var(--key-face-edge);
          box-shadow: inset 0 1px 0 #fffaf0, inset 0 -3px 5px #c9b79180,
            0 2px 0 var(--shadow-color), 0 4px 9px #00000055;
        }
        .gp-sl-hub-bolt {
          position: absolute;
          top: 11%;
          left: 50%;
          width: 18%;
          height: 18%;
          transform: translateX(-50%);
          border-radius: 50%;
          background: radial-gradient(circle at 35% 30%, #f3dcae, #7a5a2c);
          box-shadow: inset 0 0 1px #00000060;
        }
        .gp-sl-hub-label {
          font-family: var(--font-mono-arcade);
          font-weight: 700;
          font-size: clamp(5px, 2vw, 11px);
          letter-spacing: 0.06em;
          color: var(--key-face-on);
        }

        /* real spin: 5 full turns easing to rest under the top pointer */
        @keyframes gp-sl-spin {
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
