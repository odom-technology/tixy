// ---------------------------------------------------------------------------
// Shared Battleship types (usable in server and client).
//
// Battleship is a turn-based hidden-fleet game: 10×10 grid per player, two
// phases (placement, then alternating shots). The SERVER holds both fleet grids
// and never reveals an opponent's un-hit ship cells to a client (see rules.ts
// `redactMatchForViewer` — the anti-cheat core).
//
// Mirrors the Reversi/Connect Four type surface (MatchStatus / WinReason /
// GameResult + a Match domain object) so the match module and client pages stay
// structurally identical. Battleship runs UNTIMED; the cloned schema's clock
// columns (if any) go unused.
// ---------------------------------------------------------------------------

export type MatchStatus = 'waiting' | 'active' | 'completed' | 'forfeited';

/** Two-phase game. 'placement' = both players privately place their fleets;
 *  'active' = players alternate firing shots. Stored on `phase` column. */
export type Phase = 'placement' | 'active';

export type WinReason =
  | 'fleet_destroyed' // every cell of the enemy fleet was hit
  | 'resignation'
  | 'forfeit';

// Kept in the same literal alphabet as Connect Four/Reversi so the cloned match
// + postgame surfaces work unchanged. Battleship cannot draw. '1-0' = player1
// wins, '0-1' = player2 wins.
export type GameResult = '1-0' | '0-1';

// ---------------------------------------------------------------------------
// Board geometry + fleet
// ---------------------------------------------------------------------------

export const BOARD_COLS = 10;
export const BOARD_ROWS = 10;
export const BOARD_CELLS = BOARD_COLS * BOARD_ROWS; // 100

export type ShipType = 'carrier' | 'battleship' | 'cruiser' | 'submarine' | 'destroyer';

/** Standard fleet, longest-first (the order players place in). */
export const FLEET: ReadonlyArray<{ id: ShipType; label: string; size: number }> = [
  { id: 'carrier', label: 'Carrier', size: 5 },
  { id: 'battleship', label: 'Battleship', size: 4 },
  { id: 'cruiser', label: 'Cruiser', size: 3 },
  { id: 'submarine', label: 'Submarine', size: 3 },
  { id: 'destroyer', label: 'Destroyer', size: 2 },
];

export const SHIP_SIZES: Record<ShipType, number> = {
  carrier: 5,
  battleship: 4,
  cruiser: 3,
  submarine: 3,
  destroyer: 2,
};

export const SHIP_LABELS: Record<ShipType, string> = {
  carrier: 'Carrier',
  battleship: 'Battleship',
  cruiser: 'Cruiser',
  submarine: 'Submarine',
  destroyer: 'Destroyer',
};

/** Total ship cells in a full fleet (5+4+3+3+2 = 17). */
export const FLEET_CELL_COUNT = FLEET.reduce((sum, s) => sum + s.size, 0);

export type Orientation = 'h' | 'v';

/** One placed ship: the cell indices (0-99) it occupies, in line order. */
export type ShipPlacement = {
  id: ShipType;
  cells: number[];
};

export type ShotOutcome = 'hit' | 'miss' | 'sunk';

/** A fired shot + its resolved outcome. `shipId` is only set on 'sunk' (faithful
 *  Battleship hides which ship a mere 'hit' belongs to). A shot's cell, once
 *  fired, is the shooter's own knowledge — never leaks the enemy's un-hit cells. */
export type Shot = {
  cell: number;
  outcome: ShotOutcome;
  shipId?: ShipType;
};

// ---------------------------------------------------------------------------
// Domain object (server-side full row)
// ---------------------------------------------------------------------------

/**
 * Full, server-only match. `player1Board` / `player2Board` are the HIDDEN fleet
 * grids and must NEVER be sent to the opposing client. API routes return the
 * redacted `PublicMatch` (rules.ts) instead.
 */
export type BattleshipMatch = {
  id: string;
  player1Id: string;
  player1Name: string;
  player2Id: string | null;
  player2Name: string | null;
  invitedUserId: string | null;
  status: MatchStatus;
  phase: Phase;
  currentTurn: string | null;
  /** HIDDEN: player1's fleet placement (server-only). */
  player1Board: ShipPlacement[] | null;
  /** HIDDEN: player2's fleet placement (server-only). */
  player2Board: ShipPlacement[] | null;
  /** Shots player1 has fired at player2's fleet (+ outcomes). */
  player1Shots: Shot[];
  /** Shots player2 has fired at player1's fleet (+ outcomes). */
  player2Shots: Shot[];
  player1Ready: boolean;
  player2Ready: boolean;
  ply: number;
  moveCount: number;
  /** Cell index (0-99) of the most recent shot, as a string, or null. */
  lastMove: string | null;
  result: GameResult | null;
  winnerId: string | null;
  loserId: string | null;
  winReason: WinReason | null;
  tournamentMatchId: string | null;
  wagerAmount: number | null;
  wagerStatus: string | null;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
};

export type ViewerRole = 'player1' | 'player2' | 'spectator';

/**
 * Per-viewer redacted match. This is the ONLY match shape sent to clients. It
 * NEVER contains the opponent's un-hit ship cells:
 *  - `myBoard` is the requester's OWN fleet only (null for spectators pre-game-over).
 *  - `myShots` are shots the requester fired (their own knowledge).
 *  - `incomingShots` are shots fired AT the requester (also their own knowledge).
 *  - sunk-ship cell lists only ever describe cells that are already fully hit.
 *  - `revealedBoards` is populated ONLY when status === 'completed'.
 */
export type PublicMatch = {
  id: string;
  player1Id: string;
  player1Name: string;
  player2Id: string | null;
  player2Name: string | null;
  invitedUserId: string | null;
  status: MatchStatus;
  phase: Phase;
  currentTurn: string | null;
  ply: number;
  moveCount: number;
  lastMove: string | null;
  result: GameResult | null;
  winnerId: string | null;
  loserId: string | null;
  winReason: WinReason | null;
  player1Ready: boolean;
  player2Ready: boolean;
  tournamentMatchId: string | null;
  wagerAmount: number | null;
  wagerStatus: string | null;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;

  // ---- viewer-relative, redacted board state ----
  viewerRole: ViewerRole;
  /** The requester's OWN fleet (placement + active). Null for spectators until game over. */
  myBoard: ShipPlacement[] | null;
  /** Shots the requester fired at the opponent (spectator: player1's shots). */
  myShots: Shot[];
  /** Shots fired AT the requester (spectator: player2's shots). */
  incomingShots: Shot[];
  /** Ship cells still afloat on the requester's own fleet. */
  myFleetRemaining: number;
  /** Enemy ship cells not yet hit (a count only — no positions). */
  oppFleetRemaining: number;
  /** Opponent ships the requester has fully SUNK (cells already hit → safe to reveal). */
  oppSunkShips: Array<{ id: ShipType; cells: number[] }>;
  /** The requester's own ships that have been sunk. */
  mySunkShips: Array<{ id: ShipType; cells: number[] }>;
  /** Full reveal of both fleets — ONLY present when status === 'completed'. */
  revealedBoards?: {
    player1Board: ShipPlacement[] | null;
    player2Board: ShipPlacement[] | null;
  };
};

// ---------------------------------------------------------------------------
// Cell helpers
// ---------------------------------------------------------------------------

export const rowOf = (cell: number): number => Math.floor(cell / BOARD_COLS);
export const colOf = (cell: number): number => cell % BOARD_COLS;
export const cellIndex = (row: number, col: number): number => row * BOARD_COLS + col;
export const inBounds = (cell: number): boolean =>
  Number.isInteger(cell) && cell >= 0 && cell < BOARD_CELLS;
