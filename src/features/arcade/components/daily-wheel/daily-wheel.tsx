'use client';

/* The daily wheel's cabinet: the wheel, the flapper, the pegs, the rim
   lights and the handle (DAILY_WHEEL.md, "Feel spec"). The wheel and the
   flapper are their own composited layers, turned from one
   requestAnimationFrame loop with the angle a pure function of time
   (daily-wheel-motion.ts). React renders the cabinet once per state change,
   never per frame.

   The wheel never picks a result: `onSpin` asks the server, and the wheel
   plans its stop only when the answer names a unit. */

import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';

import {
  DAILY_WHEEL_SEGMENTS,
  DAILY_WHEEL_UNIT_DEG,
  DAILY_WHEEL_UNITS,
  type DailyWheelSegment,
} from '@/features/arcade/lib/daily-wheel';
import {
  createWheelMotion,
  flapperContact,
  pegsPassed,
  restRotation,
  WHEEL_TOP_SPEED,
  type WheelStop,
} from '@/features/arcade/lib/daily-wheel-motion';
import { feelReducedMotion } from '@/features/arcade/lib/game-feel';
import { playHaptic } from '@/features/arcade/lib/game-haptics';
import { SoundManager } from '@/features/arcade/lib/sound-manager';

import './daily-wheel.css';

/* The cabinet's drawing space. The wheel's centre and radius set where the
   rotor and the flapper sit as percentages of it. */
const VIEW_W = 460;
const VIEW_H = 420;
const CX = 205;
const CY = 212;
const R = 174; // the wheel's face
const PEG_R = R - 12;
const BULBS = 24;
const BULB_R = R + 17;

const FLAPPER_LEN = 50; // pivot to tip
const PIVOT_Y = CY - PEG_R - FLAPPER_LEN + 9; // the tip reaches 9 past the peg ring
const FLAPPER_MAX = 26; // degrees, at the moment a peg slips
const SPRING_MS = 34; // the flapper's snap back: decay time
const SPRING_PERIOD = 92;

const LEVER_X = 432;
const LEVER_TOP = 104;
const LEVER_TRAVEL = 150;
const PULL_AT = 0.55;

/* Game art (PLAN.md lets game art use any colour): paper and sea glass for
   the body, coral for 40, red for the 100, ticket amber for the 200. */
const FILL: Record<number, string> = {
  10: '#E9DDC8',
  15: '#C4DBD2',
  20: '#86B5AD',
  25: '#F3CB8A',
  40: '#E3906C',
  100: '#B83627',
  200: '#F2A33C',
};
const INK = '#1F1A16';
const PAPER = '#F4EBDC';

const pct = (value: number, of: number) => `${(value / of) * 100}%`;

function polar(radius: number, degrees: number) {
  const rad = (degrees * Math.PI) / 180;
  return { x: radius * Math.sin(rad), y: -radius * Math.cos(rad) };
}

function wedge(segment: DailyWheelSegment, outer = R, inner = 0) {
  const a0 = segment.start * DAILY_WHEEL_UNIT_DEG;
  const a1 = (segment.start + segment.units) * DAILY_WHEEL_UNIT_DEG;
  const p0 = polar(outer, a0);
  const p1 = polar(outer, a1);
  const large = a1 - a0 > 180 ? 1 : 0;
  if (inner <= 0) {
    return `M0 0L${p0.x.toFixed(2)} ${p0.y.toFixed(2)}A${outer} ${outer} 0 ${large} 1 ${p1.x.toFixed(2)} ${p1.y.toFixed(2)}Z`;
  }
  const q1 = polar(inner, a1);
  const q0 = polar(inner, a0);
  return `M${q0.x.toFixed(2)} ${q0.y.toFixed(2)}L${p0.x.toFixed(2)} ${p0.y.toFixed(2)}A${outer} ${outer} 0 ${large} 1 ${p1.x.toFixed(2)} ${p1.y.toFixed(2)}L${q1.x.toFixed(2)} ${q1.y.toFixed(2)}A${inner} ${inner} 0 ${large} 0 ${q0.x.toFixed(2)} ${q0.y.toFixed(2)}Z`;
}

/* The wheel face: drawn once (memo, no props), turned as a layer. Landing
   never repaints it; the light is a layer of its own (WheelGlow). */
const WheelFace = memo(function WheelFace() {
  return (
    <svg viewBox={`${-R - 2} ${-R - 2} ${2 * R + 4} ${2 * R + 4}`} aria-hidden='true' focusable='false'>
      <circle r={R + 1} fill={INK} />
      {DAILY_WHEEL_SEGMENTS.map((segment) => (
        <path key={segment.index} d={wedge(segment, R - 3)} fill={FILL[segment.value] ?? PAPER} />
      ))}
      {/* Unit lines: a hairline on every slot edge. */}
      {DAILY_WHEEL_SEGMENTS.map((segment) => {
        const a = polar(R - 3, segment.start * DAILY_WHEEL_UNIT_DEG);
        return <line key={segment.index} x1={0} y1={0} x2={a.x} y2={a.y} stroke={INK} strokeOpacity={0.55} strokeWidth={1.5} />;
      })}
      {DAILY_WHEEL_SEGMENTS.map((segment) => {
        const mid = (segment.start + segment.units / 2) * DAILY_WHEEL_UNIT_DEG;
        const sliver = segment.units === 1;
        const radius = sliver ? R - 46 : R - 50;
        const at = polar(radius, mid);
        const dark = segment.value === 100;
        return (
          <text
            key={segment.index}
            x={at.x}
            y={at.y}
            transform={`rotate(${mid - 90} ${at.x} ${at.y})`}
            className='dw-value'
            data-sliver={sliver || undefined}
            fill={dark ? PAPER : INK}
            textAnchor='middle'
            dominantBaseline='central'
          >
            {segment.value}
          </text>
        );
      })}
      {/* Pegs on every unit line. */}
      {Array.from({ length: DAILY_WHEEL_UNITS }, (_, unit) => {
        const p = polar(PEG_R, unit * DAILY_WHEEL_UNIT_DEG);
        return (
          <g key={unit}>
            <circle cx={p.x} cy={p.y} r={4.6} fill={INK} />
            <circle cx={p.x - 0.9} cy={p.y - 0.9} r={2.3} fill={PAPER} />
          </g>
        );
      })}
    </svg>
  );
});

/* The landed slot lights and the rest of the wheel dims. Its own layer,
   turned to the wheel's angle, so landing paints only this. */
function WheelGlow({ lit }: { lit: number | null }) {
  return (
    <svg viewBox={`${-R - 2} ${-R - 2} ${2 * R + 4} ${2 * R + 4}`} aria-hidden='true' focusable='false'>
      <g className='dw-dim' data-on={lit !== null || undefined}>
        {DAILY_WHEEL_SEGMENTS.filter((segment) => segment.index !== lit).map((segment) => (
          <path key={segment.index} d={wedge(segment, R - 3)} fill={INK} />
        ))}
      </g>
      {lit !== null ? (
        <path className='dw-lit' d={wedge(DAILY_WHEEL_SEGMENTS[lit]!, R - 3, 42)} fill={PAPER} fillOpacity={0.22} stroke={PAPER} strokeWidth={3} strokeLinejoin='round' />
      ) : null}
    </svg>
  );
}

function segmentOf(unit: number) {
  return DAILY_WHEEL_SEGMENTS.find((s) => unit >= s.start && unit < s.start + s.units)!;
}

export type WheelLanding = { stop: WheelStop; segment: DailyWheelSegment };

export type DailyWheelHandle = {
  /** Pull the handle (the spin button, Space). False if it can't spin now. */
  pull: () => boolean;
  /** Hurry a stop in progress. */
  skip: () => void;
};

type Phase = 'idle' | 'spinning' | 'landed' | 'error';

export const DailyWheel = forwardRef<
  DailyWheelHandle,
  {
    multiplier: number;
    /** Draw the wheel at rest on this stop, lit (already spun). */
    rested: WheelStop | null;
    /** Spinning is allowed (ready and not busy). */
    canSpin: boolean;
    /** Ask the server. Resolve with the drawn stop, or reject to coast. */
    onSpin: () => Promise<WheelStop>;
    onLand: (landing: WheelLanding) => void;
    onSpinError: (error: unknown) => void;
    /** Frame times, for /kit/wheel. */
    /** After each frame's paint: its time, whether the wheel turns, and the
     *  ms the frame's script took. For /kit/wheel's timing. */
    onFrame?: (now: number, turning: boolean, workMs: number) => void;
  }
>(function DailyWheel({ multiplier, rested, canSpin, onSpin, onLand, onSpinError, onFrame }, ref) {
  const rotorRef = useRef<HTMLDivElement>(null);
  const glowRef = useRef<HTMLDivElement>(null);
  const flapperRef = useRef<HTMLDivElement>(null);
  const knobRef = useRef<HTMLDivElement>(null);
  const cabinetRef = useRef<HTMLDivElement>(null);
  const [motion] = useState(() => {
    const created = createWheelMotion(0);
    if (rested) created.restOn(rested);
    return created;
  });
  const [phase, setPhase] = useState<Phase>(rested ? 'landed' : 'idle');
  const [lit, setLit] = useState<number | null>(rested ? segmentOf(rested.unit).index : null);
  const [chase, setChase] = useState<0 | 1 | 3>(0);
  const [fade, setFade] = useState(false);
  const frame = useRef(0);
  const callbacks = useRef({ onSpin, onLand, onSpinError, onFrame });
  callbacks.current = { onSpin, onLand, onSpinError, onFrame };
  const busy = useRef(false);

  // Paint a rotation and the flapper. Kept out of React.
  const flapper = useRef({ lastAngle: 0, releasedAt: -Infinity, released: 0, lastRotation: 0 });
  const paint = useCallback((rotation: number, now: number, speed: number) => {
    const rotor = rotorRef.current;
    const glow = glowRef.current;
    if (glow) glow.style.transform = `rotate(${rotation.toFixed(3)}deg)`;
    if (rotor) {
      rotor.style.transform = `rotate(${rotation.toFixed(3)}deg)`;
      // Above about 1.2 turns a second the face blurs, as an eye sees it.
      const fast = speed > 0.42;
      if (fast !== (rotor.dataset.fast === '1')) rotor.dataset.fast = fast ? '1' : '0';
    }
    const state = flapper.current;
    const passed = pegsPassed(state.lastRotation, rotation);
    if (passed > 0) {
      state.releasedAt = now;
      state.released = FLAPPER_MAX;
      // One click per frame at most; SoundManager spaces them 28 ms apart,
      // so at speed they run into a rattle.
      const slow = 1 - Math.min(1, speed / WHEEL_TOP_SPEED);
      SoundManager.play('wheelPeg', { volume: 0.35 + 0.45 * slow, pitch: 1.04 - 0.1 * slow });
      if (speed < 0.06) playHaptic('tick');
    }
    state.lastRotation = rotation;
    const contact = flapperContact(rotation);
    const pushed = contact ? contact.push * FLAPPER_MAX : 0;
    const since = now - state.releasedAt;
    const spring = since < 260 ? state.released * Math.exp(-since / SPRING_MS) * Math.cos((2 * Math.PI * since) / SPRING_PERIOD) : 0;
    let angle = Math.max(pushed, spring);
    if (spring < 0 && pushed === 0) angle = spring;
    // At speed the pegs come faster than a frame: the flapper buzzes bent.
    const buzz = Math.min(1, Math.max(0, (speed - 0.12) / 0.18));
    if (buzz > 0) angle = angle * (1 - buzz) + buzz * (13 + 6 * Math.sin(now / 9));
    state.lastAngle = angle;
    const flap = flapperRef.current;
    if (flap) flap.style.transform = `rotate(${(-angle).toFixed(2)}deg)`;
  }, []);

  // Draw the resting pose on mount, and move to a stop the server reports
  // while the wheel is idle (spun in another tab).
  const restKey = rested ? `${rested.unit}:${rested.rest}` : '';
  useEffect(() => {
    if (rested && !busy.current) {
      motion.restOn(rested);
      setLit(segmentOf(rested.unit).index);
      setPhase('landed');
    }
    const rotation = motion.angleAt(performance.now());
    flapper.current.lastRotation = rotation;
    paint(rotation, performance.now(), 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restKey, motion, paint]);

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  const land = useCallback(
    (stop: WheelStop) => {
      const segment = segmentOf(stop.unit);
      busy.current = false;
      setPhase('landed');
      setLit(segment.index);
      SoundManager.play('wheelLand');
      playHaptic('tick');
      if (segment.tier !== 'body') {
        // The hit-stop: the lights and the bell wait one beat.
        window.setTimeout(() => {
          SoundManager.play('wheelBig');
          playHaptic('win');
          if (!feelReducedMotion()) {
            setChase(segment.tier === 'top' ? 3 : 1);
            burst(cabinetRef.current);
          }
        }, 60);
      }
      callbacks.current.onLand({ stop, segment });
    },
    [],
  );

  const loop = useCallback(
    (onStopped: () => void) => {
      cancelAnimationFrame(frame.current);
      let stopped = false;
      const tick = (now: number) => {
        const began = performance.now();
        const stopsAt = motion.stopsAt;
        const rotation = motion.angleAt(now);
        paint(rotation, now, motion.speedAt(now));
        callbacks.current.onFrame?.(now, stopsAt === null || now < stopsAt, performance.now() - began);
        if (stopsAt !== null && now >= stopsAt) {
          if (!stopped) {
            stopped = true;
            onStopped();
          }
          // Frames run on only while the flapper's spring settles.
          if (now - flapper.current.releasedAt > 260) return;
        }
        frame.current = requestAnimationFrame(tick);
      };
      frame.current = requestAnimationFrame(tick);
    },
    [motion, paint],
  );

  const spin = useCallback(() => {
    if (busy.current || !canSpin) return false;
    busy.current = true;
    setPhase('spinning');
    setLit(null);
    setChase(0);
    SoundManager.play('wheelPull');
    playHaptic('tap');
    const reduced = feelReducedMotion();
    const request = callbacks.current.onSpin();
    if (reduced) {
      request.then(
        (stop) => {
          // No turning: fade out, move, fade in on the stop.
          setFade(true);
          window.setTimeout(() => {
            motion.restOn(stop);
            paint(restRotation(stop), performance.now(), 0);
            flapper.current.lastRotation = restRotation(stop);
            setFade(false);
            land(stop);
          }, 120);
        },
        (error) => {
          busy.current = false;
          setPhase('error');
          playHaptic('failure');
          callbacks.current.onSpinError(error);
        },
      );
      return true;
    }
    const startAt = performance.now();
    motion.start(startAt, WHEEL_TOP_SPEED);
    flapper.current.lastRotation = motion.angleAt(startAt);
    let stopFor: WheelStop | null = null;
    loop(() => {
      if (stopFor) land(stopFor);
      else {
        busy.current = false;
        setPhase('error');
      }
    });
    request.then(
      (stop) => {
        stopFor = stop;
        motion.stopOn(performance.now(), stop);
      },
      (error) => {
        motion.coast(performance.now());
        playHaptic('failure');
        callbacks.current.onSpinError(error);
      },
    );
    return true;
  }, [canSpin, land, loop, motion, paint]);

  const skip = useCallback(() => {
    if (motion.phase(performance.now()) === 'stopping') motion.skip(performance.now());
  }, [motion]);

  /* ── the handle ─────────────────────────────────────────────────────── */

  const drag = useRef<{ id: number; y0: number; amount: number; moved: boolean } | null>(null);
  const travelPx = () => {
    const box = cabinetRef.current?.getBoundingClientRect();
    return box ? (LEVER_TRAVEL / VIEW_H) * box.height : 120;
  };
  const setKnob = (amount: number) => {
    const knob = knobRef.current;
    if (knob) knob.style.transform = `translateY(${(amount * travelPx()).toFixed(1)}px)`;
  };
  const springKnob = (from: number) => {
    const knob = knobRef.current;
    if (!knob) return;
    setKnob(0);
    if (feelReducedMotion() || typeof knob.animate !== 'function') return;
    knob.animate(
      [{ transform: `translateY(${(from * travelPx()).toFixed(1)}px)` }, { transform: 'translateY(0)' }],
      { duration: 320, easing: 'cubic-bezier(.2,1.5,.4,1)' },
    );
  };
  const pullLever = useCallback(() => {
    if (busy.current || !canSpin) return false;
    const knob = knobRef.current;
    if (knob && !feelReducedMotion() && typeof knob.animate === 'function') {
      knob.animate(
        [
          { transform: 'translateY(0)' },
          { transform: `translateY(${travelPx().toFixed(1)}px)`, offset: 0.22 },
          { transform: 'translateY(0)' },
        ],
        { duration: 410, easing: 'cubic-bezier(.2,1.2,.4,1)' },
      );
    }
    return spin();
  }, [canSpin, spin]);

  useImperativeHandle(ref, () => ({ pull: pullLever, skip }), [pullLever, skip]);

  const onLeverDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (busy.current || !canSpin) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { id: event.pointerId, y0: event.clientY, amount: 0, moved: false };
    SoundManager.play('arcadeBet', { volume: 0.35 });
    playHaptic('tap');
  };
  const onLeverMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    if (!state || state.id !== event.pointerId) return;
    const amount = Math.min(1, Math.max(0, (event.clientY - state.y0) / travelPx()));
    if (Math.abs(event.clientY - state.y0) > 6) state.moved = true;
    state.amount = amount;
    setKnob(amount);
  };
  const onLeverUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    if (!state || state.id !== event.pointerId) return;
    drag.current = null;
    if (!state.moved) {
      setKnob(0);
      pullLever();
      return;
    }
    springKnob(state.amount);
    if (state.amount >= PULL_AT) spin();
  };
  const onLeverCancel = () => {
    const state = drag.current;
    drag.current = null;
    if (state) springKnob(state.amount);
  };

  const rotorBox = {
    left: pct(CX - R - 2, VIEW_W),
    top: pct(CY - R - 2, VIEW_H),
    width: pct(2 * R + 4, VIEW_W),
    height: pct(2 * R + 4, VIEW_H),
  };

  return (
    <div
      ref={cabinetRef}
      className='dw-cabinet'
      data-phase={phase}
      data-chase={chase || undefined}
      data-fade={fade || undefined}
      onPointerDown={(event) => {
        // A tap on the wheel while it slows hurries it.
        if (event.target instanceof Element && event.target.closest('.dw-lever')) return;
        skip();
      }}
    >
      <svg className='dw-back' viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} aria-hidden='true' focusable='false'>
        <circle cx={CX} cy={CY} r={BULB_R + 12} fill='#2B2119' />
        {Array.from({ length: BULBS }, (_, index) => {
          const p = polar(BULB_R, (index * 360) / BULBS);
          return (
            <g key={index} transform={`translate(${CX + p.x} ${CY + p.y})`}>
              <circle r={5.5} className='dw-bulb' />
            </g>
          );
        })}
        {/* The handle's slot. */}
        <rect x={LEVER_X - 9} y={LEVER_TOP - 6} width={18} height={LEVER_TRAVEL + 12} rx={9} fill='#2B2119' />
      </svg>
      <div className='dw-rotor' ref={rotorRef} style={rotorBox}>
        <WheelFace />
      </div>
      <div className='dw-glow' ref={glowRef} style={rotorBox} data-on={lit !== null || undefined}>
        <WheelGlow lit={lit} />
      </div>
      <div className='dw-bulbs' aria-hidden='true'>
        {Array.from({ length: BULBS }, (_, index) => {
          const p = polar(BULB_R, (index * 360) / BULBS);
          return (
            <i
              key={index}
              style={{
                left: pct(CX + p.x - 5.5, VIEW_W),
                top: pct(CY + p.y - 5.5, VIEW_H),
                width: pct(11, VIEW_W),
                height: pct(11, VIEW_H),
                ['--i' as string]: index,
              }}
            />
          );
        })}
      </div>
      <svg className='dw-front' viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} aria-hidden='true' focusable='false'>
        <circle cx={CX} cy={CY} r={40} fill={INK} />
        <circle cx={CX} cy={CY} r={33} fill='#2B2119' />
        <text x={CX} y={CY + 1} className='dw-hub' textAnchor='middle' dominantBaseline='central' fill={PAPER}>
          ×{multiplier}
        </text>
        <circle cx={CX} cy={PIVOT_Y} r={9} fill={INK} />
      </svg>
      <div
        className='dw-flapper'
        ref={flapperRef}
        style={{
          left: pct(CX - 12, VIEW_W),
          top: pct(PIVOT_Y - 4, VIEW_H),
          width: pct(24, VIEW_W),
          height: pct(FLAPPER_LEN + 8, VIEW_H),
          transformOrigin: `50% ${pct(4, FLAPPER_LEN + 8)}`,
        }}
        aria-hidden='true'
      >
        <svg viewBox={`-12 -4 24 ${FLAPPER_LEN + 8}`}>
          <path d={`M-7 0Q-7 -4 0 -4Q7 -4 7 0L2.4 ${FLAPPER_LEN}Q0 ${FLAPPER_LEN + 3} -2.4 ${FLAPPER_LEN}Z`} fill='#F2A33C' stroke={INK} strokeWidth={2} strokeLinejoin='round' />
          <circle r={3} fill={INK} />
        </svg>
      </div>
      <div
        className='dw-lever'
        role='button'
        tabIndex={-1}
        aria-label='pull the handle'
        aria-disabled={!canSpin || phase === 'spinning'}
        style={{
          left: pct(LEVER_X - 24, VIEW_W),
          top: pct(LEVER_TOP - 24, VIEW_H),
          width: pct(48, VIEW_W),
          height: pct(LEVER_TRAVEL + 48, VIEW_H),
        }}
        onPointerDown={onLeverDown}
        onPointerMove={onLeverMove}
        onPointerUp={onLeverUp}
        onPointerCancel={onLeverCancel}
      >
        <div className='dw-knob' ref={knobRef} />
      </div>
    </div>
  );
});

/* Chips from the flapper when the 100 or the 200 hits. */
function burst(cabinet: HTMLElement | null) {
  if (!cabinet || typeof cabinet.animate !== 'function') return;
  const box = cabinet.getBoundingClientRect();
  const x = (CX / VIEW_W) * box.width;
  const y = ((CY - R + 26) / VIEW_H) * box.height;
  const colours = ['#F2A33C', '#F2A33C', '#F4EBDC', '#B83627'];
  for (let index = 0; index < 14; index += 1) {
    const chip = document.createElement('i');
    chip.className = 'dw-chip';
    chip.style.left = `${x}px`;
    chip.style.top = `${y}px`;
    chip.style.background = colours[index % colours.length]!;
    cabinet.appendChild(chip);
    const angle = -Math.PI / 2 + (index / 13 - 0.5) * Math.PI * 1.3;
    const distance = 60 + (index % 4) * 18;
    const dx = Math.cos(angle) * distance;
    const dy = Math.sin(angle) * distance;
    const animation = chip.animate(
      [
        { transform: 'translate(-50%, -50%) scale(1)', opacity: 1 },
        { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) rotate(${index * 47}deg) scale(0.9)`, opacity: 1, offset: 0.6 },
        { transform: `translate(calc(-50% + ${dx * 1.1}px), calc(-50% + ${dy + 40}px)) rotate(${index * 80}deg) scale(0.6)`, opacity: 0 },
      ],
      { duration: 600, easing: 'cubic-bezier(.15,.8,.25,1)' },
    );
    animation.onfinish = () => chip.remove();
    animation.oncancel = () => chip.remove();
  }
}

/* The wheel in small, for the home card: the slots, the hub with today's
   multiplier. Still; it only turns in the dialog. */
export function DailyWheelBadge({ multiplier, dim = false }: { multiplier: number; dim?: boolean }) {
  return (
    <svg className='dw-badge' viewBox={`${-R - 6} ${-R - 6} ${2 * R + 12} ${2 * R + 12}`} aria-hidden='true' focusable='false' data-dim={dim || undefined}>
      <circle r={R + 6} fill={INK} />
      {DAILY_WHEEL_SEGMENTS.map((segment) => (
        <path key={segment.index} d={wedge(segment, R - 6)} fill={FILL[segment.value] ?? PAPER} />
      ))}
      <circle r={86} fill={INK} />
      <text className='dw-badge-hub' textAnchor='middle' dominantBaseline='central' fill={PAPER} y={4}>
        ×{multiplier}
      </text>
      <path d={`M-16 ${-R - 8}L16 ${-R - 8}L0 ${-R + 34}Z`} fill='#F2A33C' stroke={INK} strokeWidth={6} strokeLinejoin='round' />
    </svg>
  );
}
