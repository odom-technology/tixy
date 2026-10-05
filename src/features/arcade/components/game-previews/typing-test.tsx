/* Hover preview for Typing Test (DEFAULT theme).
 * A recessed text "well" holds a mono line of letters. An amber bar caret
 * sweeps left -> right; each letter snaps to cream (correct) as the caret
 * passes it — with one red incorrect letter mid-line — while a mono WPM
 * readout ticks up. Pure CSS, infinite loop. Mirrors the real default theme:
 *   caret   = var(--enamel-tickets)        #f2a33c
 *   correct = var(--text-strong)           #f6eddc (cream)
 *   error   = var(--enamel-danger-text)    #ff8a85 (red)
 *   untyped = var(--text-muted)            #b3a48a
 *   surface = var(--surface-well)          #17110a
 */
export default function TypingTestPreview() {
  // The brown-fox pangram fragment. One letter is flagged as a "miss" (red).
  const letters = [
    'q',
    'u',
    'i',
    'c',
    'k',
    ' ',
    'b',
    'r',
    'o',
    'w',
    'n',
    ' ',
    'f',
    'o',
    'x',
  ];
  // Index of the single incorrect keystroke (the 'w' in "brown").
  const missIndex = 9;

  return (
    <div className="absolute inset-0 overflow-hidden">
      <div className="gp-typing-well">
        <div className="gp-typing-line">
          {letters.map((ch, i) => (
            <span
              key={i}
              className={
                ch === ' '
                  ? 'gp-typing-space'
                  : i === missIndex
                    ? 'gp-typing-ch gp-typing-miss'
                    : 'gp-typing-ch'
              }
              style={{ ['--gp-typing-i' as string]: i }}
            >
              {ch === ' ' ? ' ' : ch}
            </span>
          ))}
          {/* amber bar caret rides the line, sweeping with the letter reveals */}
          <span className="gp-typing-caret" />
        </div>
      </div>

      <div className="gp-typing-hud">
        <span className="gp-typing-wpm-stack">
          <span className="gp-typing-wpm-n gp-typing-wpm-n0">28</span>
          <span className="gp-typing-wpm-n gp-typing-wpm-n1">54</span>
          <span className="gp-typing-wpm-n gp-typing-wpm-n2">71</span>
        </span>
        <span className="gp-typing-wpm-unit">wpm</span>
      </div>

      <style jsx>{`
        /* recessed lacquered text screen, like the real .tt-well-screen */
        .gp-typing-well {
          position: absolute;
          left: 8%;
          right: 8%;
          top: 34%;
          height: 30%;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 8px;
          background: var(--surface-well);
          box-shadow:
            inset 0 2px 12px #000000bb,
            inset 0 0 0 1px #ffffff08;
          overflow: hidden;
        }

        .gp-typing-line {
          position: relative;
          display: flex;
          align-items: center;
          font-family: var(--font-mono-arcade), monospace;
          font-size: 0.95rem;
          font-weight: 500;
          letter-spacing: 0.02em;
          white-space: nowrap;
        }

        .gp-typing-ch {
          /* untyped letters sit muted until the caret sweeps past them */
          color: var(--text-muted);
          animation: gp-typing-fill 3.4s steps(1, end) infinite;
          animation-delay: calc(var(--gp-typing-i) * 0.165s);
        }
        /* the single mistyped key snaps to red instead of cream */
        .gp-typing-miss {
          animation-name: gp-typing-miss;
        }
        .gp-typing-space {
          display: inline-block;
          width: 0.42em;
        }

        .gp-typing-caret {
          position: absolute;
          left: 0;
          width: 3px;
          height: 1.15em;
          border-radius: 9999px;
          background: var(--enamel-tickets);
          /* sweep across the line, then blink-reset at the wrap */
          animation:
            gp-typing-sweep 3.4s steps(15, end) infinite,
            gp-typing-blink 1s steps(1, end) infinite;
        }

        /* HUD readout — mono, cream, ticking number with a faint unit */
        .gp-typing-hud {
          position: absolute;
          left: 50%;
          bottom: 13%;
          transform: translateX(-50%);
          display: flex;
          align-items: baseline;
          gap: 0.28em;
          font-family: var(--font-mono-arcade), monospace;
        }
        .gp-typing-wpm-stack {
          position: relative;
          display: inline-block;
          min-width: 1.6em;
          height: 0.85rem;
          text-align: right;
        }
        .gp-typing-wpm-n {
          position: absolute;
          right: 0;
          bottom: 0;
          font-size: 0.82rem;
          font-weight: 700;
          color: var(--enamel-tickets-text, var(--enamel-tickets));
          opacity: 0;
          animation: gp-typing-wpm-tick 3.4s ease-out infinite;
        }
        .gp-typing-wpm-n0 {
          animation-delay: 0s;
        }
        .gp-typing-wpm-n1 {
          animation-delay: 0.85s;
        }
        .gp-typing-wpm-n2 {
          animation-delay: 1.7s;
        }
        .gp-typing-wpm-unit {
          font-size: 0.55rem;
          font-weight: 600;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--text-muted);
        }

        @keyframes gp-typing-fill {
          0% {
            color: var(--text-muted);
          }
          /* once the caret passes, hold cream until the loop wraps */
          1%,
          90% {
            color: var(--text-strong);
          }
          100% {
            color: var(--text-muted);
          }
        }

        @keyframes gp-typing-miss {
          0% {
            color: var(--text-muted);
          }
          1%,
          90% {
            color: var(--enamel-danger-text);
          }
          100% {
            color: var(--text-muted);
          }
        }

        @keyframes gp-typing-sweep {
          0% {
            left: 0;
          }
          /* track the last revealed glyph, then snap back for the next loop */
          90% {
            left: 100%;
          }
          100% {
            left: 100%;
          }
        }

        @keyframes gp-typing-blink {
          0%,
          55% {
            opacity: 1;
          }
          56%,
          100% {
            opacity: 0.2;
          }
        }

        @keyframes gp-typing-wpm-tick {
          0% {
            opacity: 0;
            transform: translateY(2px);
          }
          6% {
            opacity: 1;
            transform: translateY(0);
          }
          20% {
            opacity: 1;
          }
          25%,
          100% {
            opacity: 0;
          }
        }
      `}</style>
    </div>
  );
}
