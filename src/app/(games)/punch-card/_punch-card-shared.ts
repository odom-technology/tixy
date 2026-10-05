/**
 * Client-side PUNCH CARD (nonogram) UI helpers (pure). The board is a flat
 * cell-state array of length n*n (row-major). The AUTHORITATIVE generation +
 * scoring live server-side (`@/server/arcade/punch-card-*`); the solution bitmap
 * never reaches the client. The client only knows the row/column clues and
 * detects a solve when its fills satisfy every clue.
 */

export type PunchCardSize = '5x5' | '10x10' | '15x15';

export const PUNCH_CARD_SIZES: readonly PunchCardSize[] = [
  '5x5',
  '10x10',
  '15x15',
] as const;

export const SIZE_LABELS: Record<PunchCardSize, string> = {
  '5x5': 'Blitz 5×5',
  '10x10': 'Ranked 10×10',
  '15x15': 'Marathon 15×15',
};

export const SIZE_SHORT_LABELS: Record<PunchCardSize, string> = {
  '5x5': '5×5',
  '10x10': '10×10',
  '15x15': '15×15',
};

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

/** Cell UI state: 0 unmarked, 1 filled, 2 X-marked (known empty). */
export type CellState = 0 | 1 | 2;

/** Event action codes matching the server replay module. */
export const ACTION_FILL = 0;
export const ACTION_X = 1;
export const ACTION_CLEAR = 2;

/** Compact event tuple `[t, cellIndex, action]` streamed to the score route. */
export type MarkEvent = [number, number, 0 | 1 | 2];

export const rowOf = (i: number, n: number) => Math.floor(i / n);
export const colOf = (i: number, n: number) => i % n;

/** Run-lengths of consecutive filled (state === 1) cells in a line. */
export function lineRuns(states: number[], filledValue = 1): number[] {
  const runs: number[] = [];
  let run = 0;
  for (const s of states) {
    if (s === filledValue) {
      run += 1;
    } else if (run > 0) {
      runs.push(run);
      run = 0;
    }
  }
  if (run > 0) runs.push(run);
  return runs;
}

/** True iff the filled cells of a line exactly satisfy its run-length clue. */
export function lineMatches(states: number[], clue: number[]): boolean {
  const runs = lineRuns(states);
  if (runs.length !== clue.length) return false;
  for (let i = 0; i < runs.length; i += 1) if (runs[i] !== clue[i]) return false;
  return true;
}

/**
 * True iff the whole board satisfies every row AND column clue — i.e. it is the
 * (unique) solution. Because served boards are uniquely line-solvable, matching
 * all clues is equivalent to matching the hidden solution bitmap.
 */
export function isBoardSolved(
  board: number[],
  rowClues: number[][],
  colClues: number[][],
  n: number,
): boolean {
  for (let r = 0; r < n; r += 1) {
    const row = new Array<number>(n);
    for (let c = 0; c < n; c += 1) row[c] = board[r * n + c] === 1 ? 1 : 0;
    if (!lineMatches(row, rowClues[r] ?? [])) return false;
  }
  for (let c = 0; c < n; c += 1) {
    const col = new Array<number>(n);
    for (let r = 0; r < n; r += 1) col[r] = board[r * n + c] === 1 ? 1 : 0;
    if (!lineMatches(col, colClues[c] ?? [])) return false;
  }
  return true;
}

/** Count of filled cells still required by the clues (total minus placed). */
export function fillsRemaining(board: number[], rowClues: number[][]): number {
  let need = 0;
  for (const clue of rowClues) for (const run of clue) need += run;
  let have = 0;
  for (const s of board) if (s === 1) have += 1;
  return Math.max(0, need - have);
}

/** Format milliseconds as M:SS (or H:MM:SS past an hour). */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** Validate a clue payload: an array of n arrays of positive integers. */
export function parseClues(value: unknown, n: number): number[][] | null {
  if (!Array.isArray(value) || value.length !== n) return null;
  const out: number[][] = [];
  for (const line of value) {
    if (!Array.isArray(line)) return null;
    const clue: number[] = [];
    for (const v of line) {
      if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > n) {
        return null;
      }
      clue.push(v);
    }
    out.push(clue);
  }
  return out;
}
