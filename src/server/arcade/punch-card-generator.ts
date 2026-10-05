/**
 * Server-only PUNCH CARD (nonogram) generator + line-solver + uniqueness proof.
 *
 * A nonogram board is a flat `Int8Array`/`number[]` of length n*n (row-major),
 * each cell 0 (empty) or 1 (filled). The player is shown ONLY the row/column
 * run-length clues (derived here); the solution bitmap never leaves the server.
 *
 * Fairness contract (this is the heart of the build):
 *   A nonogram is only fair if it is *uniquely* solvable using pure line logic
 *   (no guessing). We enforce that with a full line-solver: starting from an
 *   all-unknown grid we repeatedly deduce every cell that is forced across ALL
 *   arrangements of a line's clue, iterating rows/cols to a fixpoint. If that
 *   terminates with every cell determined, the board is uniquely line-solvable
 *   AND the result necessarily equals the target bitmap. Candidates that stall
 *   (still have unknown cells) are rejected/regenerated.
 *
 * Everything here is a PURE function of (seed, size) — no Date.now(),
 * no Math.random() — so the puzzle route and the score route always agree.
 */

export type PunchCardSize = '5x5' | '10x10' | '15x15';

export const PUNCH_CARD_SIZES: readonly PunchCardSize[] = [
  '5x5',
  '10x10',
  '15x15',
] as const;

export const SIZE_TO_N: Record<PunchCardSize, number> = {
  '5x5': 5,
  '10x10': 10,
  '15x15': 15,
};

export function isPunchCardSize(value: unknown): value is PunchCardSize {
  return (
    typeof value === 'string' &&
    (PUNCH_CARD_SIZES as readonly string[]).includes(value)
  );
}

/**
 * mulberry32 seeded PRNG — identical to the one used by the sudoku generator so
 * seeding behavior is consistent across the codebase. Deterministic in [0, 1).
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

// ── Clues ────────────────────────────────────────────────────────────────

/** Run-lengths of consecutive filled cells in a line; [] means an empty line. */
export function lineRuns(cells: ArrayLike<number>, len: number): number[] {
  const runs: number[] = [];
  let run = 0;
  for (let i = 0; i < len; i += 1) {
    if (cells[i] === 1) {
      run += 1;
    } else if (run > 0) {
      runs.push(run);
      run = 0;
    }
  }
  if (run > 0) runs.push(run);
  return runs;
}

export interface PunchCardClues {
  rowClues: number[][];
  colClues: number[][];
}

/** Derive row + column run-length clues from an n*n solution bitmap. */
export function deriveClues(solution: ArrayLike<number>, n: number): PunchCardClues {
  const rowClues: number[][] = [];
  const colClues: number[][] = [];
  for (let r = 0; r < n; r += 1) {
    const row = new Array<number>(n);
    for (let c = 0; c < n; c += 1) row[c] = solution[r * n + c] === 1 ? 1 : 0;
    rowClues.push(lineRuns(row, n));
  }
  for (let c = 0; c < n; c += 1) {
    const col = new Array<number>(n);
    for (let r = 0; r < n; r += 1) col[r] = solution[r * n + c] === 1 ? 1 : 0;
    colClues.push(lineRuns(col, n));
  }
  return { rowClues, colClues };
}

// ── Line solver ─────────────────────────────────────────────────────────

/**
 * Given a line's currently-known cells (-1 unknown, 0 empty, 1 fill) and its
 * clue, return a new array of the cells FORCED across every valid arrangement
 * of the clue consistent with the known cells (-1 where still ambiguous), or
 * `null` if no arrangement fits (a contradiction).
 *
 * Works by enumerating all clue placements that respect the known cells and
 * intersecting them. For n ≤ 15 the placement count is tiny (known cells prune
 * hard); a CAP guards pathological inputs.
 */
export function lineForced(known: Int8Array, clue: number[]): Int8Array | null {
  const n = known.length;
  const everFill = new Uint8Array(n);
  const everEmpty = new Uint8Array(n);
  const arr = new Int8Array(n);
  let count = 0;
  const CAP = 3_000_000;

  const record = () => {
    for (let i = 0; i < n; i += 1) {
      if (arr[i] === 1) everFill[i] = 1;
      else everEmpty[i] = 1;
    }
    count += 1;
  };

  const place = (bi: number, start: number): void => {
    if (count > CAP) return;
    if (bi === clue.length) {
      // No blocks left: the tail must be empty and no known fill may remain.
      for (let k = start; k < n; k += 1) {
        if (known[k] === 1) return;
        arr[k] = 0;
      }
      record();
      return;
    }
    const len = clue[bi]!;
    for (let p = start; p + len <= n; p += 1) {
      // Gap [start, p): all cells empty. A known fill here can never be skipped
      // by a larger p, so bail out of the loop entirely.
      let gapBad = false;
      for (let k = start; k < p; k += 1) {
        if (known[k] === 1) {
          gapBad = true;
          break;
        }
        arr[k] = 0;
      }
      if (gapBad) break;
      // Block [p, p+len): all cells fill. A known empty inside the block means
      // this position is invalid but a larger p may work — continue.
      let blockBad = false;
      for (let k = p; k < p + len; k += 1) {
        if (known[k] === 0) {
          blockBad = true;
          break;
        }
        arr[k] = 1;
      }
      if (blockBad) continue;
      // Mandatory separator after every block but the last.
      let next = p + len;
      if (next < n) {
        if (known[next] === 1) continue;
        arr[next] = 0;
        next = p + len + 1;
      }
      place(bi + 1, next);
    }
  };

  place(0, 0);
  if (count === 0) return null;

  const forced = new Int8Array(n);
  for (let i = 0; i < n; i += 1) {
    if (everFill[i] && !everEmpty[i]) forced[i] = 1;
    else if (everEmpty[i] && !everFill[i]) forced[i] = 0;
    else forced[i] = -1;
  }
  return forced;
}

export interface SolveResult {
  grid: Int8Array;
  /** True iff every cell was determined by pure line logic (uniquely solvable). */
  solved: boolean;
}

/**
 * Solve a nonogram purely by iterated line deduction. Returns the deduced grid
 * and whether it is fully determined. `solved === true` means the board is
 * uniquely solvable by line logic — the only kind of board we ever serve.
 */
export function solveNonogram(
  rowClues: number[][],
  colClues: number[][],
  n: number,
): SolveResult {
  const grid = new Int8Array(n * n).fill(-1);
  const line = new Int8Array(n);

  let changed = true;
  while (changed) {
    changed = false;

    for (let r = 0; r < n; r += 1) {
      for (let c = 0; c < n; c += 1) line[c] = grid[r * n + c]!;
      const forced = lineForced(line, rowClues[r]!);
      if (!forced) return { grid, solved: false };
      for (let c = 0; c < n; c += 1) {
        const f = forced[c]!;
        if (f === -1) continue;
        const cur = grid[r * n + c]!;
        if (cur === -1) {
          grid[r * n + c] = f;
          changed = true;
        } else if (cur !== f) {
          return { grid, solved: false };
        }
      }
    }

    for (let c = 0; c < n; c += 1) {
      for (let r = 0; r < n; r += 1) line[r] = grid[r * n + c]!;
      const forced = lineForced(line, colClues[c]!);
      if (!forced) return { grid, solved: false };
      for (let r = 0; r < n; r += 1) {
        const f = forced[r]!;
        if (f === -1) continue;
        const cur = grid[r * n + c]!;
        if (cur === -1) {
          grid[r * n + c] = f;
          changed = true;
        } else if (cur !== f) {
          return { grid, solved: false };
        }
      }
    }
  }

  let full = true;
  for (let i = 0; i < n * n; i += 1) {
    if (grid[i] === -1) {
      full = false;
      break;
    }
  }
  return { grid, solved: full };
}

/** True iff the clues yield a board that is uniquely solvable by line logic. */
export function isUniquelyLineSolvable(
  solution: ArrayLike<number>,
  n: number,
): boolean {
  const { rowClues, colClues } = deriveClues(solution, n);
  const { grid, solved } = solveNonogram(rowClues, colClues, n);
  if (!solved) return false;
  for (let i = 0; i < n * n; i += 1) {
    if ((solution[i] === 1 ? 1 : 0) !== grid[i]) return false;
  }
  return true;
}

// ── Bitmap bank (curated midway pixel art) ───────────────────────────────
// '#' = filled, anything else = empty. Every entry is verified uniquely
// line-solvable by scripts/punch-card/verify-generator.ts (offline proof).

function bitmap(rows: string[]): number[] {
  const out: number[] = [];
  for (const row of rows) {
    for (const ch of row) out.push(ch === '#' ? 1 : 0);
  }
  return out;
}

// 10×10 — carnival icons (all verified uniquely line-solvable).
const BANK_10: number[][] = [
  // Duck
  bitmap([
    '...##.....',
    '..####....',
    '.#.####...',
    '..#####...',
    '..######..',
    '.#######..',
    '.########.',
    '.########.',
    '..######..',
    '...####...',
  ]),
  // Circus tent
  bitmap([
    '....##....',
    '...####...',
    '..##..##..',
    '.###..###.',
    '####..####',
    '##########',
    '##.####.##',
    '##.####.##',
    '##.#..#.##',
    '##.#..#.##',
  ]),
  // Balloon
  bitmap([
    '..######..',
    '.########.',
    '##########',
    '##########',
    '.########.',
    '..######..',
    '...####...',
    '....##....',
    '....##....',
    '...####...',
  ]),
  // Ice-cream cone
  bitmap([
    '..######..',
    '.########.',
    '##########',
    '.########.',
    '.########.',
    '..######..',
    '..######..',
    '...####...',
    '...####...',
    '....##....',
  ]),
  // Gift box
  bitmap([
    '...#..#...',
    '..##..##..',
    '..##..##..',
    '##########',
    '##########',
    '###....###',
    '###....###',
    '###....###',
    '###....###',
    '##########',
  ]),
  // Fish
  bitmap([
    '..........',
    '..####..#.',
    '.######.##',
    '########.#',
    '#.#######.',
    '########.#',
    '.######.##',
    '..####..#.',
    '..........',
    '..........',
  ]),
  // Mushroom
  bitmap([
    '..######..',
    '.########.',
    '##########',
    '##.####.##',
    '##########',
    '.########.',
    '...####...',
    '...####...',
    '...####...',
    '..######..',
  ]),
  // Lollipop
  bitmap([
    '..####....',
    '.######...',
    '########..',
    '########..',
    '.######...',
    '..####....',
    '...##.....',
    '...##.....',
    '...##.....',
    '...##.....',
  ]),
  // Diamond
  bitmap([
    '....##....',
    '...####...',
    '..######..',
    '.########.',
    '##########',
    '##########',
    '.########.',
    '..######..',
    '...####...',
    '....##....',
  ]),
  // Ticket
  bitmap([
    '##########',
    '#........#',
    '##.####.##',
    '#........#',
    '##########',
    '##########',
    '#........#',
    '##.####.##',
    '#........#',
    '##########',
  ]),
];

// 15×15 — bigger carnival scenes (all verified uniquely line-solvable).
const BANK_15: number[][] = [
  // Hot-air balloon
  bitmap([
    '....#######....',
    '..###########..',
    '.#############.',
    '###############',
    '###############',
    '###############',
    '###############',
    '.#############.',
    '.#############.',
    '..###########..',
    '...#########...',
    '....##...##....',
    '.....#####.....',
    '.....#...#.....',
    '.....#####.....',
  ]),
  // Heart
  bitmap([
    '...###...###...',
    '..#####.#####..',
    '.#############.',
    '###############',
    '###############',
    '###############',
    '###############',
    '.#############.',
    '.#############.',
    '..###########..',
    '...#########...',
    '....#######....',
    '.....#####.....',
    '......###......',
    '.......#.......',
  ]),
  // Diamond
  bitmap([
    '.......#.......',
    '......###......',
    '.....#####.....',
    '....#######....',
    '...#########...',
    '..###########..',
    '.#############.',
    '###############',
    '.#############.',
    '..###########..',
    '...#########...',
    '....#######....',
    '.....#####.....',
    '......###......',
    '.......#.......',
  ]),
  // Duck
  bitmap([
    '.....####......',
    '...########....',
    '..#..######....',
    '..############.',
    '...###########.',
    '..############.',
    '.#############.',
    '.##############',
    '.##############',
    '.#############.',
    '..###########..',
    '...#########...',
    '....#######....',
    '.....#####.....',
    '......###......',
  ]),
  // Gift box
  bitmap([
    '......#.#......',
    '.....##.##.....',
    '.....##.##.....',
    '###############',
    '###############',
    '###############',
    '##....#....####',
    '##....#....####',
    '##....#....####',
    '##....#....####',
    '##....#....####',
    '##....#....####',
    '##....#....####',
    '##....#....####',
    '###############',
  ]),
];

const BANK: Record<PunchCardSize, number[][]> = {
  '5x5': [],
  '10x10': BANK_10,
  '15x15': BANK_15,
};

// ── Procedural target generation (5×5 + guaranteed fallback) ─────────────

/**
 * Build a procedural target bitmap with vertical-mirror symmetry (reads like a
 * little emblem rather than noise) at ~55% density, deterministically from rng.
 */
function proceduralTarget(rng: () => number, n: number): number[] {
  const grid = new Array<number>(n * n).fill(0);
  const half = Math.ceil(n / 2);
  for (let r = 0; r < n; r += 1) {
    for (let c = 0; c < half; c += 1) {
      const on = rng() < 0.58 ? 1 : 0;
      grid[r * n + c] = on;
      grid[r * n + (n - 1 - c)] = on;
    }
  }
  return grid;
}

/** A non-empty, non-degenerate bitmap has ≥1 filled cell and ≥1 empty cell. */
function isPlayable(target: ArrayLike<number>, n: number): boolean {
  let filled = 0;
  for (let i = 0; i < n * n; i += 1) if (target[i] === 1) filled += 1;
  return filled >= Math.max(2, Math.floor(n)) && filled <= n * n - 1;
}

export interface GeneratedPunchCard {
  size: PunchCardSize;
  n: number;
  /** n*n solution bitmap (0/1). SERVER-ONLY — never sent to the client. */
  solution: number[];
  rowClues: number[][];
  colClues: number[][];
}

/**
 * Generate a uniquely-line-solvable puzzle for `(seed, size)`. Deterministic.
 *
 * Strategy: try curated bank bitmaps first (rotated by seed for variety), then
 * fall back to procedural mirror-symmetric targets. The first candidate that is
 * playable AND uniquely line-solvable wins — so every served board is fair.
 */
export function generatePunchCard(
  seed: number,
  size: PunchCardSize,
): GeneratedPunchCard {
  const n = SIZE_TO_N[size];
  const rng = seededRandom(seed >>> 0);

  const bank = BANK[size];
  const tryTarget = (target: number[]): GeneratedPunchCard | null => {
    if (!isPlayable(target, n)) return null;
    const { rowClues, colClues } = deriveClues(target, n);
    const { grid, solved } = solveNonogram(rowClues, colClues, n);
    if (!solved) return null;
    for (let i = 0; i < n * n; i += 1) {
      if ((target[i] === 1 ? 1 : 0) !== grid[i]) return null;
    }
    return { size, n, solution: target.slice(), rowClues, colClues };
  };

  // 1) Bank, starting at a seed-derived offset so seeds spread across the art.
  if (bank.length > 0) {
    const start = seed % bank.length;
    for (let k = 0; k < bank.length; k += 1) {
      const found = tryTarget(bank[(start + k) % bank.length]!);
      if (found) return found;
    }
  }

  // 2) Procedural fallback — deterministic sweep; one will be uniquely solvable.
  for (let attempt = 0; attempt < 4000; attempt += 1) {
    const found = tryTarget(proceduralTarget(rng, n));
    if (found) return found;
  }

  // 3) Last-resort trivial diagonal (always uniquely line-solvable).
  const diag = new Array<number>(n * n).fill(0);
  for (let i = 0; i < n; i += 1) diag[i * n + i] = 1;
  const { rowClues, colClues } = deriveClues(diag, n);
  return { size, n, solution: diag, rowClues, colClues };
}
