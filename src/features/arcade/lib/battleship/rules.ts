// ---------------------------------------------------------------------------
// Battleship rules engine. Pure + isomorphic (no Node-only imports) so the
// server match module and the client placement UI can share it. The SERVER is
// always authoritative; the client uses these only for instant UI feedback.
//
// Board: 100 cells, index = row*10 + col, row 0 = top, col 0 = left.
//
// THE ANTI-CHEAT CORE is `redactMatchForViewer`: it takes the full match (both
// hidden fleets) and a viewer id, and returns a `PublicMatch` that NEVER
// contains the opponent's un-hit ship cells. Every API response is built from
// it. See the per-field reasoning inline.
// ---------------------------------------------------------------------------

import {
  BOARD_COLS,
  BOARD_ROWS,
  BOARD_CELLS,
  FLEET,
  FLEET_CELL_COUNT,
  SHIP_SIZES,
  cellIndex,
  colOf,
  inBounds,
  rowOf,
  type BattleshipMatch,
  type GameResult,
  type Orientation,
  type PublicMatch,
  type Shot,
  type ShipPlacement,
  type ShipType,
  type ViewerRole,
  type WinReason,
} from './types';

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

/** The cells a ship of `size` would occupy starting at `start` with orientation.
 *  Returns null if it would run off the board. Pure — no overlap check. */
export function shipCellsFromStart(
  start: number,
  size: number,
  orientation: Orientation,
): number[] | null {
  if (!inBounds(start)) return null;
  const row = rowOf(start);
  const col = colOf(start);
  const cells: number[] = [];
  for (let i = 0; i < size; i++) {
    const r = orientation === 'v' ? row + i : row;
    const c = orientation === 'h' ? col + i : col;
    if (r < 0 || r >= BOARD_ROWS || c < 0 || c >= BOARD_COLS) return null;
    cells.push(cellIndex(r, c));
  }
  return cells;
}

/** Is `cells` a straight, contiguous, in-bounds horizontal/vertical run of
 *  exactly `size` cells? (Order-independent.) */
function isStraightContiguous(cells: number[], size: number): boolean {
  if (cells.length !== size) return false;
  if (cells.some((c) => !inBounds(c))) return false;
  if (new Set(cells).size !== cells.length) return false;

  const sorted = [...cells].sort((a, b) => a - b);
  const rows = sorted.map(rowOf);
  const cols = sorted.map(colOf);
  const sameRow = rows.every((r) => r === rows[0]);
  const sameCol = cols.every((c) => c === cols[0]);

  if (sameRow) {
    // contiguous columns
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i] !== sorted[i - 1] + 1) return false;
    }
    return true;
  }
  if (sameCol) {
    // contiguous rows (step of BOARD_COLS)
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i] !== sorted[i - 1] + BOARD_COLS) return false;
    }
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Fleet placement validation (server-authoritative)
// ---------------------------------------------------------------------------

const SHIP_IDS: ShipType[] = FLEET.map((s) => s.id);
const isShipType = (v: unknown): v is ShipType =>
  typeof v === 'string' && (SHIP_IDS as string[]).includes(v);

/**
 * Parse + strictly validate a placement payload into a canonical `ShipPlacement[]`.
 * Throws `Invalid placement: ...` (malformed input) or `Illegal placement: ...`
 * (rules broken) — the place route maps both prefixes to HTTP 400.
 *
 * Rules: exactly the 5 standard ships (one each, correct length), each a
 * straight contiguous in-bounds line, with NO overlaps between ships.
 */
export function parseAndValidateFleet(input: unknown): ShipPlacement[] {
  if (!Array.isArray(input)) {
    throw new Error('Invalid placement: expected an array of ships.');
  }
  if (input.length !== FLEET.length) {
    throw new Error(`Invalid placement: expected ${FLEET.length} ships, got ${input.length}.`);
  }

  const byId = new Map<ShipType, ShipPlacement>();
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') {
      throw new Error('Invalid placement: malformed ship entry.');
    }
    const id = (raw as { id?: unknown }).id;
    const cells = (raw as { cells?: unknown }).cells;
    if (!isShipType(id)) {
      throw new Error(`Invalid placement: unknown ship id '${String(id)}'.`);
    }
    if (!Array.isArray(cells) || cells.some((c) => typeof c !== 'number')) {
      throw new Error(`Invalid placement: ${id} cells must be an array of numbers.`);
    }
    if (byId.has(id)) {
      throw new Error(`Illegal placement: ${id} placed more than once.`);
    }
    const size = SHIP_SIZES[id];
    if (!isStraightContiguous(cells as number[], size)) {
      throw new Error(`Illegal placement: ${id} must be a straight line of ${size} in-bounds cells.`);
    }
    byId.set(id, { id, cells: [...(cells as number[])].sort((a, b) => a - b) });
  }

  for (const ship of FLEET) {
    if (!byId.has(ship.id)) {
      throw new Error(`Invalid placement: missing ${ship.id}.`);
    }
  }

  // No overlaps across the whole fleet.
  const occupied = new Set<number>();
  for (const ship of byId.values()) {
    for (const cell of ship.cells) {
      if (occupied.has(cell)) {
        throw new Error('Illegal placement: ships overlap.');
      }
      occupied.add(cell);
    }
  }
  if (occupied.size !== FLEET_CELL_COUNT) {
    throw new Error('Illegal placement: fleet does not cover the expected cells.');
  }

  // Canonical order (longest-first) for stable storage.
  return FLEET.map((s) => byId.get(s.id)!);
}

/** Non-throwing legality check used by the client UI for instant feedback. */
export function isFleetLegal(ships: ShipPlacement[]): boolean {
  try {
    parseAndValidateFleet(ships);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Shot resolution + sunk / win detection
// ---------------------------------------------------------------------------

const cellsHitBy = (shots: Shot[]): Set<number> =>
  new Set(shots.filter((s) => s.outcome === 'hit' || s.outcome === 'sunk').map((s) => s.cell));

const cellsFiredBy = (shots: Shot[]): Set<number> => new Set(shots.map((s) => s.cell));

/** Find the ship at `cell` in a fleet, or null. */
function shipAt(board: ShipPlacement[], cell: number): ShipPlacement | null {
  for (const ship of board) if (ship.cells.includes(cell)) return ship;
  return null;
}

/** Is every cell of `ship` contained in `hitCells`? */
function isShipSunk(ship: ShipPlacement, hitCells: Set<number>): boolean {
  return ship.cells.every((c) => hitCells.has(c));
}

export type ResolvedShot = {
  shot: Shot;
  /** True when this shot sank a ship. */
  sunk: boolean;
  /** The ship sunk, if any. */
  sunkShip: ShipPlacement | null;
  /** True once the whole target fleet is destroyed (terminal). */
  fleetDestroyed: boolean;
};

/**
 * Resolve a shot by `cell` against `targetBoard`, given the shooter's prior
 * shots. Throws `Illegal shot: ...` / `Invalid shot: ...` (mapped to 400) when
 * the cell is off-board or already fired. Pure — caller persists the result.
 */
export function resolveShot(
  targetBoard: ShipPlacement[],
  priorShots: Shot[],
  cell: number,
): ResolvedShot {
  if (!inBounds(cell)) {
    throw new Error(`Illegal shot: cell ${cell} is out of range (0-${BOARD_CELLS - 1}).`);
  }
  if (cellsFiredBy(priorShots).has(cell)) {
    throw new Error(`Illegal shot: cell ${cell} was already fired at.`);
  }

  const ship = shipAt(targetBoard, cell);
  if (!ship) {
    const shot: Shot = { cell, outcome: 'miss' };
    return { shot, sunk: false, sunkShip: null, fleetDestroyed: false };
  }

  // Hit. Recompute hit set INCLUDING this shot to test for a sink.
  const hitCells = cellsHitBy(priorShots);
  hitCells.add(cell);
  const sunk = isShipSunk(ship, hitCells);
  const shot: Shot = sunk ? { cell, outcome: 'sunk', shipId: ship.id } : { cell, outcome: 'hit' };
  const fleetDestroyed = targetBoard.every((s) => isShipSunk(s, hitCells));
  return { shot, sunk, sunkShip: sunk ? ship : null, fleetDestroyed };
}

/** Has the whole `targetBoard` been destroyed by `shotsAgainst`? */
export function isFleetDestroyed(targetBoard: ShipPlacement[], shotsAgainst: Shot[]): boolean {
  const hits = cellsHitBy(shotsAgainst);
  return targetBoard.every((ship) => isShipSunk(ship, hits));
}

/** Ships in `board` fully sunk by `shotsAgainst` (cells already hit → safe to reveal). */
function sunkShipsOf(
  board: ShipPlacement[] | null,
  shotsAgainst: Shot[],
): Array<{ id: ShipType; cells: number[] }> {
  if (!board) return [];
  const hits = cellsHitBy(shotsAgainst);
  return board
    .filter((ship) => isShipSunk(ship, hits))
    .map((ship) => ({ id: ship.id, cells: [...ship.cells] }));
}

/** Count of `board` cells NOT yet hit by `shotsAgainst`. */
function fleetRemaining(board: ShipPlacement[] | null, shotsAgainst: Shot[]): number {
  if (!board) return FLEET_CELL_COUNT;
  const hits = cellsHitBy(shotsAgainst);
  let remaining = 0;
  for (const ship of board) for (const c of ship.cells) if (!hits.has(c)) remaining++;
  return remaining;
}

/** Shooter accuracy (hits / shots) as a 0-100 integer. */
export function accuracyOf(shots: Shot[]): number {
  if (shots.length === 0) return 0;
  const hits = shots.filter((s) => s.outcome === 'hit' || s.outcome === 'sunk').length;
  return Math.round((hits / shots.length) * 100);
}

// ---------------------------------------------------------------------------
// Seat helpers
// ---------------------------------------------------------------------------

/** Which seat is `userId` in this match? */
export function seatForPlayer(
  match: { player1Id: string; player2Id: string | null },
  userId: string,
): 'player1' | 'player2' | null {
  if (match.player1Id === userId) return 'player1';
  if (match.player2Id === userId) return 'player2';
  return null;
}

// ---------------------------------------------------------------------------
// THE ANTI-CHEAT CORE — per-viewer redaction
// ---------------------------------------------------------------------------

/**
 * Build the redacted, viewer-specific `PublicMatch` from a full match.
 *
 * GUARANTEE: the returned object NEVER contains an opponent's un-hit ship cells
 * while the game is live.
 *  - A player sees ONLY their own fleet (`myBoard`), their own shots
 *    (`myShots`), and the shots fired at them (`incomingShots`). The opponent's
 *    fleet layout is simply not assembled into any returned field.
 *  - Sunk-ship cell lists describe ONLY cells that are already fully hit, so
 *    they expose nothing the viewer didn't already learn by hitting them.
 *  - `oppFleetRemaining` is a bare count, never positions.
 *  - Spectators get NO fleet layout at all (both `myBoard` null) — only the two
 *    public shot histories — until the game completes.
 *  - Full fleets are revealed (`revealedBoards`) ONLY when status==='completed'.
 */
export function redactMatchForViewer(
  match: BattleshipMatch,
  viewerId: string | null,
  _opts?: { isSpectator?: boolean },
): PublicMatch {
  const seat = viewerId ? seatForPlayer(match, viewerId) : null;
  const role: ViewerRole = seat ?? 'spectator';
  const completed = match.status === 'completed' || match.status === 'forfeited';

  // Resolve viewer-relative fleets + shot streams WITHOUT ever placing the
  // opponent's board into a returned field.
  let myShots: Shot[]; // shots the viewer fired (at the opponent)
  let incomingShots: Shot[]; // shots fired at the viewer
  let myFleetBoard: ShipPlacement[] | null; // viewer's own fleet (for sunk/remaining)
  let oppBoard: ShipPlacement[] | null; // opponent fleet — used ONLY for sunk-cell + counts, never returned raw

  if (role === 'player1') {
    myFleetBoard = match.player1Board;
    oppBoard = match.player2Board;
    myShots = match.player1Shots;
    incomingShots = match.player2Shots;
  } else if (role === 'player2') {
    myFleetBoard = match.player2Board;
    oppBoard = match.player1Board;
    myShots = match.player2Shots;
    incomingShots = match.player1Shots;
  } else {
    // Spectator: expose only the two public shot histories (peg results); NO
    // fleet layout of either side until the game is over.
    myFleetBoard = null;
    oppBoard = match.player2Board; // for the count/sunk of player2's fleet only
    myShots = match.player1Shots;
    incomingShots = match.player2Shots;
  }

  // Reveal the viewer's own fleet to a player; spectators never get a layout here.
  const myBoard: ShipPlacement[] | null = role === 'spectator' ? null : myFleetBoard;

  // Opponent ships the viewer has SUNK (cells are already fully hit → safe).
  const oppSunkShips = sunkShipsOf(oppBoard, myShots);
  // The viewer's own ships that were sunk (viewer already knows their layout).
  const mySunkShips = sunkShipsOf(myFleetBoard, incomingShots);

  const myFleetRemaining = fleetRemaining(myFleetBoard, incomingShots);
  const oppFleetRemaining = fleetRemaining(oppBoard, myShots);

  const base: PublicMatch = {
    id: match.id,
    player1Id: match.player1Id,
    player1Name: match.player1Name,
    player2Id: match.player2Id,
    player2Name: match.player2Name,
    invitedUserId: match.invitedUserId,
    status: match.status,
    phase: match.phase,
    currentTurn: match.currentTurn,
    ply: match.ply,
    moveCount: match.moveCount,
    lastMove: match.lastMove,
    result: match.result,
    winnerId: match.winnerId,
    loserId: match.loserId,
    winReason: match.winReason,
    player1Ready: match.player1Ready,
    player2Ready: match.player2Ready,
    tournamentMatchId: match.tournamentMatchId,
    wagerAmount: match.wagerAmount,
    wagerStatus: match.wagerStatus,
    createdAt: match.createdAt,
    updatedAt: match.updatedAt,
    completedAt: match.completedAt,
    viewerRole: role,
    myBoard,
    myShots,
    incomingShots,
    myFleetRemaining,
    oppFleetRemaining,
    oppSunkShips,
    mySunkShips,
  };

  // Standard post-game reveal — STRICTLY gated on a finished match.
  if (completed) {
    base.revealedBoards = {
      player1Board: match.player1Board,
      player2Board: match.player2Board,
    };
    if (role === 'spectator') base.myBoard = null;
  }

  return base;
}

// Re-export geometry constants for convenience.
export { BOARD_COLS, BOARD_ROWS, BOARD_CELLS, FLEET, SHIP_SIZES };
export type { GameResult, WinReason };
