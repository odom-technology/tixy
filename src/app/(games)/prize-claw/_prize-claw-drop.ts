/* ──────────────────────────────────────────────────────────────────────────
   PRIZE CLAW: the pure choreography timeline.

   The server sends a ClawScript (phase durations, slip point, topple keys,
   bounce keys) derived from the revealed seed. This module turns that script
   plus an elapsed time into a frame: where the head is, how closed the fingers
   are, whether the prize is riding with them, and the short line a screen
   reader hears.

   It is TIME-PARAMETERISED on purpose. Nothing here integrates or accumulates,
   so a tab that was hidden for four seconds resyncs exactly by asking for the
   frame at (now - startedAt): no drift, no catch-up loop.

   Pure: no three.js, no DOM, no randomness, no clock of its own.
   ────────────────────────────────────────────────────────────────────────── */

import type { ClawScript } from '@/server/arcade/wager-games/prize-claw';

/** Under reduced motion the whole script compresses to this fraction. */
export const CLAW_REDUCED_SCALE = 0.6;

/** How long the settled pose holds before the round hands back to the rail. */
export const CLAW_SETTLE_MS = 1_400;

export const CLAW_PHASES = [
  'armed',
  'descending',
  'closing',
  'gripping',
  'lifting',
  'travelling',
  'releasing',
  'chuting',
  'settled',
] as const;
export type ClawPhase = (typeof CLAW_PHASES)[number];

export type ClawTimeline = {
  script: ClawScript;
  reduced: boolean;
  /** Absolute phase boundaries in ms from the commit. */
  descendEnd: number;
  closeEnd: number;
  gripEnd: number;
  liftEnd: number;
  travelEnd: number;
  releaseEnd: number;
  chuteEnd: number;
  /** chuteEnd + the settle hold. The round finishes here. */
  totalMs: number;
  /** Absolute ms at which the fingers relax on a slip. Null otherwise. */
  slipAtMs: number | null;
};

/** Fold the server script into absolute phase boundaries. */
export function buildClawTimeline(
  script: ClawScript,
  reduced: boolean,
): ClawTimeline {
  const k = reduced ? CLAW_REDUCED_SCALE : 1;
  const descendEnd = script.descendMs * k;
  const closeEnd = descendEnd + script.closeMs * k;
  const gripEnd = closeEnd + script.gripMs * k;
  const liftEnd = gripEnd + script.liftMs * k;
  const travelEnd = liftEnd + script.travelMs * k;
  const releaseEnd = travelEnd + script.releaseMs * k;
  const chuteEnd = releaseEnd + script.chuteMs * k;
  return {
    script,
    reduced,
    descendEnd,
    closeEnd,
    gripEnd,
    liftEnd,
    travelEnd,
    releaseEnd,
    chuteEnd,
    totalMs: chuteEnd + CLAW_SETTLE_MS * k,
    slipAtMs:
      script.slipAtT == null
        ? null
        : gripEnd + script.liftMs * k * script.slipAtT,
  };
}

/** How long the prize slides in the fingers before the slip point, in ms. */
export const CLAW_SAG_MS = 240;
/** How far it has slid by the slip point, in world units. Matches the scene. */
const SAG_DROP = 0.07;

export type ClawFrame = {
  phase: ClawPhase;
  /** Progress within the current phase, 0..1. */
  t: number;
  /** Head height above the bed. */
  headY: number;
  /** Finger closure, 0 fully open → 1 fully closed. */
  gripT: number;
  /** True while the prize is riding in the fingers. */
  carrying: boolean;
  /** 0 at the commit column → 1 over the chute, for the trolley run. */
  travelT: number;
  /** Height of the prize above its resting pose (world units). */
  prizeLift: number;
  /** Extra yaw/roll applied to a brushed or slipped prize. */
  prizeYaw: number;
  prizeRoll: number;
  /** True once a won prize has been let go over the chute. */
  released: boolean;
  /** Prize travel down the chute ramp, 0..1. */
  chuteT: number;
  /**
   * How far a prize that is about to slip has slid down the fingers, 0..1. Rises
   * over the CLAW_SAG_MS before the server's slip point. Always 0 on any other
   * outcome and under reduced motion.
   */
  sag: number;
  /** Camera dolly weight, 0 rest → 1 pushed in. Always 0 under reduced motion. */
  dolly: number;
};

const REST_HEAD_Y = 1.62;

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

function easeOut(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

/**
 * Bounce height at a normalised settle time, from the script's bounce keys.
 * Three shrinking arcs; empty keys mean the prize just sits down.
 */
function bounceAt(keys: readonly number[], t: number): number {
  if (keys.length === 0) return 0;
  const span = 1 / keys.length;
  const index = Math.min(keys.length - 1, Math.floor(t / span));
  const local = (t - index * span) / span;
  return (keys[index] ?? 0) * Math.sin(clamp01(local) * Math.PI);
}

/**
 * The pose at `elapsed` ms after the commit. Total and monotone: calling it
 * with a huge elapsed returns the settled pose rather than running off.
 */
export function clawFrameAt(
  timeline: ClawTimeline,
  elapsed: number,
  /** Height of the targeted prize's top face, where the fingers meet it. */
  prizeTopY: number,
): ClawFrame {
  const s = timeline.script;
  const ms = Math.max(0, elapsed);
  // The hub rides above the prize; the fingertips hang ~0.36 below it, so this
  // floor keeps the tips brushing the felt rather than sinking through it.
  const grounded = Math.max(0.34, prizeTopY);
  const base: ClawFrame = {
    phase: 'settled',
    t: 1,
    headY: REST_HEAD_Y,
    gripT: 0,
    carrying: false,
    travelT: 0,
    prizeLift: 0,
    prizeYaw: 0,
    prizeRoll: 0,
    released: false,
    chuteT: 0,
    sag: 0,
    dolly: 0,
  };

  // ── descend ──
  if (ms < timeline.descendEnd) {
    const t = clamp01(ms / Math.max(1, timeline.descendEnd));
    return {
      ...base,
      phase: 'descending',
      t,
      headY: REST_HEAD_Y + (grounded - REST_HEAD_Y) * easeInOut(t),
      gripT: 0,
    };
  }

  // ── close ──
  if (ms < timeline.closeEnd) {
    const t = clamp01(
      (ms - timeline.descendEnd) /
        Math.max(1, timeline.closeEnd - timeline.descendEnd),
    );
    // A brush topples the prize while the fingers are still closing.
    const brushed = s.outcome === 'brushed';
    return {
      ...base,
      phase: 'closing',
      t,
      headY: grounded,
      gripT: easeOut(t),
      prizeYaw: brushed ? s.toppleYaw * easeOut(t) : 0,
      prizeRoll: brushed ? s.toppleRoll * easeOut(t) : 0,
    };
  }

  // ── grip ──
  if (ms < timeline.gripEnd) {
    const t = clamp01(
      (ms - timeline.closeEnd) /
        Math.max(1, timeline.gripEnd - timeline.closeEnd),
    );
    const seated = s.outcome === 'won' || s.outcome === 'slipped';
    return {
      ...base,
      phase: 'gripping',
      t,
      headY: grounded,
      gripT: 1,
      carrying: seated,
      prizeYaw: s.outcome === 'brushed' ? s.toppleYaw : 0,
      prizeRoll: s.outcome === 'brushed' ? s.toppleRoll : 0,
    };
  }

  // ── lift ──
  if (ms < timeline.liftEnd) {
    const liftSpan = Math.max(1, timeline.liftEnd - timeline.gripEnd);
    const t = clamp01((ms - timeline.gripEnd) / liftSpan);
    const headY = grounded + (REST_HEAD_Y - grounded) * easeInOut(t);
    const slipping =
      timeline.slipAtMs != null && ms >= timeline.slipAtMs;
    if (slipping) {
      // The prize rolls off the tips and falls back to the felt.
      const fallMs = Math.max(1, timeline.liftEnd - timeline.slipAtMs!);
      const fallT = clamp01((ms - timeline.slipAtMs!) / fallMs);
      const dropFrom = grounded + (REST_HEAD_Y - grounded) * easeInOut(
        clamp01((timeline.slipAtMs! - timeline.gripEnd) / liftSpan),
      );
      // It has already slid SAG_DROP down the fingers, so the fall starts there.
      const height = Math.max(0, dropFrom - grounded - SAG_DROP) * (1 - easeOut(fallT));
      return {
        ...base,
        phase: 'lifting',
        t,
        headY,
        // One finger relaxes by 0.35 as the prize goes.
        gripT: 1 - 0.35 * clamp01((ms - timeline.slipAtMs!) / 120),
        carrying: false,
        prizeLift: timeline.reduced
          ? 0
          : height + bounceAt(s.bounce, fallT) * fallT,
        prizeYaw: timeline.reduced ? 0 : s.toppleYaw * 0.4 * fallT,
        prizeRoll: timeline.reduced ? 0 : 0.35 + 0.1 * fallT,
        dolly: timeline.reduced ? 0 : easeOut(t),
      };
    }
    const carrying = s.outcome === 'won' || s.outcome === 'slipped';
    const sag =
      timeline.slipAtMs != null && !timeline.reduced
        ? easeOut(clamp01((ms - (timeline.slipAtMs - CLAW_SAG_MS)) / CLAW_SAG_MS))
        : 0;
    return {
      ...base,
      phase: 'lifting',
      t,
      headY,
      gripT: 1,
      carrying,
      sag,
      prizeYaw: s.outcome === 'brushed' ? s.toppleYaw : 0,
      prizeRoll: s.outcome === 'brushed' ? s.toppleRoll : 0,
      dolly: timeline.reduced ? 0 : easeOut(t),
    };
  }

  // Everything past the lift only happens on a win.
  if (s.outcome !== 'won') {
    return {
      ...base,
      phase: 'settled',
      headY: REST_HEAD_Y,
      gripT: 0,
      prizeYaw: s.outcome === 'brushed' ? s.toppleYaw : 0,
      prizeRoll: s.outcome === 'brushed' ? s.toppleRoll : 0,
    };
  }

  // ── travel ──
  if (ms < timeline.travelEnd) {
    const t = clamp01(
      (ms - timeline.liftEnd) /
        Math.max(1, timeline.travelEnd - timeline.liftEnd),
    );
    return {
      ...base,
      phase: 'travelling',
      t,
      headY: REST_HEAD_Y,
      gripT: 1,
      carrying: true,
      travelT: easeInOut(t),
      dolly: timeline.reduced ? 0 : 1 - easeOut(t),
    };
  }

  // ── release ──
  if (ms < timeline.releaseEnd) {
    const t = clamp01(
      (ms - timeline.travelEnd) /
        Math.max(1, timeline.releaseEnd - timeline.travelEnd),
    );
    return {
      ...base,
      phase: 'releasing',
      t,
      headY: REST_HEAD_Y,
      gripT: 1 - easeOut(t),
      carrying: t < 0.55,
      travelT: 1,
      released: t >= 0.55,
      chuteT: t < 0.55 ? 0 : clamp01((t - 0.55) / 0.45) * 0.15,
    };
  }

  // ── chute ──
  if (ms < timeline.chuteEnd) {
    const t = clamp01(
      (ms - timeline.releaseEnd) /
        Math.max(1, timeline.chuteEnd - timeline.releaseEnd),
    );
    return {
      ...base,
      phase: 'chuting',
      t,
      headY: REST_HEAD_Y,
      gripT: 0,
      travelT: 1,
      released: true,
      chuteT: 0.15 + easeIn(t) * 0.85,
    };
  }

  return {
    ...base,
    phase: 'settled',
    travelT: 1,
    released: true,
    chuteT: 1,
  };
}

function easeIn(t: number): number {
  return t * t;
}

/**
 * The screen-reader account of a drop: what the claw dropped on, whether it
 * caught, and a slip. Null when nothing new happened, so the live region
 * keeps its last line. The stage shows the rest. Flat by design: a near miss
 * is shown, never sold.
 */
export function clawStatusLine(
  frame: ClawFrame,
  outcome: ClawScript['outcome'],
  prizeName: string | null,
): string | null {
  switch (frame.phase) {
    case 'descending':
      return prizeName ? `Dropping on the ${prizeName}.` : 'Dropping on bare felt.';
    case 'gripping':
      return outcome === 'won' || outcome === 'slipped'
        ? 'Caught.'
        : outcome === 'brushed'
          ? 'Knocked it over.'
          : 'Missed.';
    case 'lifting':
      return outcome === 'slipped' && frame.carrying === false && frame.prizeLift > 0
        ? 'It slipped.'
        : null;
    default:
      return null;
  }
}
