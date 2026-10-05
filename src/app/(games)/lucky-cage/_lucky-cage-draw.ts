/* ──────────────────────────────────────────────────────────────────────────
   Lucky Cage — draw choreography.

   The round is already over before any of this runs. The server settled it,
   revealed the seed, and handed back five ball numbers in chute order; this
   module turns "elapsed milliseconds" into "what the cabinet looks like right
   now" for that committed result.

   Everything is a pure function of (timeline, elapsedMs). No RNG, no state, no
   physics feedback: the same elapsed time always produces the same frame, which
   is what makes the animation safe to interrupt, scrub, or skip. The cosmetic
   tumble in _lucky-cage-tumble.ts runs alongside it, but the moment a ball is
   due at the gate the timeline takes that ball over — visual collisions never
   decide which balls leave the cage.

   Cage spin is integrated in CLOSED FORM rather than accumulated per frame, so
   the drum is at exactly the same angle at t = 4,000 ms whether the browser
   delivered 30 frames or 300.

   Full choreography ~9.3 s. Reduced motion collapses the same beats into
   ~1.6 s and keeps every outcome-bearing moment (gate, five seats, result)
   legible rather than dropping straight to the answer.
   ────────────────────────────────────────────────────────────────────────── */

export const CAGE_DRAW_COUNT = 5;

export type CagePhase = 'idle' | 'wind' | 'tumble' | 'gate' | 'chute' | 'settle' | 'done';

export type CageTimeline = {
  reduced: boolean;
  /** Phase durations in ms. */
  windMs: number;
  tumbleMs: number;
  gateMs: number;
  travelMs: number;
  settleMs: number;
  /** Absolute ms at which each drawn ball leaves the pile for the gate. */
  releaseAt: number[];
  /** Absolute ms at which each drawn ball is fully seated in its cradle. */
  seatAt: number[];
  /** Absolute phase boundaries. */
  windEnd: number;
  tumbleEnd: number;
  gateEnd: number;
  chuteEnd: number;
  totalMs: number;
  /** Peak / gate / chute-tail cage spin, rad/s. */
  peakSpin: number;
  gateSpin: number;
  chuteSpin: number;
  /** Cage angle at each phase boundary (closed-form integral of spin). */
  angleAtWindEnd: number;
  angleAtTumbleEnd: number;
  angleAtGateEnd: number;
  angleAtChuteEnd: number;
};

export type CageFrame = {
  phase: CagePhase;
  /** Cage angular velocity, rad/s, about the drum axis. */
  spin: number;
  /** Absolute cage rotation in radians since the crank was pulled. */
  angle: number;
  /** Crank handle rotation in radians (geared down off the drum). */
  crank: number;
  /** 0 shut, 1 fully swung open. */
  gateOpen: number;
  /** 0 resting wide, 1 pushed in on the chute mouth. */
  cameraPush: number;
  /**
   * Per drawn ball: -1 while it is still loose in the pile, otherwise 0..1
   * along its chute run. 1 means seated.
   */
  progress: number[];
  /** How many balls have fully seated. */
  seated: number;
  /** True once the whole sequence has played out. */
  done: boolean;
};

/* ── easing ─────────────────────────────────────────────────────────── */

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Classic smoothstep — also the spin ramp whose integral is used below. */
function smoothstep(u: number): number {
  const t = clamp01(u);
  return t * t * (3 - 2 * t);
}

/** ∫0^u smoothstep = u^3 - u^4 / 2. */
function smoothstepIntegral(u: number): number {
  const t = clamp01(u);
  return t * t * t - (t * t * t * t) / 2;
}

function easeOutCubic(u: number): number {
  const t = clamp01(u);
  const inv = 1 - t;
  return 1 - inv * inv * inv;
}

/* ── timeline ───────────────────────────────────────────────────────── */

const FULL = {
  windMs: 900,
  tumbleMs: 3400,
  gateMs: 500,
  travelMs: 780,
  gapMs: 700,
  settleMs: 900,
  peakSpin: 9.2,
  gateSpin: 3.1,
  chuteSpin: 1.0,
};

const REDUCED = {
  windMs: 120,
  tumbleMs: 240,
  gateMs: 140,
  travelMs: 260,
  gapMs: 170,
  settleMs: 420,
  peakSpin: 3.6,
  gateSpin: 1.4,
  chuteSpin: 0.5,
};

export function buildCageTimeline(reduced: boolean): CageTimeline {
  const c = reduced ? REDUCED : FULL;

  const windEnd = c.windMs;
  const tumbleEnd = windEnd + c.tumbleMs;
  const gateEnd = tumbleEnd + c.gateMs;

  const releaseAt: number[] = [];
  const seatAt: number[] = [];
  for (let i = 0; i < CAGE_DRAW_COUNT; i += 1) {
    const start = gateEnd + i * c.gapMs;
    releaseAt.push(start);
    seatAt.push(start + c.travelMs);
  }
  const chuteEnd = seatAt[CAGE_DRAW_COUNT - 1]!;
  const totalMs = chuteEnd + c.settleMs;

  // Closed-form cage angle at each boundary.
  const angleAtWindEnd = (c.windMs / 1000) * c.peakSpin * smoothstepIntegral(1);
  const angleAtTumbleEnd = angleAtWindEnd + (c.tumbleMs / 1000) * c.peakSpin;
  const angleAtGateEnd =
    angleAtTumbleEnd +
    (c.gateMs / 1000) * (c.peakSpin + (c.gateSpin - c.peakSpin) * smoothstepIntegral(1));
  const chuteSeconds = (chuteEnd - gateEnd) / 1000;
  const angleAtChuteEnd =
    angleAtGateEnd + chuteSeconds * (c.gateSpin + (c.chuteSpin - c.gateSpin) / 2);

  return {
    reduced,
    windMs: c.windMs,
    tumbleMs: c.tumbleMs,
    gateMs: c.gateMs,
    travelMs: c.travelMs,
    settleMs: c.settleMs,
    releaseAt,
    seatAt,
    windEnd,
    tumbleEnd,
    gateEnd,
    chuteEnd,
    totalMs,
    peakSpin: c.peakSpin,
    gateSpin: c.gateSpin,
    chuteSpin: c.chuteSpin,
    angleAtWindEnd,
    angleAtTumbleEnd,
    angleAtGateEnd,
    angleAtChuteEnd,
  };
}

/* ── the frame ──────────────────────────────────────────────────────── */

/** Spin (rad/s) and absolute angle (rad) at `t` ms. Closed form, exact. */
function spinAndAngle(tl: CageTimeline, t: number): { spin: number; angle: number } {
  if (t <= 0) return { spin: 0, angle: 0 };

  if (t < tl.windEnd) {
    const u = t / tl.windMs;
    return {
      spin: tl.peakSpin * smoothstep(u),
      angle: (tl.windMs / 1000) * tl.peakSpin * smoothstepIntegral(u),
    };
  }

  if (t < tl.tumbleEnd) {
    const dt = (t - tl.windEnd) / 1000;
    return { spin: tl.peakSpin, angle: tl.angleAtWindEnd + tl.peakSpin * dt };
  }

  if (t < tl.gateEnd) {
    const u = (t - tl.tumbleEnd) / tl.gateMs;
    const delta = tl.gateSpin - tl.peakSpin;
    return {
      spin: tl.peakSpin + delta * smoothstep(u),
      angle:
        tl.angleAtTumbleEnd +
        (tl.gateMs / 1000) * (tl.peakSpin * u + delta * smoothstepIntegral(u)),
    };
  }

  const chuteSpanMs = tl.chuteEnd - tl.gateEnd;
  if (t < tl.chuteEnd) {
    const u = chuteSpanMs > 0 ? (t - tl.gateEnd) / chuteSpanMs : 1;
    const delta = tl.chuteSpin - tl.gateSpin;
    return {
      spin: tl.gateSpin + delta * u,
      angle:
        tl.angleAtGateEnd +
        (chuteSpanMs / 1000) * (tl.gateSpin * u + (delta * u * u) / 2),
    };
  }

  const u = clamp01((t - tl.chuteEnd) / tl.settleMs);
  const inv = 1 - u;
  return {
    spin: tl.chuteSpin * inv * inv,
    angle:
      tl.angleAtChuteEnd +
      ((tl.settleMs / 1000) * tl.chuteSpin * (1 - inv * inv * inv)) / 3,
  };
}

function phaseAt(tl: CageTimeline, t: number): CagePhase {
  if (t <= 0) return 'idle';
  if (t < tl.windEnd) return 'wind';
  if (t < tl.tumbleEnd) return 'tumble';
  if (t < tl.gateEnd) return 'gate';
  if (t < tl.chuteEnd) return 'chute';
  if (t < tl.totalMs) return 'settle';
  return 'done';
}

/** The whole cabinet state at `elapsedMs`. Pure. */
export function cageFrame(tl: CageTimeline, elapsedMs: number): CageFrame {
  const t = Math.max(0, elapsedMs);
  const { spin, angle } = spinAndAngle(tl, t);

  // The gate swings open across the gate phase and latches shut again once the
  // last ball is down.
  let gateOpen = 0;
  if (t >= tl.tumbleEnd) {
    if (t < tl.gateEnd) gateOpen = smoothstep((t - tl.tumbleEnd) / tl.gateMs);
    else if (t < tl.chuteEnd) gateOpen = 1;
    else gateOpen = 1 - smoothstep(clamp01((t - tl.chuteEnd) / (tl.settleMs * 0.6)));
  }

  const progress: number[] = [];
  let seated = 0;
  for (let i = 0; i < CAGE_DRAW_COUNT; i += 1) {
    const start = tl.releaseAt[i]!;
    if (t < start) {
      progress.push(-1);
      continue;
    }
    const p = clamp01((t - start) / tl.travelMs);
    progress.push(p);
    if (p >= 1) seated += 1;
  }

  // Restrained push-in: settle onto the chute mouth as the cage winds up, hold
  // through the draw, ease back out as the result lands.
  let cameraPush = 0;
  if (t < tl.windEnd + tl.tumbleMs * 0.35) {
    cameraPush = smoothstep(t / Math.max(1, tl.windEnd + tl.tumbleMs * 0.35));
  } else if (t < tl.chuteEnd) {
    cameraPush = 1;
  } else {
    cameraPush = 1 - 0.55 * smoothstep(clamp01((t - tl.chuteEnd) / tl.settleMs));
  }

  return {
    phase: phaseAt(tl, t),
    spin,
    angle,
    // The crank is geared down off the drum and only turns while the drum does.
    crank: angle * 0.42,
    gateOpen,
    cameraPush,
    progress,
    seated,
    done: t >= tl.totalMs,
  };
}

/* ── path shaping (consumed by the scene) ───────────────────────────── */

/**
 * Split one ball's 0..1 chute run into its three readable beats:
 *   pluck  — lifted out of the tumbling pile toward the gate mouth
 *   run    — carried down the chute curve
 *   seat   — the last drop into its cradle
 * Returned as a triple of 0..1 sub-progresses so the scene can blend positions
 * without re-deriving the thresholds.
 */
export const CHUTE_PLUCK_END = 0.2;
export const CHUTE_RUN_END = 0.84;

export function chuteSegments(p: number): {
  pluck: number;
  run: number;
  seat: number;
} {
  if (p < 0) return { pluck: 0, run: 0, seat: 0 };
  const pluck = clamp01(p / CHUTE_PLUCK_END);
  const run = clamp01((p - CHUTE_PLUCK_END) / (CHUTE_RUN_END - CHUTE_PLUCK_END));
  const seat = clamp01((p - CHUTE_RUN_END) / (1 - CHUTE_RUN_END));
  return { pluck: easeOutCubic(pluck), run, seat: easeOutCubic(seat) };
}

/** A ball is under the timeline's control from the instant it is plucked. */
export function isBallReleased(progress: number): boolean {
  return progress >= 0;
}

/** The line for the aria-live region as the draw plays: each ball as it
 *  lands, nothing while the cage turns. */
export function cageStatusLine(
  frame: CageFrame,
  draw: readonly number[] | null,
): string {
  if (!draw || draw.length === 0) return '';
  switch (frame.phase) {
    case 'chute':
    case 'settle':
    case 'done': {
      const out = draw.slice(0, Math.max(0, frame.seated));
      if (out.length === 0) return '';
      if (out.length < draw.length) {
        return `Ball ${out.length} of ${draw.length}: ${out[out.length - 1]}.`;
      }
      return `Drew ${draw.join(', ')}.`;
    }
    default:
      return '';
  }
}
