import { pickSpawn } from '@/server/arcade/game-2048-replay';
import type { Direction, Tile } from './_2048-types';

export const GRID_SIZE = 4;
const WIN_TILE = 2048;

/** The run's reward note while signed out. The result checks for this exact value. */
export const GUEST_RUN_MESSAGE = 'Sign in to save scores and earn tickets.';

export const REWARDS_HINT_TEXT =
  'Rewards hint: score 1k = ~10 Tickets | score 3k = ~30 Tickets | rewards taper at higher scores (daily cap 200).';

export const getSubmitErrorMessage = (
  status: number,
  data: { error?: string; details?: string; retryAfterSec?: number } | null,
) => {
  if (status === 429) {
    const retry =
      typeof data?.retryAfterSec === 'number'
        ? ` Try again in ${data.retryAfterSec}s.`
        : '';
    return `${data?.error ?? 'Too many runs.'}${retry}`;
  }
  if (typeof data?.details === 'string' && data.details.trim()) {
    return data.details;
  }
  if (typeof data?.error === 'string' && data.error.trim()) {
    return data.error;
  }
  return 'Could not save your run. Try again.';
};

export type Game2048State = {
  tiles: Tile[];
  score: number;
  highestTile: number;
  nextId: number;
};

const tilesToGrid = (tiles: Tile[]): Array<Array<Tile | null>> => {
  const grid: Array<Array<Tile | null>> = Array.from({ length: GRID_SIZE }, () =>
    Array<Tile | null>(GRID_SIZE).fill(null),
  );
  for (const t of tiles) {
    if (t.row >= 0 && t.row < GRID_SIZE && t.col >= 0 && t.col < GRID_SIZE) {
      grid[t.row][t.col] = t;
    }
  }
  return grid;
};

const cloneTile = (t: Tile): Tile => ({
  id: t.id,
  value: t.value,
  row: t.row,
  col: t.col,
});

const emptyCellsFromTiles = (tiles: Tile[]): Array<[number, number]> => {
  const occupied = new Set<string>();
  for (const t of tiles) occupied.add(`${t.row},${t.col}`);
  const out: Array<[number, number]> = [];
  for (let r = 0; r < GRID_SIZE; r++) {
    for (let c = 0; c < GRID_SIZE; c++) {
      if (!occupied.has(`${r},${c}`)) out.push([r, c]);
    }
  }
  return out;
};

/**
 * Picks an empty cell and returns a new tile (value 2 90% of the time, 4 the
 * other 10%) without mutating the input. Returns null if no space. `next` is
 * the draw: a run's seeded stream (the score route replays it, see
 * game-2048-replay.ts) or Math.random for a board nobody scores.
 */
export const spawnTile = (
  tiles: Tile[],
  nextId: number,
  next: () => number = Math.random,
): { tile: Tile | null; nextId: number } => {
  const empty = emptyCellsFromTiles(tiles);
  if (empty.length === 0) return { tile: null, nextId };
  const pick = pickSpawn(empty.length, next);
  const [row, col] = empty[pick.index];
  return {
    tile: { id: nextId, value: pick.value, row, col, spawned: true },
    nextId: nextId + 1,
  };
};

export const createInitialState = (next: () => number = Math.random): Game2048State => {
  let nextId = 1;
  const tiles: Tile[] = [];
  for (let i = 0; i < 2; i++) {
    const spawn = spawnTile(tiles, nextId, next);
    if (spawn.tile) {
      tiles.push({ ...spawn.tile, spawned: false });
      nextId = spawn.nextId;
    }
  }
  return {
    tiles,
    score: 0,
    highestTile: Math.max(...tiles.map((t) => t.value), 0),
    nextId,
  };
};

/**
 * Slides a single line of up-to-GRID_SIZE tiles toward index 0 (left).
 * Returns the new line (with merged tiles carrying `merged: true` and
 * their new value) and the score gained on this line.
 */
const slideLineLeft = (line: Array<Tile | null>): {
  line: Array<Tile | null>;
  gained: number;
} => {
  // Compact: drop nulls, keep tile order.
  const compact = line.filter((t): t is Tile => t !== null).map(cloneTile);
  const out: Array<Tile | null> = Array<Tile | null>(GRID_SIZE).fill(null);
  let gained = 0;
  let writeIdx = 0;
  let i = 0;
  while (i < compact.length) {
    const current = compact[i];
    const next = compact[i + 1];
    if (next && next.value === current.value) {
      // Merge into current. Keep `current`'s id as the surviving tile so its
      // position animates from its old spot to writeIdx; the consumed `next`
      // is discarded from the output (it will unmount after the transition).
      const mergedValue = current.value * 2;
      out[writeIdx] = {
        ...current,
        value: mergedValue,
        col: writeIdx,
        merged: true,
      };
      gained += mergedValue;
      i += 2;
    } else {
      out[writeIdx] = { ...current, col: writeIdx };
      i += 1;
    }
    writeIdx += 1;
  }
  return { line: out, gained };
};

const rowOfTiles = (
  grid: Array<Array<Tile | null>>,
  r: number,
): Array<Tile | null> => grid[r].slice();

const colOfTiles = (
  grid: Array<Array<Tile | null>>,
  c: number,
): Array<Tile | null> => grid.map((row) => row[c]);

/**
 * Applies a move in the given direction and returns the resulting state.
 * Tiles keep their ids so the client can animate sliding; merged tiles
 * carry `merged: true`. Caller must append any spawned tile separately
 * (see `spawnTile`) after the slide transition completes.
 */
export const moveTiles = (
  state: Game2048State,
  direction: Direction,
): { state: Game2048State; moved: boolean } => {
  // Clear stale spawn/merge flags on input tiles.
  const cleanTiles = state.tiles.map((t) => ({
    id: t.id,
    value: t.value,
    row: t.row,
    col: t.col,
  }));
  const grid = tilesToGrid(cleanTiles);
  const out: Array<Array<Tile | null>> = Array.from({ length: GRID_SIZE }, () =>
    Array<Tile | null>(GRID_SIZE).fill(null),
  );
  let gained = 0;

  const writeRow = (r: number, line: Array<Tile | null>) => {
    for (let c = 0; c < GRID_SIZE; c++) {
      const tile = line[c];
      if (tile) out[r][c] = { ...tile, row: r, col: c };
    }
  };
  const writeCol = (c: number, line: Array<Tile | null>) => {
    for (let r = 0; r < GRID_SIZE; r++) {
      const tile = line[r];
      if (tile) out[r][c] = { ...tile, row: r, col: c };
    }
  };

  if (direction === 'LEFT') {
    for (let r = 0; r < GRID_SIZE; r++) {
      const { line, gained: g } = slideLineLeft(rowOfTiles(grid, r));
      writeRow(r, line);
      gained += g;
    }
  } else if (direction === 'RIGHT') {
    for (let r = 0; r < GRID_SIZE; r++) {
      const reversed = rowOfTiles(grid, r).slice().reverse();
      const { line, gained: g } = slideLineLeft(reversed);
      writeRow(r, line.slice().reverse());
      gained += g;
    }
  } else if (direction === 'UP') {
    for (let c = 0; c < GRID_SIZE; c++) {
      const { line, gained: g } = slideLineLeft(colOfTiles(grid, c));
      writeCol(c, line);
      gained += g;
    }
  } else {
    for (let c = 0; c < GRID_SIZE; c++) {
      const reversed = colOfTiles(grid, c).slice().reverse();
      const { line, gained: g } = slideLineLeft(reversed);
      writeCol(c, line.slice().reverse());
      gained += g;
    }
  }

  const outTiles: Tile[] = [];
  for (let r = 0; r < GRID_SIZE; r++) {
    for (let c = 0; c < GRID_SIZE; c++) {
      const t = out[r][c];
      if (t) outTiles.push(t);
    }
  }

  // A move counts as "moved" if any tile ended up in a different position
  // OR a merge happened (which could leave positions identical when the
  // matched pair was already at the edge).
  const moved =
    outTiles.some((t) => t.merged) ||
    outTiles.some((t) => {
      const prev = state.tiles.find((p) => p.id === t.id);
      return !prev || prev.row !== t.row || prev.col !== t.col;
    }) ||
    outTiles.length !== state.tiles.length;

  const highestTile = outTiles.reduce(
    (max, t) => (t.value > max ? t.value : max),
    state.highestTile,
  );

  return {
    state: {
      tiles: outTiles,
      score: state.score + gained,
      highestTile,
      nextId: state.nextId,
    },
    moved,
  };
};

export const hasLegalMove = (state: Game2048State): boolean => {
  if (state.tiles.length < GRID_SIZE * GRID_SIZE) return true;
  const grid = tilesToGrid(state.tiles);
  for (let r = 0; r < GRID_SIZE; r++) {
    for (let c = 0; c < GRID_SIZE; c++) {
      const t = grid[r][c];
      if (!t) return true;
      if (r + 1 < GRID_SIZE && grid[r + 1][c]?.value === t.value) return true;
      if (c + 1 < GRID_SIZE && grid[r][c + 1]?.value === t.value) return true;
    }
  }
  return false;
};

export const hasWon = (state: Game2048State): boolean =>
  state.highestTile >= WIN_TILE;

export const DIRECTION_KEYS: Record<string, Direction> = {
  arrowup: 'UP',
  arrowdown: 'DOWN',
  arrowleft: 'LEFT',
  arrowright: 'RIGHT',
  w: 'UP',
  s: 'DOWN',
  a: 'LEFT',
  d: 'RIGHT',
};
