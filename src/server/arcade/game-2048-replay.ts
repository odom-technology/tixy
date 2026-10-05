/* 2048's server replay. The session hands out a seed; every tile the run
   spawns, the two it starts with and one after each move, comes from that
   seed. The client posts the moves it made, each with the time it made it
   (ms since its run began), and the server plays them again on the same rules:
   the score and the highest tile are what the replay reaches. The client's own
   figures are never trusted and have to match.

   The client deals its spawns through the same two functions (createSpawnRng
   and pickSpawn), so a seeded board can't drift from the server's.

   What the server bounds:
   - The moves are legal: a move that changes nothing isn't one the client
     would log, and nothing follows a board with no move left.
   - The run fits inside the session. The server stamped the session's start
     when the run was dealt, so a run whose last move is later than the
     session is old is rejected.
   - The pace is human. See the floors below.
   - Undo. One a day on a device is the client's rule. In the move list an
     undo is the entry 'Z': it takes back the move just before it, board,
     score and spawn together (the next move deals the tile the undone one
     did, so an undo isn't a re-roll). A run holds at most one, and only
     straight after a move, never straight after the move that made 2048
     (the client clears undo there). The score route also counts the runs
     that held one, per player, per day. */

export const GAME_2048_SIZE = 4;
const CELLS = GAME_2048_SIZE * GAME_2048_SIZE;
export const GAME_2048_WIN_TILE = 2048;

/** U, D, L, R slide the board. Z is the undo. */
export type Game2048MoveCode = 'U' | 'D' | 'L' | 'R' | 'Z';
/** A logged move: [ms since the run began, code]. */
export type Game2048Move = readonly [number, Game2048MoveCode];

export const GAME_2048_MAX_MOVES = 250_000;

/* Pace floors, over the moves the client logs (only moves that changed the
   board are logged, an undo included).

   1. No two gaps in a row under 15 ms. Two arrow keys hit together, a roll
      or a chord while mashing, land a few ms apart, so one gap that short is
      a person (the client stamps each move with its key's or swipe's own
      time, so a busy frame doesn't squeeze presses closer). But one key
      repeats no faster than about 30 ms and a screen reports a tap no faster
      than a frame, so three board-changing entries inside two such gaps
      only come from a script.
   2. No 50 entries inside 1.96 s (40 ms apiece, 25 a second). Holding an
      arrow key repeats at up to about 33 ms, but a held key only keeps
      changing the board for a few presses before it jams, so a held key
      doesn't reach 50 logged moves in a row. A script can.
   3. Over a run of 100 or more entries, 80 ms a move on average (12.5 a
      second) from first to last. Fast human play is 5 to 8 a second over a
      whole run; 12.5 is beyond sustained tapping on one hand. A bot that stays
      under it still has to spend real time for every move, so a score costs
      the clock what it costs a person. */
export const GAME_2048_MIN_GAP_MS = 15;
export const GAME_2048_WINDOW_MOVES = 50;
export const GAME_2048_WINDOW_MIN_MS = 49 * 40;
export const GAME_2048_AVG_FLOOR_FROM = 100;
export const GAME_2048_AVG_MIN_MS = 80;
/** The run's clock starts after the session is stamped, so a run can't have
 *  lasted longer than the session; a second covers rounding. */
export const GAME_2048_CLOCK_SLACK_MS = 1000;

export type SpawnRng = {
  /** The next draw, in [0, 1). */
  next: () => number;
  /** The generator's whole state. Set it to rewind (undo). */
  state: number;
};

/** The spawn stream for a seed: a 32-bit mulberry generator whose state can
 *  be read and put back. */
export const createSpawnRng = (seed: number): SpawnRng => {
  const rng: SpawnRng = {
    state: seed >>> 0,
    next: () => {
      rng.state = (rng.state + 0x6d2b79f5) >>> 0;
      let t = rng.state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
  };
  return rng;
};

/** One spawn: which empty cell (in reading order) and a 2 (90%) or a 4.
 *  Two draws, cell first. */
export const pickSpawn = (
  emptyCount: number,
  next: () => number,
): { index: number; value: 2 | 4 } => {
  const index = Math.floor(next() * emptyCount);
  const value = next() < 0.9 ? 2 : 4;
  return { index, value };
};

const lineIndexes = (move: 'U' | 'D' | 'L' | 'R', n: number): number[] => {
  const line: number[] = [];
  for (let i = 0; i < GAME_2048_SIZE; i += 1) {
    const j = move === 'L' || move === 'U' ? i : GAME_2048_SIZE - 1 - i;
    line.push(move === 'L' || move === 'R' ? n * GAME_2048_SIZE + j : j * GAME_2048_SIZE + n);
  }
  return line;
};

/** Slides a board. Cells are row by row, 0 for empty. */
export const slide2048 = (
  cells: readonly number[],
  move: 'U' | 'D' | 'L' | 'R',
): { cells: number[]; gained: number; changed: boolean } => {
  const out = new Array<number>(CELLS).fill(0);
  let gained = 0;
  let changed = false;
  for (let n = 0; n < GAME_2048_SIZE; n += 1) {
    const idx = lineIndexes(move, n);
    const tiles = idx.map((i) => cells[i]!).filter((v) => v !== 0);
    const merged: number[] = [];
    for (let i = 0; i < tiles.length; i += 1) {
      if (tiles[i + 1] === tiles[i]) {
        const value = tiles[i]! * 2;
        merged.push(value);
        gained += value;
        i += 1;
      } else {
        merged.push(tiles[i]!);
      }
    }
    merged.forEach((value, i) => {
      out[idx[i]!] = value;
    });
    if (idx.some((cellIndex) => out[cellIndex] !== cells[cellIndex])) changed = true;
  }
  return { cells: out, gained, changed };
};

export const hasMove2048 = (cells: readonly number[]): boolean => {
  if (cells.some((v) => v === 0)) return true;
  for (let r = 0; r < GAME_2048_SIZE; r += 1) {
    for (let c = 0; c < GAME_2048_SIZE; c += 1) {
      const v = cells[r * GAME_2048_SIZE + c];
      if (c + 1 < GAME_2048_SIZE && cells[r * GAME_2048_SIZE + c + 1] === v) return true;
      if (r + 1 < GAME_2048_SIZE && cells[(r + 1) * GAME_2048_SIZE + c] === v) return true;
    }
  }
  return false;
};

const spawnInto = (cells: number[], next: () => number): boolean => {
  const empty: number[] = [];
  for (let i = 0; i < CELLS; i += 1) if (cells[i] === 0) empty.push(i);
  if (empty.length === 0) return false;
  const { index, value } = pickSpawn(empty.length, next);
  cells[empty[index]!] = value;
  return true;
};

/** The two tiles a seeded run starts with. */
export const initialBoard2048 = (rng: SpawnRng): number[] => {
  const cells = new Array<number>(CELLS).fill(0);
  spawnInto(cells, rng.next);
  spawnInto(cells, rng.next);
  return cells;
};

const MOVE_CODES: ReadonlySet<string> = new Set(['U', 'D', 'L', 'R', 'Z']);

/** Reads the wire form, `[[ms, 'L'], ...]`. Null when it isn't that. */
export function parseGame2048Moves(raw: unknown): Game2048Move[] | null {
  if (!Array.isArray(raw) || raw.length > GAME_2048_MAX_MOVES) return null;
  const moves: Game2048Move[] = [];
  for (const entry of raw) {
    if (!Array.isArray(entry) || entry.length !== 2) return null;
    const [t, code] = entry as [unknown, unknown];
    if (typeof t !== 'number' || !Number.isFinite(t) || t < 0) return null;
    if (typeof code !== 'string' || !MOVE_CODES.has(code)) return null;
    moves.push([t, code as Game2048MoveCode]);
  }
  return moves;
}

export type Game2048Run =
  | {
      ok: true;
      score: number;
      highestTile: number;
      /** Moves that count: the list's slides, less one when it was undone. */
      moves: number;
      /** 1 when the run holds its undo. */
      undos: number;
      /** ms of the last entry on the run's own clock. */
      lastMoveMs: number;
      /** The board has no move left. */
      over: boolean;
      cells: number[];
    }
  | { ok: false; reason: string; at?: number };

const fail = (reason: string, at?: number): Game2048Run => ({ ok: false, reason, at });

export type Game2048ReplayOptions = {
  /** The server's age of the session. When set, a run that outlasts it is rejected. */
  elapsedMs?: number;
  /** A board to start from instead of the seed's deal. For the verifier's
   *  boards no seed deals (a run that reaches 2048 in a few moves). */
  startCells?: readonly number[];
};

export function replayGame2048(
  seed: number,
  moves: readonly Game2048Move[],
  options: Game2048ReplayOptions = {},
): Game2048Run {
  if (moves.length > GAME_2048_MAX_MOVES) return fail('Too many moves');

  // Pace and clock, before any play.
  let closeBefore = false;
  for (let i = 0; i < moves.length; i += 1) {
    const t = moves[i]![0];
    if (i > 0) {
      const gap = t - moves[i - 1]![0];
      if (gap < 0) return fail('Moves out of order', i);
      const close = gap < GAME_2048_MIN_GAP_MS;
      if (close && closeBefore) {
        return fail(`Three moves in ${t - moves[i - 2]![0]}ms`, i);
      }
      closeBefore = close;
    }
    if (i >= GAME_2048_WINDOW_MOVES - 1) {
      const span = t - moves[i - (GAME_2048_WINDOW_MOVES - 1)]![0];
      if (span < GAME_2048_WINDOW_MIN_MS) {
        return fail(`${GAME_2048_WINDOW_MOVES} moves in ${span}ms`, i);
      }
    }
  }
  const lastMoveMs = moves.length > 0 ? moves[moves.length - 1]![0] : 0;
  if (moves.length >= GAME_2048_AVG_FLOOR_FROM) {
    const avg = (lastMoveMs - moves[0]![0]) / (moves.length - 1);
    if (avg < GAME_2048_AVG_MIN_MS) {
      return fail(`${moves.length} moves at ${avg.toFixed(1)}ms each`);
    }
  }
  if (
    options.elapsedMs !== undefined &&
    lastMoveMs > options.elapsedMs + GAME_2048_CLOCK_SLACK_MS
  ) {
    return fail(
      `Run lasted ${Math.round(lastMoveMs)}ms; the session is ${Math.round(options.elapsedMs)}ms old`,
    );
  }

  const rng = createSpawnRng(seed);
  let cells = options.startCells ? [...options.startCells] : initialBoard2048(rng);
  let score = 0;
  let highestTile = Math.max(...cells);
  let applied = 0;
  let undos = 0;
  let over = false;
  let wonSeen = false;
  let snapshot: {
    cells: number[];
    score: number;
    highestTile: number;
    rngState: number;
    applied: number;
  } | null = null;

  for (let i = 0; i < moves.length; i += 1) {
    const code = moves[i]![1];
    if (over) return fail('Move after the board was stuck', i);

    if (code === 'Z') {
      if (snapshot === null) return fail('Undo with nothing to take back', i);
      if (undos >= 1) return fail('More than one undo', i);
      cells = snapshot.cells;
      score = snapshot.score;
      highestTile = snapshot.highestTile;
      rng.state = snapshot.rngState;
      applied = snapshot.applied;
      snapshot = null;
      undos += 1;
      continue;
    }

    const slid = slide2048(cells, code);
    if (!slid.changed) return fail('Move that changes nothing', i);
    snapshot = { cells, score, highestTile, rngState: rng.state, applied };
    cells = slid.cells;
    score += slid.gained;
    spawnInto(cells, rng.next);
    highestTile = Math.max(highestTile, ...cells);
    applied += 1;
    if (!wonSeen && highestTile >= GAME_2048_WIN_TILE) {
      wonSeen = true;
      // The client clears undo on the move that makes 2048.
      snapshot = null;
    }
    if (!hasMove2048(cells)) over = true;
  }

  return { ok: true, score, highestTile, moves: applied, undos, lastMoveMs, over, cells };
}

/** The replay, held to the client's claim: what the score route runs. A run
 *  whose score or highest tile isn't the replay's is rejected. */
export function verifyGame2048Run(
  seed: number,
  moves: readonly Game2048Move[],
  claim: { score: number; highestTile: number },
  options: Game2048ReplayOptions = {},
): Game2048Run {
  const run = replayGame2048(seed, moves, options);
  if (run.ok === false) return run;
  if (run.score !== claim.score || run.highestTile !== claim.highestTile) {
    return fail(
      `Authoritative result mismatch (server=${run.score}/${run.highestTile}, client=${claim.score}/${claim.highestTile})`,
    );
  }
  return run;
}
