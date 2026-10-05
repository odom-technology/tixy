// ──────────────────────────────────────────────────────────────────────────
// BREAKOUT — server-side authoritative replay / plausibility verifier.
//
// This is a PURE function (no DB, no imports). It mirrors the parts of the
// client that determine the AUTHORITATIVE score, but it does NOT re-simulate
// ball/paddle float physics — that would never stay byte-identical across
// machines and would false-reject skilled players. Instead it follows the
// lighter "tetris-style" model:
//
//   • The client streams a `brick` scoring event per destroyed brick carrying
//     { t, points } and a `level` event on each level clear carrying { t, level }.
//   • The AUTHORITATIVE score = the validated SUM of recorded `brick` event
//     points  +  deterministic level-clear bonuses derived from recorded
//     `level` events.
//   • A PLAUSIBILITY pass rejects impossible logs: events must be monotonic in
//     time; each brick's `points` must be in the valid per-row point set; the
//     number of bricks destroyed cannot exceed (a) the total bricks reachable
//     across the levels the player actually reached (seed-derived) nor (b) the
//     count physically reachable in the elapsed time given the per-brick min
//     interval; level events must be sequential (1,2,3,…) and not exceed what
//     the brick count can justify.
//
// The score route compares the client-claimed score against this authoritative
// score and rejects on mismatch.
//
// The brick-LAYOUT generator below is shared byte-for-byte with the client
// (_breakout-client.tsx generateLevel) so the seed-derived per-level brick
// TOTAL is identical on both sides.
// ──────────────────────────────────────────────────────────────────────────

// ── Grid + scoring constants (mirror the client) ──────────────────────────
export const BRICK_COLS = 10;
export const BRICK_ROWS = 6;

// Per-row point values (top row worth most). A destroyed brick on row `r`
// (0 = top) is always worth ROW_POINTS[r]. This is the ONLY valid point set,
// so the verifier rejects any `brick` event whose points are not in here.
export const ROW_POINTS = [70, 60, 50, 40, 30, 20] as const;

// Deterministic level-clear bonus for clearing level N (1-indexed).
export const levelClearBonus = (level: number): number => 100 * level;

// Per-brick minimum interval (ms) enforced both in ws.ts and here. A run can
// physically destroy at most ceil(elapsed / MIN) + 1 bricks.
export const MIN_BRICK_INTERVAL_MS = 45;

// Hard ceiling on the authoritative score (defense in depth alongside the
// route's client-score cap and the anti-cheat absolute limit).
export const BREAKOUT_SCORE_CAP = 100_000;

// ── Seeded RNG — identical mulberry32 to the client ────────────────────────
const createSeededRng = (seed: number) => {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/**
 * Deterministically generate the brick layout for a given (seed, level) pair.
 * Returns a ROWS×COLS boolean grid (true = a brick is present). MUST match the
 * client's generateLevel exactly so brick TOTALS agree on both sides.
 *
 * Density ramps with level: level 1 leaves more gaps; by level ~6 the grid is
 * nearly full. The RNG is re-seeded per level as `seed + level * 0x9e3779b1`
 * so each level has its own stable layout derived from the one server seed.
 */
export const generateBreakoutLevel = (
  seed: number,
  level: number,
): boolean[][] => {
  const rng = createSeededRng((seed + level * 0x9e3779b1) >>> 0);
  // Fill probability climbs from ~0.62 at level 1 toward a 0.96 ceiling.
  const fill = Math.min(0.96, 0.62 + (level - 1) * 0.07);
  const grid: boolean[][] = [];
  for (let r = 0; r < BRICK_ROWS; r += 1) {
    const row: boolean[] = [];
    for (let c = 0; c < BRICK_COLS; c += 1) {
      row.push(rng() < fill);
    }
    grid.push(row);
  }
  return grid;
};

/** Count of bricks present in a generated level. */
export const brickCountForLevel = (seed: number, level: number): number => {
  const grid = generateBreakoutLevel(seed, level);
  let total = 0;
  for (const row of grid) {
    for (const present of row) if (present) total += 1;
  }
  return total;
};

/**
 * The maximum number of bricks that could be destroyed if a player reached
 * `levelsReached` levels (i.e. fully cleared levels 1..levelsReached-1 and
 * was partway through level `levelsReached`). This is the seed-derived upper
 * bound on destroyed-brick count.
 */
const reachableBrickTotal = (seed: number, levelsReached: number): number => {
  let total = 0;
  for (let lvl = 1; lvl <= levelsReached; lvl += 1) {
    total += brickCountForLevel(seed, lvl);
  }
  return total;
};

/**
 * The point value of every present brick in a level, sorted DESCENDING. Used to
 * derive authoritative brick points from the seed: a cleared level contributes
 * its full list (all bricks broken); an in-progress level contributes its first
 * `remaining` (highest-value) entries — the most any real play could have
 * scored for that brick count. The client's per-event `points` are never
 * trusted for scoring (a tampered client could label every brick a top-row
 * value), so this is the single source of truth for the score.
 */
const levelBrickPointsDesc = (seed: number, level: number): number[] => {
  const grid = generateBreakoutLevel(seed, level);
  const points: number[] = [];
  for (let r = 0; r < BRICK_ROWS; r += 1) {
    for (let c = 0; c < BRICK_COLS; c += 1) {
      if (grid[r]![c]) points.push(ROW_POINTS[r]!);
    }
  }
  points.sort((a, b) => b - a);
  return points;
};

export type BreakoutBrickEvent = { t: number; points: number };
export type BreakoutLevelEvent = { t: number; level: number };

export type BreakoutReplayResult = {
  /** The seed-derived MAXIMUM legitimate score for this validated event log
   *  (max brick points + level-clear bonuses). Brick points are derived from
   *  the seed layout — NEVER from the client's per-event `points` — so this is
   *  the ceiling the route accepts a claimed score up to. An honest run's exact
   *  score is always <= this value. */
  maxScore: number;
  /** Seed-derived maximum brick points: cleared levels contribute their exact
   *  full-board sum; the in-progress level contributes its highest-value
   *  `remaining` bricks. */
  brickPoints: number;
  /** Sum of deterministic level-clear bonuses. */
  bonusPoints: number;
  /** Count of valid brick events counted. */
  bricksDestroyed: number;
  /** Highest level reached (1-indexed; a player always starts on level 1). */
  levelsReached: number;
  /** True if the log was rejected as implausible (maxScore is then 0). */
  rejected: boolean;
  /** Human-readable reason when rejected (embedded in the route reject log). */
  reason: string | null;
};

const VALID_POINTS = new Set<number>(ROW_POINTS);

/**
 * Verify a recorded Breakout session and return the authoritative score.
 *
 * @param brickEvents recorded `brick` scoring events ({ t, points })
 * @param levelEvents recorded `level` events ({ t, level })
 * @param durationMs  the bounded session/replay duration in ms
 * @param seed        the server `breakout_seed` for this session
 */
export const replayBreakoutSession = (
  brickEvents: BreakoutBrickEvent[],
  levelEvents: BreakoutLevelEvent[],
  durationMs: number,
  seed: number,
): BreakoutReplayResult => {
  const reject = (reason: string): BreakoutReplayResult => ({
    maxScore: 0,
    brickPoints: 0,
    bonusPoints: 0,
    bricksDestroyed: 0,
    levelsReached: 1,
    rejected: true,
    reason,
  });

  const bricks = [...brickEvents]
    .filter(
      (e) =>
        Number.isFinite(e.t) &&
        e.t >= 0 &&
        Number.isFinite(e.points) &&
        e.points > 0,
    )
    .sort((a, b) => a.t - b.t);
  const levels = [...levelEvents]
    .filter(
      (e) =>
        Number.isFinite(e.t) &&
        e.t >= 0 &&
        Number.isInteger(e.level) &&
        e.level >= 1,
    )
    .sort((a, b) => a.t - b.t || a.level - b.level);

  // ── Level events must be a strict, gap-free ascending sequence 1,2,3,… ──
  // (clearing level 1 emits level:1, then level 2 begins, etc.). A player who
  // never cleared a level emits no level events. levelsReached = clears + 1.
  for (let i = 0; i < levels.length; i += 1) {
    if (levels[i]!.level !== i + 1) {
      return reject(
        `Level events out of sequence (index ${i} -> level ${levels[i]!.level}, expected ${i + 1})`,
      );
    }
  }
  const levelClears = levels.length;
  const levelsReached = levelClears + 1;

  // ── Per-brick interval + monotonic-points-time plausibility ──
  for (let i = 1; i < bricks.length; i += 1) {
    const interval = bricks[i]!.t - bricks[i - 1]!.t;
    if (interval < MIN_BRICK_INTERVAL_MS) {
      return reject(
        `Brick interval too short (${Math.round(interval)}ms < ${MIN_BRICK_INTERVAL_MS}ms at index ${i})`,
      );
    }
  }

  // ── Per-event sanity only: each brick's points must be a real per-row value.
  //    NOTE: these client-supplied values are NOT summed into the score — a
  //    tampered client could label every brick a top-row value. The
  //    authoritative brick points are derived from the seed layout below. ──
  for (const b of bricks) {
    if (!VALID_POINTS.has(b.points)) {
      return reject(`Invalid brick points ${b.points} (not a per-row value)`);
    }
  }
  const bricksDestroyed = bricks.length;

  // ── Time-budget bound: at most ceil(duration / MIN) + 1 bricks ──
  const safeDuration =
    Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 0;
  const timeBudgetMax = Math.floor(safeDuration / MIN_BRICK_INTERVAL_MS) + 1;
  if (bricksDestroyed > timeBudgetMax) {
    return reject(
      `Too many bricks for elapsed time (${bricksDestroyed} > ${timeBudgetMax} in ${Math.round(safeDuration)}ms)`,
    );
  }

  // ── Seed-derived bound: cannot destroy more bricks than exist across the
  //    levels actually reached. Clearing a level requires destroying ALL of
  //    that level's bricks, so the player must have destroyed at least the sum
  //    of the fully-cleared levels' brick counts. ──
  const reachableMax = reachableBrickTotal(seed, levelsReached);
  if (bricksDestroyed > reachableMax) {
    return reject(
      `More bricks than reachable for levels played (${bricksDestroyed} > ${reachableMax} across ${levelsReached} level(s))`,
    );
  }
  let requiredForClears = 0;
  for (let lvl = 1; lvl <= levelClears; lvl += 1) {
    requiredForClears += brickCountForLevel(seed, lvl);
  }
  if (bricksDestroyed < requiredForClears) {
    return reject(
      `Too few bricks for ${levelClears} level clear(s) (${bricksDestroyed} < ${requiredForClears} required)`,
    );
  }

  // ── Authoritative brick points — derived from the SEED, never the client's
  //    per-event values. A fully-cleared level necessarily had ALL its bricks
  //    destroyed, so it contributes the exact sum of its bricks' row values.
  //    The in-progress level contributes its highest-value `remaining` bricks —
  //    the maximum any real play could have scored for that brick count. The
  //    route accepts a claimed score anywhere in [0, this maximum]. ──
  let brickPoints = 0;
  for (let lvl = 1; lvl <= levelClears; lvl += 1) {
    for (const p of levelBrickPointsDesc(seed, lvl)) brickPoints += p;
  }
  const remainingInProgress = bricksDestroyed - requiredForClears;
  const inProgressDesc = levelBrickPointsDesc(seed, levelsReached);
  for (let i = 0; i < remainingInProgress && i < inProgressDesc.length; i += 1) {
    brickPoints += inProgressDesc[i]!;
  }

  // ── Deterministic level-clear bonuses ──
  let bonusPoints = 0;
  for (let lvl = 1; lvl <= levelClears; lvl += 1) {
    bonusPoints += levelClearBonus(lvl);
  }

  const maxScore = Math.min(BREAKOUT_SCORE_CAP, brickPoints + bonusPoints);

  return {
    maxScore,
    brickPoints,
    bonusPoints,
    bricksDestroyed,
    levelsReached,
    rejected: false,
    reason: null,
  };
};
