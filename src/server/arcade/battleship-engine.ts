// ---------------------------------------------------------------------------
// Battleship pure engine entry point.
//
// The canonical implementation lives in the isomorphic lib at
// `@/features/arcade/lib/battleship` (shared verbatim with the client placement
// UI). This module re-exports the pure engine API under the stable names the
// server match + bot modules import:
//
//   parseAndValidateFleet(input) -> ShipPlacement[]   (throws on illegal)
//   resolveShot(board, priorShots, cell) -> ResolvedShot
//   isFleetDestroyed(board, shotsAgainst) -> boolean
//   accuracyOf(shots) -> number
//   seatForPlayer(match, userId) -> 'player1'|'player2'|null
//   redactMatchForViewer(match, viewerId, opts) -> PublicMatch   (THE ANTI-CHEAT CORE)
//   shipCellsFromStart(start, size, orientation) -> number[]|null
//
// Encoding: 100-cell grid, index = row*10 + col. Fleet = Carrier(5),
// Battleship(4), Cruiser(3), Submarine(3), Destroyer(2).
// ---------------------------------------------------------------------------

export {
  parseAndValidateFleet,
  isFleetLegal,
  resolveShot,
  isFleetDestroyed,
  accuracyOf,
  seatForPlayer,
  redactMatchForViewer,
  shipCellsFromStart,
  BOARD_COLS,
  BOARD_ROWS,
  BOARD_CELLS,
  FLEET,
  SHIP_SIZES,
  type ResolvedShot,
} from '@/features/arcade/lib/battleship';

export type {
  BattleshipMatch,
  PublicMatch,
  Phase,
  MatchStatus,
  WinReason,
  GameResult,
  Shot,
  ShotOutcome,
  ShipPlacement,
  ShipType,
  Orientation,
  ViewerRole,
} from '@/features/arcade/lib/battleship/types';
