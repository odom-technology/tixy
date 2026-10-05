/**
 * Client-side Minesweeper helpers. The deterministic board engine lives in the
 * canonical, dependency-free module `@/server/arcade/minesweeper-generator`
 * (a pure module with no server-only imports), so the client derives the EXACT
 * same board the server will regenerate to verify the solve. This file just
 * re-exports the engine pieces the UI needs plus a few presentation helpers.
 */

export {
  MINESWEEPER_DIFFICULTIES,
  MINESWEEPER_CONFIG,
  generateMinesweeper,
  floodReveal,
  neighborsOf,
  isFullSafeClear,
  isMinesweeperDifficulty,
  type MinesweeperDifficulty,
  type GeneratedMinesweeper,
  type MinesweeperBoardConfig,
} from '@/server/arcade/minesweeper-generator';

import type { MinesweeperDifficulty } from '@/server/arcade/minesweeper-generator';

export const DIFFICULTY_LABELS: Record<MinesweeperDifficulty, string> = {
  beginner: 'Beginner',
  intermediate: 'Intermediate',
  expert: 'Expert',
};

/** Short "9×9 · 10" style descriptor for a difficulty. */
export const DIFFICULTY_SUBLABELS: Record<MinesweeperDifficulty, string> = {
  beginner: '9×9 · 10 mines',
  intermediate: '16×16 · 40 mines',
  expert: '16×30 · 99 mines',
};

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

/** The warm Midway 1–8 number ramp keyed by adjacent-mine count. Mirrors the
    [data-adj] colors in _minesweeper-midway.css; distinguishable by lightness
    and weight, not hue alone. */
export const ADJACENCY_COLORS: Record<number, string> = {
  1: '#2f5aa8',
  2: '#2f7d38',
  3: '#c23a29',
  4: '#7a3f9c',
  5: '#9a5a1a',
  6: '#16756b',
  7: '#3a2a1a',
  8: '#6b5238',
};
