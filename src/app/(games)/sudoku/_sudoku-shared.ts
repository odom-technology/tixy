/**
 * Client-side Sudoku UI helpers (pure). The board is a flat number[] of length
 * 81 (row-major), 0 = empty. These only support the local UI — the AUTHORITATIVE
 * generation + validation live server-side in
 * `@/server/arcade/sudoku-generator` (the solution never reaches the client).
 */

export type SudokuDifficulty = 'easy' | 'medium' | 'hard' | 'expert' | 'evil';

export const SUDOKU_DIFFICULTIES: readonly SudokuDifficulty[] = [
  'easy',
  'medium',
  'hard',
  'expert',
  'evil',
] as const;

export const DIFFICULTY_LABELS: Record<SudokuDifficulty, string> = {
  easy: 'Easy',
  medium: 'Medium',
  hard: 'Hard',
  expert: 'Expert',
  evil: 'Evil',
};

export const rowOf = (i: number) => Math.floor(i / 9);
export const colOf = (i: number) => i % 9;
export const boxOf = (i: number) =>
  Math.floor(rowOf(i) / 3) * 3 + Math.floor(colOf(i) / 3);

/** Indices that share a row, column, or box with `i` (excluding `i`). */
export function peersOf(i: number): number[] {
  const peers: number[] = [];
  const r = rowOf(i);
  const c = colOf(i);
  const br = Math.floor(r / 3) * 3;
  const bc = Math.floor(c / 3) * 3;
  for (let k = 0; k < 9; k += 1) {
    const rowIdx = r * 9 + k;
    const colIdx = k * 9 + c;
    if (rowIdx !== i) peers.push(rowIdx);
    if (colIdx !== i) peers.push(colIdx);
  }
  for (let dr = 0; dr < 3; dr += 1) {
    for (let dc = 0; dc < 3; dc += 1) {
      const idx = (br + dr) * 9 + (bc + dc);
      if (idx !== i) peers.push(idx);
    }
  }
  return peers;
}

/**
 * Returns the set of indices that are in conflict — any cell whose non-zero
 * value duplicates another non-zero value in the same row, column, or box.
 */
export function findConflicts(board: readonly number[]): Set<number> {
  const conflicts = new Set<number>();
  const scan = (group: number[]) => {
    const seen = new Map<number, number[]>();
    for (const idx of group) {
      const v = board[idx]!;
      if (v === 0) continue;
      const list = seen.get(v);
      if (list) list.push(idx);
      else seen.set(v, [idx]);
    }
    for (const list of seen.values()) {
      if (list.length > 1) for (const idx of list) conflicts.add(idx);
    }
  };
  for (let r = 0; r < 9; r += 1) {
    const row: number[] = [];
    for (let c = 0; c < 9; c += 1) row.push(r * 9 + c);
    scan(row);
  }
  for (let c = 0; c < 9; c += 1) {
    const col: number[] = [];
    for (let r = 0; r < 9; r += 1) col.push(r * 9 + c);
    scan(col);
  }
  for (let b = 0; b < 9; b += 1) {
    const box: number[] = [];
    const br = Math.floor(b / 3) * 3;
    const bc = (b % 3) * 3;
    for (let dr = 0; dr < 3; dr += 1) {
      for (let dc = 0; dc < 3; dc += 1) box.push((br + dr) * 9 + (bc + dc));
    }
    scan(box);
  }
  return conflicts;
}

/** True iff every cell is filled (1-9) — does not check correctness. */
export function isBoardFull(board: readonly number[]): boolean {
  for (let i = 0; i < 81; i += 1) {
    if (!board[i]) return false;
  }
  return true;
}

/** Remaining count for each digit 1..9 (9 minus how many are placed). */
export function remainingCounts(board: readonly number[]): number[] {
  const placed = new Array<number>(10).fill(0);
  for (let i = 0; i < 81; i += 1) {
    const v = board[i]!;
    if (v >= 1 && v <= 9) placed[v]! += 1;
  }
  const remaining = new Array<number>(10).fill(0);
  for (let d = 1; d <= 9; d += 1) remaining[d] = Math.max(0, 9 - placed[d]!);
  return remaining;
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

/**
 * Validates the shape of a puzzle response's `givens` array: 81 integers 0..9.
 * Returns a fresh number[] or null.
 */
export function parseGivens(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length !== 81) return null;
  const out = new Array<number>(81);
  for (let i = 0; i < 81; i += 1) {
    const v = value[i];
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 9) {
      return null;
    }
    out[i] = v;
  }
  return out;
}
