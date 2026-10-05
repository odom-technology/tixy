/* A reference ricochet client for the verifiers: the engine's own step
   (stepRicochet), the tap log the client keeps (the number of steps played
   when a tap landed) and a bot with a human's mistakes. Shared by
   verify-ricochet-replay.ts, sim-ricochet.ts and verify-ricochet-http.ts. */
import {
  RICOCHET_BASE_HEIGHT,
  RICOCHET_LEFT_FACE,
  RICOCHET_MAX_WALLS,
  RICOCHET_RIGHT_FACE,
  RICOCHET_STEP_MS,
  createRicochetState,
  ricochetGapFor,
  stepRicochet,
  type RicochetEvent,
  type RicochetState,
} from '@/server/arcade/ricochet-replay';

export type Skill = {
  name: string;
  /** Pixels the bot's idea of a gap's middle is off by, per wall. */
  aimSd: number;
  /** Steps between seeing it is time to flap and the tap landing, mean and sd. */
  lagMean: number;
  lagSd: number;
  /** Chance per flap that the tap is missed and the bot flaps late instead. */
  lapse: number;
  /** Steps a missed tap costs. */
  lapseSteps: number;
};

/** The skill ladder every sim and verifier uses. */
export const SKILLS: readonly Skill[] = [
  { name: 'novice', aimSd: 55, lagMean: 6, lagSd: 3, lapse: 0.05, lapseSteps: 12 },
  { name: 'casual', aimSd: 40, lagMean: 5, lagSd: 2.2, lapse: 0.025, lapseSteps: 10 },
  { name: 'good', aimSd: 28, lagMean: 4, lagSd: 1.5, lapse: 0.01, lapseSteps: 9 },
  { name: 'strong', aimSd: 18, lagMean: 3.5, lagSd: 1, lapse: 0.004, lapseSteps: 8 },
  { name: 'expert', aimSd: 10, lagMean: 3, lagSd: 0.6, lapse: 0.001, lapseSteps: 8 },
];

export type BotRng = () => number;

export function mulberry32(seed: number): BotRng {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const gauss = (rand: BotRng) => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());

export type Stepper = (state: RicochetState, seed: number, flap: boolean) => RicochetEvent | null;

export type ClientRun = {
  seed: number;
  /** The client's tap log: steps played when each tap landed. */
  taps: number[];
  score: number;
  steps: number;
  /** The run's least duration at the step rate. */
  durationMs: number;
};

export type FramedRun = ClientRun & {
  /** Wall time at the frame the run ended on. */
  wallMs: number;
};

/** One flap rises this far before gravity takes it back, about; the bot aims
 *  its rule's threshold so the climb is centred on the gap. */
const FLAP_RISE_SHIFT = 21;

/** The bot's eyes and rule. The returned function is called with the state the
 *  bot can see and returns the steps to wait before tapping, or null for no
 *  tap. It sees the next gap and leans toward it as far as the current gap
 *  allows. */
function createDecider(seed: number, skill: Skill, rand: BotRng, maxWalls: number) {
  let aimWall = 0;
  let seen = { now: RICOCHET_BASE_HEIGHT / 2, next: RICOCHET_BASE_HEIGHT / 2, half: 60 };
  let blockedUntil = 0;
  return (state: RicochetState): number | null => {
    if (state.score >= maxWalls) return null;
    if (state.wall !== aimWall) {
      aimWall = state.wall;
      const gap = ricochetGapFor(seed, aimWall);
      const next = ricochetGapFor(seed, aimWall + 1);
      seen = {
        now: (gap.start + gap.end) / 2 + gauss(rand) * skill.aimSd,
        next: (next.start + next.end) / 2 + gauss(rand) * skill.aimSd,
        half: gap.height / 2,
      };
    }
    // Far from the wall, lean toward the next gap as far as this one allows;
    // close to it, hold this gap's middle.
    const toWall = state.dir > 0 ? RICOCHET_RIGHT_FACE - state.x : state.x - RICOCHET_LEFT_FACE;
    const band = seen.half * 0.7;
    const aim = Math.min(
      RICOCHET_BASE_HEIGHT - 50,
      Math.max(
        50,
        toWall > 70
          ? Math.min(seen.now + band, Math.max(seen.now - band, seen.next))
          : seen.now,
      ),
    );
    if (state.step < blockedUntil) return null;
    // Far below the aim it flaps sooner, to climb as fast as a hand can.
    const below = state.y - aim;
    const rising = below > 160 ? -5 : below > 80 ? -3 : -1.5;
    if (!(below > FLAP_RISE_SHIFT && state.vy > rising)) return null;
    if (rand() < skill.lapse) {
      blockedUntil = state.step + skill.lapseSteps;
      return null;
    }
    return Math.max(0, Math.round(skill.lagMean + gauss(rand) * skill.lagSd));
  };
}

/** Plays a run with the real engine, one decision a step. The bot stops
 *  flapping at `maxWalls` and dies. */
export function playClient(
  seed: number,
  skill: Skill,
  rand: BotRng,
  options: { maxWalls?: number; step?: Stepper } = {},
): ClientRun {
  const maxWalls = options.maxWalls ?? RICOCHET_MAX_WALLS;
  const step = options.step ?? stepRicochet;
  const state = createRicochetState();
  const look = createDecider(seed, skill, rand, maxWalls);
  const taps: number[] = [];
  let pendingFlapAt = -1;
  let ended = false;

  while (!ended && state.step < 60 * 60 * 40) {
    if (pendingFlapAt < 0) {
      const lag = look(state);
      if (lag !== null) pendingFlapAt = state.step + lag;
    }
    let flap = false;
    if (pendingFlapAt >= 0 && state.step >= pendingFlapAt) {
      flap = true;
      pendingFlapAt = -1;
      // The client logs the tap with the steps played so far.
      taps.push(state.step);
    }
    const event = step(state, seed, flap);
    if (event?.kind === 'death') ended = true;
    else if (event?.kind === 'bounce' && state.score >= RICOCHET_MAX_WALLS) ended = true;
  }
  return { seed, taps, score: state.score, steps: state.step, durationMs: state.step * RICOCHET_STEP_MS };
}

/** The client as the browser runs it: frames at a refresh rate with jitter and
 *  the odd long frame, a frame loop that turns wall time into whole 60 Hz
 *  steps (a hitch is clamped to 100 ms, at most 4 steps a frame), and taps
 *  that land between frames. A tap logs the steps played when it landed and
 *  flaps on the next step; two taps between the same two steps log once. */
export function playFramed(
  seed: number,
  skill: Skill,
  rand: BotRng,
  options: { hz: number; jitterMs: number; dropRate: number; maxWalls?: number },
): FramedRun {
  const maxWalls = options.maxWalls ?? RICOCHET_MAX_WALLS;
  const frameMs = 1000 / options.hz;
  const state = createRicochetState();
  const look = createDecider(seed, skill, rand, maxWalls);
  const taps: number[] = [];
  const events: number[] = [];
  let lastTap = -1;
  let flapPending = false;
  let accumulator = 0;
  let previous: number | null = null;
  let now = 0;
  let ended = false;

  while (!ended && state.step < 60 * 60 * 40) {
    // The next frame.
    now += Math.max(1, frameMs + gauss(rand) * options.jitterMs);
    if (rand() < options.dropRate) now += frameMs * (2 + Math.floor(rand() * 5));

    // Taps that landed before this frame.
    while (events.length > 0 && events[0]! <= now) {
      events.shift();
      if (state.step > lastTap) {
        taps.push(state.step);
        lastTap = state.step;
      }
      flapPending = true;
    }

    // The frame loop: the first frame sets the clock and steps nothing.
    const delta = previous === null ? 0 : Math.min(100, now - previous);
    previous = now;
    accumulator += delta;
    let steps = 0;
    while (accumulator >= RICOCHET_STEP_MS && steps < 4 && !ended) {
      const event = stepRicochet(state, seed, flapPending);
      flapPending = false;
      accumulator -= RICOCHET_STEP_MS;
      steps += 1;
      if (event?.kind === 'death') ended = true;
      else if (event?.kind === 'bounce' && state.score >= RICOCHET_MAX_WALLS) ended = true;
    }
    if (steps >= 4 && accumulator >= RICOCHET_STEP_MS) accumulator = 0;

    // The player looks at the frame and decides.
    if (!ended && events.length === 0 && !flapPending) {
      const lag = look(state);
      if (lag !== null) events.push(now + lag * RICOCHET_STEP_MS + rand() * frameMs);
    }
  }
  return {
    seed,
    taps,
    score: state.score,
    steps: state.step,
    durationMs: state.step * RICOCHET_STEP_MS,
    wallMs: now,
  };
}
