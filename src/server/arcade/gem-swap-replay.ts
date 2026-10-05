// ──────────────────────────────────────────────────────────────────────────
// GEM SWAP — server-side authoritative replay / scoring module.
//
// This is a PURE module (no DB, no IO, no Date.now/Math.random). It re-derives
// the initial 8×8 board AND the entire refill stream from the one server seed,
// then re-plays the player's recorded SWAPS (each = a pair of adjacent cells the
// player swapped) and returns the AUTHORITATIVE score.
//
// Why this is replayable byte-for-byte:
//   • The initial board is built from the seed with NO pre-existing matches and
//     at least one legal move (deterministic construction below).
//   • Every NEW gem that ever enters the board is drawn from a single monotonic
//     refill stream keyed by (seed, drawIndex) — an O(1), order-independent draw
//     exactly like Bubble Shooter's bubbleQueueColor. As long as the swap
//     SEQUENCE is identical, the drawIndex advances identically on client and
//     server, so the refilled gems (and therefore every cascade and every point)
//     are identical.
//   • applySwap is the SINGLE source of truth used by BOTH the client (live,
//     incrementally) and the server replay below, so the client's running score
//     is byte-identical to the authoritative one.
//
// A swap is LEGAL only if it forms a line of >= MIN_MATCH same-colour gems. The
// score route compares the client-claimed score to replayGemSwapSession and
// rejects on mismatch. The swap count is bounded (GEM_MAX_SWAPS), the score is
// hard-capped (GEM_SCORE_CAP), and every swap must fall inside the 60s window,
// so a run is finite by construction.
// ──────────────────────────────────────────────────────────────────────────

// ── Board geometry / scoring constants (the client mirrors these) ──────────

/** Board edge length. The board is GRID×GRID cells, addressed 0..CELLS-1 with
 *  index = row * GRID + col (row 0 = top, col 0 = left). */
export const GRID = 8;

/** Total addressable cells. */
export const CELLS = GRID * GRID; // 64

/** Number of distinct gem colours (0..NUM_COLORS-1). */
export const NUM_COLORS = 6;

/** A line of >= MIN_MATCH same-colour gems clears. */
export const MIN_MATCH = 3;

/** Empty-cell sentinel (only transiently present mid-cascade; the board is full
 *  again before any match scan runs). */
export const EMPTY = -1;

/** Base points awarded per cleared gem (before the cascade multiplier). */
export const BASE_POINTS = 10;

/** The fixed game clock. Every recorded swap must fall inside this window. */
export const GEM_GAME_DURATION_MS = 60_000;

/** Grace added to the swap-time window for honest client jitter / network skew. */
export const GEM_SWAP_GRACE_MS = 1_500;

/** Hard ceiling on an authoritative run score (defense in depth alongside the
 *  route's client-score cap + the anti-cheat absolute limit). */
export const GEM_SCORE_CAP = 1_000_000;

/** Max swaps a legit 60s run can record. A swap + cascade takes time, so a real
 *  run is a few hundred at most; this is generous headroom. Anything larger is
 *  rejected before any work. */
export const GEM_MAX_SWAPS = 4_000;

/** Minimum wall-clock between consecutive swaps (select two gems + animate the
 *  clear). 80ms = a 12.5 swaps/sec ceiling — well above human cadence, so honest
 *  fast play never trips it, but it caps how many swaps can be claimed inside the
 *  real (server-measured) window so a maxed run can't be posted instantly. */
export const MIN_SWAP_INTERVAL_MS = 80;

/** Cap on the cascade multiplier so a pathological chain can't unbound a score. */
export const GEM_MAX_CASCADE_MULT = 16;

/** Defensive ceiling on cascade resolution steps for a single swap. */
const MAX_CASCADE_STEPS = 100;

// ── Seeded RNG — identical mulberry32 to the client + the other replays ─────
const createSeededRng = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/** Stable 32-bit mix of two values (golden-ratio constants), used to derive a
 *  fresh RNG stream from (seed, salt) without any shared cross-call state. */
const mixSeed = (seed: number, salt: number): number => {
  let mixed = (seed ^ Math.imul(salt + 1, 0x9e3779b1)) | 0;
  mixed = (mixed ^ 0x85ebca6b) | 0;
  return mixed >>> 0;
};

/**
 * The colour of the `drawIndex`-th gem to enter the board from the refill
 * stream (0-based), derived purely from the seed. O(1) and order-independent
 * (mirrors Bubble Shooter's bubbleQueueColor) so client + server agree without
 * any shared cross-draw RNG state.
 */
export const gemRefillColor = (seed: number, drawIndex: number): number => {
  const rng = createSeededRng(mixSeed(seed, drawIndex));
  return Math.floor(rng() * NUM_COLORS) % NUM_COLORS;
};

// ── Match / move detection ──────────────────────────────────────────────────

/**
 * All cell indices that belong to a horizontal or vertical run of >= MIN_MATCH
 * same-colour gems. Pure + identical on client and server. EMPTY cells never
 * match (the board is full whenever this is called, but the guard is kept).
 */
export const findMatches = (board: number[]): Set<number> => {
  const matched = new Set<number>();

  // Horizontal runs.
  for (let r = 0; r < GRID; r += 1) {
    let runStart = 0;
    for (let c = 1; c <= GRID; c += 1) {
      const prev = board[r * GRID + (c - 1)]!;
      const cur = c < GRID ? board[r * GRID + c]! : EMPTY;
      if (c < GRID && cur === prev && cur !== EMPTY) continue;
      const runLen = c - runStart;
      if (runLen >= MIN_MATCH && prev !== EMPTY) {
        for (let k = runStart; k < c; k += 1) matched.add(r * GRID + k);
      }
      runStart = c;
    }
  }

  // Vertical runs.
  for (let c = 0; c < GRID; c += 1) {
    let runStart = 0;
    for (let r = 1; r <= GRID; r += 1) {
      const prev = board[(r - 1) * GRID + c]!;
      const cur = r < GRID ? board[r * GRID + c]! : EMPTY;
      if (r < GRID && cur === prev && cur !== EMPTY) continue;
      const runLen = r - runStart;
      if (runLen >= MIN_MATCH && prev !== EMPTY) {
        for (let k = runStart; k < r; k += 1) matched.add(k * GRID + c);
      }
      runStart = r;
    }
  }

  return matched;
};

/** Whether cells `a` and `b` are orthogonally adjacent (and in bounds + distinct). */
export const areAdjacent = (a: number, b: number): boolean => {
  if (!Number.isInteger(a) || !Number.isInteger(b)) return false;
  if (a < 0 || a >= CELLS || b < 0 || b >= CELLS || a === b) return false;
  const ar = Math.floor(a / GRID);
  const ac = a % GRID;
  const br = Math.floor(b / GRID);
  const bc = b % GRID;
  return (
    (ar === br && Math.abs(ac - bc) === 1) ||
    (ac === bc && Math.abs(ar - br) === 1)
  );
};

/** Whether ANY adjacent swap would form a match (i.e. a legal move exists). */
export const hasLegalMove = (board: number[]): boolean => {
  const trySwap = (a: number, b: number): boolean => {
    const tmp = board[a]!;
    board[a] = board[b]!;
    board[b] = tmp;
    const ok = findMatches(board).size > 0;
    board[b] = board[a]!;
    board[a] = tmp;
    return ok;
  };
  for (let r = 0; r < GRID; r += 1) {
    for (let c = 0; c < GRID; c += 1) {
      const idx = r * GRID + c;
      if (c < GRID - 1 && trySwap(idx, idx + 1)) return true; // swap right
      if (r < GRID - 1 && trySwap(idx, idx + GRID)) return true; // swap down
    }
  }
  return false;
};

// ── Deterministic board construction (no initial matches) ───────────────────

/**
 * Fill `board` in place with a no-pre-existing-match layout using `rng`. For
 * each cell the colours that would complete a run of MIN_MATCH with the two
 * cells to the left or above are forbidden; the colour is then chosen from the
 * remaining allowed colours. With NUM_COLORS=6 there are at most 2 forbidden
 * colours, so an allowed colour always exists and the build always terminates.
 */
const fillNoMatchBoard = (board: number[], rng: () => number): void => {
  for (let r = 0; r < GRID; r += 1) {
    for (let c = 0; c < GRID; c += 1) {
      const idx = r * GRID + c;
      const forbidden = new Set<number>();
      if (
        c >= 2 &&
        board[idx - 1] === board[idx - 2] &&
        board[idx - 1] !== EMPTY
      ) {
        forbidden.add(board[idx - 1]!);
      }
      if (
        r >= 2 &&
        board[idx - GRID] === board[idx - 2 * GRID] &&
        board[idx - GRID] !== EMPTY
      ) {
        forbidden.add(board[idx - GRID]!);
      }
      const allowed: number[] = [];
      for (let color = 0; color < NUM_COLORS; color += 1) {
        if (!forbidden.has(color)) allowed.push(color);
      }
      board[idx] = allowed[Math.floor(rng() * allowed.length) % allowed.length]!;
    }
  }
};

/**
 * The deterministic initial board: an 8×8 layout with NO pre-existing matches
 * and at least one legal move, derived purely from the seed. Pure + identical on
 * client and server.
 */
export const generateInitialBoard = (seed: number): number[] => {
  const board = new Array<number>(CELLS).fill(EMPTY);
  for (let attempt = 0; attempt < 64; attempt += 1) {
    fillNoMatchBoard(board, createSeededRng(mixSeed(seed, attempt)));
    if (hasLegalMove(board)) return board;
  }
  // Unreachable in practice (a no-match 6-colour board nearly always has a move);
  // return the last build so the function is total.
  return board;
};

// ── Refill draw state (seed + monotonic index, shared by client & server) ───

/** The running refill cursor: the seed plus the next draw index. Both the live
 *  client and the server replay advance this identically as gems are spawned. */
export type DrawState = { seed: number; index: number };

/** A fresh draw cursor for a run (refill stream starts at index 0). */
export const createDrawState = (seed: number): DrawState => ({ seed, index: 0 });

/**
 * Gravity + seeded refill (mutates `board`). For each column (left→right) the
 * surviving gems settle to the bottom preserving their relative order, then the
 * vacated top cells are filled (top→bottom) with the next gems from the refill
 * stream. The column/row iteration order is the deterministic refill order both
 * client and server obey, so the spawned colours are identical.
 */
const collapseAndRefill = (board: number[], draw: DrawState): void => {
  for (let c = 0; c < GRID; c += 1) {
    const survivors: number[] = [];
    for (let r = GRID - 1; r >= 0; r -= 1) {
      const v = board[r * GRID + c]!;
      if (v !== EMPTY) survivors.push(v);
    }
    // survivors are bottom→top; place them back bottom→top.
    const emptyCount = GRID - survivors.length;
    for (let r = 0; r < emptyCount; r += 1) {
      board[r * GRID + c] = gemRefillColor(draw.seed, draw.index);
      draw.index += 1;
    }
    for (let i = 0; i < survivors.length; i += 1) {
      board[(GRID - 1 - i) * GRID + c] = survivors[i]!;
    }
  }
};

/**
 * Deterministically reshuffle the whole board in place when no legal move
 * remains. Builds a fresh no-match board with a legal move from an RNG keyed by
 * the current draw cursor, advancing the cursor so subsequent refills stay in
 * lockstep between client and server. Reshuffles never create matches, so they
 * award no free score.
 */
const reshuffleBoard = (board: number[], draw: DrawState): void => {
  for (let attempt = 0; attempt < 64; attempt += 1) {
    fillNoMatchBoard(
      board,
      createSeededRng(mixSeed(draw.seed, draw.index + attempt)),
    );
    draw.index += CELLS;
    if (hasLegalMove(board)) return;
  }
};

/** The cascade multiplier for chain depth `depth` (1-indexed), capped. */
export const cascadeMultiplier = (depth: number): number =>
  Math.min(Math.max(1, depth), GEM_MAX_CASCADE_MULT);

// ── applySwap — the single source of truth (client + server) ────────────────

/** The outcome of applying one swap (mutates `board` + `draw`). */
export type SwapOutcome = {
  /** The (possibly mutated) board, for callers that prefer the return value. */
  board: number[];
  /** Was the swap legal (adjacent + formed a match)? If false, board unchanged. */
  legal: boolean;
  reason: string | null;
  /** Total gems cleared across every cascade step of this swap. */
  cleared: number;
  /** Points scored by this swap (all cascade steps, with multipliers). */
  scoreGained: number;
  /** Number of cascade resolution steps (chain depth). */
  cascades: number;
};

/**
 * Apply one swap of adjacent cells `a` and `b`. A swap is legal only if it forms
 * a line of >= MIN_MATCH same-colour gems; otherwise the gems swap back and the
 * board is left unchanged (legal=false). Legal swaps clear the matched gems,
 * collapse + refill from the seeded stream, and auto-resolve any cascade the
 * refill produces (the multiplier grows each chain step). If the resolved board
 * has no legal move it is deterministically reshuffled. Mutates `board` + `draw`.
 *
 * This is the SINGLE source of truth used by BOTH the live client and the server
 * replay, guaranteeing the client's running score equals the authoritative one.
 */
export const applySwap = (
  board: number[],
  a: number,
  b: number,
  draw: DrawState,
): SwapOutcome => {
  const illegal = (reason: string): SwapOutcome => ({
    board,
    legal: false,
    reason,
    cleared: 0,
    scoreGained: 0,
    cascades: 0,
  });

  if (!areAdjacent(a, b)) return illegal('cells not adjacent');

  // Tentatively swap; a swap that forms no match is rejected (gems swap back).
  const tmp = board[a]!;
  board[a] = board[b]!;
  board[b] = tmp;

  let matched = findMatches(board);
  if (matched.size === 0) {
    // Revert — an illegal swap leaves the board exactly as it was.
    board[b] = board[a]!;
    board[a] = tmp;
    return illegal('swap forms no match');
  }

  let scoreGained = 0;
  let cleared = 0;
  let depth = 0;

  while (matched.size > 0 && depth < MAX_CASCADE_STEPS) {
    depth += 1;
    const mult = cascadeMultiplier(depth);
    scoreGained += matched.size * BASE_POINTS * mult;
    cleared += matched.size;
    for (const idx of matched) board[idx] = EMPTY;
    collapseAndRefill(board, draw);
    matched = findMatches(board);
  }

  if (!hasLegalMove(board)) reshuffleBoard(board, draw);

  return { board, legal: true, reason: null, cleared, scoreGained, cascades: depth };
};

// ── Recorded swap + replay result shapes ────────────────────────────────────

/** One recorded swap: the two adjacent cell indices the player swapped. `t` =
 *  ms since the run began (used for the 60s window + ordering). */
export type GemSwap = {
  a: number;
  b: number;
  t: number;
};

export type GemReplayResult = {
  /** Authoritative score = points from all validated swaps (capped). */
  score: number;
  /** How many recorded swaps were actually applied before the run ended. */
  counted: number;
  /** True if the log was rejected as implausible (score is then 0). */
  rejected: boolean;
  /** Human-readable reason when rejected (embedded in the route reject log). */
  reason: string | null;
};

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/**
 * Verify a recorded Gem Swap run and return the authoritative score.
 *
 * Swaps are ordered by `t` (then original index); each must be adjacent, form a
 * match (legal), and fall inside the 60s window (and the bounded session
 * duration). The board + every refilled gem are re-derived from the seed, so the
 * score is recomputed entirely from (seed + ordered swaps); the client's claimed
 * number must equal it.
 *
 * Pure + never throws. A structurally invalid swap (non-adjacent / forms no
 * match / outside the window) rejects the whole run, mirroring Bubble Shooter.
 *
 * @param rawSwaps   recorded swaps ({ a, b, t })
 * @param seed       the server `gemSeed` for this session
 * @param durationMs the bounded session/replay duration in ms
 */
export const replayGemSwapSession = (
  rawSwaps: GemSwap[],
  seed: number,
  durationMs: number,
): GemReplayResult => {
  const reject = (reason: string): GemReplayResult => ({
    score: 0,
    counted: 0,
    rejected: true,
    reason,
  });

  if (!Array.isArray(rawSwaps)) return reject('Swaps payload missing');
  if (rawSwaps.length > GEM_MAX_SWAPS) {
    return reject(`Swap payload too large (${rawSwaps.length})`);
  }
  if (rawSwaps.length === 0) {
    return { score: 0, counted: 0, rejected: false, reason: null };
  }

  // Keep only well-formed entries, then order by t (fallback original index).
  // Sorting by t means out-of-order delivery can't reorder the run; the index
  // tiebreak preserves the client's application order for equal timestamps.
  const clean = rawSwaps
    .map((s, i) => ({
      a: Number(s?.a),
      b: Number(s?.b),
      t: isFiniteNumber(Number(s?.t)) ? Number(s?.t) : 0,
      idx: i,
    }))
    .filter((s) => Number.isInteger(s.a) && Number.isInteger(s.b))
    .sort((a, b) => a.t - b.t || a.idx - b.idx);

  if (clean.length === 0) return reject('No well-formed swaps');

  // The upper edge for any swap timestamp: the 60s clock plus grace, further
  // bounded by the server-measured session duration plus grace.
  const windowMs =
    isFiniteNumber(durationMs) && durationMs > 0
      ? Math.min(GEM_GAME_DURATION_MS, durationMs) + GEM_SWAP_GRACE_MS
      : GEM_GAME_DURATION_MS + GEM_SWAP_GRACE_MS;

  // The swap count can't exceed what is physically performable in the elapsed
  // window at MIN_SWAP_INTERVAL_MS apart. windowMs is bounded by the server-
  // measured session duration, so this binds the achievable score to real time
  // — a maxed run can no longer be posted instantly with all-zero timestamps.
  const maxSwapsForWindow = Math.floor(windowMs / MIN_SWAP_INTERVAL_MS) + 8;
  if (clean.length > maxSwapsForWindow) {
    return reject(
      `Too many swaps (${clean.length}) for the elapsed window (${Math.round(windowMs)}ms)`,
    );
  }

  const board = generateInitialBoard(seed);
  const draw = createDrawState(seed);
  let score = 0;
  let counted = 0;

  for (let i = 0; i < clean.length; i += 1) {
    const swap = clean[i]!;
    if (swap.t < 0 || swap.t > windowMs) {
      return reject(
        `Swap ${i} outside the 60s window (t=${Math.round(swap.t)}ms > ${Math.round(windowMs)}ms)`,
      );
    }
    const outcome = applySwap(board, swap.a, swap.b, draw);
    if (!outcome.legal) {
      return reject(
        `Swap ${i} illegal: ${outcome.reason} at (${swap.a},${swap.b})`,
      );
    }
    counted += 1;
    score += outcome.scoreGained;
    if (score >= GEM_SCORE_CAP) {
      score = GEM_SCORE_CAP;
      break;
    }
  }

  return {
    score: Math.min(GEM_SCORE_CAP, score),
    counted,
    rejected: false,
    reason: null,
  };
};

/** Alias kept to match a `validateGemRun` naming if preferred. */
export const validateGemRun = replayGemSwapSession;
