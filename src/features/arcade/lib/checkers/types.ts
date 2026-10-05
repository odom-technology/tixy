// ---------------------------------------------------------------------------
// Shared checkers types (usable in server and client).
//
// Mirrors the chess `lib/chess/types.ts` surface so the cloned match module can
// stay structurally identical. Checkers runs UNTIMED, so the time-format presets
// are kept (single fixed "untimed" preset) purely to satisfy the shared shapes
// the match table + lobby expect — no clock ever runs.
// ---------------------------------------------------------------------------

export type MatchStatus = 'waiting' | 'active' | 'completed' | 'forfeited';

export type WinReason =
  | 'no_moves'        // opponent has no legal move (blocked or no pieces)
  | 'resignation'
  | 'draw_agreement'
  | 'forty_move'      // 40 moves by each side with no capture / no king made
  | 'forfeit';

export type GameResult = '1-0' | '0-1' | '1/2-1/2';

/** Red moves first (bottom of the board), white is the opponent. */
export type CheckersColor = 'red' | 'white';

export type CheckersMatch = {
  id: string;
  player1Id: string;
  player1Name: string;
  player2Id: string | null;
  player2Name: string | null;
  invitedUserId: string | null;
  /** Which player controls the RED discs (moves first). */
  redId: string | null;
  /** Which player controls the WHITE discs. */
  whiteId: string | null;
  status: MatchStatus;
  currentTurn: string;
  timeFormat: string;
  initialTimeMs: number;
  incrementMs: number;
  redTimeMs: number;
  whiteTimeMs: number;
  lastMoveAt: number | null;
  /** 64-char board string (see rules.ts STARTING_BOARD). */
  board: string;
  ply: number;
  moveCount: number;
  /** Move notation of the last move played (e.g. "c3-d4" or "c3xe5xg7"). */
  lastMove: string | null;
  drawOfferedBy: string | null;
  drawOfferedAt: number | null;
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

// ---------------------------------------------------------------------------
// Time format presets — checkers is untimed, so there's a single preset. Kept
// for parity with the shared match table / lobby plumbing the chess clone uses.
// ---------------------------------------------------------------------------

type TimeFormatPreset = {
  id: string;
  label: string;
  initialTimeMs: number;
  incrementMs: number;
};

export const TIME_FORMAT_PRESETS: TimeFormatPreset[] = [
  { id: 'untimed', label: 'Untimed', initialTimeMs: 0, incrementMs: 0 },
];

const TIME_FORMAT_BY_ID: Record<string, TimeFormatPreset> = Object.fromEntries(
  TIME_FORMAT_PRESETS.map((p) => [p.id, p]),
);

export function resolveTimeFormat(id: string | null | undefined): TimeFormatPreset {
  return (id && TIME_FORMAT_BY_ID[id]) || TIME_FORMAT_BY_ID.untimed;
}

export function isValidTimeFormatId(id: unknown): id is string {
  return typeof id === 'string' && id in TIME_FORMAT_BY_ID;
}

/**
 * Starting board for standard 8×8 American/English draughts.
 *
 * Encoding: 64 characters, index 0 = row 0 (top, white's back rank) col 0,
 * reading left→right, top→bottom (row-major). Row 7 is red's back rank.
 *   '.' empty
 *   'r' red man, 'R' red king
 *   'w' white man, 'W' white king
 *
 * Only dark squares (where (row + col) is odd) ever hold a piece. White occupies
 * rows 0-2, red occupies rows 5-7. Red advances UP (decreasing row), white
 * advances DOWN (increasing row).
 */
export const STARTING_BOARD = [
  '.w.w.w.w', // row 0
  'w.w.w.w.', // row 1
  '.w.w.w.w', // row 2
  '........', // row 3
  '........', // row 4
  'r.r.r.r.', // row 5
  '.r.r.r.r', // row 6
  'r.r.r.r.', // row 7
].join('');
