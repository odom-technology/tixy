/**
 * Server-authoritative, seed-deterministic Minesweeper engine (pure).
 *
 * Anti-cheat contract (mirrors the Sudoku generator):
 *  - The board (mine layout) is a pure function of (seed, difficulty) — no
 *    Date.now(), no Math.random() — so the puzzle route, the client, and the
 *    score route always derive the IDENTICAL board.
 *  - Integrity does NOT come from hiding the mines (the seed reaches the client
 *    so it can play). It comes from the score route regenerating the board and
 *    verifying the submitted "full safe clear" proof — the exact set of revealed
 *    cells must equal ALL non-mine cells — plus the server-measured solve time.
 *
 * Board layout: a flat index space `0 .. rows*cols - 1`, row-major. Cell `i`
 * lives at row `floor(i / cols)`, column `i % cols`.
 *
 * First-click-safe: a seed-determined `firstSafeCell` and its (up to) 8
 * neighbors are reserved as guaranteed non-mines BEFORE mines are placed. Since
 * every neighbor of `firstSafeCell` is reserved, its adjacency count is 0, so
 * opening it always flood-fills a region (a real, non-trivial opening move).
 */

export type MinesweeperDifficulty = 'beginner' | 'intermediate' | 'expert';

export const MINESWEEPER_DIFFICULTIES: readonly MinesweeperDifficulty[] = [
  'beginner',
  'intermediate',
  'expert',
] as const;

export interface MinesweeperBoardConfig {
  rows: number;
  cols: number;
  /** Number of mines placed on the board. */
  mines: number;
}

/**
 * The three classic tiers. `expert` is the standard 16×30 (rows×cols) board.
 */
export const MINESWEEPER_CONFIG: Record<
  MinesweeperDifficulty,
  MinesweeperBoardConfig
> = {
  beginner: { rows: 9, cols: 9, mines: 10 },
  intermediate: { rows: 16, cols: 16, mines: 40 },
  expert: { rows: 16, cols: 30, mines: 99 },
};

/** Maximum allowed solve time in ms (1 hour) — anything above is rejected. */
export const MINESWEEPER_MAX_SOLVE_MS = 3_600_000;

export function isMinesweeperDifficulty(
  value: unknown,
): value is MinesweeperDifficulty {
  return (
    typeof value === 'string' &&
    (MINESWEEPER_DIFFICULTIES as readonly string[]).includes(value)
  );
}

/**
 * Simple seeded PRNG (mulberry32) — identical implementation to the one used by
 * the Sudoku/typing generators, so seeding behavior is consistent codebase-wide.
 * Deterministic 32-bit-seeded pseudo-random in [0, 1).
 */
function seededRandom(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic Fisher–Yates shuffle of a copied array. */
function shuffled<T>(arr: readonly T[], rng: () => number): T[] {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
  return out;
}

/**
 * The (up to 8) orthogonal+diagonal neighbor indices of `index` on a
 * `rows × cols` grid. Pure; order is deterministic (row-major).
 */
export function neighborsOf(
  index: number,
  rows: number,
  cols: number,
): number[] {
  const r = Math.floor(index / cols);
  const c = index % cols;
  const out: number[] = [];
  for (let dr = -1; dr <= 1; dr += 1) {
    for (let dc = -1; dc <= 1; dc += 1) {
      if (dr === 0 && dc === 0) continue;
      const nr = r + dr;
      const nc = c + dc;
      if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
      out.push(nr * cols + nc);
    }
  }
  return out;
}

export interface GeneratedMinesweeper {
  difficulty: MinesweeperDifficulty;
  rows: number;
  cols: number;
  mineCount: number;
  /** Total cells = rows * cols. */
  total: number;
  /** Guaranteed-safe opening cell (and its neighbors) — see first-click-safe. */
  firstSafeCell: number;
  /** Sorted ascending mine indices. SERVER + client agree (derived from seed). */
  mines: number[];
  /** Fast membership set over `mines`. */
  mineSet: Set<number>;
  /** Per-cell count of adjacent mines (length `total`). */
  adjacency: number[];
}

/**
 * Generates the deterministic board for `(seed, difficulty)`.
 *
 * Deterministic order of RNG draws (so client + server agree byte-for-byte):
 *   1. `firstSafeCell = floor(rng() * total)`
 *   2. shuffle the non-reserved candidate cells; take the first `mineCount`.
 */
export function generateMinesweeper(
  seed: number,
  difficulty: MinesweeperDifficulty,
): GeneratedMinesweeper {
  const cfg = MINESWEEPER_CONFIG[difficulty];
  const { rows, cols } = cfg;
  const mineCount = cfg.mines;
  const total = rows * cols;

  const rng = seededRandom(seed >>> 0);

  // (1) Seed-determined guaranteed-safe opening cell.
  const firstSafeCell = Math.floor(rng() * total) % total;

  // Reserve the opening cell + its neighbors as guaranteed non-mines.
  const reserved = new Set<number>([firstSafeCell]);
  for (const n of neighborsOf(firstSafeCell, rows, cols)) reserved.add(n);

  // (2) Candidate cells = everything not reserved, shuffled; first N are mines.
  const candidates: number[] = [];
  for (let i = 0; i < total; i += 1) {
    if (!reserved.has(i)) candidates.push(i);
  }
  const order = shuffled(candidates, rng);
  const mines = order.slice(0, mineCount).sort((a, b) => a - b);
  const mineSet = new Set(mines);

  // Adjacency counts.
  const adjacency = new Array<number>(total).fill(0);
  for (const m of mines) {
    for (const n of neighborsOf(m, rows, cols)) {
      adjacency[n] = (adjacency[n] ?? 0) + 1;
    }
  }

  return {
    difficulty,
    rows,
    cols,
    mineCount,
    total,
    firstSafeCell,
    mines,
    mineSet,
    adjacency,
  };
}

/**
 * Flood-reveal from `start` (a safe cell): reveals `start` and, when a revealed
 * cell has zero adjacent mines, cascades to all of its neighbors. Mines are
 * never revealed. Returns the list of revealed cell indices.
 *
 * Pure + deterministic given the generated board. Used client-side to expand
 * an opening; the server only ever checks the FINAL full-clear set.
 */
export function floodReveal(
  generated: GeneratedMinesweeper,
  start: number,
): number[] {
  const { rows, cols, mineSet, adjacency } = generated;
  if (start < 0 || start >= generated.total) return [];
  if (mineSet.has(start)) return [];

  const revealed = new Set<number>();
  const stack: number[] = [start];
  while (stack.length > 0) {
    const cell = stack.pop()!;
    if (revealed.has(cell)) continue;
    if (mineSet.has(cell)) continue;
    revealed.add(cell);
    if ((adjacency[cell] ?? 0) === 0) {
      for (const n of neighborsOf(cell, rows, cols)) {
        if (!revealed.has(n) && !mineSet.has(n)) stack.push(n);
      }
    }
  }
  return [...revealed];
}

/**
 * Sanitizes an unknown client payload into a clean `number[]` of unique integer
 * cell indices in `[0, total)`, or null if the shape is wrong. Caps the length
 * at `total` so an oversized payload can't be used to exhaust memory.
 */
export function normalizeRevealedCells(
  value: unknown,
  total: number,
): number[] | null {
  if (!Array.isArray(value)) return null;
  if (value.length > total) return null;
  const out: number[] = [];
  for (const v of value) {
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v >= total) {
      return null;
    }
    out.push(v);
  }
  return out;
}

/**
 * True iff `revealedCells` is exactly the set of ALL non-mine cells:
 *   (a) every revealed index is in range and is NOT a mine, AND
 *   (b) the count of distinct revealed cells equals (total - mineCount).
 *
 * Because (a) restricts the set to in-range non-mine cells and there are exactly
 * `total - mineCount` of those, (a)+(b) imply the revealed set equals every
 * safe cell — a complete, mine-free clear.
 */
export function isFullSafeClear(
  generated: GeneratedMinesweeper,
  revealedCells: readonly number[],
): boolean {
  const safeCount = generated.total - generated.mineCount;
  const seen = new Set<number>();
  for (const c of revealedCells) {
    if (!Number.isInteger(c) || c < 0 || c >= generated.total) return false;
    if (generated.mineSet.has(c)) return false;
    seen.add(c);
  }
  return seen.size === safeCount;
}
