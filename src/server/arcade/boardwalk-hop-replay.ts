// ──────────────────────────────────────────────────────────────────────────
// BOARDWALK HOP — server-side authoritative replay / plausibility verifier.
//
// This is a PURE module (no DB, no IO, no Date.now, no Math.random). It is the
// SINGLE SOURCE OF TRUTH shared by BOTH the client (which renders the grid and
// gives live feedback) and the server score route (which re-simulates the
// submitted hop list to compute the authoritative score). Same `seed` ⇒ a
// byte-identical lane layout + hazard motion on both sides, so the client can
// never invent a safe gap the server disagrees with.
//
// ── Game model (frogger-like grid hopper, single-POST, seed-deterministic) ──
//   • The player stands on a COLS-wide grid and hops forward (U) one row at a
//     time to advance, or sideways (L/R) / back (D) to dodge. Row 0 is a safe
//     boardwalk start row; the player begins at column START_COL.
//   • Row r is one of three kinds, a PURE function of (seed, r):
//       SAFE  — a boardwalk plank row: stand anywhere as long as you like
//               (subject only to the idle-punish clock below).
//       ROAD  — a carnival cart road: a stream of carts (1–2 tiles long) scrolls
//               horizontally at a seeded speed + direction. Standing in a cart's
//               path is death.
//       FLUME — a log-flume water channel: the WATER is death; the drifting
//               LOGS (2–3 tiles long) are rideable platforms. Land on a log and
//               you attach to it: your x drifts with the log until you hop off.
//               Being carried past the edge of the grid is death (classic
//               Frogger). Bigger logs drift slower (Crossy Road speed tiers).
//   • POSITION is an integer column on SAFE/ROAD rows and a fractional x while
//     riding a log. Hopping onto SAFE/ROAD rounds to the nearest column;
//     hopping FLUME→FLUME keeps the fractional x. All transitions run through
//     the exported stepHop/dwellDeath functions on BOTH sides.
//   • DEATH is defined identically on both sides:
//       – collision: a cart occupies your tile at any instant while you sit on
//         a ROAD row (continuous analytic check over the dwell interval), or
//         you hop straight into a cart.
//       – drown: you hop onto a FLUME row and no log is under your landing x.
//       – swept: the log you are riding carries you past the grid edge.
//       – gull: no NEW furthest row for longer than idleLimitMs(furthest).
//         The idle window is sized so waiting out one full log period is always
//         survivable (see the reachability proof script).
//   • SCORE = furthest row reached + close-call bonuses. Each forward hop that
//     sets a NEW furthest row scores 1. Bonuses (streak-multiplied, swerve DNA):
//       – ROAD close call: a cart passes within CLOSE_CALL_DIST of your column
//         at the landing instant.
//       – FLUME edge grab: you catch a log within EDGE_GRAB_DIST of its end.
//
// ── Why precomputing the (non-secret) layout buys nothing ───────────────────
// The score is bounded by TIME, not by knowledge of the layout: counted forward
// hops are gated by HOP_COOLDOWN_MS, so the furthest row (and therefore the
// score) a run can legitimately reach is capped by duration / cooldown.
//
// ── Reachability (fairness) ─────────────────────────────────────────────────
// The generator keeps the field survivable: SAFE rows are interleaved so no
// more than MAX_HAZARD_BAND hazard rows are ever consecutive, consecutive
// hazard rows ALTERNATE direction (bounds the relative log speed from below,
// so an alignment always comes around), hazard speeds are capped far below the
// player's sidestep rate, fast carts keep a longer following distance, and log
// lattices are dense enough that a log is always present within the grid.
// Proved empirically by a lookahead survivor bot over thousands of seeds
// (scripts/verify-boardwalk-replay.ts): zero forced deaths below row 60, and
// ≤0.75% unwinnable corner states out to row 120 — the deep-game difficulty
// ramp (plus the tightening idle window) is what terminates marathon runs.
// ──────────────────────────────────────────────────────────────────────────

// ── Grid geometry / scoring constants (the client mirrors these) ────────────

/** Number of columns. Tiles are indexed 0..COLS-1. */
export const COLS = 9;
/** Column the player starts on (center). */
export const START_COL = 4;

/** A run can never legitimately exceed this score (defense in depth alongside
 *  the route's client-score cap + anti-cheat absolute limit). */
export const BOARDWALK_SCORE_CAP = 100_000;
/** Hard cap on the number of recorded hop events we will process. */
export const BOARDWALK_MAX_EVENTS = 20_000;

// ── Input cadence contract ──────────────────────────────────────────────────

/** Minimum wall-clock spacing between two ACCEPTED hops (ms). The client drops
 *  inputs faster than this (they never reach the recorded list), so a recorded
 *  hop pair closer than this − grace is a fabricated/scripted log → reject. */
export const HOP_COOLDOWN_MS = 110;
/** Tiny tolerance for float rounding only. The client gates accepted hops on
 *  the SAME clock it records, so honest gaps are always ≥ HOP_COOLDOWN_MS
 *  exactly — a wide grace here would just let forged logs hop faster than any
 *  real client can (codex review finding). */
export const HOP_COOLDOWN_GRACE_MS = 5;

// ── Idle-punish (gull) contract ─────────────────────────────────────────────

/** Idle window at the very start of a run (ms of no new forward progress).
 *  Sized so waiting for a log gap is always survivable (worst log period is
 *  ~spacing/speed ≈ 3.6s at the slowest; the player can also hop toward an
 *  incoming log to cut the wait). */
export const IDLE_BASE_MS = 5200;
/** Hard floor on the idle window no matter how deep the run goes (ms). Kept
 *  above the worst log-alignment wait so the gull pressures but never
 *  checkmates (see the reachability proof). */
export const IDLE_MIN_MS = 3200;
/** How much the idle window tightens per furthest row (ms). */
export const IDLE_RAMP_MS = 12;
/** Grace added to the idle deadline for client/network/render jitter (ms). */
export const IDLE_GRACE_MS = 140;
/** How many rows behind the furthest the (visual) camera bottom sits. Used only
 *  to describe the gull position; the authoritative death is the idle deadline. */
export const CAMERA_LEAD = 4;

/** Idle window (ms) allowed at a given furthest row before the gull sweeps. */
export const idleLimitMs = (furthest: number): number =>
  Math.max(IDLE_MIN_MS, IDLE_BASE_MS - Math.max(0, furthest) * IDLE_RAMP_MS);

// ── Hazard geometry contract ────────────────────────────────────────────────

/** Legacy alias kept for the anti-cheat route imports: half-width of a 1-tile
 *  hazard. Multi-tile hazards use len/2 (see coverHalf). */
export const CAR_HALF = 0.5;
/** Minimum center-to-center hazard spacing is len + GAP_MIN (open tiles). */
export const GAP_MIN = 2;
/** Slowest hazard speed (tiles/second). */
export const SPEED_MIN = 0.8;

/** Grace (tiles) beyond the log's half-length within which a landing still
 *  catches the log (edge grab — toes on the very end). The ride offset stays
 *  where the player landed: snapping inward could shove a valid landing x past
 *  the grid edge margin (an instant sweep — reachability-proof finding). */
export const LOG_GRAB_GRACE = 0.3;
/** Riding past this margin beyond the outer columns is death (swept away).
 *  Wide enough that a log freshly entering the grid is genuinely boardable
 *  from the outer column (the renderer draws a gutter to match). */
export const EDGE_KEEP = 0.6;

/** ROAD close call: a cart edge passes within this (tiles) of your column at
 *  the landing instant (but not on it — that would be a collision). */
export const CLOSE_CALL_DIST = 0.9;
/** FLUME edge grab: catching a log within this (tiles) of its end. */
export const EDGE_GRAB_DIST = 0.55;
/** Bonus points per close-call streak step. */
export const CLOSE_CALL_BONUS = 2;
/** Close-call streak multiplier cap. */
export const CLOSE_CALL_STREAK_CAP = 4;

// ── Lane pacing constants ───────────────────────────────────────────────────

/** Rows 0..WARMUP_SAFE_ROWS are always SAFE (gentle read-in). */
export const WARMUP_SAFE_ROWS = 3;
/** One band = BAND rows: the first row is always SAFE (a rest), the next up to
 *  depthHazards(r) rows are HAZARD, the remainder SAFE. */
export const BAND = 4;
/** Ceiling on consecutive hazard rows (= max hazards packed into one band). */
export const MAX_HAZARD_BAND = 3;

/** Peak cart speed cap (tiles/second) a road row may draw, ramping with depth. */
const SPEED_CAP_BASE = 1.5;
const SPEED_CAP_RAMP = 0.012; // per row
const SPEED_CAP_MAX = 3.4;

/** Flume speeds are gentler than roads — you have to LAND on these. */
const FLUME_SPEED_CAP_BASE = 1.15;
const FLUME_SPEED_CAP_RAMP = 0.008;
const FLUME_SPEED_CAP_MAX = 2.2;

/** Max hazard rows packed into a band at depth r (ramps 1 → MAX_HAZARD_BAND). */
const depthHazards = (r: number): number =>
  r < 10 ? 1 : r < 26 ? 2 : MAX_HAZARD_BAND;

/** Peak speed a hazard row at depth r may draw (tiles/second). */
const speedCapForRow = (r: number, kind: 'road' | 'flume'): number =>
  kind === 'road'
    ? Math.min(SPEED_CAP_MAX, SPEED_CAP_BASE + r * SPEED_CAP_RAMP)
    : Math.min(FLUME_SPEED_CAP_MAX, FLUME_SPEED_CAP_BASE + r * FLUME_SPEED_CAP_RAMP);

// ── Seeded RNG — identical mulberry32 to the client + the other replays ──────
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
 * (golden-ratio constant, all 32-bit) keeps a row's draws local to that row, so
 * random access to any row is O(1) and byte-identical on client + server.
 */
const rngForRow = (seed: number, row: number): (() => number) => {
  let mixed = (seed ^ Math.imul(row + 1, 0x9e3779b1)) | 0;
  mixed = (mixed + 0x6d2b79f5) | 0;
  return createSeededRng(mixed >>> 0);
};

// ── Lane layout ─────────────────────────────────────────────────────────────

export type RowKind = 'safe' | 'road' | 'flume';

/** Derived hazard motion for a HAZARD row. All fields are pure functions of
 *  (seed, row). Motion is expressed in tiles + ms so both sides agree exactly. */
export type HazardRow = {
  row: number;
  kind: 'road' | 'flume';
  /** +1 → hazards move toward higher columns, −1 → toward lower. */
  dir: 1 | -1;
  /** Hazard speed magnitude in TILES PER MILLISECOND (always > 0). */
  velTilesPerMs: number;
  /** Hazard length in tiles (carts 1–2, logs 2–3). */
  len: number;
  /** Center-to-center hazard spacing (integer tiles, ≥ len + GAP_MIN). */
  spacing: number;
  /** Phase offset (tiles) of the hazard lattice at t = 0. */
  phase: number;
};

export type RowInfo =
  | { row: number; kind: 'safe'; hazard: null }
  | { row: number; kind: 'road' | 'flume'; hazard: HazardRow };

/** Pure row KIND from (seed, row). */
export const rowKind = (seed: number, row: number): RowKind => {
  const r = Math.floor(row);
  if (r <= WARMUP_SAFE_ROWS) return 'safe';
  const posInBand = (r - WARMUP_SAFE_ROWS - 1) % BAND;
  // Band position 0 is always a rest (safe); positions 1..depthHazards are
  // hazards; the rest of the band is safe.
  if (posInBand === 0 || posInBand > depthHazards(r)) return 'safe';
  // Hazard row — pick the kind from the row RNG (draw #0).
  const rng = rngForRow(seed, r);
  return rng() < 0.5 ? 'road' : 'flume';
};

/**
 * Full derived info for a row (kind + hazard motion). Pure + O(1). The RNG draw
 * ORDER is fixed (kind, dir, len, speed, spacing, phase) so the stream is stable.
 */
export const rowInfo = (seed: number, row: number): RowInfo => {
  const r = Math.floor(row);
  const kind = rowKind(seed, r);
  if (kind === 'safe') return { row: r, kind: 'safe', hazard: null };

  const rng = rngForRow(seed, r);
  rng(); // draw #0 consumed by rowKind for the kind — keep in sync
  const ownDirDraw: 1 | -1 = rng() < 0.5 ? -1 : 1;

  // Consecutive hazard rows in a band ALTERNATE direction (classic Frogger).
  // This bounds the relative speed between neighboring flume lattices from
  // below (≥ 2×SPEED_MIN), so a log alignment always comes around well inside
  // the idle window — proved by the reachability bot. The chain's base
  // direction is the FIRST hazard row's own draw #1, so r === r0 is consistent.
  const p = (r - WARMUP_SAFE_ROWS - 1) % BAND; // 1-based hazard index in band
  let dir: 1 | -1 = ownDirDraw;
  if (p > 1) {
    const r0 = r - (p - 1);
    const rng0 = rngForRow(seed, r0);
    rng0(); // kind draw
    const baseDir: 1 | -1 = rng0() < 0.5 ? -1 : 1;
    dir = p % 2 === 1 ? baseDir : ((-baseDir) as 1 | -1);
  }

  // Length: carts 1–2 tiles (longer deeper), logs 2–3 tiles.
  const lenDraw = rng();
  const len =
    kind === 'road'
      ? r >= 18 && lenDraw < 0.35
        ? 2
        : 1
      : lenDraw < 0.45
        ? 3
        : 2;

  // Speed: big logs drift slower (Crossy Road tiering); carts unscaled.
  const speedDraw = rng();
  const cap = speedCapForRow(r, kind);
  // Big logs drift slower (Crossy Road tiering) but never below SPEED_MIN —
  // the alternating-direction fairness bound needs relative speed ≥ 2×SPEED_MIN.
  let speedTilesPerSec = SPEED_MIN + speedDraw * (cap - SPEED_MIN);
  if (kind === 'flume' && len === 3) {
    speedTilesPerSec = Math.max(SPEED_MIN, speedTilesPerSec * 0.75);
  }

  // Spacing: center-to-center ≥ len + GAP_MIN, denser deeper. Flume spacing is
  // additionally capped at len + 3 (⇒ always ≤ COLS) so logs stay dense enough
  // that the worst alignment wait fits inside the idle window.
  const maxExtra = r < 20 ? 3 : r < 60 ? 2 : 1;
  let spacing = len + GAP_MIN + Math.floor(rng() * (maxExtra + 1));
  if (kind === 'flume') spacing = Math.min(spacing, len + GAP_MIN + 1);
  // Fast carts keep a longer following distance — dense + fast road rows are
  // where corner pins happen (reachability-proof finding).
  if (kind === 'road' && speedTilesPerSec > 1.8) spacing += 1;
  const phase = rng() * spacing;

  return {
    row: r,
    kind,
    hazard: {
      row: r,
      kind,
      dir,
      // Magnitude only; `dir` carries the sign (see signedVel).
      velTilesPerMs: speedTilesPerSec / 1000,
      len,
      spacing,
      phase,
    },
  };
};

// The velocity magnitude is stored positive; `dir` carries the sign.
const signedVel = (h: HazardRow): number => h.dir * h.velTilesPerMs;

/** Half-extent (tiles) of a hazard body around its center. */
export const coverHalf = (h: HazardRow): number => h.len / 2;

/**
 * Signed distance helper: the position (in tiles) of the hazard lattice origin
 * at time t is `phase + signedVel*t`; hazards sit at that origin + k*spacing for
 * every integer k. Returns the SIGNED offset from the NEAREST hazard center at
 * time t to position `x` (x − center, wrapped into ±spacing/2).
 */
export const nearestHazardOffset = (
  h: HazardRow,
  x: number,
  t: number,
): number => {
  const base = h.phase + signedVel(h) * t; // lattice origin at time t
  const rel = x - base;
  return rel - h.spacing * Math.round(rel / h.spacing);
};

/** Distance from position `x` to the NEAREST hazard center at time t. */
export const nearestHazardDist = (
  h: HazardRow,
  x: number,
  t: number,
): number => Math.abs(nearestHazardOffset(h, x, t));

/** True iff position `x` is covered by a hazard body on row `h` at time t. */
export const hazardBlockedAt = (
  h: HazardRow,
  x: number,
  t: number,
): boolean => nearestHazardDist(h, x, t) < coverHalf(h);

/**
 * True iff position `x` on hazard row `h` is covered at ANY instant in the
 * closed interval [a, b]. Solved analytically (no sampling): a hazard center
 * passes `x` at times forming the arithmetic sequence
 *   t = tRef + n*period,  tRef = (x − phase)/signedVel,  period = spacing/|vel|
 * and covers it for ±(coverHalf/|vel|) around each pass. So the position is
 * covered during [a,b] iff the sequence lands in [a−half, b+half].
 */
export const hazardBlockedDuring = (
  h: HazardRow,
  x: number,
  a: number,
  b: number,
): boolean => {
  const vel = signedVel(h);
  const absVel = Math.abs(vel);
  if (!(absVel > 0)) return false;
  const period = h.spacing / absVel; // ms between successive passes of `x`
  const half = coverHalf(h) / absVel; // ms half-cover
  const tRef = (x - h.phase) / vel; // one time the lattice origin hits `x`
  const lo = a - half;
  const hi = b + half;
  const nLo = Math.ceil((lo - tRef) / period);
  const nHi = Math.floor((hi - tRef) / period);
  return nHi >= nLo;
};

// ── Player position model (shared client + server) ─────────────────────────

/** Standing on a SAFE/ROAD row at an integer column, or riding log lattice
 *  index `k` on a FLUME row at a fixed offset from that log's center. */
export type PlayerPos =
  | { mode: 'ground'; row: number; col: number }
  | { mode: 'riding'; row: number; k: number; offset: number };

/** The player's x (tile units, fractional while riding) at time t. */
export const playerXAt = (seed: number, pos: PlayerPos, t: number): number => {
  if (pos.mode === 'ground') return pos.col;
  const info = rowInfo(seed, pos.row);
  if (info.kind !== 'flume') return 0; // unreachable for well-formed states
  const h = info.hazard;
  return h.phase + signedVel(h) * t + pos.k * h.spacing + pos.offset;
};

export type DeathCause = 'collision' | 'drown' | 'swept' | 'gull';

export type HopOutcome =
  | { ok: false } // off-grid target: input is illegal, never emitted/accepted
  | {
      ok: true;
      pos: PlayerPos;
      died: 'collision' | 'drown' | null;
      /** True when the landing earned a close-call / edge-grab bonus. */
      closeCall: boolean;
    };

/**
 * Resolve one hop from `pos` at time t. THE transition function — the client
 * accepts/renders with it and the replay loop re-runs it, so the two can never
 * disagree. Pure; never throws.
 */
export const stepHop = (
  seed: number,
  pos: PlayerPos,
  dir: HopDir,
  t: number,
): HopOutcome => {
  const x = playerXAt(seed, pos, t);
  let nRow = pos.row;
  let nX = x;
  if (dir === 'U') nRow = pos.row + 1;
  else if (dir === 'D') nRow = Math.max(0, pos.row - 1);
  else nX = x + (dir === 'L' ? -1 : 1);

  // Sideways hops off the grid are illegal (the client never emits them). A
  // U/D take-off from a log drifting inside the edge margin is legal — the
  // landing x just clamps back into the grid.
  if (dir === 'L' || dir === 'R') {
    if (nX < 0 || nX > COLS - 1) return { ok: false };
  } else {
    nX = Math.max(0, Math.min(COLS - 1, nX));
  }

  const dest = rowInfo(seed, nRow);

  if (dest.kind === 'flume') {
    // Landing on water: catch a log (ride) or drown. Fractional x is kept.
    const h = dest.hazard;
    const off = nearestHazardOffset(h, nX, t);
    if (Math.abs(off) > coverHalf(h) + LOG_GRAB_GRACE) {
      return {
        ok: true,
        pos: { mode: 'ground', row: nRow, col: Math.round(nX) },
        died: 'drown',
        closeCall: false,
      };
    }
    const base = h.phase + signedVel(h) * t;
    const k = Math.round((nX - base) / h.spacing);
    const edgeGrab = coverHalf(h) - Math.abs(off) <= EDGE_GRAB_DIST;
    return {
      ok: true,
      pos: { mode: 'riding', row: nRow, k, offset: off },
      died: null,
      closeCall: edgeGrab,
    };
  }

  // Landing on ground rounds to the nearest column.
  const nCol = Math.max(0, Math.min(COLS - 1, Math.round(nX)));
  if (dest.kind === 'road') {
    if (hazardBlockedAt(dest.hazard, nCol, t)) {
      return {
        ok: true,
        pos: { mode: 'ground', row: nRow, col: nCol },
        died: 'collision',
        closeCall: false,
      };
    }
    const d = nearestHazardDist(dest.hazard, nCol, t);
    const closeCall = d - coverHalf(dest.hazard) <= CLOSE_CALL_DIST;
    return { ok: true, pos: { mode: 'ground', row: nRow, col: nCol }, died: null, closeCall };
  }
  return { ok: true, pos: { mode: 'ground', row: nRow, col: nCol }, died: null, closeCall: false };
};

export type DwellDeath = { cause: 'collision' | 'swept'; t: number } | null;

/**
 * Death (if any) while HOLDING position `pos` over the interval [a, b]:
 *   – ROAD: a cart sweeps into the occupied column (analytic, no sampling).
 *   – FLUME (riding): the log carries the player past the grid edge.
 * SAFE rows never dwell-kill. The idle gull is checked separately (it depends
 * on run-level state, not the position). Returns the death time for rendering;
 * the replay only needs cause + whether it precedes the next hop.
 */
export const dwellDeath = (
  seed: number,
  pos: PlayerPos,
  a: number,
  b: number,
): DwellDeath => {
  if (b < a) return null;
  const info = rowInfo(seed, pos.row);
  if (pos.mode === 'ground') {
    if (info.kind !== 'road') return null;
    if (!hazardBlockedDuring(info.hazard, pos.col, a, b)) return null;
    // First blocked instant (for rendering; correctness only needs existence).
    const h = info.hazard;
    const vel = signedVel(h);
    const period = h.spacing / Math.abs(vel);
    const half = coverHalf(h) / Math.abs(vel);
    const tRef = (pos.col - h.phase) / vel;
    const n = Math.ceil((a - half - tRef) / period);
    return { cause: 'collision', t: Math.max(a, tRef + n * period - half) };
  }
  // Riding: linear drift x(t) = base0 + vel*t; death when x leaves the strip.
  if (info.kind !== 'flume') return null;
  const h = info.hazard;
  const vel = signedVel(h);
  const base0 = h.phase + pos.k * h.spacing + pos.offset;
  const lo = -EDGE_KEEP;
  const hi = COLS - 1 + EDGE_KEEP;
  // Solve for the first t in [a,b] with x(t) outside [lo, hi].
  const exitT = vel > 0 ? (hi - base0) / vel : (lo - base0) / vel;
  if (exitT >= a && exitT <= b) return { cause: 'swept', t: exitT };
  // Already outside at a (shouldn't happen for legal states, but be exact).
  const xa = base0 + vel * a;
  if (xa < lo || xa > hi) return { cause: 'swept', t: a };
  return null;
};

// ── Recorded event + result shapes ──────────────────────────────────────────

export type HopDir = 'U' | 'D' | 'L' | 'R';

/** One recorded ACCEPTED hop. `t` = ms since the run started (client clock —
 *  used for the cadence/idle bound; the authoritative elapsed is the server
 *  session durationMs). */
export type BoardwalkHopEvent = {
  dir: HopDir;
  t: number;
};

export type BoardwalkReplayResult = {
  /** Authoritative score = furthest row + validated close-call bonuses. */
  score: number;
  /** Furthest row the player legitimately reached. */
  furthest: number;
  /** How many recorded hops were applied before the run ended. */
  counted: number;
  /** How the run ended (for logs / UI). */
  ending: DeathCause | 'events-ended' | null;
  /** True if the log was rejected as implausible (score is then 0). */
  rejected: boolean;
  /** Human-readable reason when rejected. */
  reason: string | null;
};

const isFiniteNum = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v);

const isHopDir = (v: unknown): v is HopDir =>
  v === 'U' || v === 'D' || v === 'L' || v === 'R';

/**
 * Re-simulate a recorded Boardwalk Hop run and return the authoritative score.
 *
 * Pure and never throws on bad input. Structural violations (non-monotonic time,
 * cadence-floor breach, out-of-window, off-grid hop) REJECT the whole run; the
 * run otherwise ends naturally on the first death and the score is the rows
 * proven survived up to that point.
 *
 * @param events     recorded accepted hops ({ dir, t })
 * @param durationMs the bounded server session/replay duration in ms
 * @param seed       the server `boardwalkSeed` for this session
 */
export const replayBoardwalkRun = (
  events: BoardwalkHopEvent[],
  durationMs: number,
  seed: number,
): BoardwalkReplayResult => {
  const reject = (reason: string): BoardwalkReplayResult => ({
    score: 0,
    furthest: 0,
    counted: 0,
    ending: null,
    rejected: true,
    reason,
  });

  if (!Array.isArray(events) || events.length === 0) {
    return { score: 0, furthest: 0, counted: 0, ending: null, rejected: false, reason: null };
  }
  if (events.length > BOARDWALK_MAX_EVENTS) {
    return reject(`Hop payload too large (${events.length})`);
  }

  // Keep well-formed entries, ordered by time. Sorting by time (not trusting
  // delivery order) means batching / reordering can't unfairly break a valid
  // run; the monotonic-cadence check below is positional in time.
  const clean = events
    .filter((e) => e != null && isHopDir(e.dir) && isFiniteNum(e.t) && e.t >= 0)
    .slice()
    .sort((a, b) => a.t - b.t);

  if (clean.length === 0) return reject('No well-formed hop events');

  // Upper edge for any hop timestamp: the server-measured elapsed plus a little
  // grace for the final hop / network skew. The client clock is only sanity
  // checked; the server duration is the real elapsed.
  const serverWindowMs =
    isFiniteNum(durationMs) && durationMs > 0
      ? durationMs + 1_500
      : Number.POSITIVE_INFINITY;

  let pos: PlayerPos = { mode: 'ground', row: 0, col: START_COL };
  let furthest = 0;
  let score = 0;
  let closeStreak = 0;
  let counted = 0;
  let lastHopT = -Infinity;
  let lastForwardT = 0; // idle clock resets when furthest increases
  let prevT = -Infinity;
  let ending: BoardwalkReplayResult['ending'] = null;

  for (const ev of clean) {
    const t = ev.t;

    // Monotonic time + cadence floor between ACCEPTED hops.
    if (t < prevT) {
      return reject('Hop timestamps out of order after sort (non-finite?)');
    }
    if (
      lastHopT !== -Infinity &&
      t - lastHopT < HOP_COOLDOWN_MS - HOP_COOLDOWN_GRACE_MS
    ) {
      return reject(
        `Hops faster than the cadence floor (gap=${Math.round(t - lastHopT)}ms < ${HOP_COOLDOWN_MS - HOP_COOLDOWN_GRACE_MS}ms)`,
      );
    }
    if (t > serverWindowMs) {
      return reject(
        `Hop outside session window (t=${Math.round(t)}ms > ${Math.round(serverWindowMs)}ms)`,
      );
    }

    // ── Resolve the dwell at the CURRENT position over [dwellStart, t] BEFORE
    //    moving. Death can occur mid-dwell (cart sweep / carried off edge). ──
    const dwellStart = prevT === -Infinity ? 0 : prevT;
    const dwell = dwellDeath(seed, pos, dwellStart, t);
    if (dwell) {
      ending = dwell.cause;
      break;
    }
    // Idle-punish: died if no new furthest row for longer than the window.
    if (t - lastForwardT > idleLimitMs(furthest) + IDLE_GRACE_MS) {
      ending = 'gull';
      break;
    }

    // ── Apply the hop through the shared transition function. ──
    const out = stepHop(seed, pos, ev.dir, t);
    if (!out.ok) {
      return reject('Hop off the grid (the client never emits these)');
    }
    pos = out.pos;
    counted += 1;
    lastHopT = t;
    prevT = t;
    if (out.died) {
      ending = out.died;
      break;
    }

    // Scoring: only a NEW furthest row scores.
    if (pos.row > furthest) {
      furthest = pos.row;
      lastForwardT = t; // reset the idle clock on real forward progress
      let pts = 1;
      if (out.closeCall) {
        closeStreak += 1;
        pts += CLOSE_CALL_BONUS * Math.min(closeStreak, CLOSE_CALL_STREAK_CAP);
      } else {
        closeStreak = 0;
      }
      score += pts;
      if (score >= BOARDWALK_SCORE_CAP) {
        ending = 'events-ended';
        break;
      }
    }
  }

  // If we never broke out of the loop, the run simply ran out of recorded events
  // (the client submitted after death or the tab closed). We do NOT extend the
  // dwell past the recorded events (the player may have died exactly there,
  // which is why the log ends), so the score stands at what was proven.
  if (ending === null) ending = 'events-ended';

  return {
    score: Math.min(BOARDWALK_SCORE_CAP, score),
    furthest,
    counted,
    ending,
    rejected: false,
    reason: null,
  };
};

/** Alias to match the spec's `validateBoardwalkRun` naming if preferred. */
export const validateBoardwalkRun = replayBoardwalkRun;
