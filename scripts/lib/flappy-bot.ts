/* A reference flappy client for the verifiers: the client's own step
   (_flappy-sim.ts), the frame loop the page runs (createGameFrameLoop) on a
   fake display clock, and a bot that flaps like a person with a given
   timing error. Shared by verify-flappy-replay.ts, the achievement tier sim
   and verify-trusted-scores-http's flappy case. */
import {
  FLAPPY_BIRD_RADIUS,
  FLAPPY_BIRD_X,
  FLAPPY_PIPE_GAP,
  FLAPPY_PIPE_WIDTH,
  FLAPPY_STEP_MS,
  createFlappyState,
  stepFlappy,
  type FlappyState,
} from '@/app/(games)/flappy-bird/_flappy-sim';
import { createGameFrameLoop } from '@/features/arcade/lib/game-frame-loop';

/** A small seeded stream for the bot's own noise (not the game's). */
export function botRng(seed: number) {
  let s = (seed ^ 0x9e3779b9) >>> 0;
  const next = () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
  const gauss = () => {
    const u = Math.max(1e-9, next());
    const v = next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  return { next, gauss };
}

export type FlappySkill = {
  label: string;
  /** Spread of when a tap lands against when it should, in ms (1 sigma). */
  timingMs: number;
  /** Spread of the height the player aims for, in px (1 sigma, per pipe). */
  aimPx: number;
};

/** Skill ladder for the tier sim and the verifiers. The timing spreads are
 *  a person's tap error at a steady rhythm: about 60 ms for someone new to
 *  the game, 14 ms for someone who has played a lot. */
export const FLAPPY_SKILLS: readonly FlappySkill[] = [
  { label: 'novice', timingMs: 60, aimPx: 18 },
  { label: 'casual', timingMs: 42, aimPx: 13 },
  { label: 'good', timingMs: 30, aimPx: 9 },
  { label: 'strong', timingMs: 21, aimPx: 6 },
  { label: 'expert', timingMs: 14, aimPx: 4 },
];

/** The pipe the bird is heading for: the first one its hitbox hasn't left. */
function targetPipe(state: FlappyState) {
  return state.pipes.find((pipe) => pipe.x + FLAPPY_PIPE_WIDTH > FLAPPY_BIRD_X - FLAPPY_BIRD_RADIUS) ?? null;
}

/** Below this line (from the gap's centre) the bot wants to flap. */
const FLAP_LINE = 22;
/** A person can't tap again sooner than this. */
const REFRACTORY_MS = 110;

export type FlappyBot = {
  /** Called on each painted frame with the state the player sees. Returns
   *  the display time at which it wants a tap to land, or null. */
  wants: (state: FlappyState, nowMs: number) => number | null;
};

export function createFlappyBot(skill: FlappySkill, seed: number): FlappyBot {
  const rng = botRng(seed);
  let aimFor = -1;
  let aim = 0;
  let pendingAt: number | null = null;
  let lastTapAt = -Infinity;
  return {
    wants(state, nowMs) {
      if (pendingAt !== null) {
        if (nowMs < pendingAt) return null;
        const at = pendingAt;
        pendingAt = null;
        lastTapAt = at;
        return at;
      }
      const pipe = targetPipe(state);
      const centre = pipe ? pipe.topHeight + FLAPPY_PIPE_GAP / 2 : 300;
      const id = pipe?.id ?? -1;
      if (id !== aimFor) {
        aimFor = id;
        aim = rng.gauss() * skill.aimPx;
      }
      if (state.y > centre + FLAP_LINE + aim && state.velocity > -1) {
        // A tap meant for now lands a little early or late.
        const at = Math.max(nowMs, nowMs + rng.gauss() * skill.timingMs, lastTapAt + REFRACTORY_MS);
        pendingAt = at;
        if (at <= nowMs) {
          pendingAt = null;
          lastTapAt = at;
          return at;
        }
      }
      return null;
    },
  };
}

export type FlappyClientRun = {
  seed: number;
  /** Ticks of the flaps, as the page posts them. */
  flaps: number[];
  score: number;
  ticks: number;
  /** Display time from the first flap to the crash. */
  wallMs: number;
};

export type FrameClock = {
  /** Display refresh in Hz. */
  hz: number;
  /** Spread of each frame's interval, as a fraction of it. */
  jitter?: number;
  /** Chance a frame is dropped (the next one comes two intervals later). */
  drop?: number;
  /** Chance of a long stall (a GC pause or a tab hitch), and its length. */
  stall?: number;
  stallMs?: number;
};

/**
 * Plays one run the way the page does: the frame loop steps the sim at
 * 60 Hz from a display clock, a tap sets a pending flap, and the next step
 * takes it and logs the tick. The run starts with the first flap at tick 0.
 */
export function playFlappyClient(
  seed: number,
  skill: FlappySkill,
  clock: FrameClock = { hz: 60 },
  options: { botSeed?: number; maxTicks?: number } = {},
): FlappyClientRun {
  const state = createFlappyState(seed);
  const flaps: number[] = [];
  let pendingFlap = true; // the tap that starts the run
  const bot = createFlappyBot(skill, options.botSeed ?? seed);
  const maxTicks = options.maxTicks ?? 60 * 60 * 30;
  const rng = botRng((options.botSeed ?? seed) * 31 + 7);

  type Raf = (now: number) => void;
  let scheduled: Raf | null = null;
  const g = globalThis as unknown as {
    requestAnimationFrame?: (cb: Raf) => number;
    cancelAnimationFrame?: (id: number) => void;
  };
  const savedRaf = g.requestAnimationFrame;
  const savedCancel = g.cancelAnimationFrame;
  g.requestAnimationFrame = (cb) => {
    scheduled = cb;
    return 1;
  };
  g.cancelAnimationFrame = () => {
    scheduled = null;
  };

  let pendingTapAt: number | null = null;
  const loop = createGameFrameLoop({
    stepMs: FLAPPY_STEP_MS,
    simulate: () => {
      if (state.dead) return false;
      const flap = pendingFlap;
      pendingFlap = false;
      if (flap) flaps.push(state.tick);
      stepFlappy(state, flap);
      if (state.dead || state.tick >= maxTicks) return false;
      return true;
    },
    render: () => {},
    pauseWhenHidden: false,
  });

  const interval = 1000 / clock.hz;
  let now = 1000;
  const startedAt = now;
  loop.start();
  try {
    while (scheduled && !state.dead && state.tick < maxTicks) {
      // The bot taps between frames, at the time it wanted.
      if (pendingTapAt !== null && pendingTapAt <= now) {
        pendingFlap = true;
        pendingTapAt = null;
      }
      const cb: Raf = scheduled;
      scheduled = null;
      cb(now);
      const want = bot.wants(state, now);
      if (want !== null) pendingTapAt = want;
      let dt = interval * (1 + (rng.next() * 2 - 1) * (clock.jitter ?? 0));
      if (clock.drop && rng.next() < clock.drop) dt += interval;
      if (clock.stall && rng.next() < clock.stall) dt += clock.stallMs ?? 250;
      now += dt;
    }
  } finally {
    loop.destroy();
    g.requestAnimationFrame = savedRaf;
    g.cancelAnimationFrame = savedCancel;
  }

  return { seed, flaps, score: state.score, ticks: state.tick, wallMs: now - startedAt };
}

/** The same run with no frame loop: the bot acts on every step. Fast, for
 *  the tier sim's thousands of runs. */
export function playFlappyDirect(seed: number, skill: FlappySkill, botSeed = seed, maxTicks = 60 * 60 * 60): FlappyClientRun {
  const state = createFlappyState(seed);
  const bot = createFlappyBot(skill, botSeed);
  const flaps: number[] = [];
  let pendingTapAt: number | null = null;
  let flap = true;
  while (!state.dead && state.tick < maxTicks) {
    const now = state.tick * FLAPPY_STEP_MS;
    if (pendingTapAt !== null && pendingTapAt <= now) {
      flap = true;
      pendingTapAt = null;
    }
    if (flap) flaps.push(state.tick);
    stepFlappy(state, flap);
    flap = false;
    const want = bot.wants(state, (state.tick) * FLAPPY_STEP_MS);
    if (want !== null) pendingTapAt = want;
  }
  return { seed, flaps, score: state.score, ticks: state.tick, wallMs: state.tick * FLAPPY_STEP_MS };
}
