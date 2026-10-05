/* Derby's rules: the numbers the client, the server, the bots and the
   verifier all read. Pure, no DOM or Node APIs.

   The water race. Up to eight players sit at the counter, each with a water
   gun and a target. While your stream is on your target your horse runs up
   its rail; the closer to the middle, the faster. Off the target it stands.
   Every lane's target follows the same seeded path, so every lane faces the
   same race. First horse to the wire wins. DERBY.md has the research, the
   feel spec, the maths and the netcode. */

/** Bumped when the race maths changes (distance, target, speed, bots, timing). */
export const DERBY_RULES_VERSION = 2;

/** Lanes in a race. Bots fill the ones no person takes. */
export const DERBY_LANES = 8;

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------

/** The race runs in ticks. A tick's aim decides the horse's speed for it. */
export const DERBY_TICK_MS = 25;

/** The countdown between "they're loaded" and the gate opening. */
export const DERBY_COUNTDOWN_MS = 3_000;

/** No horse at the wire by then: the leader wins. */
export const DERBY_RACE_MAX_MS = 90_000;

/** Ticks in the longest race. */
export const DERBY_MAX_TICKS = DERBY_RACE_MAX_MS / DERBY_TICK_MS;

// ---------------------------------------------------------------------------
// The field, the target and the speed
// ---------------------------------------------------------------------------

/** The aiming field: x from -1 to 1, y from -0.6 (top) to 0.6 (bottom).
 *  Every phone draws it at this shape, so the race is the same everywhere. */
export const DERBY_FIELD_X = 1;
export const DERBY_FIELD_Y = 0.6;

/** Aim samples travel as integers: field units times this. */
export const DERBY_AIM_SCALE = 1_000;

/** The target's radius in field units. On it, your horse runs. */
export const DERBY_TARGET_R = 0.2;

/** The bull: inside this share of the radius, full speed. */
export const DERBY_BULL = 0.3;

/** Speed at the target's rim, as a share of full speed. */
export const DERBY_RIM_SPEED = 0.35;

/** Lengths from the gate to the wire. */
export const DERBY_DISTANCE = 60;

/** Full speed in lengths a second (on the bull the whole time). */
export const DERBY_TOP_SPEED = 2;

/** Full speed in lengths a tick. */
export const DERBY_TICK_LENGTHS = (DERBY_TOP_SPEED * DERBY_TICK_MS) / 1000;

/**
 * How fast the horse runs, as a share of full speed, for a stream `d`
 * target radii from the target's middle. 1 on the bull, falling in a
 * straight line to DERBY_RIM_SPEED at the rim, 0 off the target.
 */
export function derbySpeedShare(d: number): number {
  if (!(d < 1)) return 0;
  if (d <= DERBY_BULL) return 1;
  return 1 - ((1 - DERBY_RIM_SPEED) * (d - DERBY_BULL)) / (1 - DERBY_BULL);
}

/** The aim can move this far in field units between two ticks while the
 *  water runs (40 units a second, two field widths in 50 ms). The phone's
 *  aim never moves faster; the server turns down input that does. */
export const DERBY_AIM_MAX_STEP = 1;

// ---------------------------------------------------------------------------
// The network
// ---------------------------------------------------------------------------

/** The phone sends its aim samples this often. */
export const DERBY_BATCH_MS = 200;

/** The most ticks one batch may carry (a phone catching up after a stall). */
export const DERBY_MAX_BATCH_TICKS = 160;

/**
 * How far in the past the server still takes a tick's aim. A sample that
 * reaches the server later than this is dropped and the tick is dry (the
 * horse stands for it). A tick older than this is final for every lane.
 */
export const DERBY_MAX_LAG_MS = 1_000;

/** Extra margin before the server treats a tick as final when it settles
 *  or tells phones what is final: a batch already past its check but not
 *  yet stored can't change a decided race. */
export const DERBY_SEAL_MARGIN_MS = 500;

/** A sample this far ahead of the server's clock is not taken (yet). */
export const DERBY_MAX_LEAD_MS = 250;

/** A person silent this long during a race forfeits (no tickets). */
export const DERBY_DISCONNECT_FORFEIT_MS = 30_000;

/** Heartbeat cadence while the race page is open. */
export const DERBY_HEARTBEAT_MS = 4_000;

/** A person silent this long in a lobby loses the lane. */
export const DERBY_LOBBY_TIMEOUT_MS = 20_000;

/** A public race starts this long after it opens, full or not. */
export const DERBY_PUBLIC_FILL_MS = 12_000;

/** An invite race nobody starts closes after this. */
export const DERBY_LOBBY_MAX_MS = 15 * 60_000;

// ---------------------------------------------------------------------------
// Tickets
// ---------------------------------------------------------------------------

/**
 * Tickets by place. s is the share of the field you beat, 0 for last and 1
 * for a win. 75 × (1 − exp(−((s + a) / k)^p)), with a floor for a lane that
 * raced, inside the 75 per-run cap. The fit and the per-minute numbers are
 * in DERBY.md and scripts/sim-derby.ts.
 */
export const DERBY_REWARD_CAP = 75;
export const DERBY_REWARD_FLOOR = 10;
export const DERBY_REWARD_A = 0.05;
export const DERBY_REWARD_K = 0.64;
export const DERBY_REWARD_P = 1.4;

/** Tickets for finishing `place` (1 is first) out of `field` lanes. */
export function derbyTickets(place: number, field: number = DERBY_LANES): number {
  if (!Number.isFinite(place) || !Number.isFinite(field) || field < 2) return 0;
  const p = Math.min(field, Math.max(1, Math.floor(place)));
  const s = (field - p) / (field - 1);
  const raw = DERBY_REWARD_CAP * (1 - Math.exp(-Math.pow((s + DERBY_REWARD_A) / DERBY_REWARD_K, DERBY_REWARD_P)));
  return Math.max(DERBY_REWARD_FLOOR, Math.min(DERBY_REWARD_CAP, Math.round(raw)));
}

// ---------------------------------------------------------------------------
// Lanes
// ---------------------------------------------------------------------------

/** Each lane's silks: game art, so any colour; told apart by lightness too.
 *  Ticket amber is kept for "you" and is no lane's colour. */
export const DERBY_LANE_COLORS = [
  { silk: '#C8402F', trim: '#F4EBDC', ink: '#F4EBDC' },
  { silk: '#2F63B4', trim: '#F4EBDC', ink: '#F4EBDC' },
  { silk: '#2E7566', trim: '#F4EBDC', ink: '#F4EBDC' },
  { silk: '#F4EBDC', trim: '#1F1A16', ink: '#1F1A16' },
  { silk: '#7B4FA0', trim: '#F4EBDC', ink: '#F4EBDC' },
  { silk: '#E58AA0', trim: '#1F1A16', ink: '#1F1A16' },
  { silk: '#1F1A16', trim: '#F4EBDC', ink: '#F4EBDC' },
  { silk: '#8FC1D9', trim: '#1F1A16', ink: '#1F1A16' },
] as const;

/** Bot horses' names, one per lane. */
export const DERBY_BOT_NAMES = [
  'Tin Lizzy',
  'Nightjar',
  'Marmalade',
  'Penny Whistle',
  'Foxtrot',
  'Wooden Nickel',
  'Boardwalk Bea',
  'Saltwater',
] as const;

// ---------------------------------------------------------------------------
// Aim samples (the server's rules, pure so the verifier can prove them)
// ---------------------------------------------------------------------------

/** The latest tick that is final at server race time `nowRace` (ms after
 *  the gate): every tick before it is decided for every lane. */
export function derbySealTick(nowRace: number, margin: number = DERBY_SEAL_MARGIN_MS): number {
  return Math.max(0, Math.floor((nowRace - DERBY_MAX_LAG_MS - margin) / DERBY_TICK_MS));
}

export type DerbyAimCheck =
  | { ok: true; ticks: number }
  | { ok: false; reason: 'malformed' | 'out_of_range' | 'teleport' };

/**
 * Check a batch of samples, flat [x, y, squirt, ...] integers. Positions
 * inside the field, squirt 0 or 1, and while the water runs on two ticks
 * in a row the aim moves at most DERBY_AIM_MAX_STEP. `before` is the
 * lane's last stored sample when it is the tick just before this batch.
 */
export function derbyCheckSamples(samples: unknown, before: readonly [number, number, number] | null): DerbyAimCheck {
  if (!Array.isArray(samples) || samples.length === 0 || samples.length % 3 !== 0) return { ok: false, reason: 'malformed' };
  const n = samples.length / 3;
  if (n > DERBY_MAX_BATCH_TICKS) return { ok: false, reason: 'malformed' };
  const maxX = DERBY_FIELD_X * DERBY_AIM_SCALE;
  const maxY = DERBY_FIELD_Y * DERBY_AIM_SCALE;
  const step = DERBY_AIM_MAX_STEP * DERBY_AIM_SCALE;
  let px = before ? before[0] : 0;
  let py = before ? before[1] : 0;
  let ps = before ? before[2] : 0;
  for (let i = 0; i < n; i += 1) {
    const x = samples[i * 3];
    const y = samples[i * 3 + 1];
    const s = samples[i * 3 + 2];
    if (!Number.isInteger(x) || !Number.isInteger(y) || (s !== 0 && s !== 1)) return { ok: false, reason: 'malformed' };
    if (Math.abs(x as number) > maxX || Math.abs(y as number) > maxY) return { ok: false, reason: 'out_of_range' };
    if (s === 1 && ps === 1) {
      const dx = (x as number) - px;
      const dy = (y as number) - py;
      if (dx * dx + dy * dy > step * step) return { ok: false, reason: 'teleport' };
    }
    px = x as number;
    py = y as number;
    ps = s as number;
  }
  return { ok: true, ticks: n };
}

/**
 * Which part of a batch the server keeps. The lane has every tick before
 * `next`; the batch claims ticks from `from`; the server's clock is
 * `nowRace`. Ticks already held are skipped, ticks older than the lag are
 * dropped (dry), ticks ahead of the clock wait for a later batch. Returns
 * the kept range [keepFrom, keepTo), or null when nothing is kept.
 */
export function derbyKeepRange(
  next: number,
  from: number,
  ticks: number,
  nowRace: number,
): { keepFrom: number; keepTo: number } | null {
  const oldest = Math.ceil((nowRace - DERBY_MAX_LAG_MS) / DERBY_TICK_MS);
  const newest = Math.floor((nowRace + DERBY_MAX_LEAD_MS) / DERBY_TICK_MS);
  const keepFrom = Math.max(from, next, oldest, 0);
  const keepTo = Math.min(from + ticks, newest + 1, DERBY_MAX_TICKS);
  return keepTo > keepFrom ? { keepFrom, keepTo } : null;
}

export const isDerbyLane = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < DERBY_LANES;
