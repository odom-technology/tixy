/* Bumper cars: the numbers every part of the game shares. The browser, the
   server's room loop, the bots, the sync test and the reward table all read
   them from here. BUMPER_CARS.md says where each one comes from. */

/** Physics ticks a second. The server and the page step the same tick. */
export const TICK_HZ = 60;
export const DT = 1 / TICK_HZ;

/** A round is 90 seconds of power, after a 3 second count in. */
export const ROUND_SECONDS = 90;
export const ROUND_TICKS = ROUND_SECONDS * TICK_HZ;
export const COUNTDOWN_TICKS = 3 * TICK_HZ;
/** After the horn the power is cut and the cars coast for this long. */
export const COAST_TICKS = Math.round(1.6 * TICK_HZ);

/** Seats in a round. Bots fill the ones nobody takes. */
export const MAX_CARS = 8;
export const MIN_HUMANS_TO_START = 1;

// ── The rink: a rounded rectangle, steel floor, rubber rail ──────────────
// Real rinks run about 24 x 14 m for 30-odd cars. Eight cars get a smaller
// floor with the same crowding: about 23 m² a car, long and narrow so it
// fills a phone held upright and a desktop turned on its side.
/** Half the rink's width (x) and depth (z), metres, to the rail's face. */
export const RINK_HX = 5.4;
export const RINK_HZ = 9.0;
/** Corner radius. Round corners stop a car being pinned in a corner. */
export const RINK_CORNER = 2.6;

// ── The car ──────────────────────────────────────────────────────────────
/** The rubber ring's collision radius, metres. The body is 2.0 x 1.7. */
export const CAR_RADIUS = 0.92;
/** Mass is 1 for every car: a bump is decided by speed and angle alone. */
export const CAR_MASS = 1;
/** Moment of inertia: a disc's, a little heavier for the rider. */
export const CAR_INERTIA = 0.6 * CAR_MASS * CAR_RADIUS * CAR_RADIUS;

/** Throttle's push, m/s², and reverse's. */
export const ACCEL = 6.2;
export const REVERSE_ACCEL = 4.2;
/** Linear drag, 1/s. Top speed is ACCEL / DRAG, about 4.6 m/s (16.5 km/h),
 *  twice a real dodgem: on a phone the real speed reads as slow motion. */
export const DRAG = 1.35;
/** Rolling friction with the pedal up, m/s². Stops a coasting car in ~2 s. */
export const ROLL_DECEL = 1.1;

/** Steering: the yaw rate at full lock, rad/s, and how fast it gets there. */
export const TURN_RATE = 3.3;
export const YAW_RESPONSE = 11;

/** Sideways grip, 1/s: how fast sideways speed dies. Lower is more drift. */
export const GRIP = 8.5;
/** Hard lock at speed lets the tail out. */
export const DRIFT_GRIP = 2.6;
export const DRIFT_SPEED = 3.0;
export const DRIFT_STEER = 0.75;
/** A car that has just been hit slides for a moment. */
export const SLIP_GRIP = 1.1;
export const SLIP_TICKS = 22;

// ── Contact ──────────────────────────────────────────────────────────────
/** Rubber on rubber. Textbook dodgem figures are around 0.8. */
export const RESTITUTION_CAR = 0.74;
/** The rail's padding is softer than a bumper. */
export const RESTITUTION_WALL = 0.42;
/** Rubber friction at the contact, which is what spins a glancing hit. */
export const CONTACT_FRICTION = 0.28;
/** A side hit turns the car it lands on: yaw per m/s of impulse. */
export const SIDE_HIT_SPIN = 0.55;

// ── Scoring ──────────────────────────────────────────────────────────────
/** Closing speed, m/s, that counts as a bump. A nudge doesn't. */
export const BUMP_MIN_SPEED = 2.2;
/** A hit this hard scores two. Full speed into a car standing still is 4.6. */
export const BIG_BUMP_SPEED = 3.8;
/** The same two cars can't score off each other again for this long. */
export const PAIR_COOLDOWN_TICKS = 90;
/** One car scores off the same car at most this many times a round, so two
 *  players can't farm each other. */
export const MAX_SCORES_PER_VICTIM = 10;
/** Head on: each car's share of the closing speed is within this of the
 *  other's, and both were driving in. Both score. */
export const HEAD_ON_SHARE = 0.3;

// ── Network ──────────────────────────────────────────────────────────────
/** The server sends a snapshot every this many ticks (30 a second). */
export const SNAPSHOT_EVERY = 2;
/** The page sends its inputs every this many ticks, with the last few again. */
export const INPUT_EVERY = 2;
export const INPUT_REDUNDANCY = 6;
/** A seat whose player has gone waits this long, idling, before a bot drives
 *  it. Their score stops counting until they are back. */
export const DROP_GRACE_TICKS = 15 * TICK_HZ;

/** Steering and throttle travel as whole numbers from -STEPS to STEPS. */
export const INPUT_STEPS = 16;

/** Car colours, by seat. Game art may use any colour; these are flat and
 *  tell eight cars apart on an ink floor. */
export const CAR_COLORS: readonly string[] = [
  '#B83627', // red
  '#F2A33C', // ticket
  '#3E7CB1', // blue
  '#2E9E6B', // green
  '#F4EBDC', // paper
  '#8C5BB0', // violet
  '#E0709A', // pink
  '#2BB3B1', // teal
];
export const CAR_COLOR_NAMES: readonly string[] = ['red', 'yellow', 'blue', 'green', 'cream', 'violet', 'pink', 'teal'];
