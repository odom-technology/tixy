// ──────────────────────────────────────────────────────────────────────────
// SWERVE — server-side authoritative replay / plausibility verifier.
//
// This is a PURE module (no DB, no IO, no imports). It re-derives the highway's
// traffic LAYOUT and SPEED RAMP from the one server seed, then validates the
// player's recorded { row, lane } passes and returns the AUTHORITATIVE score.
//
// Game model (single-POST, seed-deterministic, discrete-resim):
//   • The player drives a car down a 3-lane highway. Traffic rows scroll toward
//     the player; each row blocks zero, one, or two seed-derived lanes (it NEVER
//     blocks all three — a safe lane always remains).
//   • Row r (1-indexed) is "passed" when it crosses the player's line. If the
//     player's lane was NOT blocked at row r → the row's points are credited and
//     the client records { row, lane }. If it was blocked → crash → game over.
//   • So an honest event log is the rows 1..N the player survived, in order,
//     each tagged with the lane the car occupied (which must be a SAFE lane).
//
// ── THE PASSABILITY INVARIANT (the core generation rule) ──────────────────
// The old generator picked blocked lanes independently per row, so deep in a
// run the only safe lane could jump 2 lanes between consecutive rows — a
// physically impossible move given the lane-change time. The generator below
// forward-tracks the REACHABLE-LANE SET while it derives each row:
//
//   budget k(r)      = max lane changes a player can make between row r and
//                      row r+1 = floor((interval(r) − reaction) / laneChange),
//                      kept ≥ 1 BY CONSTRUCTION (the interval floor is chosen
//                      so the floor-speed budget is still 1).
//   reachable(r+1)   = { l : ∃ s ∈ survivors(r), |l − s| ≤ k(r) }
//   survivors(r)     = reachable(r) ∩ openLanes(r)   — never allowed to empty.
//
// Every row's blocked lanes are CHOSEN so survivors(r) is non-empty: a forced
// (two-blocked) row always keeps a lane open that is reachable from the
// previous rows' survivable lanes, and a row after a forced row never blocks
// the lane the forced row funnelled the player into. This makes every seed
// beatable at every depth — provable by walking the reachable set (see the
// passability regression script; the walk is the formal proof).
//
// Generation is SEQUENTIAL (row r depends on the reachable set after r−1), so
// the layout is exposed as a factory (`createSwerveLayout`) with an internal
// row cache — O(1) amortized per row, O(N) memory for an N-row run, identical
// on client and server for the same seed. Sequential derivation is required by
// the invariant itself: reachability is inherently a forward walk.
//
// ── SCORING (pure function of events + seed) ───────────────────────────────
// score = Σ points(row) over the validated sequential passes, where
//   points(row) = 1                                  for open / single rows
//   points(row) = 1 + 2·min(streak, 4)               for forced (two-blocked)
//                 rows, streak = consecutive forced rows ending at this row.
// Forced rows are the "close calls" — the server re-derives which rows were
// forced from the seed, so the bonus is fully recomputable from {row,lane,t}.
//
// AUTHORITATIVE score = the points total of recorded rows that ALL hold:
//   1. rows are the sequential run 1,2,3,…,N (no gaps, no repeats, start at 1),
//   2. the recorded lane is in [0, LANE_COUNT) and was NOT blocked at that row
//      (re-derived here from the seed — the client's claim is never trusted),
//   3. the run respects the seed speed ramp: consecutive passes are spaced at
//      least the per-row minimum interval apart (a row physically cannot reach
//      the player faster than the ramp allows), AND the whole run fits the
//      bounded session/replay duration.
// The score route compares the client-claimed score to this total and rejects
// on mismatch. The min-interval + duration bounds cap the achievable score by
// TIME, so precomputing the (non-secret) layout from the seed buys nothing.
//
// Everything here is pure: no Date.now(), no Math.random(), no I/O.
// ──────────────────────────────────────────────────────────────────────────

// ── Highway geometry / scoring constants (the client mirrors these) ────────

/** Number of lanes. Lanes are indexed 0..LANE_COUNT-1. */
export const LANE_COUNT = 3;

/** A run can never legitimately exceed this score (defense in depth alongside
 *  the route's client-score cap + anti-cheat absolute limit). */
export const SWERVE_SCORE_CAP = 100_000;

// ── Speed ramp ─────────────────────────────────────────────────────────────
// Rows arrive faster the deeper the run goes. We express the ramp as the
// minimum wall-clock interval (ms) between two consecutive row passes at a
// given row. It decays linearly toward a hard floor. The floor is chosen so
// the lane-change budget (below) never drops under 1 — the §4a guardrail
// `interval ≥ laneChange + reaction` holds at every depth by construction.
// The client's scroll speed is the inverse of this — both sides derive
// identical numbers from the same row index.

/** Interval between passing row 1 and row 2, at the start of a run (ms). */
export const SWERVE_BASE_ROW_INTERVAL_MS = 640;
/** Hard floor on the per-row interval no matter how deep the run goes (ms).
 *  360 ≥ SWERVE_LANE_CHANGE_MS + SWERVE_REACTION_MS (350), so a one-lane move
 *  is ALWAYS physically possible between consecutive rows (k ≥ 1). */
export const SWERVE_MIN_ROW_INTERVAL_MS = 360;
/** How much the per-row interval tightens each row (ms removed per row).
 *  Reaches the floor at row 57 (~26 s in) — past that, difficulty comes from
 *  pattern pressure (forced-row waves keep heating up with depth). */
export const SWERVE_ROW_INTERVAL_RAMP_MS = 5;
/** Small tolerance subtracted from the ramp interval so honest client jitter /
 *  rounding never false-rejects a legitimately fast-but-fair pass (ms). */
export const SWERVE_INTERVAL_GRACE_MS = 60;

// ── Lane-change physics contract ───────────────────────────────────────────
// These two constants define the fairness math shared by the generator, the
// client's steering tween, and the passability proof. If the client tween ever
// changes, change it HERE so generation stays honest about what a player can do.

/** Duration of a one-lane steering tween on the client (ms). */
export const SWERVE_LANE_CHANGE_MS = 130;
/** Human reaction budget assumed by the generator (ms). */
export const SWERVE_REACTION_MS = 220;
/** Lead-in before row 1 reaches the player (ms) — the client schedules row 1
 *  this long after the run starts, so the opening row is telegraphed and any
 *  starting lane can be reached (the generator seeds the reachable set with
 *  the budget this lead-in buys). */
export const SWERVE_LEAD_IN_MS = 900;

// ── Pattern pacing constants ───────────────────────────────────────────────

/** Rows 1..WARMUP are always single-block (gentle read-in). */
export const SWERVE_WARMUP_ROWS = 6;
/** Length of one pressure wave (rows). Each wave closes with guaranteed rest
 *  rows (no traffic) — two early on, one past row 150 (see waveRestRows). */
export const SWERVE_WAVE_LEN = 16;
/** Bonus points per forced-row streak step (see scoring above). */
export const SWERVE_FORCED_BONUS = 2;
/** Forced-streak multiplier cap. */
export const SWERVE_FORCED_STREAK_CAP = 4;

/**
 * The minimum legitimate interval (ms) between passing row `row` and the NEXT
 * row, given the speed ramp. `row` is 1-indexed (the interval that GOVERNS the
 * gap leading INTO row+1). Decays linearly from the base toward the floor.
 * Pure + identical on client and server.
 */
export const rowIntervalMs = (row: number): number => {
  const safeRow = row > 1 ? Math.floor(row) : 1;
  const ramped =
    SWERVE_BASE_ROW_INTERVAL_MS - (safeRow - 1) * SWERVE_ROW_INTERVAL_RAMP_MS;
  return Math.max(SWERVE_MIN_ROW_INTERVAL_MS, ramped);
};

/**
 * The minimum cumulative time (ms, from the first obstacle row appearing) by
 * which the player could have passed row `row`. Equals the sum of the ramp
 * intervals leading up to it. Used as the lower bound on a row pass's
 * timestamp so a client cannot claim it cleared deep rows faster than the
 * ramp allows. O(row), but row is bounded by the score cap and the route
 * also caps payload size.
 */
export const minTimeForRowMs = (row: number): number => {
  const target = row > 1 ? Math.floor(row) : 1;
  let total = 0;
  for (let r = 1; r < target; r += 1) {
    total += rowIntervalMs(r);
  }
  return total;
};

/**
 * Lane-change budget k between row `row` and row `row+1`: how many one-lane
 * moves a player can complete in that gap after the reaction budget. ≥ 1 at
 * every depth by construction (see SWERVE_MIN_ROW_INTERVAL_MS).
 */
export const laneBudgetForRow = (row: number): number =>
  Math.max(
    1,
    Math.floor(
      (rowIntervalMs(row) - SWERVE_REACTION_MS) / SWERVE_LANE_CHANGE_MS,
    ),
  );

// ── Seeded RNG — identical mulberry32 to the client + the other replays ─────
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
 * Derive a stable per-row RNG from (seed, row). Mixing the row into the seed
 * (golden-ratio constant, all 32-bit) keeps the RANDOM draws for a row local
 * to that row — the sequential part of generation is only the small reachable-
 * set state, so a drifted draw can never desynchronize later rows' entropy.
 */
const rngForRow = (seed: number, row: number): (() => number) => {
  let mixed = (seed ^ Math.imul(row + 1, 0x9e3779b1)) | 0;
  mixed = (mixed + 0x6d2b79f5) | 0;
  return createSeededRng(mixed >>> 0);
};

/**
 * Probability that an eligible row is FORCED (blocks two lanes, one escape).
 * Ramps with depth and oscillates with the wave position: early wave rows are
 * calm, late wave rows spike, then the wave's rest rows reset the tension.
 */
const forcedChance = (row: number, wavePos: number): number => {
  if (row <= SWERVE_WARMUP_ROWS) return 0;
  const base = Math.min(0.5, (row - SWERVE_WARMUP_ROWS) * 0.02);
  // Deep-run pressure: past row 150 even the calm stretches of each wave keep
  // heating up (+0.001/row, capped at +0.2 by row 350) so long runs stay
  // terminal instead of plateauing — 2026-07 tune after live 2.1k first-try runs.
  const deep = Math.min(0.2, Math.max(0, row - 150) * 0.001);
  const intensity = wavePos < 4 ? 0.55 : wavePos < 10 ? 1 : 1.35;
  return Math.min(0.9, base * intensity + deep);
};

/** Cap on consecutive forced rows (rises with depth). */
const maxForcedRun = (row: number): number =>
  row < 40 ? 2 : row < 90 ? 3 : row < 200 ? 4 : 5;

/** Rest rows closing each wave: two breathers early, only one past row 150 —
 *  deep runs earn less recovery time. */
const waveRestRows = (row: number): number => (row > 150 ? 1 : 2);

// ── Layout rows ─────────────────────────────────────────────────────────────

/** One derived traffic row. Everything here is a pure function of (seed, row)
 *  via the sequential reachable-set walk — byte-identical on client + server. */
export type SwerveRowInfo = {
  /** 1-indexed row number. */
  row: number;
  /** Sorted blocked lanes (0, 1 or 2 of them — never all three). */
  blocked: number[];
  /** True when two lanes are blocked (a "close call" / forced move). */
  forced: boolean;
  /** True when no lane is blocked (a deterministic breather row). */
  rest: boolean;
  /** Consecutive forced-row streak ending at this row (0 when not forced). */
  streak: number;
  /** Points credited for passing this row (see scoring notes above). */
  points: number;
  /** Open lanes that are REACHABLE from the previous rows' survivable lanes —
   *  the survivors set of the invariant. Never empty. The client uses it to
   *  draw safe-path hints; the proof script asserts it is never empty. */
  safeReachableLanes: number[];
};

export type SwerveLayout = {
  seed: number;
  /** Derive (and cache) the layout row `row` (1-indexed). */
  rowInfo: (row: number) => SwerveRowInfo;
};

/**
 * Create the deterministic layout walker for a seed. Rows are generated
 * sequentially (the reachability invariant needs the previous row's survivor
 * set) and cached, so random access is O(1) after first touch.
 */
export const createSwerveLayout = (seed: number): SwerveLayout => {
  const cache: SwerveRowInfo[] = [];

  // Sequential generation state (all deterministic).
  let survivors: number[] = []; // survivable lanes after the last cached row
  let consecutiveForced = 0;
  let forcedCooldown = 0; // rows that must NOT be forced (post-gauntlet rest)
  let prevForcedSafe: number | null = null; // escape lane of a just-passed forced row

  const generateNext = (): SwerveRowInfo => {
    const row = cache.length + 1;
    const rng = rngForRow(seed, row);
    const wavePos = (row - 1) % SWERVE_WAVE_LEN;

    // Reachable set entering this row: expand the previous survivors by the
    // lane-change budget of the gap leading into this row. Row 1's budget
    // comes from the lead-in (player can reach any lane before row 1 lands).
    const budget =
      row === 1
        ? Math.max(
            1,
            Math.floor(
              (SWERVE_LEAD_IN_MS - SWERVE_REACTION_MS) / SWERVE_LANE_CHANGE_MS,
            ),
          )
        : laneBudgetForRow(row - 1);
    const prev = row === 1 ? [0, 1, 2] : survivors;
    const reachable: number[] = [];
    for (let l = 0; l < LANE_COUNT; l += 1) {
      if (prev.some((s) => Math.abs(l - s) <= budget)) reachable.push(l);
    }

    // ── Decide the row type (warm-up / rest / forced / single). ──
    let type: 'rest' | 'single' | 'forced';
    if (row <= SWERVE_WARMUP_ROWS) {
      type = 'single';
    } else if (wavePos >= SWERVE_WAVE_LEN - waveRestRows(row)) {
      type = 'rest'; // deterministic breather closing every wave
    } else if (consecutiveForced >= maxForcedRun(row)) {
      type = 'single';
      forcedCooldown = 2; // guaranteed cool-down after a max-length gauntlet
    } else if (forcedCooldown > 0) {
      type = 'single';
      forcedCooldown -= 1;
    } else {
      type = rng() < forcedChance(row, wavePos) ? 'forced' : 'single';
    }

    // ── Choose blocked lanes UNDER the invariant. ──
    let blocked: number[];
    let newSurvivors: number[];
    if (type === 'rest') {
      blocked = [];
      newSurvivors = reachable;
    } else if (type === 'forced') {
      // The single escape lane must be reachable from the previous survivors.
      const safe = reachable[Math.floor(rng() * reachable.length)]!;
      blocked = [0, 1, 2].filter((l) => l !== safe);
      newSurvivors = [safe];
    } else {
      // Single block: any lane EXCEPT the escape lane of an immediately
      // preceding forced row (the funnelled player must never be clipped the
      // very next row). Two lanes stay open, and since the reachable set has
      // ≥ 2 lanes whenever k ≥ 1, at least one open lane is always reachable.
      const candidates = [0, 1, 2].filter((l) => l !== prevForcedSafe);
      const pick = candidates[Math.floor(rng() * candidates.length)]!;
      blocked = [pick];
      newSurvivors = reachable.filter((l) => l !== pick);
    }

    // The invariant: survivors never empties. This cannot happen by
    // construction; the guard is defense-in-depth (fail open, not impossible).
    if (newSurvivors.length === 0) {
      blocked = [];
      newSurvivors = reachable;
      type = 'rest';
    }

    const forced = type === 'forced';
    const streak = forced ? consecutiveForced + 1 : 0;
    const points =
      1 +
      (forced
        ? SWERVE_FORCED_BONUS * Math.min(streak, SWERVE_FORCED_STREAK_CAP)
        : 0);

    // Advance the sequential state.
    survivors = newSurvivors;
    consecutiveForced = forced ? consecutiveForced + 1 : 0;
    prevForcedSafe = forced ? newSurvivors[0]! : null;

    const info: SwerveRowInfo = {
      row,
      blocked: blocked.slice().sort((a, b) => a - b),
      forced,
      rest: type === 'rest',
      streak,
      points,
      safeReachableLanes: newSurvivors.slice().sort((a, b) => a - b),
    };
    cache.push(info);
    return info;
  };

  const rowInfo = (row: number): SwerveRowInfo => {
    const target = row > 1 ? Math.floor(row) : 1;
    while (cache.length < target) generateNext();
    return cache[target - 1]!;
  };

  return { seed, rowInfo };
};

/** Sorted blocked lanes at `row` (convenience — walks the layout). Prefer a
 *  long-lived `createSwerveLayout` handle when reading many rows. */
export const blockedLanesForRow = (seed: number, row: number): number[] =>
  createSwerveLayout(seed).rowInfo(row).blocked;

// ── Recorded event + result shapes ─────────────────────────────────────────

/** One recorded safe-row pass: the car cleared row `row` while in lane `lane`.
 *  `t` = ms since the first obstacle row appeared (client clock — used only for
 *  the cadence/ramp sanity bound; the authoritative elapsed is the server
 *  session durationMs). */
export type SwervePassEvent = {
  row: number;
  lane: number;
  t: number;
};

export type SwerveReplayResult = {
  /** Authoritative score = points total of validated sequential safe rows. */
  score: number;
  /** How many recorded passes were actually counted before the chain broke. */
  counted: number;
  /** True if the log was rejected as implausible (score is then 0). */
  rejected: boolean;
  /** Human-readable reason when rejected (embedded in the route reject log). */
  reason: string | null;
};

const isNonNegFinite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

const isLaneIndex = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isInteger(value) &&
  value >= 0 &&
  value < LANE_COUNT;

const isRowIndex = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1;

/**
 * Verify a recorded Swerve run and return the authoritative score.
 *
 * The passes must form the gap-free ascending run 1,2,…,N; each recorded lane
 * must be a real, SEED-SAFE lane at its row; and the timing must respect the
 * seed speed ramp (per-row min interval) plus the bounded session duration.
 * The score is the sum of the seed-derived per-row points (base + forced-row
 * close-call bonuses) — recomputed here, never trusted from the client.
 *
 * Pure + never throws on bad input — malformed/implausible entries break the
 * chain (the score is the rows proven before the break), and structural
 * violations (wrong order, blocked lane, ramp violation) reject the whole run.
 *
 * @param passes     recorded safe-row passes ({ row, lane, t })
 * @param durationMs the bounded session/replay duration in ms
 * @param seed       the server `swerveSeed` for this session
 */
export const replaySwerveSession = (
  passes: SwervePassEvent[],
  durationMs: number,
  seed: number,
): SwerveReplayResult => {
  const reject = (reason: string): SwerveReplayResult => ({
    score: 0,
    counted: 0,
    rejected: true,
    reason,
  });

  if (!Array.isArray(passes) || passes.length === 0) {
    return { score: 0, counted: 0, rejected: false, reason: null };
  }

  if (passes.length > SWERVE_SCORE_CAP) {
    return reject(`Pass payload too large (${passes.length})`);
  }

  // Keep only well-formed entries, then order by row. Sorting by row (not by
  // arrival) means out-of-order delivery / client batching can't unfairly break
  // a valid sequential chain; the sequence + uniqueness check below is positional.
  const clean = passes
    .filter(
      (p) =>
        p != null &&
        isRowIndex(p.row) &&
        isLaneIndex(p.lane) &&
        isNonNegFinite(p.t),
    )
    .slice()
    .sort((a, b) => a.row - b.row || a.t - b.t);

  if (clean.length === 0) {
    return reject('No well-formed pass events');
  }

  // The bounded upper edge for any pass timestamp: the smaller of a generous
  // hard ceiling and the server-measured elapsed plus a little grace for the
  // final pass / network skew. (The client clock is only sanity-checked; the
  // server session duration is the real elapsed.)
  const serverWindowMs =
    Number.isFinite(durationMs) && durationMs > 0
      ? durationMs + 1_500
      : Number.POSITIVE_INFINITY;

  const layout = createSwerveLayout(seed);

  let score = 0;
  let counted = 0;
  let prevT = -Infinity;
  let expectedRow = 1;
  const seenRows = new Set<number>();

  for (const pass of clean) {
    // ── Sequence: rows must be 1,2,3,… with no gaps and no repeats. ──
    if (seenRows.has(pass.row)) {
      return reject(`Duplicate row ${pass.row} in pass log`);
    }
    if (pass.row !== expectedRow) {
      return reject(
        `Rows out of sequence (got ${pass.row}, expected ${expectedRow})`,
      );
    }

    // ── Lane safety: the recorded lane must NOT be blocked at this row, per the
    //    seed-derived layout (the client's claim is never trusted). ──
    const info = layout.rowInfo(pass.row);
    if (info.blocked.includes(pass.lane)) {
      return reject(
        `Lane ${pass.lane} was blocked at row ${pass.row} (collision, not a safe pass)`,
      );
    }

    // ── Timing vs the speed ramp: a pass cannot land before the ramp could have
    //    delivered that row, nor after the bounded session window, nor closer to
    //    the previous pass than the per-row min interval allows. ──
    const earliest = minTimeForRowMs(pass.row);
    if (pass.t + SWERVE_INTERVAL_GRACE_MS < earliest) {
      return reject(
        `Row ${pass.row} passed too early for the speed ramp ` +
          `(t=${Math.round(pass.t)}ms < ${Math.round(earliest)}ms)`,
      );
    }
    if (pass.t > serverWindowMs) {
      return reject(
        `Row ${pass.row} pass outside session window ` +
          `(t=${Math.round(pass.t)}ms > ${Math.round(serverWindowMs)}ms)`,
      );
    }
    if (prevT !== -Infinity) {
      const minGap = rowIntervalMs(pass.row - 1) - SWERVE_INTERVAL_GRACE_MS;
      if (pass.t - prevT < minGap) {
        return reject(
          `Row ${pass.row} passed too fast after row ${pass.row - 1} ` +
            `(gap=${Math.round(pass.t - prevT)}ms < ${Math.round(minGap)}ms)`,
        );
      }
    }

    seenRows.add(pass.row);
    prevT = pass.t;
    expectedRow += 1;
    counted += 1;
    score += info.points;

    if (score >= SWERVE_SCORE_CAP) break;
  }

  return {
    score: Math.min(SWERVE_SCORE_CAP, score),
    counted,
    rejected: false,
    reason: null,
  };
};

/** Alias kept to match the spec's `validateSwerveRun` naming if preferred. */
export const validateSwerveRun = replaySwerveSession;
