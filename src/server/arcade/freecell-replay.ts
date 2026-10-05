// ──────────────────────────────────────────────────────────────────────────
// FREECELL SPRINT — server-authoritative rules engine, seeded deal, bounded
// solvability solver, and single-POST replay verifier.
//
// This is a PURE module (no DB, no IO, no Date.now, no Math.random). The SAME
// module is imported by the client (to render the seeded deal and validate
// moves locally) and by the server routes (puzzle deal + authoritative score
// replay), so both sides converge on the byte-identical deal and rules.
//
// MODEL (mirrors punch-card / sudoku time-attack + swerve single-POST resim):
//   • A session seed deterministically deals 8 cascades / 4 free cells /
//     4 foundations via a seeded Fisher-Yates shuffle.
//   • At generation we PROVE the deal solvable with a bounded best-first
//     solver. If a seed's deal can't be proven solvable within the node budget
//     (astronomically rare — ~99.999% of FreeCell deals are solvable), we
//     deterministically re-derive with seed+1, seed+2, … via `resolveDeal`, so
//     client and server pick the identical final deal.
//   • The client streams its full ordered move list (+ undos). The score route
//     re-derives the deal, replays every move enforcing the real rules
//     (legal-move validation incl. supermove sizing), rejects any illegal move,
//     and only accepts a run whose final state has all 52 cards on foundations.
//   • SCORING is time (lower better), SERVER-AUTHORITATIVE: the recorded base
//     time is the server session wall-clock (never the client's claim); move
//     count is the leaderboard tiebreak. Undo is replay-honest — it is a real
//     event the server replays (popping a state snapshot); undone moves still
//     count toward the move total, so undo costs you the tiebreak but is always
//     legal and never fakes a faster time.
// ──────────────────────────────────────────────────────────────────────────

export const NUM_CASCADES = 8;
export const NUM_FREECELLS = 4;
export const NUM_FOUNDATIONS = 4;
export const DECK_SIZE = 52;

/** Wire cap on the number of move events a single run may submit. A real solve
 *  is a few hundred moves; thrash + undo stays far under this. */
export const FREECELL_MAX_EVENTS = 5000;

/** Lower bound (ms) of physically-plausible time per move, used by the session
 *  plausibility floor. A blistering keyboard speed-runner averages ~150-300
 *  ms/move; 55 ms is a >2.5× generous floor that never false-rejects a human
 *  but catches a bot that precomputes a solution and submits within a second of
 *  session start (the recorded time is the server wall-clock, so this floor is
 *  what stops an "instant" fabricated solve from topping the fastest board). */
export const FREECELL_MIN_MS_PER_MOVE = 55;

/** Floor for any recorded solve time (ms). */
export const FREECELL_MIN_RECORDED_MS = 1_000;

/** Hard cap on recorded solve time (1 hour) — anything longer is rejected. */
export const FREECELL_MAX_SOLVE_MS = 3_600_000;

/** Node budget for the bounded solvability proof. Random solvable deals are
 *  proven far under this; the cap only bounds the (astronomically rare) hard /
 *  unsolvable deals so generation always terminates. */
export const FREECELL_SOLVER_NODE_BUDGET = 60_000;

/** Max seed re-derivations before falling back (never reached in practice). */
const MAX_REDERIVE = 64;

const MOD = 2 ** 31;

// ── Card helpers ────────────────────────────────────────────────────────────
// A card is an integer 0..51. rank = 1..13 (A..K), suit = 0..3
// (0 spades, 1 hearts, 2 diamonds, 3 clubs). card = suit*13 + (rank-1).
export const rankOf = (card: number): number => (card % 13) + 1;
export const suitOf = (card: number): number => Math.floor(card / 13);
export const isRed = (card: number): boolean => {
  const s = suitOf(card);
  return s === 1 || s === 2;
};
/** The two opposite-color suits for a suit (for the safe-autoplay rule). */
const OPP_SUITS: readonly [number, number][] = [
  [1, 2], // spades(black) → hearts,diamonds(red)
  [0, 3], // hearts(red)   → spades,clubs(black)
  [0, 3], // diamonds(red) → spades,clubs(black)
  [1, 2], // clubs(black)  → hearts,diamonds(red)
];

/** True iff `card` can legally sit on `onto` in a cascade (one lower, opp color). */
export const canStack = (card: number, onto: number): boolean =>
  rankOf(card) === rankOf(onto) - 1 && isRed(card) !== isRed(onto);

// ── Seeded RNG — identical mulberry32 to the client + the other replays ─────
const mulberry32 = (seed: number) => {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

// ── Deal ────────────────────────────────────────────────────────────────────
/** Seeded Fisher-Yates shuffle of the 52-card deck, dealt round-robin into 8
 *  cascades (columns 0-3 get 7 cards, columns 4-7 get 6). Each column is
 *  bottom-first: index 0 is the buried card, the last index is the free top. */
export const dealFromSeed = (seed: number): number[][] => {
  const rng = mulberry32(seed >>> 0);
  const deck = Array.from({ length: DECK_SIZE }, (_, i) => i);
  for (let i = DECK_SIZE - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = deck[i]!;
    deck[i] = deck[j]!;
    deck[j] = tmp;
  }
  const cascades: number[][] = Array.from({ length: NUM_CASCADES }, () => []);
  for (let i = 0; i < DECK_SIZE; i += 1) {
    cascades[i % NUM_CASCADES]!.push(deck[i]!);
  }
  return cascades;
};

// ── Daily-deal helpers ──────────────────────────────────────────────────────
/** UTC day number since the epoch (a stable per-day integer). */
export const dayNumberFromMs = (ms: number): number =>
  Math.floor(ms / 86_400_000);

/** Deterministic, pure (client-safe) integer hash from a day number to a seed.
 *  Everyone playing the daily on the same UTC day derives the identical deal. */
export const dailySeedForDay = (day: number): number => {
  let x = (day + 1) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x = (x ^ (x >>> 16)) >>> 0;
  return x % MOD;
};

// ── Game state ──────────────────────────────────────────────────────────────
export type FreeCellState = {
  /** 8 columns, bottom-first (last element is the free top card). */
  cascades: number[][];
  /** 4 free cells; null = empty. */
  free: (number | null)[];
  /** 4 foundations by suit; value = top rank placed (0 = empty). */
  found: number[];
};

export const initialState = (deal: number[][]): FreeCellState => ({
  cascades: deal.map((col) => col.slice()),
  free: [null, null, null, null],
  found: [0, 0, 0, 0],
});

const cloneState = (s: FreeCellState): FreeCellState => ({
  cascades: s.cascades.map((c) => c.slice()),
  free: s.free.slice(),
  found: s.found.slice(),
});

export const isWon = (s: FreeCellState): boolean =>
  s.found[0] === 13 && s.found[1] === 13 && s.found[2] === 13 && s.found[3] === 13;

// ── Location codes for the wire move format ─────────────────────────────────
// from/to codes: 0..7 = cascade i, 8..11 = free cell i, 12 = foundation
// (auto-routed to the card's suit). Undo is a distinct event (from === -1).
export const LOC_FREECELL_BASE = 8;
export const LOC_FOUNDATION = 12;

/** How many cards may legally move as one supermove: (freeCells+1) · 2^emptyCols,
 *  with the destination column excluded from the multiplier when it is itself
 *  empty (the standard FreeCell supermove sizing). */
export const maxSupermove = (
  s: FreeCellState,
  toEmptyColumn: boolean,
): number => {
  const freeEmpties = s.free.reduce((n, c) => n + (c === null ? 1 : 0), 0);
  const emptyCols = s.cascades.reduce((n, c) => n + (c.length === 0 ? 1 : 0), 0);
  const effEmpty = toEmptyColumn ? Math.max(0, emptyCols - 1) : emptyCols;
  return (freeEmpties + 1) * 2 ** effEmpty;
};

export type FreeCellMove = { f: number; t: number; n: number };

/**
 * Apply one move to a state, returning the NEW state, or null if the move is
 * illegal. `f`/`t` are location codes; `n` is the card count (only >1 for a
 * cascade→cascade supermove). Pure — never mutates the input.
 */
export const applyMove = (
  state: FreeCellState,
  move: FreeCellMove,
): FreeCellState | null => {
  const n = Number.isInteger(move.n) && move.n >= 1 ? move.n : 1;
  const { f, t } = move;

  // ── Gather the moving cards from the source (bottom-of-group first). ──
  let moving: number[];
  if (f >= 0 && f < NUM_CASCADES) {
    const col = state.cascades[f]!;
    if (col.length < n) return null;
    moving = col.slice(col.length - n);
    // A multi-card grab must itself be a valid descending, alternating run.
    for (let i = 0; i < moving.length - 1; i += 1) {
      if (!canStack(moving[i + 1]!, moving[i]!)) return null;
    }
  } else if (f >= LOC_FREECELL_BASE && f < LOC_FREECELL_BASE + NUM_FREECELLS) {
    if (n !== 1) return null;
    const card = state.free[f - LOC_FREECELL_BASE];
    if (card === null || card === undefined) return null;
    moving = [card];
  } else {
    return null; // foundations are never a source
  }

  const next = cloneState(state);

  // ── Destination. ──
  if (t === LOC_FOUNDATION) {
    if (n !== 1) return null;
    const card = moving[0]!;
    const s = suitOf(card);
    if (next.found[s] !== rankOf(card) - 1) return null;
    removeFromSource(next, f, n);
    next.found[s] = rankOf(card);
    return next;
  }

  if (t >= LOC_FREECELL_BASE && t < LOC_FREECELL_BASE + NUM_FREECELLS) {
    if (n !== 1) return null;
    const idx = t - LOC_FREECELL_BASE;
    if (next.free[idx] !== null) return null;
    removeFromSource(next, f, n);
    next.free[idx] = moving[0]!;
    return next;
  }

  if (t >= 0 && t < NUM_CASCADES) {
    if (t === f) return null; // no-op onto itself
    const destCol = next.cascades[t]!;
    const toEmpty = destCol.length === 0;
    if (!toEmpty) {
      const top = destCol[destCol.length - 1]!;
      if (!canStack(moving[0]!, top)) return null;
    }
    if (n > maxSupermove(state, toEmpty)) return null;
    removeFromSource(next, f, n);
    destCol.push(...moving);
    return next;
  }

  return null;
};

const removeFromSource = (s: FreeCellState, f: number, n: number) => {
  if (f >= 0 && f < NUM_CASCADES) {
    s.cascades[f]!.length -= n;
  } else if (f >= LOC_FREECELL_BASE && f < LOC_FREECELL_BASE + NUM_FREECELLS) {
    s.free[f - LOC_FREECELL_BASE] = null;
  }
};

// ── Event normalization (wire) ──────────────────────────────────────────────
export type FreeCellEvent =
  | { kind: 'move'; f: number; t: number; n: number }
  | { kind: 'undo' };

/**
 * Coerce an unknown payload into a clean event list, or null if malformed.
 * Accepts compact tuples `[f, t, n]` (f === -1 → undo) or objects
 * `{ f, t, n }` / `{ undo: true }`.
 */
export const normalizeEvents = (
  value: unknown,
  cap = FREECELL_MAX_EVENTS,
): FreeCellEvent[] | null => {
  if (!Array.isArray(value)) return null;
  if (value.length > cap) return null;
  const out: FreeCellEvent[] = [];
  for (const raw of value) {
    let f: unknown;
    let t: unknown;
    let n: unknown;
    let undo = false;
    if (Array.isArray(raw)) {
      [f, t, n] = raw;
      if (f === -1) undo = true;
    } else if (raw && typeof raw === 'object') {
      const o = raw as Record<string, unknown>;
      if (o.undo === true || o.kind === 'undo' || o.f === -1) {
        undo = true;
      } else {
        f = o.f;
        t = o.t;
        n = o.n;
      }
    } else {
      return null;
    }
    if (undo) {
      out.push({ kind: 'undo' });
      continue;
    }
    if (
      typeof f !== 'number' ||
      !Number.isInteger(f) ||
      f < 0 ||
      f > 11 ||
      typeof t !== 'number' ||
      !Number.isInteger(t) ||
      t < 0 ||
      t > LOC_FOUNDATION
    ) {
      return null;
    }
    const count =
      typeof n === 'number' && Number.isInteger(n) && n >= 1 ? n : 1;
    out.push({ kind: 'move', f, t, n: count });
  }
  return out;
};

export type FreeCellReplayResult = {
  /** True iff every event was legal AND the final state has all 52 home. */
  solved: boolean;
  /** Forward moves applied over the whole run (undone moves still counted —
   *  the leaderboard tiebreak). */
  moveCount: number;
  /** Index of the first illegal event, or -1. */
  illegalAt: number;
  /** Human-readable reason when rejected. */
  reason: string | null;
};

/**
 * Replay a submitted event list against the seeded deal. Enforces the real
 * rules move-by-move (illegal move → reject) and reports whether the run
 * reaches a solved board. Undo pops the prior state snapshot; a forward move is
 * counted even if later undone. Pure + never throws.
 */
export const replayFreecell = (
  deal: number[][],
  events: FreeCellEvent[],
): FreeCellReplayResult => {
  let state = initialState(deal);
  const history: FreeCellState[] = [];
  let moveCount = 0;

  for (let i = 0; i < events.length; i += 1) {
    const ev = events[i]!;
    if (ev.kind === 'undo') {
      // Undo with nothing to revert is a harmless no-op (lenient).
      const prev = history.pop();
      if (prev) state = prev;
      continue;
    }
    history.push(state);
    const nextState = applyMove(state, { f: ev.f, t: ev.t, n: ev.n });
    if (!nextState) {
      return {
        solved: false,
        moveCount,
        illegalAt: i,
        reason: `Illegal move at event ${i} (f=${ev.f}, t=${ev.t}, n=${ev.n})`,
      };
    }
    state = nextState;
    moveCount += 1;
  }

  return {
    solved: isWon(state),
    moveCount,
    illegalAt: -1,
    reason: null,
  };
};

// ── Bounded solvability solver (weighted best-first + transposition table) ──

const isSafeAuto = (rank: number, suit: number, found: number[]): boolean => {
  const [a, b] = OPP_SUITS[suit]!;
  return Math.min(found[a]!, found[b]!) >= rank - 1;
};

/** Greedily send every safe card to its foundation (never changes solvability,
 *  drastically prunes the search). Mutates `s`. */
const autoplaySafe = (s: FreeCellState): void => {
  let moved = true;
  while (moved) {
    moved = false;
    for (let i = 0; i < NUM_CASCADES; i += 1) {
      const col = s.cascades[i]!;
      if (col.length === 0) continue;
      const card = col[col.length - 1]!;
      const suit = suitOf(card);
      const rank = rankOf(card);
      if (s.found[suit] === rank - 1 && isSafeAuto(rank, suit, s.found)) {
        col.length -= 1;
        s.found[suit] = rank;
        moved = true;
      }
    }
    for (let i = 0; i < NUM_FREECELLS; i += 1) {
      const card = s.free[i];
      if (card === null || card === undefined) continue;
      const suit = suitOf(card);
      const rank = rankOf(card);
      if (s.found[suit] === rank - 1 && isSafeAuto(rank, suit, s.found)) {
        s.free[i] = null;
        s.found[suit] = rank;
        moved = true;
      }
    }
  }
};

/** Canonical key: cascade columns and free cells are interchangeable, so sort
 *  them before hashing to collapse symmetric states. */
const canonicalKey = (s: FreeCellState): string => {
  const cols = s.cascades.map((c) => c.join(',')).sort();
  const free = s.free
    .filter((c): c is number => c !== null)
    .sort((a, b) => a - b)
    .join(',');
  return `${cols.join('|')}/${free}/${s.found.join(',')}`;
};

const foundationTotal = (s: FreeCellState): number =>
  s.found[0]! + s.found[1]! + s.found[2]! + s.found[3]!;

/** Heuristic: cards not yet home, weighted, plus a buried-card penalty for the
 *  next card each foundation needs, plus free-cell pressure. Lower is closer. */
const heuristic = (s: FreeCellState): number => {
  let h = (DECK_SIZE - foundationTotal(s)) * 3;
  for (let suit = 0; suit < NUM_FOUNDATIONS; suit += 1) {
    const need = s.found[suit]! + 1;
    if (need > 13) continue;
    const card = suit * 13 + (need - 1);
    for (let c = 0; c < NUM_CASCADES; c += 1) {
      const col = s.cascades[c]!;
      const idx = col.indexOf(card);
      if (idx >= 0) {
        h += col.length - 1 - idx; // cards buried on top of it
        break;
      }
    }
  }
  h += s.free.reduce((n, c) => n + (c === null ? 0 : 1), 0);
  return h;
};

/** Generate the successor states via single-card moves (complete given free
 *  cells) after safe-autoplay. Columns/cells are deduped by the caller's
 *  transposition table. */
const successors = (s: FreeCellState): FreeCellState[] => {
  const out: FreeCellState[] = [];
  const freeEmptyIdx = s.free.findIndex((c) => c === null);
  const emptyColIdx = s.cascades.findIndex((c) => c.length === 0);

  const tryDestinations = (card: number, apply: () => FreeCellState) => {
    const rank = rankOf(card);
    const suit = suitOf(card);
    // Foundation (non-safe ones; safe ones were auto-played already).
    if (s.found[suit] === rank - 1) {
      const ns = apply();
      ns.found[suit] = rank;
      autoplaySafe(ns);
      out.push(ns);
    }
    // Onto a cascade top.
    for (let c = 0; c < NUM_CASCADES; c += 1) {
      const col = s.cascades[c]!;
      if (col.length === 0) continue;
      if (canStack(card, col[col.length - 1]!)) {
        const ns = apply();
        ns.cascades[c]!.push(card);
        autoplaySafe(ns);
        out.push(ns);
      }
    }
    // Onto ONE empty column (columns interchangeable → only the first).
    if (emptyColIdx >= 0) {
      const ns = apply();
      ns.cascades[emptyColIdx]!.push(card);
      autoplaySafe(ns);
      out.push(ns);
    }
  };

  // From each cascade top.
  for (let c = 0; c < NUM_CASCADES; c += 1) {
    const col = s.cascades[c]!;
    if (col.length === 0) continue;
    const card = col[col.length - 1]!;
    tryDestinations(card, () => {
      const ns = cloneState(s);
      ns.cascades[c]!.length -= 1;
      return ns;
    });
    // Cascade top → one empty free cell.
    if (freeEmptyIdx >= 0) {
      const ns = cloneState(s);
      ns.cascades[c]!.length -= 1;
      ns.free[freeEmptyIdx] = card;
      autoplaySafe(ns);
      out.push(ns);
    }
  }

  // ── Supermoves: move an ordered run (length ≥ 2) between cascades atomically.
  // This is what makes the search terminate fast — single-card moves alone
  // explode the state space on deep tableaus. The count is bounded by
  // maxSupermove (free cells + empty columns), matching the real rules.
  const mmNonEmpty = maxSupermove(s, false);
  const mmEmpty = maxSupermove(s, true);
  for (let c = 0; c < NUM_CASCADES; c += 1) {
    const col = s.cascades[c]!;
    if (col.length < 2) continue;
    // Length of the ordered (descending, alternating-color) tail run.
    let runLen = 1;
    while (
      runLen < col.length &&
      canStack(col[col.length - runLen]!, col[col.length - runLen - 1]!)
    ) {
      runLen += 1;
    }
    if (runLen < 2) continue;
    const tailStart = col.length - runLen; // index of highest card in the run
    for (let d = 0; d < NUM_CASCADES; d += 1) {
      if (d === c) continue;
      const dest = s.cascades[d]!;
      if (dest.length === 0) {
        // Move the maximal movable run onto one empty column.
        const move = Math.min(runLen, mmEmpty);
        if (move >= 2 && d === emptyColIdx) {
          const ns = cloneState(s);
          const run = col.slice(col.length - move);
          ns.cascades[c]!.length -= move;
          ns.cascades[d]!.push(...run);
          autoplaySafe(ns);
          out.push(ns);
        }
      } else {
        const top = dest[dest.length - 1]!;
        // At most one card in the tail can land on `top`.
        for (let j = tailStart; j < col.length; j += 1) {
          if (canStack(col[j]!, top)) {
            const move = col.length - j;
            if (move >= 2 && move <= mmNonEmpty) {
              const ns = cloneState(s);
              const run = col.slice(j);
              ns.cascades[c]!.length -= move;
              ns.cascades[d]!.push(...run);
              autoplaySafe(ns);
              out.push(ns);
            }
            break;
          }
        }
      }
    }
  }

  // From each occupied free cell.
  for (let i = 0; i < NUM_FREECELLS; i += 1) {
    const card = s.free[i];
    if (card === null || card === undefined) continue;
    tryDestinations(card, () => {
      const ns = cloneState(s);
      ns.free[i] = null;
      return ns;
    });
  }

  return out;
};

// Minimal binary min-heap keyed by priority number.
class MinHeap<T> {
  private items: { p: number; v: T }[] = [];
  get size() {
    return this.items.length;
  }
  push(p: number, v: T) {
    const a = this.items;
    a.push({ p, v });
    let i = a.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (a[parent]!.p <= a[i]!.p) break;
      [a[parent], a[i]] = [a[i]!, a[parent]!];
      i = parent;
    }
  }
  pop(): T | undefined {
    const a = this.items;
    if (a.length === 0) return undefined;
    const top = a[0]!;
    const last = a.pop()!;
    if (a.length > 0) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = 2 * i + 2;
        let m = i;
        if (l < a.length && a[l]!.p < a[m]!.p) m = l;
        if (r < a.length && a[r]!.p < a[m]!.p) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i]!, a[m]!];
        i = m;
      }
    }
    return top.v;
  }
}

export type SolverResult = {
  solved: boolean;
  /** Nodes expanded (for measurement / budget tuning). */
  nodes: number;
  /** True if the search stopped at the node budget without proving solvable. */
  exhausted: boolean;
};

/**
 * Prove a deal solvable within `budget` node expansions. Weighted-A* best-first
 * (priority = g + 3·h) with safe-autoplay and a canonical-state transposition
 * table. Returns as soon as any goal state is reached. Pure + deterministic.
 */
export const isSolvable = (
  deal: number[][],
  budget = FREECELL_SOLVER_NODE_BUDGET,
): SolverResult => {
  const start = initialState(deal);
  autoplaySafe(start);
  if (isWon(start)) return { solved: true, nodes: 0, exhausted: false };

  const heap = new MinHeap<{ state: FreeCellState; g: number }>();
  const visited = new Set<string>();
  heap.push(heuristic(start), { state: start, g: 0 });
  visited.add(canonicalKey(start));

  let nodes = 0;
  while (heap.size > 0) {
    if (nodes >= budget) {
      return { solved: false, nodes, exhausted: true };
    }
    const node = heap.pop()!;
    nodes += 1;
    const { state, g } = node;
    if (isWon(state)) return { solved: true, nodes, exhausted: false };

    for (const ns of successors(state)) {
      const key = canonicalKey(ns);
      if (visited.has(key)) continue;
      visited.add(key);
      if (isWon(ns)) return { solved: true, nodes, exhausted: false };
      heap.push(g + 1 + 3 * heuristic(ns), { state: ns, g: g + 1 });
    }
  }
  return { solved: false, nodes, exhausted: false };
};

/** Find a single safe-autoplay wire move for the state, or null. */
const findSafeAutoMove = (s: FreeCellState): FreeCellMove | null => {
  for (let i = 0; i < NUM_CASCADES; i += 1) {
    const col = s.cascades[i]!;
    if (col.length === 0) continue;
    const card = col[col.length - 1]!;
    if (
      s.found[suitOf(card)] === rankOf(card) - 1 &&
      isSafeAuto(rankOf(card), suitOf(card), s.found)
    ) {
      return { f: i, t: LOC_FOUNDATION, n: 1 };
    }
  }
  for (let i = 0; i < NUM_FREECELLS; i += 1) {
    const card = s.free[i];
    if (card === null || card === undefined) continue;
    if (
      s.found[suitOf(card)] === rankOf(card) - 1 &&
      isSafeAuto(rankOf(card), suitOf(card), s.found)
    ) {
      return { f: LOC_FREECELL_BASE + i, t: LOC_FOUNDATION, n: 1 };
    }
  }
  return null;
};

/** All single-card wire moves from a state (used to reconstruct a move list). */
const movesFrom = (s: FreeCellState): FreeCellMove[] => {
  const out: FreeCellMove[] = [];
  const freeEmptyIdx = s.free.findIndex((c) => c === null);
  const emptyColIdx = s.cascades.findIndex((c) => c.length === 0);

  const dests = (card: number, from: number) => {
    const rank = rankOf(card);
    const suit = suitOf(card);
    if (s.found[suit] === rank - 1) out.push({ f: from, t: LOC_FOUNDATION, n: 1 });
    for (let c = 0; c < NUM_CASCADES; c += 1) {
      const col = s.cascades[c]!;
      if (col.length === 0) continue;
      if (from === c) continue;
      if (canStack(card, col[col.length - 1]!)) out.push({ f: from, t: c, n: 1 });
    }
    if (emptyColIdx >= 0 && from !== emptyColIdx) {
      out.push({ f: from, t: emptyColIdx, n: 1 });
    }
  };

  for (let c = 0; c < NUM_CASCADES; c += 1) {
    const col = s.cascades[c]!;
    if (col.length === 0) continue;
    const card = col[col.length - 1]!;
    dests(card, c);
    if (freeEmptyIdx >= 0) out.push({ f: c, t: LOC_FREECELL_BASE + freeEmptyIdx, n: 1 });
  }
  for (let i = 0; i < NUM_FREECELLS; i += 1) {
    const card = s.free[i];
    if (card === null || card === undefined) continue;
    dests(card, LOC_FREECELL_BASE + i);
  }
  return out;
};

export type SolveToMovesResult = {
  moves: FreeCellMove[] | null;
  nodes: number;
};

/**
 * Produce an explicit wire-move list that solves the deal (or null if not
 * proven within budget). Best-first with forced safe-autoplay recording. Used
 * by the client's auto-complete / hint and by the offline replay-parity proof
 * and the E2E bot — never on the score hot path.
 */
export const solveToMoves = (
  deal: number[][],
  budget = 400_000,
): SolveToMovesResult => {
  type Node = { state: FreeCellState; g: number; parent: number; move: FreeCellMove | null };
  const nodesArr: Node[] = [];
  const heap = new MinHeap<number>();
  const visited = new Set<string>();

  const start = initialState(deal);
  nodesArr.push({ state: start, g: 0, parent: -1, move: null });
  heap.push(heuristic(start), 0);
  visited.add(canonicalKey(start));

  let expanded = 0;
  while (heap.size > 0) {
    if (expanded >= budget) return { moves: null, nodes: expanded };
    const id = heap.pop()!;
    const node = nodesArr[id]!;
    expanded += 1;
    if (isWon(node.state)) {
      const moves: FreeCellMove[] = [];
      let cur = id;
      while (cur > 0) {
        const nd = nodesArr[cur]!;
        if (nd.move) moves.push(nd.move);
        cur = nd.parent;
      }
      moves.reverse();
      return { moves, nodes: expanded };
    }

    const safe = findSafeAutoMove(node.state);
    const candidateMoves = safe ? [safe] : movesFrom(node.state);
    for (const mv of candidateMoves) {
      const ns = applyMove(node.state, mv);
      if (!ns) continue;
      const key = canonicalKey(ns);
      if (visited.has(key)) continue;
      visited.add(key);
      const childId = nodesArr.length;
      nodesArr.push({ state: ns, g: node.g + 1, parent: id, move: mv });
      heap.push(node.g + 1 + 3 * heuristic(ns), childId);
    }
  }
  return { moves: null, nodes: expanded };
};

export type ResolvedDeal = {
  /** The final, proven-solvable deal (8 cascades, bottom-first). */
  deal: number[][];
  /** The effective seed used (base seed + k). */
  seed: number;
  /** How many re-derivations were needed (0 in ~all cases). */
  k: number;
  /** True only if no seed proved solvable within budget (never in practice). */
  fallback: boolean;
};

/**
 * Deterministically resolve a base seed to a proven-solvable deal. Loops
 * seed+k for k=0,1,2,… until the bounded solver proves solvability. Client and
 * server run the identical loop, so both converge on the same final deal.
 */
export const resolveDeal = (
  baseSeed: number,
  budget = FREECELL_SOLVER_NODE_BUDGET,
): ResolvedDeal => {
  for (let k = 0; k < MAX_REDERIVE; k += 1) {
    const seed = (((baseSeed % MOD) + MOD) % MOD + k) % MOD;
    const deal = dealFromSeed(seed);
    if (isSolvable(deal, budget).solved) {
      return { deal, seed, k, fallback: false };
    }
  }
  const seed = ((baseSeed % MOD) + MOD) % MOD;
  return { deal: dealFromSeed(seed), seed, k: 0, fallback: true };
};
