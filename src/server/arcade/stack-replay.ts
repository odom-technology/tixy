/**
 * STACK (stacker's endless mode): the shared rules, imported by the client
 * (src/app/(games)/stack/_stack-client.tsx), the score route and the
 * verifiers. Anything score-affecting lives here; rendering (colours, camera,
 * falling pieces, sound) stays in the client and never feeds back.
 *
 * A block sweeps left and right above the tower; the player drops it, and
 * whatever hangs over the block below is sliced off, so the next block is
 * narrower. A drop near the centre is a PERFECT: it snaps into line and keeps
 * its width, and from the fifth perfect in a row each one grows the block
 * back. A drop that misses the tower ends the run. Score = height.
 *
 * Two rule sets live here. Rules 1 (below, `replayStackSession`) is the game
 * as it was: a 60 fps frame counter, drops resolved at frame boundaries, a
 * speed that stepped up every 15 rows and stopped at 2.2x. Strong players
 * could stack forever. It is kept for last season's numbers and the
 * verifier's baseline; nothing new is scored with it.
 *
 * Rules 2 (`STACK_RULES_VERSION`, further down) is what the game plays now:
 *  - Time, not frames. A drop is the input event's own time in whole ms since
 *    the run began, and the block's position is a pure function of the time
 *    since its row began. The client draws that function every frame at the
 *    display's refresh rate and scores a drop with it at the event's time;
 *    the route replays the same numbers. 30 Hz and 144 Hz screens agree.
 *  - Only + - * /, floor and round in anything that decides a score, so
 *    every JavaScript engine computes the same bits.
 *  - The sweep slows into each wall and back out (an eased turnaround), and is
 *    straight and steady over the tower.
 *  - It gets harder as you climb: the speed rises on a smooth curve, and past
 *    set heights one more pressure joins at a time (fast rows on alternate
 *    turns, then a narrowing width limit). Tuning and the tables by skill are
 *    in scripts/verify-stack-endless-replay.ts.
 *
 * No DB, no imports, no Date or Math.random.
 */

// ── Deterministic sim constants (shared client + server) ─────────────────────
// (Vertical geometry — canvas height, block height — is render-only and so
// does NOT appear here: STACK's slice/overlap is purely 1-D horizontal.)
export const STACK_BASE_WIDTH = 480;
export const STACK_TARGET_FPS = 60;
export const STACK_FRAME_TIME = 1000 / STACK_TARGET_FPS;

/** First (base) block width, in logical px. */
export const STACK_INITIAL_BLOCK_WIDTH = 220;
/** Horizontal travel band: px of dead space at each wall. */
export const STACK_SWEEP_MARGIN = 30;
export const STACK_SWEEP_LEFT = STACK_SWEEP_MARGIN;

/**
 * Sweep speed (px per fixed 60fps frame). Stepped ramp: +10% of base every 15
 * placed blocks, capped at 2.2x base — past that, shrinkage (not speed) is the
 * difficulty engine.
 */
export const STACK_BASE_SPEED = 2.6;
export const STACK_SPEED_STEP_EVERY = 15;
export const STACK_SPEED_STEP = 0.1;
export const STACK_MAX_SPEED_FACTOR = 2.2;

/**
 * PERFECT window: |delta| <= max(abs floor, frac * current width).
 * The absolute floor keeps perfects reachable when the block is a sliver.
 */
export const STACK_PERFECT_WINDOW_ABS = 18;
export const STACK_PERFECT_WINDOW_FRAC = 0.1;

/** Grow-back: from the STACK_GROW_GATE-th consecutive perfect onward, each
 * perfect grows the block, clamped at the original width. */
export const STACK_GROW_GATE = 5;
export const STACK_GROW_PER_PERFECT = 18;

/** Degenerate-sliver guard: a cut leaving less than this is treated as a miss. */
export const STACK_MIN_OVERLAP = 4;

/** Speed of the moving block (px/frame) at a given height. Pure. */
export const stackSpeedForHeight = (height: number): number =>
  Math.min(
    STACK_BASE_SPEED * STACK_MAX_SPEED_FACTOR,
    STACK_BASE_SPEED *
      (1 + STACK_SPEED_STEP * Math.floor(height / STACK_SPEED_STEP_EVERY)),
  );

/**
 * Left-edge x of the moving block from the fixed-frame phase. The block of
 * `width` ping-pongs between STACK_SWEEP_LEFT and (STACK_BASE_WIDTH -
 * STACK_SWEEP_MARGIN - width) as a triangle wave; parity flips the start wall
 * each row (parity 0 starts left sweeping right, parity 1 mirrors it).
 */
export const stackMovingLeftAt = (
  framePhase: number,
  width: number,
  parity: number,
  height: number,
): number => {
  const span = STACK_BASE_WIDTH - STACK_SWEEP_MARGIN - width - STACK_SWEEP_LEFT;
  if (span <= 0) return STACK_SWEEP_LEFT;
  const speed = stackSpeedForHeight(height);
  const distance = framePhase * speed;
  const cycle = span * 2;
  let pos = distance % cycle;
  if (pos < 0) pos += cycle;
  // Triangle wave: 0..span then span..0.
  const tri = pos <= span ? pos : cycle - pos;
  return parity === 0 ? STACK_SWEEP_LEFT + tri : STACK_SWEEP_LEFT + span - tri;
};

// ── Sim state machine ─────────────────────────────────────────────────────────

export type StackSimState = {
  /** Left edge of the landed tower-top block (the next block inherits it). */
  left: number;
  /** Width of the landed tower-top block. */
  width: number;
  /** Number of successfully placed blocks (= score). */
  height: number;
  /** Fixed frames since the current moving block appeared. */
  phase: number;
  /** Current consecutive-PERFECT streak (reset by any non-perfect drop). */
  streak: number;
  /** Total PERFECT drops this run. */
  perfects: number;
  /** Best consecutive-PERFECT streak this run. */
  bestStreak: number;
  died: boolean;
};

export const createStackSim = (): StackSimState => ({
  left: (STACK_BASE_WIDTH - STACK_INITIAL_BLOCK_WIDTH) / 2,
  width: STACK_INITIAL_BLOCK_WIDTH,
  height: 0,
  phase: 0,
  streak: 0,
  perfects: 0,
  bestStreak: 0,
  died: false,
});

export type StackDropOutcome =
  | {
      kind: 'miss';
      /** Where the whole block was when it fell (render uses this for debris). */
      movingLeft: number;
      movingWidth: number;
    }
  | {
      kind: 'perfect';
      left: number;
      width: number;
      streak: number;
      /** How many px the block grew back this drop (0 until the streak gate). */
      grewPx: number;
    }
  | {
      kind: 'cut';
      left: number;
      width: number;
      /** The sliced-off overhang (render uses this for the falling piece). */
      sliceLeft: number;
      sliceWidth: number;
      sliceSide: -1 | 1;
    };

/**
 * Resolve one DROP at the sim's current phase. Mutates `state` and returns the
 * outcome (the render layer uses the outcome; the verifier only needs state).
 * MUST stay pure of any Date/Math.random/environment reads.
 */
export const applyStackDrop = (state: StackSimState): StackDropOutcome => {
  const parity = state.height % 2;
  const movingLeft = stackMovingLeftAt(
    state.phase,
    state.width,
    parity,
    state.height,
  );
  const movingRight = movingLeft + state.width;
  const baseLeft = state.left;
  const baseRight = state.left + state.width;

  const overlapLeft = Math.max(movingLeft, baseLeft);
  const overlapRight = Math.min(movingRight, baseRight);
  const overlap = overlapRight - overlapLeft;
  const delta = movingLeft - baseLeft;

  // Full miss: the moving block clears the block below entirely.
  if (overlap <= 0) {
    state.died = true;
    return { kind: 'miss', movingLeft, movingWidth: state.width };
  }

  // PERFECT: near-center — snap to exact alignment, keep full width.
  const perfectWindow = Math.max(
    STACK_PERFECT_WINDOW_ABS,
    STACK_PERFECT_WINDOW_FRAC * state.width,
  );
  if (Math.abs(delta) <= perfectWindow) {
    state.streak += 1;
    state.perfects += 1;
    if (state.streak > state.bestStreak) state.bestStreak = state.streak;
    let grewPx = 0;
    if (state.streak >= STACK_GROW_GATE) {
      const grown = Math.min(
        STACK_INITIAL_BLOCK_WIDTH,
        state.width + STACK_GROW_PER_PERFECT,
      );
      grewPx = grown - state.width;
      if (grewPx > 0) {
        // Grow symmetrically, clamped inside the sweep band so the block
        // always stays fully coverable by future sweeps.
        let left = state.left - grewPx / 2;
        left = Math.min(
          Math.max(left, STACK_SWEEP_LEFT),
          STACK_BASE_WIDTH - STACK_SWEEP_MARGIN - grown,
        );
        state.left = left;
        state.width = grown;
      }
    }
    state.height += 1;
    state.phase = 0;
    return {
      kind: 'perfect',
      left: state.left,
      width: state.width,
      streak: state.streak,
      grewPx,
    };
  }

  // Degenerate sliver: too thin to stand — treat as a miss.
  if (overlap < STACK_MIN_OVERLAP) {
    state.died = true;
    return { kind: 'miss', movingLeft, movingWidth: state.width };
  }

  // Normal cut: shrink to the overlap; the overhang falls away.
  const sliceSide: -1 | 1 = delta < 0 ? -1 : 1;
  const sliceLeft = sliceSide === -1 ? movingLeft : overlapRight;
  const sliceWidth =
    sliceSide === -1 ? overlapLeft - movingLeft : movingRight - overlapRight;
  state.left = overlapLeft;
  state.width = overlap;
  state.streak = 0;
  state.height += 1;
  state.phase = 0;
  return {
    kind: 'cut',
    left: state.left,
    width: state.width,
    sliceLeft,
    sliceWidth,
    sliceSide,
  };
};

// ── Server replay ─────────────────────────────────────────────────────────────

export type StackDropEvent = {
  /** Client-relative timestamp (ms) at which the player dropped the block. */
  t: number;
};

export type StackReplayResult = {
  /** Authoritative height = number of successful drops before the run ended. */
  score: number;
  /** Server-derived timeline of successful-drop times (ms), for cross-checks. */
  dropTimesMs: number[];
  /** True if a drop produced zero overlap (a miss) and ended the run. */
  died: boolean;
  /** Number of fixed-timestep frames simulated. */
  framesPlayed: number;
  /** Total PERFECT drops (secondary stat; not part of the score). */
  perfects: number;
  /** Best consecutive-PERFECT streak (secondary stat; not part of the score). */
  bestStreak: number;
};

/**
 * Replay a STACK run from the recorded drop-event timestamps.
 *
 * Advances the shared fixed-timestep state machine; on each `drop` event the
 * block's position is sampled at that frame and resolved through the identical
 * slice/perfect/grow logic the client ran. Zero overlap (or a sliver) => the
 * run ends.
 *
 * @param events     recorded drop events (each carries client-relative `t`)
 * @param durationMs total run duration (drops past this are ignored)
 * @param _seed      unused — STACK has no RNG (kept for a uniform replay API)
 */
export const replayStackSession = (
  events: StackDropEvent[],
  durationMs: number,
  _seed?: number,
): StackReplayResult => {
  const drops = [...events]
    .filter((event) => Number.isFinite(event.t) && event.t >= 0)
    .map((event) => event.t)
    .sort((a, b) => a - b);

  const sim = createStackSim();
  const dropTimesMs: number[] = [];

  let elapsedMs = 0;
  let framesPlayed = 0;
  let dropIndex = 0;

  while (elapsedMs + STACK_FRAME_TIME <= durationMs && !sim.died) {
    elapsedMs += STACK_FRAME_TIME;
    framesPlayed += 1;
    sim.phase += 1;

    // Resolve every drop whose timestamp falls in this frame.
    while (dropIndex < drops.length && drops[dropIndex]! <= elapsedMs) {
      const outcome = applyStackDrop(sim);
      dropIndex += 1;
      if (outcome.kind === 'miss') break;
      dropTimesMs.push(Math.round(elapsedMs));
    }
  }

  return {
    score: sim.height,
    dropTimesMs,
    died: sim.died,
    framesPlayed,
    perfects: sim.perfects,
    bestStreak: sim.bestStreak,
  };
};

// ═════════════════════════════════════════════════════════════════════════════
// Rules 2: time-based, eased turnarounds, harder as you climb.
// ═════════════════════════════════════════════════════════════════════════════

/** Stored with every run scored by these rules (stack_scores.rules). */
export const STACK_RULES_VERSION = 2;

/** The travel band: the block's left edge runs from STACK_SWEEP_LEFT to
 *  STACK_SWEEP_LEFT + (STACK_BAND - width). Same geometry as rules 1. */
export const STACK_BAND = STACK_BASE_WIDTH - 2 * STACK_SWEEP_MARGIN;

/**
 * Speed, px per ms, rises on one smooth S-shaped curve that never steps:
 *   speed(h) = BASE + (TOP - BASE) * h^2 / (h^2 + HALF^2)
 * Flat for the first rows, steepest around height 46, then levelling off
 * toward TOP: 0.15 at 0 (rules 1 started at 0.156), 0.21 at 30, 0.32 at 60,
 * 0.44 at 100, 0.52 at 150. No row is more than 2% faster than the one
 * before (the verifier checks), so no single row feels like a jump.
 */
export const STACK2_BASE_SPEED = 0.15;
export const STACK2_TOP_SPEED = 0.62;
export const STACK2_SPEED_HALF = 80;

/** Px of travel at each wall over which the block slows to a stop and
 *  speeds back up. Over the tower it moves at full, steady speed. */
export const STACK2_TURN_PX = 36;

/** Pressure 1, from this height: every other row (odd heights) moves faster,
 *  by up to FAST_BOOST, phased in over FAST_RAMP_ROWS fast rows. */
export const STACK2_FAST_FROM = 30;
export const STACK2_FAST_RAMP_ROWS = 6;
export const STACK2_FAST_BOOST = 0.25;

/** Pressure 2, from this height: a width limit. The moving block is never
 *  wider than the limit, which drops by NARROW_STEP px every NARROW_EVERY
 *  rows, down to NARROW_MIN. A block wider than the limit is trimmed, evenly
 *  on both sides, when its row begins. */
export const STACK2_NARROW_FROM = 60;
export const STACK2_NARROW_EVERY = 10;
export const STACK2_NARROW_STEP = 20;
export const STACK2_NARROW_MIN = 140;

/** PERFECT: the centres line up within max(ABS, FRAC * width) px. */
export const STACK2_PERFECT_ABS = 15;
export const STACK2_PERFECT_FRAC = 0.1;

/**
 * Tickets: rewards/wallet.ts pays a rules 2 run
 *   75 x (1 - exp(-(height / SCALE)^POWER))
 * floored, at most 75 (the per-run cap) and inside the daily cap. Rules 1
 * paid the shared curve at height / 40 with power 1.15. Rules 2 runs are
 * shorter for the same skill, so a power under 1 front-loads the curve: the
 * first rows pay more, the top pays less. SCALE and POWER are fitted so new
 * and good players (60 ms / 20 px and 40 ms / 13 px of error) earn within
 * 10% of what they did per minute under rules 1. The fit and the tables by
 * skill are in scripts/verify-stack-endless-replay.ts, which fails if this
 * drifts.
 */
export const STACK_REWARD_SCALE = 88;
export const STACK_REWARD_POWER = 0.6;

/** What a height pays before the daily cap: the same numbers the reward
 *  pipeline pays (the verifier checks every height to 400). */
export const stackRunTickets = (height: number): number => {
  const x = Math.max(0, height / STACK_REWARD_SCALE);
  return Math.max(0, Math.floor(75 * (1 - Math.exp(-Math.pow(x, STACK_REWARD_POWER)))));
};

/** Every row is reached from these. */
export type StackRow = {
  /** Blocks already placed (the row being played lands at height + 1). */
  height: number;
  /** px per ms over the tower. */
  speed: number;
  /** An alternate-turn fast row. */
  fast: boolean;
  /** The widest the moving block can be on this row. */
  limit: number;
  /** +1 starts at the left wall moving right, -1 at the right wall. */
  dir: 1 | -1;
};

/** The curve alone, without the fast-row boost. */
export const stackBaseSpeed = (height: number): number => {
  const h2 = height * height;
  return STACK2_BASE_SPEED + ((STACK2_TOP_SPEED - STACK2_BASE_SPEED) * h2) / (h2 + STACK2_SPEED_HALF * STACK2_SPEED_HALF);
};

/** The width limit at a height. */
export const stackWidthLimit = (height: number): number => {
  if (height < STACK2_NARROW_FROM) return STACK_INITIAL_BLOCK_WIDTH;
  const steps = 1 + Math.floor((height - STACK2_NARROW_FROM) / STACK2_NARROW_EVERY);
  return Math.max(STACK2_NARROW_MIN, STACK_INITIAL_BLOCK_WIDTH - steps * STACK2_NARROW_STEP);
};

/** The rules for the row played at `height`. Pure. */
export const stackRow = (height: number): StackRow => {
  const h = Math.max(0, Math.floor(height));
  let speed = stackBaseSpeed(h);
  const fast = h >= STACK2_FAST_FROM && h % 2 === 1;
  if (fast) {
    const k = Math.min(1, (h - STACK2_FAST_FROM + 1) / (2 * STACK2_FAST_RAMP_ROWS));
    speed = speed * (1 + STACK2_FAST_BOOST * k);
  }
  return { height: h, speed, fast, limit: stackWidthLimit(h), dir: h % 2 === 0 ? 1 : -1 };
};

/** Displacement from a wall `d` px of path after the turn: starts at rest,
 *  meets full speed at `w` with no kink (f(0) = f'(0) = 0, f(w) = w,
 *  f'(w) = 1). Never past the straight line, so the block stays in the band. */
const turnEase = (d: number, w: number): number => (2 * d * d) / w - (d * d * d) / (w * w);

/**
 * Left edge of the moving block `elapsedMs` into its row. A pure function of
 * time: the client draws it every frame, and a drop is scored with it at the
 * drop's own time. The block starts at its wall from rest.
 */
export const stackMoverLeft = (row: StackRow, width: number, elapsedMs: number): number => {
  const span = STACK_BAND - width;
  if (span <= 0) return STACK_SWEEP_LEFT;
  const d = elapsedMs > 0 ? elapsedMs * row.speed : 0;
  const cycle = span * 2;
  const p = d % cycle;
  // Distance from the start wall, 0 to span and back.
  const q = p <= span ? p : cycle - p;
  const w = Math.min(STACK2_TURN_PX, span / 2);
  let e = q;
  if (w > 0 && q < w) e = turnEase(q, w);
  else if (w > 0 && q > span - w) e = span - turnEase(span - q, w);
  return row.dir === 1 ? STACK_SWEEP_LEFT + e : STACK_SWEEP_LEFT + span - e;
};

export type StackRunState = {
  /** Left edge and width of the tower's top block. */
  left: number;
  width: number;
  /** Blocks placed: the score. */
  height: number;
  /** When the row now moving began, ms since the run began. */
  rowStartMs: number;
  streak: number;
  perfects: number;
  bestStreak: number;
  died: boolean;
};

export const createStackRun = (): StackRunState => ({
  left: (STACK_BASE_WIDTH - STACK_INITIAL_BLOCK_WIDTH) / 2,
  width: STACK_INITIAL_BLOCK_WIDTH,
  height: 0,
  rowStartMs: 0,
  streak: 0,
  perfects: 0,
  bestStreak: 0,
  died: false,
});

/** The moving block's width on the row now playing: the top block's width,
 *  held to the row's limit. */
export const stackMoverWidth = (state: StackRunState): number =>
  Math.min(state.width, stackRow(state.height).limit);

export type StackDropResult =
  | { kind: 'miss'; movingLeft: number; movingWidth: number }
  | {
      kind: 'perfect';
      left: number;
      width: number;
      movingLeft: number;
      movingWidth: number;
      streak: number;
      /** px the block grew back (0 before the fifth perfect in a row). */
      grewPx: number;
    }
  | {
      kind: 'cut';
      left: number;
      width: number;
      movingLeft: number;
      movingWidth: number;
      /** The overhang that falls (width 0 when nothing hung over). */
      sliceLeft: number;
      sliceWidth: number;
      sliceSide: -1 | 1;
    };

/**
 * Drop the moving block at `tMs` (whole ms since the run began; never before
 * the row began). Mutates `state`. The next row begins at `tMs`.
 */
export const stackDropAt = (state: StackRunState, tMs: number): StackDropResult => {
  const row = stackRow(state.height);
  const width = Math.min(state.width, row.limit);
  const elapsed = Math.max(0, tMs - state.rowStartMs);
  const movingLeft = stackMoverLeft(row, width, elapsed);
  const movingRight = movingLeft + width;
  const baseLeft = state.left;
  const baseRight = state.left + state.width;
  const overlapLeft = Math.max(movingLeft, baseLeft);
  const overlapRight = Math.min(movingRight, baseRight);
  const overlap = overlapRight - overlapLeft;
  // Twice the distance between the centres (no halving, so it stays exact).
  const offset2 = 2 * movingLeft + width - (2 * baseLeft + state.width);

  if (overlap <= 0 || overlap < STACK_MIN_OVERLAP) {
    state.died = true;
    return { kind: 'miss', movingLeft, movingWidth: width };
  }

  const window = Math.max(STACK2_PERFECT_ABS, STACK2_PERFECT_FRAC * width);
  if (Math.abs(offset2) <= 2 * window) {
    state.streak += 1;
    state.perfects += 1;
    if (state.streak > state.bestStreak) state.bestStreak = state.streak;
    // Snap onto the centre of the block below.
    let left = baseLeft + (state.width - width) / 2;
    let grown = width;
    if (state.streak >= STACK_GROW_GATE) grown = Math.min(row.limit, width + STACK_GROW_PER_PERFECT);
    const grewPx = grown - width;
    if (grewPx > 0) {
      left = Math.min(Math.max(left - grewPx / 2, STACK_SWEEP_LEFT), STACK_SWEEP_LEFT + STACK_BAND - grown);
    }
    state.left = left;
    state.width = grown;
    state.height += 1;
    state.rowStartMs = tMs;
    return { kind: 'perfect', left, width: grown, movingLeft, movingWidth: width, streak: state.streak, grewPx };
  }

  const sliceSide: -1 | 1 = movingLeft < baseLeft ? -1 : 1;
  const sliceLeft = sliceSide === -1 ? movingLeft : overlapRight;
  const sliceWidth = width - overlap;
  state.left = overlapLeft;
  state.width = overlap;
  state.streak = 0;
  state.height += 1;
  state.rowStartMs = tMs;
  return { kind: 'cut', left: overlapLeft, width: overlap, movingLeft, movingWidth: width, sliceLeft, sliceWidth, sliceSide };
};

/** Whole ms since the run began, from an input event's time and the run's
 *  start on the same clock. The client sends exactly this number. */
export const stackInputMs = (eventTimeMs: number, runStartMs: number): number =>
  Math.max(0, Math.round(eventTimeMs - runStartMs));

export type StackRunResult = {
  score: number;
  died: boolean;
  perfects: number;
  bestStreak: number;
  /** The drops that were played, in order (ms since the run began). */
  dropTimesMs: number[];
  /** The last played drop's time, ms. */
  durationMs: number;
};

/**
 * Replay a rules 2 run from its drop times. Times are rounded to whole ms
 * (the client sends whole ms, so this changes nothing for an honest run),
 * sorted, and played in order; drops after `durationMs` or after the miss
 * are ignored.
 */
export const replayStackRun = (drops: readonly number[], durationMs: number): StackRunResult => {
  const times = drops
    .filter((t) => typeof t === 'number' && Number.isFinite(t) && t >= 0)
    .map((t) => Math.round(t))
    .sort((a, b) => a - b);
  const run = createStackRun();
  const played: number[] = [];
  for (const t of times) {
    if (run.died || t > durationMs) break;
    stackDropAt(run, t);
    played.push(t);
  }
  return {
    score: run.height,
    died: run.died,
    perfects: run.perfects,
    bestStreak: run.bestStreak,
    dropTimesMs: played,
    durationMs: played.length > 0 ? played[played.length - 1]! : 0,
  };
};

/**
 * For bots and tests, never for scoring: the first time at or after
 * `fromElapsedMs` into the row when the moving block's centre crosses the
 * centre of the block below, in ms since the row began.
 */
export const stackAimElapsedMs = (state: StackRunState, fromElapsedMs = 0): number => {
  const row = stackRow(state.height);
  const width = Math.min(state.width, row.limit);
  const span = STACK_BAND - width;
  if (span <= 0) return fromElapsedMs;
  const target = state.left + (state.width - width) / 2;
  const q = row.dir === 1 ? target - STACK_SWEEP_LEFT : STACK_SWEEP_LEFT + span - target;
  // The path distance from the wall that eases to q.
  const w = Math.min(STACK2_TURN_PX, span / 2);
  const invert = (y: number) => {
    let lo = 0;
    let hi = w;
    for (let i = 0; i < 48; i += 1) {
      const mid = (lo + hi) / 2;
      if (turnEase(mid, w) < y) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  };
  let along = q;
  if (w > 0 && q < w) along = invert(q);
  else if (w > 0 && q > span - w) along = span - invert(span - q);
  const cycle = span * 2;
  const from = fromElapsedMs * row.speed;
  let best = Infinity;
  for (const base of [along, cycle - along]) {
    const k = Math.max(0, Math.ceil((from - base) / cycle));
    best = Math.min(best, base + k * cycle);
  }
  return best / row.speed;
};
