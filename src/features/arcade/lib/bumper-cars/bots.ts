/* Bots for the empty seats. A bot picks a car to chase, leads it by its
   speed, steers with a little error, backs off the rail when it is stuck, and
   reacts a few ticks late. It sees only what a player sees: positions and
   speeds. The server drives bots in a real round; the page drives them in
   practice. Same code, seeded, so a practice round can be replayed. */

import { INPUT_STEPS, MAX_CARS, RINK_HX, RINK_HZ, TICK_HZ } from './constants';
import type { CarInput, SimState } from './sim';

export type BotSkill = {
  /** Ticks between the bot seeing something and acting on it. */
  reaction: number;
  /** How far ahead it leads a moving target, 0 to 1. */
  lead: number;
  /** Steering noise, as a share of full lock. */
  wobble: number;
  /** Throttle when chasing, 0 to 1. */
  pace: number;
};

export const BOT_SKILLS: Record<'easy' | 'medium' | 'hard', BotSkill> = {
  easy: { reaction: 16, lead: 0.2, wobble: 0.3, pace: 0.8 },
  medium: { reaction: 10, lead: 0.55, wobble: 0.18, pace: 0.92 },
  hard: { reaction: 6, lead: 0.85, wobble: 0.08, pace: 1 },
};

export const BOT_NAMES: readonly string[] = [
  'Dot', 'Gus', 'Mabel', 'Ike', 'Ruth', 'Sal', 'June', 'Otto', 'Pearl', 'Cy', 'Vera', 'Abe',
];

export type BotBrain = {
  seat: number;
  skill: BotSkill;
  rand: () => number;
  target: number;
  retargetAt: number;
  stuckTicks: number;
  reverseUntil: number;
  reverseSteer: number;
  /** Breaking off from a scrum: drive to this point until the tick. */
  escapeUntil: number;
  escapeX: number;
  escapeZ: number;
  crowdTicks: number;
  /** Decided inputs waiting out the reaction time. */
  queue: CarInput[];
  last: CarInput;
};

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createBot(seat: number, seed: number, skill: BotSkill): BotBrain {
  return {
    seat,
    skill,
    rand: mulberry32((seed ^ Math.imul(seat + 1, 0x9e3779b1)) >>> 0),
    target: -1,
    retargetAt: 0,
    stuckTicks: 0,
    reverseUntil: -1,
    reverseSteer: 1,
    escapeUntil: -1,
    escapeX: 0,
    escapeZ: 0,
    crowdTicks: 0,
    queue: [],
    last: { steer: 0, throttle: 0 },
  };
}

/** Cars within `radius` of car `i`, not counting it. */
function crowdAround(state: SimState, i: number, radius: number): number {
  const c = state.cars[i]!;
  let n = 0;
  for (let j = 0; j < MAX_CARS; j += 1) {
    if (j === i || !state.cars[j]!.active) continue;
    const o = state.cars[j]!;
    const dx = o.x - c.x;
    const dz = o.z - c.z;
    if (dx * dx + dz * dz < radius * radius) n += 1;
  }
  return n;
}

function pickTarget(bot: BotBrain, state: SimState): number {
  const me = state.cars[bot.seat]!;
  let best = -1;
  let bestScore = Infinity;
  for (let i = 0; i < MAX_CARS; i += 1) {
    if (i === bot.seat || !state.cars[i]!.active) continue;
    const c = state.cars[i]!;
    const dx = c.x - me.x;
    const dz = c.z - me.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    // Closer is better, and a car facing away is a better mark.
    const facing = (c.fx * -dx + c.fz * -dz) / (dist || 1);
    // A car in a scrum is a poor mark: go for the ones out in the open.
    const crowd = crowdAround(state, i, 3.2);
    const score = dist + facing * 2 + crowd * 6 + bot.rand() * 5 + (i === bot.target ? 3 : 0);
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}

function decide(bot: BotBrain, state: SimState): CarInput {
  const me = state.cars[bot.seat]!;
  const tick = state.tick;
  const speed = Math.sqrt(me.vx * me.vx + me.vz * me.vz);

  if (tick < bot.reverseUntil) {
    return { steer: bot.reverseSteer * INPUT_STEPS, throttle: -INPUT_STEPS };
  }

  // Wedged in among two or more cars for a moment: break off, drive out to
  // open floor, and come back in for another run.
  const near = crowdAround(state, bot.seat, 2.3);
  bot.crowdTicks = near >= 2 ? bot.crowdTicks + 3 : Math.max(0, bot.crowdTicks - 3);
  if (bot.crowdTicks > 15 && tick >= bot.escapeUntil) {
    bot.crowdTicks = 0;
    let cx = 0;
    let cz = 0;
    for (let j = 0; j < MAX_CARS; j += 1) {
      const o = state.cars[j]!;
      if (j === bot.seat || !o.active) continue;
      const dx = o.x - me.x;
      const dz = o.z - me.z;
      if (dx * dx + dz * dz < 2.3 * 2.3) {
        cx += dx;
        cz += dz;
      }
    }
    const len = Math.sqrt(cx * cx + cz * cz) || 1;
    // Away from the scrum, pulled toward the middle of the floor.
    let ex = me.x - (cx / len) * 5 - me.x * 0.35;
    let ez = me.z - (cz / len) * 5 - me.z * 0.35;
    ex = Math.max(-(RINK_HX - 1.8), Math.min(RINK_HX - 1.8, ex));
    ez = Math.max(-(RINK_HZ - 1.8), Math.min(RINK_HZ - 1.8, ez));
    bot.escapeX = ex;
    bot.escapeZ = ez;
    bot.escapeUntil = tick + 45 + Math.floor(bot.rand() * 30);
    bot.target = -1;
  }
  if (tick < bot.escapeUntil) {
    const gx = bot.escapeX - me.x;
    const gz = bot.escapeZ - me.z;
    const cross = me.fx * gz - me.fz * gx;
    const dot = me.fx * gx + me.fz * gz;
    const angle = Math.atan2(cross, dot);
    if (gx * gx + gz * gz < 1.2) bot.escapeUntil = tick;
    // The open floor is behind: back straight out, turning toward it.
    if (Math.abs(angle) > 2.0) {
      return { steer: Math.round((angle > 0 ? -1 : 1) * INPUT_STEPS), throttle: -INPUT_STEPS };
    }
    return { steer: Math.round(Math.max(-1, Math.min(1, angle * 2)) * INPUT_STEPS), throttle: INPUT_STEPS };
  }

  if (bot.target < 0 || tick >= bot.retargetAt || !state.cars[bot.target]?.active) {
    bot.target = pickTarget(bot, state);
    bot.retargetAt = tick + Math.round(TICK_HZ * (1.6 + bot.rand() * 2.4));
  }
  const target = state.cars[bot.target];
  let gx = 0;
  let gz = 0;
  if (target) {
    const dx = target.x - me.x;
    const dz = target.z - me.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    const ahead = Math.min(0.9, dist / 5) * bot.skill.lead;
    gx = target.x + target.vx * ahead - me.x;
    gz = target.z + target.vz * ahead - me.z;
    // Just bumped it: back off, pick another, and come again.
    if (dist < 2.05 && speed < 1.6) {
      bot.reverseUntil = tick + 26 + Math.floor(bot.rand() * 26);
      bot.reverseSteer = bot.rand() < 0.5 ? -1 : 1;
      bot.retargetAt = bot.reverseUntil;
      return { steer: bot.reverseSteer * INPUT_STEPS, throttle: -INPUT_STEPS };
    }
  } else {
    gx = -me.x;
    gz = -me.z;
  }

  // Keep off the rail: a point ahead that is outside the floor pulls to the middle.
  const lookX = me.x + me.vx * 0.7;
  const lookZ = me.z + me.vz * 0.7;
  if (Math.abs(lookX) > RINK_HX - 1.6 || Math.abs(lookZ) > RINK_HZ - 1.6) {
    gx = gx * 0.4 - me.x * 0.6;
    gz = gz * 0.4 - me.z * 0.6;
  }

  // Angle from the nose to the goal, positive to the right.
  const cross = me.fx * gz - me.fz * gx;
  const dot = me.fx * gx + me.fz * gz;
  const angle = Math.atan2(cross, dot);
  let steer = Math.max(-1, Math.min(1, angle * 1.9));
  steer += (bot.rand() * 2 - 1) * bot.skill.wobble;
  steer = Math.max(-1, Math.min(1, steer));
  const throttle = Math.abs(angle) > 2.3 ? 0.35 : bot.skill.pace;

  // Stuck against something: back out with the wheel turned.
  if (throttle > 0.5 && speed < 0.35) bot.stuckTicks += 1;
  else bot.stuckTicks = Math.max(0, bot.stuckTicks - 2);
  if (bot.stuckTicks > 30) {
    bot.stuckTicks = 0;
    bot.reverseUntil = tick + 30 + Math.floor(bot.rand() * 20);
    bot.reverseSteer = bot.rand() < 0.5 ? -1 : 1;
  }

  return { steer: Math.round(steer * INPUT_STEPS), throttle: Math.round(throttle * INPUT_STEPS) };
}

/** The input this bot drives with this tick. Call once per tick. */
export function botInput(bot: BotBrain, state: SimState): CarInput {
  // Think at 20 Hz, and act on it `reaction` ticks later.
  if (state.tick % 3 === bot.seat % 3) {
    bot.queue.push(decide(bot, state));
  } else {
    bot.queue.push(bot.queue.length > 0 ? bot.queue[bot.queue.length - 1]! : bot.last);
  }
  if (bot.queue.length > bot.skill.reaction) {
    bot.last = bot.queue.shift()!;
  }
  return bot.last;
}
