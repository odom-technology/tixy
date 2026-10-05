"use client";

/* Roulette wheel: an SVG wheel with its pocket numbers, a ball on the rim, and
 * the motion that joins them.
 *
 * Real wheel: the wheel turns one way, the ball runs the other way round the
 * track, slows, drops in and rides with the wheel. The two angles live in one
 * rAF loop (no React state per frame), and the landing is planned in the
 * wheel's own frame, so the ball always comes to rest in the winning pocket
 * and nothing drifts from round to round.
 *
 * Angles are degrees clockwise from the top, which is how SVG's rotate() and
 * a clock both count.
 */

import { useEffect, useRef, type MutableRefObject } from "react";
import { feltColor } from "./_roulette-felt";

/** European wheel order (single zero), clockwise from the zero. The server has
 *  no pocket order (it draws 0 to 36 straight from the seed), so this is the
 *  visual order only; the winning pocket still comes from the server. */
export const WHEEL_ORDER = [
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24,
  16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26,
] as const;

const POCKETS = WHEEL_ORDER.length;
const SEG = 360 / POCKETS;

/** Where a pocket's centre sits on the wheel, clockwise from the top. */
function pocketAngle(pocket: number): number {
  const slot = (WHEEL_ORDER as readonly number[]).indexOf(pocket);
  return ((slot >= 0 ? slot : 0) + 0.5) * SEG;
}

/* ── Geometry (viewBox is -100 to 100) ───────────────────────────────────── */
const R_TRACK_IN = 90;
const R_NUM_IN = 75;
const R_FLOOR_IN = 55;
const R_NUM = 82.5;
/** The ball's radius on the rim and in a pocket. */
const R_RIM = 94;
const R_POCKET = 65;

/* ── Motion ──────────────────────────────────────────────────────────────── */
/** deg/s: the wheel turns clockwise, the ball runs the other way. */
const WHEEL_SPEED = 96;
const BALL_SPEED = -760;
/** From the answer arriving to the wheel standing still. */
const LAND_S = 3.6;
/** Where in the landing the ball drops and hops, as fractions of LAND_S. */
const DROP_AT = 0.42;
const DROP_DONE = 0.72;
const BEATS = [0.44, 0.7, 0.82, 0.92] as const;

export type WheelEngine = {
  /** Spin the wheel up and send the ball round the rim. Call on press. */
  launch: () => void;
  /** The answer is in: slow down and drop the ball into `pocket`. `onBeat`
   *  fires as it drops and hops (for a tick), `onLanded` once it has stopped. */
  land: (pocket: number, onLanded: () => void, onBeat?: (n: number) => void) => void;
  /** Put the ball in `pocket` without moving (reduced motion). */
  snap: (pocket: number) => void;
  /** Let the wheel and ball run down where they are (the round failed). */
  stop: () => void;
  dispose: () => void;
};

type Draw = (wheelDeg: number, ballDeg: number, ballRadius: number, ballShown: boolean) => void;

function createWheelEngine(draw: Draw): WheelEngine {
  let tw = 0;
  let tb = 0;
  let vw = 0;
  let vb = 0;
  let r = R_POCKET;
  let shown = false;
  let phase: "rest" | "launch" | "land" | "stop" = "rest";
  let raf = 0;
  let last = 0;
  let plan: {
    t0: number;
    tw0: number;
    w0: number;
    r0: number;
    c: number;
    travel: number;
    power: number;
    beat: number;
    onLanded: () => void;
    onBeat?: (n: number) => void;
  } | null = null;

  const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

  const frame = (now: number) => {
    raf = 0;
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;

    if (phase === "launch") {
      vw += (WHEEL_SPEED - vw) * (1 - Math.exp(-dt * 2.2));
      vb += (BALL_SPEED - vb) * (1 - Math.exp(-dt * 7));
      r += (R_RIM - r) * (1 - Math.exp(-dt * 6));
      tw += vw * dt;
      tb += vb * dt;
    } else if (phase === "stop") {
      const k = Math.exp(-dt * 3);
      vw *= k;
      vb *= k;
      r += (R_POCKET - r) * (1 - Math.exp(-dt * 5));
      tw += vw * dt;
      tb += vb * dt;
      if (Math.abs(vw) < 0.5 && Math.abs(vb) < 0.5) phase = "rest";
    } else if (phase === "land" && plan) {
      const p = plan;
      const sec = (now - p.t0) / 1000;
      const u = Math.min(sec / LAND_S, 1);
      // The wheel slows in a straight line to a stop at the end.
      tw = p.tw0 + ((p.w0 * LAND_S) / 2) * (1 - (1 - u) * (1 - u));
      // The ball's lead over its pocket runs down to 0 with the speed it had
      // when the answer came in, so nothing jumps.
      const rattle = (() => {
        const s = clamp01((u - DROP_DONE) / (1 - DROP_DONE));
        return 2.6 * Math.sin(2 * Math.PI * 3 * s) * (1 - s) * (1 - s);
      })();
      tb = tw + p.c + p.travel * Math.pow(1 - u, p.power) + rattle;
      // On the rim, then down into the pocket, then a few hops.
      const rim = R_RIM + (p.r0 - R_RIM) * Math.exp(-sec * 6);
      const s = clamp01((u - DROP_AT) / (DROP_DONE - DROP_AT));
      const fall = s * s * (3 - 2 * s);
      const h = clamp01((u - 0.66) / 0.34);
      const hop = 3.2 * Math.abs(Math.sin(Math.PI * 3 * h)) * (1 - h) * (1 - h);
      r = rim + (R_POCKET - rim) * fall + hop;
      while (p.beat < BEATS.length && u >= BEATS[p.beat]!) p.onBeat?.(p.beat++);
      if (u >= 1) {
        tw = (p.tw0 + (p.w0 * LAND_S) / 2) % 360;
        tb = tw + p.c;
        vw = 0;
        vb = 0;
        r = R_POCKET;
        phase = "rest";
        plan = null;
        draw(tw, tb, r, shown);
        p.onLanded();
        return;
      }
    }

    draw(tw, tb, r, shown);
    if (phase !== "rest") raf = requestAnimationFrame(frame);
  };

  const run = () => {
    if (raf) return;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  };

  return {
    launch() {
      if (!shown) {
        shown = true;
        tb = tw;
      }
      phase = "launch";
      plan = null;
      run();
    },
    land(pocket, onLanded, onBeat) {
      if (phase !== "launch") phase = "launch";
      const c = pocketAngle(pocket);
      // Speed of the ball against the wheel right now (it runs the other way).
      const rel = Math.min(vb - vw, -150);
      const behind = (((tb - tw - c) % 360) + 360) % 360;
      // Pick the whole turns so the slowdown has the same shape every time.
      const speed = -rel;
      const lo = (speed * LAND_S) / 3.6;
      const travel = behind + 360 * Math.ceil((lo - behind) / 360);
      plan = {
        t0: performance.now(),
        tw0: tw,
        w0: vw,
        r0: r,
        c,
        travel,
        power: (speed * LAND_S) / travel,
        beat: 0,
        onLanded,
        onBeat,
      };
      phase = "land";
      run();
    },
    snap(pocket) {
      shown = true;
      phase = "rest";
      plan = null;
      tb = tw + pocketAngle(pocket);
      r = R_POCKET;
      draw(tw, tb, r, shown);
    },
    stop() {
      if (phase === "land") return;
      phase = "stop";
      plan = null;
      run();
    },
    dispose() {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      phase = "rest";
      plan = null;
    },
  };
}

/* ── Drawing ─────────────────────────────────────────────────────────────── */

const point = (radius: number, deg: number) => {
  const a = (deg * Math.PI) / 180;
  return `${(radius * Math.sin(a)).toFixed(2)} ${(-radius * Math.cos(a)).toFixed(2)}`;
};

/** A ring slice between two radii and two angles. */
function wedge(r1: number, r2: number, a0: number, a1: number): string {
  return `M${point(r1, a0)}L${point(r2, a0)}A${r2} ${r2} 0 0 1 ${point(r2, a1)}L${point(r1, a1)}A${r1} ${r1} 0 0 0 ${point(r1, a0)}Z`;
}

const POCKET_FILL = {
  red: "var(--enamel-danger)",
  black: "#15100b",
  green: "var(--enamel-prize)",
} as const;
const POCKET_INK = {
  red: "var(--enamel-danger-on)",
  black: "#f6eddc",
  green: "var(--enamel-prize-on)",
} as const;

const SLOTS = WHEEL_ORDER.map((n, i) => ({
  n,
  mid: (i + 0.5) * SEG,
  color: feltColor(n),
  floor: wedge(R_FLOOR_IN, R_NUM_IN, i * SEG, (i + 1) * SEG),
  band: wedge(R_NUM_IN, R_TRACK_IN, i * SEG, (i + 1) * SEG),
}));

export function RouletteWheel({
  engineRef,
  pocket,
}: {
  engineRef: MutableRefObject<WheelEngine | null>;
  /** The winning pocket once the ball has stopped, else null. */
  pocket: number | null;
}) {
  const spinRef = useRef<SVGGElement>(null);
  const ballRef = useRef<SVGGElement>(null);

  useEffect(() => {
    const wheel = spinRef.current;
    const ball = ballRef.current;
    if (!wheel || !ball) return;
    const engine = createWheelEngine((wheelDeg, ballDeg, radius, shown) => {
      wheel.setAttribute("transform", `rotate(${wheelDeg.toFixed(2)})`);
      const a = (ballDeg * Math.PI) / 180;
      ball.setAttribute(
        "transform",
        `translate(${(radius * Math.sin(a)).toFixed(2)} ${(-radius * Math.cos(a)).toFixed(2)})`,
      );
      ball.style.display = shown ? "" : "none";
    });
    engineRef.current = engine;
    return () => {
      engine.dispose();
      engineRef.current = null;
    };
  }, [engineRef]);

  const slot = pocket != null ? SLOTS.find((s) => s.n === pocket) : undefined;

  return (
    <div className="rl-wheel-slot">
      <div className="rl-wheel">
        <svg viewBox="-100 -100 200 200" role="img" aria-label="roulette wheel">
          <circle r="100" fill="#1d140d" />
          <circle r={R_TRACK_IN} fill="#2b2119" />
          <circle r={R_TRACK_IN} fill="none" stroke="#f6eddc" strokeOpacity="0.18" strokeWidth="0.6" />
          <g ref={spinRef}>
            {SLOTS.map((s) => (
              <g key={s.n}>
                <path d={s.band} fill={POCKET_FILL[s.color]} />
                <path d={s.floor} fill={POCKET_FILL[s.color]} fillOpacity="0.72" />
                <text
                  transform={`rotate(${s.mid}) translate(0 ${-R_NUM})`}
                  textAnchor="middle"
                  dominantBaseline="central"
                  className="rl-wheel-num"
                  fill={POCKET_INK[s.color]}
                >
                  {s.n}
                </text>
              </g>
            ))}
            {/* pocket dividers and the line between the numbers and the pockets */}
            {SLOTS.map((s) => (
              <line
                key={`d${s.n}`}
                x1="0"
                y1={-R_FLOOR_IN}
                x2="0"
                y2={-R_TRACK_IN}
                transform={`rotate(${s.mid - SEG / 2})`}
                stroke="#f6eddc"
                strokeOpacity="0.5"
                strokeWidth="0.45"
              />
            ))}
            <circle r={R_NUM_IN} fill="none" stroke="#1d140d" strokeWidth="0.8" />
            <circle r={R_FLOOR_IN} fill="#2b2119" />
            {[0, 90, 180, 270].map((a) => (
              <line
                key={a}
                x1="0"
                y1="-30"
                x2="0"
                y2={-R_FLOOR_IN + 4}
                transform={`rotate(${a})`}
                stroke="#f6eddc"
                strokeOpacity="0.55"
                strokeWidth="3"
                strokeLinecap="round"
              />
            ))}
            {slot ? (
              <g key={slot.n} className="rl-lit">
                <path d={slot.band} fill="#f4ebdc" />
                <text
                  transform={`rotate(${slot.mid}) translate(0 ${-R_NUM})`}
                  textAnchor="middle"
                  dominantBaseline="central"
                  className="rl-wheel-num"
                  fill="#1f1a16"
                >
                  {slot.n}
                </text>
                <path
                  d={wedge(R_FLOOR_IN, R_TRACK_IN, slot.mid - SEG / 2, slot.mid + SEG / 2)}
                  fill="none"
                  stroke="#f4ebdc"
                  strokeWidth="1.8"
                  strokeLinejoin="round"
                />
              </g>
            ) : null}
          </g>
          <circle r="31" fill="#1d140d" stroke="#f6eddc" strokeOpacity="0.4" strokeWidth="1" />
          <g ref={ballRef} style={{ display: "none" }}>
            <circle r="3.6" cx="0.7" cy="1" fill="#000" fillOpacity="0.45" />
            <circle r="3.6" fill="#f4ebdc" stroke="#1f1a16" strokeWidth="0.8" />
          </g>
        </svg>
        {pocket != null ? (
          <span
            key={pocket}
            className={`rl-hub rl-hub-${feltColor(pocket)} arcade-num`}
            aria-hidden
          >
            {pocket}
          </span>
        ) : null}
      </div>
    </div>
  );
}
