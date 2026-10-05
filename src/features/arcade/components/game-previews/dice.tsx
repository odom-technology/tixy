'use client';

/* Dice hover preview — emulates the real Dice screen
   (src/app/(games)/dice/_dice-client.tsx). The real game is NOT a pair of
   tumbling dice: it's an over/under gauge. A big mono number reads out the roll
   (1–100) over an etched horizontal track split into two solid enamel zones at
   the target threshold — for the default "Over 50", danger (--enamel-danger)
   below 50 and prize (--enamel-prize) above. A thin key-face threshold marker
   sits at the target, and a beveled die token (a real lucide-style pip face)
   tumbles, then slides along the track to the rolled position, painted
   prize/green on a win. This loop rolls Over 50 and lands a winning 72.
   Flat enamel, nothing glows. */

const TARGET = 50; // real default target
const ROLL = 72; // a winning over-50 roll
// die token sits at ((roll - 1) / 99) of the track width
const ROLL_X = ((ROLL - 1) / 99) * 100;
const START_X = ((50 - 1) / 99) * 100; // prevIndicatorRef starts at 50
const THRESH_X = ((TARGET - 1) / 98) * 100;

// Over 50 → danger 0..target, prize target..100 (real barFill, "over" branch).
const BAR_FILL = `linear-gradient(to right, var(--enamel-danger) 0%, var(--enamel-danger) ${TARGET}%, var(--enamel-prize) ${TARGET}%, var(--enamel-prize) 100%)`;

// roll 72 → die face index (72 % 6 = 0 → face 6: 3-3 pip columns)
const PIPS_SIX = [0, 2, 3, 5, 6, 8]; // 3×3 grid indices for a six-face

export default function DicePreview() {
  return (
    <div className='absolute inset-0 overflow-hidden gp-dice-root'>
      {/* big mono readout — the rolled number, painted enamel */}
      <div className='gp-dice-readout'>
        <span className='gp-dice-num' />
        <span className='gp-dice-tag' />
      </div>

      {/* the gauge */}
      <div className='gp-dice-gauge'>
        <div className='gp-dice-track' style={{ background: BAR_FILL }} />
        <div className='gp-dice-thresh' style={{ left: `${THRESH_X}%` }} />
        <div className='gp-dice-token-wrap'>
          <div className='gp-dice-token'>
            <div className='gp-dice-face'>
              {Array.from({ length: 9 }).map((_, i) => (
                <span
                  className={`gp-dice-pip${PIPS_SIX.includes(i) ? ' on' : ''}`}
                  key={i}
                />
              ))}
            </div>
          </div>
        </div>
        <div className='gp-dice-scale'>
          {[1, 25, 50, 75, 100].map((n) => (
            <span key={n}>{n}</span>
          ))}
        </div>
      </div>

      <style jsx>{`
        .gp-dice-root {
          background:
            repeating-linear-gradient(
              90deg,
              transparent 0 calc(10% - 1px),
              #ffffff08 calc(10% - 1px) 10%
            ),
            var(--screen-well);
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 8%;
          padding: 0 8%;
        }
        .gp-dice-readout {
          display: flex;
          flex-direction: column;
          align-items: center;
          line-height: 1;
        }
        .gp-dice-num {
          font-family: var(--font-mono-arcade);
          font-weight: 700;
          font-size: clamp(26px, 9vw, 48px);
          line-height: 1;
          color: var(--enamel-prize-text);
          text-shadow: 0 1px 8px rgba(0, 0, 0, 0.6);
          animation: gp-dice-num 3.2s steps(1, end) infinite;
        }
        .gp-dice-num::after {
          content: '50';
          animation: gp-dice-num 3.2s steps(1, end) infinite;
        }
        .gp-dice-tag {
          margin-top: 4px;
          font-family: var(--font-mono-arcade);
          font-weight: 600;
          font-size: clamp(7px, 2.4vw, 11px);
          letter-spacing: 0.04em;
          color: var(--enamel-prize-text);
          opacity: 0;
          animation: gp-dice-tag 3.2s steps(1, end) infinite;
        }
        .gp-dice-tag::after {
          content: 'OVER 50';
          animation: gp-dice-tag-text 3.2s steps(1, end) infinite;
        }
        .gp-dice-gauge {
          position: relative;
          width: 100%;
          max-width: 86%;
          height: 30px;
        }
        .gp-dice-track {
          position: absolute;
          top: 50%;
          left: 0;
          right: 0;
          height: 9px;
          transform: translateY(-50%);
          border-radius: 999px;
          border: 1.5px solid var(--border-ink);
          overflow: hidden;
          box-shadow: inset 0 2px 5px #000000aa, inset 0 0 0 1px #ffffff10;
        }
        .gp-dice-thresh {
          position: absolute;
          top: 50%;
          width: 3px;
          height: 18px;
          transform: translate(-50%, -50%);
          border-radius: 999px;
          border: 1px solid var(--border-ink);
          background: var(--key-face);
          z-index: 2;
        }
        .gp-dice-token-wrap {
          position: absolute;
          top: 50%;
          left: ${START_X}%;
          transform: translate(-50%, -50%);
          z-index: 3;
          animation: gp-dice-slide 3.2s cubic-bezier(0.22, 1, 0.36, 1) infinite;
        }
        .gp-dice-token {
          width: 22px;
          height: 22px;
          border-radius: var(--radius-tag, 4px);
          border: 2px solid var(--border-ink);
          background: var(--key-face);
          box-shadow: inset 0 1px 0 #ffffff80, 0 2px 4px #00000070;
          animation: gp-dice-token-color 3.2s steps(1, end) infinite,
            gp-dice-tumble 3.2s linear infinite;
        }
        .gp-dice-face {
          position: absolute;
          inset: 18%;
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          grid-template-rows: repeat(3, 1fr);
          place-items: center;
        }
        .gp-dice-pip {
          width: 64%;
          aspect-ratio: 1;
          border-radius: 50%;
          background: transparent;
        }
        .gp-dice-pip.on {
          background: var(--key-face-on);
          box-shadow: inset 0 1px 1px rgba(0, 0, 0, 0.5);
        }
        .gp-dice-scale {
          position: absolute;
          left: 0;
          right: 0;
          bottom: -2px;
          display: flex;
          justify-content: space-between;
          font-family: var(--font-mono-arcade);
          font-size: clamp(6px, 1.8vw, 9px);
          color: var(--text-faint);
        }

        /* readout climbs while rolling, then settles on the winning 72 */
        @keyframes gp-dice-num {
          0% {
            content: '50';
          }
          20% {
            content: '38';
          }
          32% {
            content: '61';
          }
          44% {
            content: '29';
          }
          54% {
            content: '83';
          }
          62%,
          100% {
            content: '72';
          }
        }
        @keyframes gp-dice-tag {
          0%,
          61% {
            opacity: 0;
          }
          62%,
          100% {
            opacity: 1;
          }
        }
        @keyframes gp-dice-tag-text {
          0%,
          61% {
            content: 'OVER 50';
          }
          62%,
          100% {
            content: 'WON +97 ×1.94';
          }
        }
        /* token slides to the rolled position; stops tumbling on settle */
        @keyframes gp-dice-slide {
          0%,
          18% {
            left: ${START_X}%;
          }
          62%,
          100% {
            left: ${ROLL_X}%;
          }
        }
        /* tumbles fast while resolving (0–62%), then holds still on settle */
        @keyframes gp-dice-tumble {
          0% {
            transform: rotate(0deg);
          }
          62% {
            transform: rotate(1800deg);
          }
          100% {
            transform: rotate(1800deg);
          }
        }
        /* token paints prize-green once it lands in the win zone */
        @keyframes gp-dice-token-color {
          0% {
            background: var(--key-face);
            animation-timing-function: linear;
          }
          62%,
          100% {
            background: var(--enamel-prize);
            border-color: var(--enamel-prize-edge);
          }
        }
      `}</style>
    </div>
  );
}
