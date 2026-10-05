/* A reference 2048 client for the verifiers: the client's own helpers
   (createInitialState, moveTiles, spawnTile, hasLegalMove) and the undo
   snapshot of _2048-client.tsx, driven by a bot. Shared by verify-2048-replay.ts
   and verify-trusted-scores-http.ts. */
import {
  createSpawnRng,
  type Game2048MoveCode,
} from '@/server/arcade/game-2048-replay';
import {
  createInitialState,
  hasLegalMove,
  moveTiles,
  spawnTile,
  type Game2048State,
} from '@/app/(games)/2048/_2048-helpers';
import type { Direction } from '@/app/(games)/2048/_2048-types';

const CODES: Record<Direction, Game2048MoveCode> = { UP: 'U', DOWN: 'D', LEFT: 'L', RIGHT: 'R' };

export type ClientRun = {
  seed: number;
  log: Array<[number, Game2048MoveCode]>;
  score: number;
  highestTile: number;
  moves: number;
  undone: boolean;
  cells: number[];
  durationMs: number;
};

const gridOf = (state: Game2048State): number[] => {
  const cells = new Array<number>(16).fill(0);
  for (const t of state.tiles) cells[t.row * 4 + t.col] = t.value;
  return cells;
};

/** The client's run, move for move as _2048-client.tsx plays it: a seeded
 *  deal, a snapshot before each move, the undo that restores the board, the
 *  move count and the spawn stream, the move log. `paceMs` is the time between
 *  moves. Ends when the board is stuck, or at `maxMoves` (a player can stop). */
export function playClient(
  seed: number,
  policy: 'corner' | 'random',
  pace: () => number,
  options: { undoAfter?: number; maxMoves?: number; rng: () => number },
): ClientRun {
  const spawn = createSpawnRng(seed);
  let state = createInitialState(spawn.next);
  let snapshot: { state: Game2048State; moves: number; rng: number } | null = null;
  let moves = 0;
  let applied = 0;
  let undone = false;
  let t = 0;
  const log: Array<[number, Game2048MoveCode]> = [];
  const maxMoves = options.maxMoves ?? 100000;

  while (applied < maxMoves) {
    const order: Direction[] =
      policy === 'corner'
        ? options.rng() < 0.12
          ? ['LEFT', 'DOWN', 'RIGHT', 'UP']
          : ['DOWN', 'LEFT', 'RIGHT', 'UP']
        : (['UP', 'DOWN', 'LEFT', 'RIGHT'] as Direction[]).sort(() => options.rng() - 0.5);
    let played = false;
    for (const direction of order) {
      const { state: moved, moved: didMove } = moveTiles(state, direction);
      if (!didMove) continue;
      t += pace();
      snapshot = {
        state: {
          ...state,
          tiles: state.tiles.map((x) => ({ id: x.id, value: x.value, row: x.row, col: x.col })),
        },
        moves,
        rng: spawn.state,
      };
      const next = spawnTile(moved.tiles, moved.nextId, spawn.next);
      state = {
        tiles: next.tile ? [...moved.tiles, next.tile] : moved.tiles,
        score: moved.score,
        highestTile: next.tile ? Math.max(moved.highestTile, next.tile.value) : moved.highestTile,
        nextId: next.nextId,
      };
      moves += 1;
      applied += 1;
      log.push([Math.round(t), CODES[direction]]);
      played = true;
      if (state.highestTile >= 2048) snapshot = null;
      break;
    }
    if (!played || !hasLegalMove(state)) break;
    if (!undone && options.undoAfter !== undefined && applied === options.undoAfter && snapshot) {
      t += pace();
      undone = true;
      moves = snapshot.moves;
      spawn.state = snapshot.rng;
      state = snapshot.state;
      snapshot = null;
      log.push([Math.round(t), 'Z']);
    }
  }
  return {
    seed,
    log,
    score: state.score,
    highestTile: state.highestTile,
    moves,
    undone,
    cells: gridOf(state),
    durationMs: Math.round(t),
  };
}
